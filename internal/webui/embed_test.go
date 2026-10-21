package webui_test

import (
	"bytes"
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/BeCrafter/sail/internal/webui"
)

const assetVersionPlaceholder = "__SAIL_ASSET_V__"

// fetch 发一次请求并读回响应体。
func fetch(t *testing.T, h http.Handler, method, target string) (*http.Response, string) {
	t.Helper()
	req := httptest.NewRequest(method, target, nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	resp := rec.Result()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("读取响应体失败: %v", err)
	}
	resp.Body.Close()
	return resp, string(body)
}

// 根路径必须直接给出 index.html:这是浏览器的入口。
func TestHandlerServesIndexAtRoot(t *testing.T) {
	h := webui.Handler()
	resp, body := fetch(t, h, http.MethodGet, "/")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET / = %d,期望 200", resp.StatusCode)
	}
	if ct := resp.Header.Get("Content-Type"); !strings.HasPrefix(ct, "text/html") {
		t.Errorf("GET / Content-Type = %q,期望 text/html", ct)
	}
	if !strings.Contains(body, `<div id="app"`) {
		t.Error("GET / 未返回 SPA 挂载点")
	}
	if strings.Contains(body, assetVersionPlaceholder) {
		t.Error("index.html 仍包含静态资源版本占位符")
	}
	if !strings.Contains(body, "/app.js?v=") || !strings.Contains(body, "/app.css?v=") {
		t.Error("index.html 的首屏资源没有带版本号")
	}
	if got := resp.Header.Get("Cache-Control"); got != "no-cache" {
		t.Errorf("index.html 必须 no-cache(升级即生效),实际 %q", got)
	}
	if got := resp.Header.Get("X-Content-Type-Options"); got != "nosniff" {
		t.Errorf("缺少 nosniff,实际 %q", got)
	}
}

// 真实静态文件按扩展名给 Content-Type,并允许长缓存(URL 不变、内容随二进制升级)。
func TestHandlerServesAssetsWithTypes(t *testing.T) {
	cases := []struct {
		path string
		want string
	}{
		{"/app.js", "text/javascript"},
		{"/app.css", "text/css"},
		{"/logo.svg", "image/svg+xml"},
		{"/lib/vue.global.prod.js", "text/javascript"},
		{"/lib/highlight.min.js", "text/javascript"},
		{"/lib/jszip.min.js", "text/javascript"},
		{"/lib/docx-preview.min.js", "text/javascript"},
		{"/lib/exceljs.min.js", "text/javascript"},
		{"/lib/pptx-preview.bundle.js", "text/javascript"},
		{"/lib/echarts.min.js", "text/javascript"},
		{"/lib/three.bundle.min.js", "text/javascript"},
		{"/lib/pako.min.js", "text/javascript"},
		{"/lib/UTIF.js", "text/javascript"},
		{"/lib/ag-psd.bundle.js", "text/javascript"},
		{"/lib/heic2any.min.js", "text/javascript"},
		{"/lib/preview_xlsx.js", "text/javascript"},
		{"/lib/preview_xlsx_formula.js", "text/javascript"},
	}
	h := webui.Handler()
	for _, c := range cases {
		// 只有带版本号的 URL 才允许长缓存;无版本 URL 必须每次校验。
		resp, body := fetch(t, h, http.MethodGet, c.path+"?v=test")
		if resp.StatusCode != http.StatusOK {
			t.Errorf("GET %s = %d,期望 200", c.path, resp.StatusCode)
			continue
		}
		if ct := resp.Header.Get("Content-Type"); !strings.HasPrefix(ct, c.want) {
			t.Errorf("GET %s Content-Type = %q,期望 %q", c.path, ct, c.want)
		}
		if body == "" {
			t.Errorf("GET %s 返回空内容", c.path)
		}
		if strings.Contains(body, assetVersionPlaceholder) {
			t.Errorf("GET %s 未替换版本占位符", c.path)
		}
		if got := resp.Header.Get("Cache-Control"); !strings.Contains(got, "immutable") {
			t.Errorf("GET %s 应可长缓存,实际 Cache-Control=%q", c.path, got)
		}
	}
	resp, _ := fetch(t, h, http.MethodGet, "/app.js")
	if got := resp.Header.Get("Cache-Control"); got != "no-cache" {
		t.Errorf("无版本 /app.js 必须 no-cache,实际 %q", got)
	}
}

// 单页应用的深链接刷新不能 404:未命中真实文件时回落到 index.html。
func TestHandlerFallsBackToIndexForDeepLinks(t *testing.T) {
	h := webui.Handler()
	for _, target := range []string{"/photos/2026/summer", "/browse/deep/path/", "/missing.js"} {
		resp, body := fetch(t, h, http.MethodGet, target)
		if resp.StatusCode != http.StatusOK {
			t.Errorf("GET %s = %d,期望回落 index.html(200)", target, resp.StatusCode)
			continue
		}
		if !strings.Contains(body, `<div id="app"`) {
			t.Errorf("GET %s 未回落到 SPA 入口", target)
		}
	}
}

// 静态资源只读:写入类方法明确 405,而不是悄悄当 GET 处理。
func TestHandlerRejectsWriteMethods(t *testing.T) {
	h := webui.Handler()
	for _, method := range []string{http.MethodPost, http.MethodPut, http.MethodDelete} {
		resp, _ := fetch(t, h, method, "/app.js")
		if resp.StatusCode != http.StatusMethodNotAllowed {
			t.Errorf("%s /app.js = %d,期望 405", method, resp.StatusCode)
		}
		if allow := resp.Header.Get("Allow"); !strings.Contains(allow, "GET") {
			t.Errorf("%s /app.js 缺少 Allow: GET,实际 %q", method, allow)
		}
	}
}

// HEAD 与 GET 同语义(响应体由 net/http 在真实连接上丢弃,这里只验头)。
func TestHandlerSupportsHead(t *testing.T) {
	h := webui.Handler()
	resp, _ := fetch(t, h, http.MethodHead, "/app.js")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("HEAD /app.js = %d,期望 200", resp.StatusCode)
	}
	if ct := resp.Header.Get("Content-Type"); !strings.HasPrefix(ct, "text/javascript") {
		t.Errorf("HEAD /app.js Content-Type = %q", ct)
	}
}

// 前端入口必须真的引用内置库,避免「打包了却没接上」的静默回归。
func TestIndexReferencesBundledLibraries(t *testing.T) {
	h := webui.Handler()
	_, body := fetch(t, h, http.MethodGet, "/")
	for _, want := range []string{"/app.js", "/app.css", "/lib/vue.global.prod.js", "/lib/highlight.min.js"} {
		if !strings.Contains(body, want) {
			t.Errorf("index.html 未引用 %s", want)
		}
	}
}

// 文本类静态资源在客户端声明 gzip 时必须压缩,并带上 Vary;解压后内容与
// 未压缩响应完全一致。已压缩格式(GIF 等)不重复压缩。
func TestHandlerGzipCompressesTextAssets(t *testing.T) {
	h := webui.Handler()
	req := httptest.NewRequest(http.MethodGet, "/app.js?v=test", nil)
	req.Header.Set("Accept-Encoding", "gzip")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	resp := rec.Result()
	defer resp.Body.Close()
	if enc := resp.Header.Get("Content-Encoding"); enc != "gzip" {
		t.Fatalf("app.js Content-Encoding = %q,期望 gzip", enc)
	}
	if vary := resp.Header.Get("Vary"); !strings.Contains(vary, "Accept-Encoding") {
		t.Errorf("缺少 Vary: Accept-Encoding,实际 %q", vary)
	}
	zr, err := gzip.NewReader(resp.Body)
	if err != nil {
		t.Fatalf("gzip 解压失败: %v", err)
	}
	decoded, err := io.ReadAll(zr)
	if err != nil {
		t.Fatalf("读取解压内容失败: %v", err)
	}
	zr.Close()
	_, raw := fetch(t, h, http.MethodGet, "/app.js?v=test")
	if !bytes.Equal(decoded, []byte(raw)) {
		t.Error("gzip 解压后的 app.js 与未压缩响应不一致")
	}
	if len(decoded) <= len(rec.Body.Bytes()) {
		t.Errorf("压缩后体积未变小: raw=%d gzip=%d", len(decoded), rec.Body.Len())
	}
}

func TestHandlerSkipsGzipWhenDeclinedOrIncompressible(t *testing.T) {
	h := webui.Handler()
	for _, tc := range []struct {
		name, target, encoding string
	}{
		{"q=0", "/app.js?v=test", "gzip;q=0"},
		{"brotli only", "/app.js?v=test", "br"},
		{"gif", "/lib/pdfjs/web/images/loading-icon.gif?v=test", "gzip"},
	} {
		req := httptest.NewRequest(http.MethodGet, tc.target, nil)
		req.Header.Set("Accept-Encoding", tc.encoding)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		resp := rec.Result()
		resp.Body.Close()
		if enc := resp.Header.Get("Content-Encoding"); enc != "" {
			t.Errorf("%s: Content-Encoding = %q,期望不压缩", tc.name, enc)
		}
	}
}

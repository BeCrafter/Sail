package webui_test

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/BeCrafter/sail/internal/webui"
)

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
		resp, body := fetch(t, h, http.MethodGet, c.path)
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
		if got := resp.Header.Get("Cache-Control"); !strings.Contains(got, "immutable") {
			t.Errorf("GET %s 应可长缓存,实际 Cache-Control=%q", c.path, got)
		}
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

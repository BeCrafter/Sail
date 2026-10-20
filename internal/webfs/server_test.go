package webfs_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/BeCrafter/sail/internal/client"
	"github.com/BeCrafter/sail/internal/config"
	"github.com/BeCrafter/sail/internal/fakes3"
	"github.com/BeCrafter/sail/internal/vfs/quotafs"
	"github.com/BeCrafter/sail/internal/vfs/s3fs"
	"github.com/BeCrafter/sail/internal/webfs"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

const bucket = "b"

// gateway 是单用户网关测试外壳:复刻 cmd 的栈构建方式
// (s3fs → quotafs → webfs.FileSystem → webfs.Server)。
type gateway struct {
	ts  *httptest.Server
	s3  *fakes3.Server
	s3c *s3.Client
	qfs *quotafs.FS
}

func newGateway(t *testing.T, quota int64, prefix string) *gateway {
	t.Helper()
	s3srv := fakes3.New()
	t.Cleanup(s3srv.Close)
	s3c, err := client.New(context.Background(), &config.Resolved{
		Endpoint: s3srv.URL(), AccessKey: "ak", SecretKey: "sk",
		Region: "us-east-1", PathStyle: true,
	})
	if err != nil {
		t.Fatalf("构造 S3 client 失败: %v", err)
	}
	core, err := s3fs.New(s3fs.Config{Client: s3c, Bucket: bucket, Prefix: prefix, StagingDir: t.TempDir()})
	if err != nil {
		t.Fatalf("构造 s3fs 失败: %v", err)
	}
	qfs := quotafs.New(core, core, quota, 0, nil)
	fs := webfs.NewFileSystem(qfs, time.Minute, nil)
	gw, err := webfs.NewServer(webfs.Config{
		Users:         []webfs.UserEntry{{Name: "alice", Password: "pa", FileSystem: fs, Prefix: prefix}},
		Profile:       "test",
		Bucket:        bucket,
		MaxUploadSize: 1 << 20,
	})
	if err != nil {
		t.Fatalf("构造网关失败: %v", err)
	}
	ts := httptest.NewServer(gw)
	t.Cleanup(ts.Close)
	return &gateway{ts: ts, s3: s3srv, s3c: s3c, qfs: qfs}
}

func (g *gateway) do(t *testing.T, method, path string, body []byte, hdr map[string]string) (*http.Response, []byte) {
	t.Helper()
	var rd io.Reader
	if body != nil {
		rd = bytes.NewReader(body)
	}
	req, err := http.NewRequest(method, g.ts.URL+path, rd)
	if err != nil {
		t.Fatalf("构造请求失败: %v", err)
	}
	req.SetBasicAuth("alice", "pa")
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("请求失败: %v", err)
	}
	data, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	return resp, data
}

func decode(t *testing.T, data []byte) map[string]any {
	t.Helper()
	var out map[string]any
	if err := json.Unmarshal(data, &out); err != nil {
		t.Fatalf("响应不是 JSON: %v (%s)", err, data)
	}
	return out
}

func (g *gateway) upload(t *testing.T, path, body string, ct string) {
	t.Helper()
	hdr := map[string]string{}
	if ct != "" {
		hdr["Content-Type"] = ct
	}
	resp, data := g.do(t, http.MethodPut, "/api/file?path="+path, []byte(body), hdr)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("上传 %s 失败: %d %s", path, resp.StatusCode, data)
	}
}

func TestAuthIsRequiredAndChecked(t *testing.T) {
	g := newGateway(t, 0, "")

	// 无凭据:401 + challenge。
	resp, err := http.Get(g.ts.URL + "/api/session")
	if err != nil {
		t.Fatalf("请求失败: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("无凭据应 401,得到 %d", resp.StatusCode)
	}
	if !strings.HasPrefix(resp.Header.Get("WWW-Authenticate"), "Basic") {
		t.Fatalf("缺少 Basic challenge: %q", resp.Header.Get("WWW-Authenticate"))
	}

	// 口令错误:401(与「用户不存在」同一条失败路径)。
	req, _ := http.NewRequest(http.MethodGet, g.ts.URL+"/api/session", nil)
	req.SetBasicAuth("alice", "wrong")
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("请求失败: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("错误口令应 401,得到 %d", resp.StatusCode)
	}
}

func TestSessionReportsBucketAndQuota(t *testing.T) {
	g := newGateway(t, 1024, "alice")
	resp, data := g.do(t, http.MethodGet, "/api/session", nil, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("session 失败: %d %s", resp.StatusCode, data)
	}
	s := decode(t, data)
	if s["user"] != "alice" || s["bucket"] != bucket || s["profile"] != "test" {
		t.Fatalf("会话信息不对: %v", s)
	}
	if s["prefix"] != "alice" {
		t.Fatalf("前缀应为 alice,得到 %v", s["prefix"])
	}
	q, ok := s["quota"].(map[string]any)
	if !ok || q["limit"].(float64) != 1024 || q["ok"] != true {
		t.Fatalf("配额信息不对: %v", s["quota"])
	}
	if _, has := s["capabilities"]; !has {
		t.Fatalf("缺少 capabilities")
	}
}

func TestUploadListDownloadRoundtrip(t *testing.T) {
	g := newGateway(t, 0, "")
	g.upload(t, "/photos/a.txt", "hello sail", "text/plain")

	resp, data := g.do(t, http.MethodGet, "/api/list?path=/photos/", nil, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("列目录失败: %d %s", resp.StatusCode, data)
	}
	l := decode(t, data)
	entries := l["entries"].([]any)
	if len(entries) != 1 {
		t.Fatalf("应有 1 个条目,得到 %d: %s", len(entries), data)
	}
	e := entries[0].(map[string]any)
	if e["name"] != "a.txt" || e["dir"] != false || e["size"].(float64) != 10 {
		t.Fatalf("条目不对: %v", e)
	}
	if e["contentType"] != "text/plain; charset=utf-8" && e["contentType"] != "text/plain" {
		t.Fatalf("Content-Type 未推断: %v", e["contentType"])
	}

	// 根目录应能看到 photos/ 这个目录。
	_, data = g.do(t, http.MethodGet, "/api/list?path=/", nil, nil)
	root := decode(t, data)["entries"].([]any)
	if len(root) != 1 || root[0].(map[string]any)["name"] != "photos" || root[0].(map[string]any)["dir"] != true {
		t.Fatalf("根目录条目不对: %s", data)
	}

	// 下载:内容、类型、inline 头。
	resp, body := g.do(t, http.MethodGet, "/api/file?path=/photos/a.txt", nil, nil)
	if resp.StatusCode != http.StatusOK || string(body) != "hello sail" {
		t.Fatalf("下载失败: %d %q", resp.StatusCode, body)
	}
	if !strings.HasPrefix(resp.Header.Get("Content-Type"), "text/plain") {
		t.Fatalf("下载 Content-Type 不对: %q", resp.Header.Get("Content-Type"))
	}
	if !strings.HasPrefix(resp.Header.Get("Content-Disposition"), "inline") {
		t.Fatalf("默认应为 inline: %q", resp.Header.Get("Content-Disposition"))
	}
	if resp.Header.Get("ETag") == "" {
		t.Fatalf("缺少 ETag")
	}

	// download=1:attachment。
	resp, _ = g.do(t, http.MethodGet, "/api/file?path=/photos/a.txt&download=1", nil, nil)
	if !strings.HasPrefix(resp.Header.Get("Content-Disposition"), "attachment") {
		t.Fatalf("download=1 应为 attachment: %q", resp.Header.Get("Content-Disposition"))
	}
}

func TestRangeRequestIsServed(t *testing.T) {
	g := newGateway(t, 0, "")
	g.upload(t, "/a.bin", "0123456789", "application/octet-stream")
	resp, body := g.do(t, http.MethodGet, "/api/file?path=/a.bin", nil, map[string]string{"Range": "bytes=2-5"})
	if resp.StatusCode != http.StatusPartialContent || string(body) != "2345" {
		t.Fatalf("Range 请求失败: %d %q", resp.StatusCode, body)
	}
}

// HTML 预览用 /api/raw/<路径> 保留目录关系,相对 CSS/JS 才能继续命中。
func TestRawPathServesRelativeAssets(t *testing.T) {
	g := newGateway(t, 0, "")
	g.upload(t, "/site/index.html", `<link rel="stylesheet" href="./app.css"><script src="app.js"></script>`, "text/html; charset=utf-8")
	g.upload(t, "/site/app.css", "body{color:red}", "text/css")
	g.upload(t, "/site/app.js", "console.log(1)", "text/javascript")

	resp, body := g.do(t, http.MethodGet, "/api/raw/site/index.html", nil, nil)
	if resp.StatusCode != http.StatusOK || !strings.Contains(string(body), "app.css") {
		t.Fatalf("raw HTML 失败: %d %q", resp.StatusCode, body)
	}
	if !strings.Contains(resp.Header.Get("Content-Security-Policy"), "sandbox") {
		t.Fatalf("raw HTML 缺少沙箱 CSP: %q", resp.Header.Get("Content-Security-Policy"))
	}
	// HTML 预览请求会注入与应用一致的滚动条样式,但不改动原始响应。
	resp, body = g.do(t, http.MethodGet, "/api/raw/site/index.html?sail-preview=1&theme=dark", nil, nil)
	if resp.StatusCode != http.StatusOK || !strings.Contains(string(body), "sail-preview-scrollbars") ||
		!strings.Contains(string(body), "color-scheme:dark") {
		t.Fatalf("HTML 预览没有注入滚动条样式: %d %q", resp.StatusCode, body)
	}
	if got := resp.Header.Get("Cache-Control"); got != "no-cache" {
		t.Fatalf("HTML 预览应 no-cache,得到 %q", got)
	}
	for _, p := range []string{"/api/raw/site/app.css", "/api/raw/site/app.js"} {
		resp, body = g.do(t, http.MethodGet, p, nil, nil)
		if resp.StatusCode != http.StatusOK || len(body) == 0 {
			t.Fatalf("raw 子资源 %s 失败: %d %q", p, resp.StatusCode, body)
		}
	}
	resp, body = g.do(t, http.MethodGet, "/api/raw/site/app.js", nil, map[string]string{"Range": "bytes=0-2"})
	if resp.StatusCode != http.StatusPartialContent || string(body) != "con" {
		t.Fatalf("raw Range 失败: %d %q", resp.StatusCode, body)
	}
	// 路径逃逸必须被 logicalPath 拦截。
	if resp, _ = g.do(t, http.MethodGet, "/api/raw/site/%2e%2e/secret", nil, nil); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("raw 路径逃逸应 404,得到 %d", resp.StatusCode)
	}
}

func TestMkdirRenameDelete(t *testing.T) {
	g := newGateway(t, 0, "")

	resp, data := g.do(t, http.MethodPost, "/api/mkdir", []byte(`{"path":"/docs"}`), nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("建目录失败: %d %s", resp.StatusCode, data)
	}
	// 重复建目录:409。
	resp, _ = g.do(t, http.MethodPost, "/api/mkdir", []byte(`{"path":"/docs"}`), nil)
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("重复建目录应 409,得到 %d", resp.StatusCode)
	}

	g.upload(t, "/docs/a.txt", "a", "text/plain")
	g.upload(t, "/docs/b.txt", "b", "text/plain")

	// 文件改名。
	resp, data = g.do(t, http.MethodPost, "/api/rename", []byte(`{"from":"/docs/a.txt","to":"/docs/c.txt"}`), nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("文件改名失败: %d %s", resp.StatusCode, data)
	}
	_, data = g.do(t, http.MethodGet, "/api/list?path=/docs/", nil, nil)
	if names := entryNames(decode(t, data)); !strings.Contains(names, "c.txt") || strings.Contains(names, "a.txt") {
		t.Fatalf("文件改名未生效: %s", names)
	}

	// 目录改名(壳内展开为递归复制 + 删源)。
	resp, data = g.do(t, http.MethodPost, "/api/rename", []byte(`{"from":"/docs","to":"/papers"}`), nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("目录改名失败: %d %s", resp.StatusCode, data)
	}
	_, data = g.do(t, http.MethodGet, "/api/list?path=/papers/", nil, nil)
	if names := entryNames(decode(t, data)); !strings.Contains(names, "b.txt") {
		t.Fatalf("目录改名后内容丢失: %s", names)
	}
	resp, _ = g.do(t, http.MethodGet, "/api/list?path=/docs/", nil, nil)
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("源目录应已不存在,得到 %d", resp.StatusCode)
	}

	// 删目录不带 recursive:400。
	resp, _ = g.do(t, http.MethodPost, "/api/delete", []byte(`{"paths":["/papers/"]}`), nil)
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("目录删除未要求 recursive,得到 %d", resp.StatusCode)
	}
	resp, data = g.do(t, http.MethodPost, "/api/delete", []byte(`{"paths":["/papers/"],"recursive":true}`), nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("删目录失败: %d %s", resp.StatusCode, data)
	}
	resp, _ = g.do(t, http.MethodGet, "/api/list?path=/papers/", nil, nil)
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("目录应已删除,得到 %d", resp.StatusCode)
	}
}

func entryNames(l map[string]any) string {
	var names []string
	for _, raw := range l["entries"].([]any) {
		names = append(names, raw.(map[string]any)["name"].(string))
	}
	return strings.Join(names, ",")
}

func TestPathTraversalIsRejected(t *testing.T) {
	g := newGateway(t, 0, "")
	for _, p := range []string{"/../etc/passwd", "/a/../../b", "/%2e%2e/x"} {
		resp, _ := g.do(t, http.MethodGet, "/api/list?path="+p, nil, nil)
		if resp.StatusCode != http.StatusNotFound {
			t.Fatalf("路径逃逸 %q 应 404,得到 %d", p, resp.StatusCode)
		}
	}
}

func TestQuotaIsEnforcedAtCommit(t *testing.T) {
	g := newGateway(t, 8, "")
	resp, data := g.do(t, http.MethodPut, "/api/file?path=/big.bin", bytes.Repeat([]byte("x"), 32), nil)
	if resp.StatusCode != http.StatusInsufficientStorage {
		t.Fatalf("超配额应 507,得到 %d %s", resp.StatusCode, data)
	}
	if body := decode(t, data); body["error"].(map[string]any)["code"] != "quota_exceeded" {
		t.Fatalf("错误码应为 quota_exceeded: %s", data)
	}
	// 超限的写入不得落库。
	_, data = g.do(t, http.MethodGet, "/api/list?path=/", nil, nil)
	if len(decode(t, data)["entries"].([]any)) != 0 {
		t.Fatalf("超配额文件不应落库: %s", data)
	}
}

func TestUploadSizeLimit(t *testing.T) {
	g := newGateway(t, 0, "")
	big := bytes.Repeat([]byte("x"), (1<<20)+1)
	resp, data := g.do(t, http.MethodPut, "/api/file?path=/big.bin", big, map[string]string{
		"Content-Type": "application/octet-stream",
	})
	if resp.StatusCode != http.StatusRequestEntityTooLarge {
		t.Fatalf("超限应 413,得到 %d %s", resp.StatusCode, data)
	}
}

func TestWritesInvalidateListingCache(t *testing.T) {
	g := newGateway(t, 0, "")
	// 先把根目录列表读进缓存。
	_, data := g.do(t, http.MethodGet, "/api/list?path=/", nil, nil)
	if len(decode(t, data)["entries"].([]any)) != 0 {
		t.Fatalf("初始目录应为空")
	}
	g.upload(t, "/new.txt", "x", "text/plain")
	// 同一条缓存不能把新文件藏起来(自己的写入立即失效)。
	_, data = g.do(t, http.MethodGet, "/api/list?path=/", nil, nil)
	if names := entryNames(decode(t, data)); !strings.Contains(names, "new.txt") {
		t.Fatalf("写入后列表未失效: %s", names)
	}
}

// 删掉某个目录下最后一个对象后,该目录会从桶里消失:祖父一级(这里是根)的
// 缓存也必须立刻失效,否则用户返回上级仍会看到一个已经不存在、点进去就 404
// 的空目录,直到 TTL 结束。
func TestDeleteInvalidatesGrandparentListing(t *testing.T) {
	g := newGateway(t, 0, "")
	g.upload(t, "/d/f.txt", "x", "text/plain")

	// 缓存根列表(此时含 d/)。
	_, data := g.do(t, http.MethodGet, "/api/list?path=/", nil, nil)
	if names := entryNames(decode(t, data)); !strings.Contains(names, "d") {
		t.Fatalf("根列表应含 d: %s", names)
	}

	resp, data := g.do(t, http.MethodPost, "/api/delete", []byte(`{"paths":["/d/f.txt"]}`), nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("删除失败: %d %s", resp.StatusCode, data)
	}
	_, data = g.do(t, http.MethodGet, "/api/list?path=/", nil, nil)
	if names := entryNames(decode(t, data)); strings.Contains(names, "d") {
		t.Fatalf("删除最后对象后根列表未失效: %s", names)
	}
}

func TestReservedChunkPrefixIsHidden(t *testing.T) {
	g := newGateway(t, 0, "")
	// 直接往桶里塞一个 .sail/ 下的对象(模拟分片存储),列表不能暴露它。
	// 走内核 API 是写不进去的(保留前缀被 s3fs 拦下),这正是设计意图。
	if _, err := g.s3c.PutObject(context.Background(), &s3.PutObjectInput{
		Bucket: aws.String(bucket), Key: aws.String(".sail/parts/a/1"), Body: strings.NewReader("x"),
	}); err != nil {
		t.Fatalf("种入保留前缀对象失败: %v", err)
	}
	_, data := g.do(t, http.MethodGet, "/api/list?path=/", nil, nil)
	if names := entryNames(decode(t, data)); strings.Contains(names, ".sail") {
		t.Fatalf("保留前缀不应暴露: %s", names)
	}
}

func TestStatAndMissingPath(t *testing.T) {
	g := newGateway(t, 0, "")
	g.upload(t, "/x/y.json", `{"a":1}`, "application/json")
	resp, data := g.do(t, http.MethodGet, "/api/stat?path=/x/y.json", nil, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("stat 失败: %d %s", resp.StatusCode, data)
	}
	e := decode(t, data)["entry"].(map[string]any)
	if e["name"] != "y.json" || e["contentType"] != "application/json" {
		t.Fatalf("stat 结果不对: %v", e)
	}
	resp, data = g.do(t, http.MethodGet, "/api/stat?path=/nope", nil, nil)
	if resp.StatusCode != http.StatusNotFound || decode(t, data)["error"].(map[string]any)["code"] != "not_found" {
		t.Fatalf("缺失路径应 404 not_found: %d %s", resp.StatusCode, data)
	}
}

func TestPresignAndPublicURLCapabilities(t *testing.T) {
	g := newGateway(t, 0, "")
	g.upload(t, "/a.txt", "x", "text/plain")
	// 未注入能力:501,前端据此隐藏按钮。
	resp, _ := g.do(t, http.MethodGet, "/api/url?path=/a.txt&mode=presign", nil, nil)
	if resp.StatusCode != http.StatusNotImplemented {
		t.Fatalf("未配置时应 501,得到 %d", resp.StatusCode)
	}
}

// ---- 匿名网关(Web 资源库默认模式) --------------------------------

// newAnonymousGateway 复刻 cmd 的匿名装配:单个空间 + Anonymous=true。
func newAnonymousGateway(t *testing.T, prefix string) *gateway {
	t.Helper()
	s3srv := fakes3.New()
	t.Cleanup(s3srv.Close)
	s3c, err := client.New(context.Background(), &config.Resolved{
		Endpoint: s3srv.URL(), AccessKey: "ak", SecretKey: "sk",
		Region: "us-east-1", PathStyle: true,
	})
	if err != nil {
		t.Fatalf("构造 S3 client 失败: %v", err)
	}
	core, err := s3fs.New(s3fs.Config{Client: s3c, Bucket: bucket, Prefix: prefix, StagingDir: t.TempDir()})
	if err != nil {
		t.Fatalf("构造 s3fs 失败: %v", err)
	}
	qfs := quotafs.New(core, core, 0, 0, nil)
	fs := webfs.NewFileSystem(qfs, time.Minute, nil)
	gw, err := webfs.NewServer(webfs.Config{
		Anonymous:     true,
		Users:         []webfs.UserEntry{{Name: "anonymous", FileSystem: fs, Prefix: prefix}},
		Profile:       "test",
		Bucket:        bucket,
		MaxUploadSize: 1 << 20,
	})
	if err != nil {
		t.Fatalf("构造匿名网关失败: %v", err)
	}
	ts := httptest.NewServer(gw)
	t.Cleanup(ts.Close)
	return &gateway{ts: ts, s3: s3srv, s3c: s3c, qfs: qfs}
}

func TestAnonymousGatewayServesWithoutCredentials(t *testing.T) {
	g := newAnonymousGateway(t, "")
	// g.do 固定带 Basic 头;这里直接用 http.Get 验证「不带凭据也能用」。
	resp, err := http.Get(g.ts.URL + "/api/session")
	if err != nil {
		t.Fatalf("匿名请求失败: %v", err)
	}
	data, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("匿名 session = %d %s", resp.StatusCode, data)
	}
	var sess map[string]any
	if err := json.Unmarshal(data, &sess); err != nil {
		t.Fatalf("session 不是 JSON: %v", err)
	}
	if sess["anonymous"] != true || sess["user"] != "" {
		t.Errorf("匿名会话标记不对: %v", sess)
	}

	// 上传/列目录同样不需要凭据。
	req, _ := http.NewRequest(http.MethodPut, g.ts.URL+"/api/file?path=/hello.txt", strings.NewReader("hi"))
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("匿名上传失败: %v", err)
	}
	data, _ = io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("匿名上传 = %d %s", resp.StatusCode, data)
	}
	resp, err = http.Get(g.ts.URL + "/api/list?path=/")
	if err != nil {
		t.Fatalf("匿名列目录失败: %v", err)
	}
	data, _ = io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || !strings.Contains(string(data), "hello.txt") {
		t.Fatalf("匿名列目录 = %d %s", resp.StatusCode, data)
	}
}

func TestAnonymousGatewayRequiresExactlyOneSpace(t *testing.T) {
	if _, err := webfs.NewServer(webfs.Config{Anonymous: true}); err == nil {
		t.Error("匿名网关缺少空间应报错")
	}
	fs := webfs.NewFileSystem(nil, time.Minute, nil)
	if _, err := webfs.NewServer(webfs.Config{Anonymous: true, Users: []webfs.UserEntry{
		{Name: "a", FileSystem: fs}, {Name: "b", FileSystem: fs},
	}}); err == nil {
		t.Error("匿名网关多个空间应报错")
	}
}

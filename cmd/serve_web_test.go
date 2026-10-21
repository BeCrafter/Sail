package cmd

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/BeCrafter/sail/internal/config"
	"github.com/BeCrafter/sail/internal/fakes3"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// ---- 参数合并 ----------------------------------------------------------

func TestMergeServeWebSettings(t *testing.T) {
	base := func() (serveFlags, *config.Resolved, func(string) bool) {
		return serveFlags{backendMaxSize: "5TiB", listen: ":9090"},
			&config.Resolved{ProfileName: "prod", Serve: config.ServeConfig{User: "alice", Password: "pa"}},
			func(string) bool { return false }
	}

	t.Run("默认监听地址", func(t *testing.T) {
		o, r, changed := base()
		s, err := mergeServeWeb(o, r, changed)
		if err != nil {
			t.Fatalf("merge 失败: %v", err)
		}
		if s.listen != ":9090" {
			t.Errorf("listen = %q,期望 :9090", s.listen)
		}
	})

	t.Run("配置提供监听地址", func(t *testing.T) {
		o, r, changed := base()
		r.Serve.Web.Listen = ":9443"
		s, err := mergeServeWeb(o, r, changed)
		if err != nil {
			t.Fatalf("merge 失败: %v", err)
		}
		if s.listen != ":9443" {
			t.Errorf("listen = %q,期望配置值 :9443", s.listen)
		}
	})

	t.Run("flag 显式设置覆盖配置", func(t *testing.T) {
		o, r, _ := base()
		o.listen = ":8080"
		r.Serve.Web.Listen = ":9443"
		s, err := mergeServeWeb(o, r, func(f string) bool { return f == "listen" })
		if err != nil {
			t.Fatalf("merge 失败: %v", err)
		}
		if s.listen != ":8080" {
			t.Errorf("listen = %q,期望 flag 值 :8080", s.listen)
		}
	})

	t.Run("TLS 对来自 serve.web", func(t *testing.T) {
		o, r, changed := base()
		r.Serve.Web.TLSCert, r.Serve.Web.TLSKey = "c.pem", "k.pem"
		s, err := mergeServeWeb(o, r, changed)
		if err != nil {
			t.Fatalf("merge 失败: %v", err)
		}
		if s.tlsCert != "c.pem" || s.tlsKey != "k.pem" {
			t.Errorf("TLS 对 = %q/%q", s.tlsCert, s.tlsKey)
		}
	})

	t.Run("TLS 只给一半必须拒绝", func(t *testing.T) {
		o, r, changed := base()
		o.tlsCert = "c.pem"
		r.Serve.Web.TLSKey = ""
		if _, err := mergeServeWeb(o, r, changed); err == nil || !strings.Contains(err.Error(), "--tls-key") {
			t.Fatalf("只给证书应报错,实际 %v", err)
		}
	})

	t.Run("监听地址不继承 serve.listen", func(t *testing.T) {
		o, r, changed := base()
		r.Serve.Listen = ":8443" // WebDAV 的端口
		s, err := mergeServeWeb(o, r, changed)
		if err != nil {
			t.Fatalf("merge 失败: %v", err)
		}
		if s.listen == ":8443" {
			t.Error("Web 资源库不应复用 WebDAV 的 serve.listen 端口")
		}
	})
}

func TestEnabledWebResolved(t *testing.T) {
	origProfile, origBucket, origEndpoint := profile, cfgBucket, cfgEndpoint
	t.Cleanup(func() {
		profile, cfgBucket, cfgEndpoint = origProfile, origBucket, origEndpoint
	})
	profile, cfgBucket, cfgEndpoint = "", "", ""

	cfg := &config.Config{
		DefaultProfile: "off",
		Profiles: map[string]config.Profile{
			"off": {
				Endpoint: "https://off.example.com", AccessKey: "ak", SecretKey: "sk",
				Bucket: "off-bucket", Disabled: true,
			},
			"on": {
				Endpoint: "https://on.example.com", AccessKey: "ak", SecretKey: "sk",
				Bucket: "on-bucket",
			},
		},
	}
	r, err := cfg.Resolve("off")
	if err != nil {
		t.Fatal(err)
	}
	profile = ""
	got, err := enabledWebResolved(cfg, r)
	if err != nil {
		t.Fatal(err)
	}
	if got.ProfileName != "on" || got.Bucket != "on-bucket" {
		t.Fatalf("fallback = %+v, want on/on-bucket", got)
	}

	profile = "off"
	if _, err := enabledWebResolved(cfg, r); err == nil {
		t.Fatal("explicit disabled profile should be rejected")
	}
}

func TestPhysicalKey(t *testing.T) {
	cases := []struct{ prefix, logical, want string }{
		{"", "/hello.txt", "hello.txt"},
		{"", "hello.txt", "hello.txt"},
		{"tenant/", "/a/b.txt", "tenant/a/b.txt"},
		{"/tenant", "/a/b.txt", "tenant/a/b.txt"},
		{"tenant/", "a.txt", "tenant/a.txt"},
	}
	for _, c := range cases {
		if got := physicalKey(c.prefix, c.logical); got != c.want {
			t.Errorf("physicalKey(%q,%q) = %q,期望 %q", c.prefix, c.logical, got, c.want)
		}
	}
}

// ---- 启动前校验 --------------------------------------------------------

// 与 WebDAV 同一条边界:没有桶就没有可展示的内容;凭据不可匿名。
// 只走错误分支,成功路径会真的开始监听。
func TestServeWebRequiresBucketAndCredentials(t *testing.T) {
	origOpts := serveWebOpts
	t.Cleanup(func() { serveWebOpts = origOpts })

	writeServeConfig(t, "")
	t.Setenv("SAIL_BUCKET", "")
	cfgBucket = ""
	serveWebOpts = serveFlags{backendMaxSize: "5TiB", listen: ":9090", user: "alice", password: "s3cret"}
	err := runServeWeb(serveWebCmd, nil)
	if err == nil {
		t.Fatal("缺少 bucket 应报错")
	}
	for _, want := range []string{"--bucket", "SAIL_BUCKET", "bucket"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("缺桶错误未提到 %q:%v", want, err)
		}
	}

	// 有桶但无凭据:Web 默认匿名启动(不要求用户配置)。
	writeServeConfig(t, "mybucket")
	serveWebOpts = serveFlags{backendMaxSize: "5TiB", listen: ":9090"}
	r, _, err := loadResolved()
	if err != nil {
		t.Fatalf("读取配置失败: %v", err)
	}
	noAuth := func(string) bool { return false }
	settings, err := mergeServeWeb(serveWebOpts, r, noAuth)
	if err != nil {
		t.Fatalf("Web 默认应匿名启动,实际报错: %v", err)
	}
	if !settings.anonymous {
		t.Errorf("缺凭据时 Web 应匿名,实际 %+v", settings)
	}

	// 显式 require-auth 且没有凭据:回退默认 sail/sail。
	serveWebOpts = serveFlags{backendMaxSize: "5TiB", listen: ":9090", requireAuth: true}
	requireAuthChanged := func(f string) bool { return f == "require-auth" }
	settings, err = mergeServeWeb(serveWebOpts, r, requireAuthChanged)
	if err != nil {
		t.Fatalf("require-auth 缺凭据应回退默认值,实际报错: %v", err)
	}
	if settings.anonymous || settings.user != defaultServeUser || settings.password != defaultServePassword || !settings.defaultCreds {
		t.Errorf("require-auth 缺凭据应用默认 sail/sail,实际 %+v", settings)
	}

	// TLS 只给一半。
	serveWebOpts = serveFlags{backendMaxSize: "5TiB", listen: ":9090", user: "alice", password: "s3cret", tlsCert: "c.pem"}
	if err := runServeWeb(serveWebCmd, nil); err == nil || !strings.Contains(err.Error(), "--tls-key") {
		t.Fatalf("只给证书应报错,实际 %v", err)
	}

	// 非法大小。
	serveWebOpts = serveFlags{backendMaxSize: "不是大小", listen: ":9090", user: "alice", password: "s3cret"}
	if err := runServeWeb(serveWebCmd, nil); err == nil || !strings.Contains(err.Error(), "backend-max-object-size") {
		t.Fatalf("非法上限应报错,实际 %v", err)
	}
}

// Web 命令自己注册那批 flag:共享的布局参数 + Web 专属的监听/TLS/缓存。
func TestServeWebFlagSurface(t *testing.T) {
	for _, name := range []string{
		"listen", "prefix", "user", "password", "require-auth", "tls-cert", "tls-key",
		"backend-max-object-size", "max-upload-size", "staging-dir",
		"chunked-upload", "chunk-size", "dir-cache-ttl", "prewarm",
	} {
		if serveWebCmd.Flags().Lookup(name) == nil {
			t.Errorf("缺少参数 --%s", name)
		}
	}
	// 其它协议专属的旋钮不应出现在 Web 命令上。
	for _, name := range []string{"share", "server-name", "print-windows-setup"} {
		if serveWebCmd.Flags().Lookup(name) != nil {
			t.Errorf("不应提供参数 --%s", name)
		}
	}
	if got := serveWebCmd.Flags().Lookup("listen").DefValue; got != ":9090" {
		t.Errorf("--listen 默认值 = %q,期望 :9090", got)
	}
}

// ---- 运行期集成 --------------------------------------------------------

type webHarness struct {
	ts *httptest.Server
	rt *serveRuntime
}

// newServeWebHarness 按 cmd 的真实装配路径建一个 Web 网关:
// client → s3fs → quotafs → webfs 壳 → webfs.Server,再用 httptest 起服务。
func newServeWebHarness(t *testing.T, opt serveRuntimeOptions) *webHarness {
	return newServeWebHarnessWith(t, opt, nil)
}

// newServeWebHarnessWith 允许用例调整生效参数(例如切换匿名模式)。
func newServeWebHarnessWith(t *testing.T, opt serveRuntimeOptions, mutate func(*serveSettings)) *webHarness {
	t.Helper()
	s3srv := fakes3.New()
	t.Cleanup(s3srv.Close)

	r := &config.Resolved{
		ProfileName: "prod",
		Endpoint:    s3srv.URL(),
		AccessKey:   "ak",
		SecretKey:   "sk",
		Region:      "us-east-1",
		PathStyle:   true,
		Bucket:      "b",
	}
	s := serveSettings{
		listen:      "127.0.0.1:0",
		user:        "alice",
		password:    "pa",
		maxUpload:   1 << 20,
		dirCacheTTL: time.Minute,
	}
	if mutate != nil {
		mutate(&s)
	}
	rt, err := newServeRuntimeWith(serveFlags{}, r, s, func(string) bool { return false },
		log.New(io.Discard, "", 0), webProtocolShell, opt)
	if err != nil {
		t.Fatalf("装配 Web 运行期失败: %v", err)
	}
	ts := httptest.NewServer(rt.gw)
	t.Cleanup(ts.Close)
	return &webHarness{ts: ts, rt: rt}
}

func (h *webHarness) do(t *testing.T, method, target string, body []byte, user, pass string) (*http.Response, []byte) {
	t.Helper()
	var rd io.Reader
	if body != nil {
		rd = bytes.NewReader(body)
	}
	req, err := http.NewRequest(method, h.ts.URL+target, rd)
	if err != nil {
		t.Fatalf("构造请求失败: %v", err)
	}
	if user != "" {
		req.SetBasicAuth(user, pass)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("请求失败: %v", err)
	}
	data, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	return resp, data
}

func decodeJSON(t *testing.T, data []byte) map[string]any {
	t.Helper()
	var out map[string]any
	if err := json.Unmarshal(data, &out); err != nil {
		t.Fatalf("响应不是 JSON: %v (%s)", err, data)
	}
	return out
}

func TestServeWebGatewayIntegration(t *testing.T) {
	h := newServeWebHarness(t, serveRuntimeOptions{
		presignUsing: func(s3c *s3.Client) func(context.Context, string, string, time.Duration) (string, error) {
			return presignForServe(s3c, "b")
		},
		publicURL: publicURLForServe(&config.Resolved{CDNDomain: "https://cdn.example.com", Bucket: "b"}),
	})

	// 未认证:API 与页面都必须 401(challenge),不允许匿名浏览。
	for _, target := range []string{"/", "/api/session"} {
		resp, _ := h.do(t, http.MethodGet, target, nil, "", "")
		if resp.StatusCode != http.StatusUnauthorized {
			t.Errorf("GET %s 未认证 = %d,期望 401", target, resp.StatusCode)
		}
		if !strings.HasPrefix(resp.Header.Get("WWW-Authenticate"), "Basic") {
			t.Errorf("GET %s 缺少 Basic challenge", target)
		}
	}

	// 静态入口:内置前端原样返回。
	resp, page := h.do(t, http.MethodGet, "/", nil, "alice", "pa")
	if resp.StatusCode != http.StatusOK || !strings.Contains(string(page), `<div id="app"`) {
		t.Fatalf("GET / = %d,未返回内置前端: %s", resp.StatusCode, page)
	}

	// 会话:桶、profile、用户、能力都由 cmd 侧注入。
	resp, data := h.do(t, http.MethodGet, "/api/session", nil, "alice", "pa")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("session = %d %s", resp.StatusCode, data)
	}
	sess := decodeJSON(t, data)
	if sess["user"] != "alice" || sess["bucket"] != "b" || sess["profile"] != "prod" {
		t.Errorf("会话信息不对: %v", sess)
	}
	caps, _ := sess["capabilities"].(map[string]any)
	if caps["presign"] != true || caps["publicUrl"] != true {
		t.Errorf("外链能力未接通: %v", caps)
	}

	// 上传 → 列目录 → 下载。
	resp, data = h.do(t, http.MethodPut, "/api/file?path=/photos/a.txt", []byte("hello sail"), "alice", "pa")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("上传失败: %d %s", resp.StatusCode, data)
	}
	resp, data = h.do(t, http.MethodGet, "/api/list?path=/photos/", nil, "alice", "pa")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("列目录失败: %d %s", resp.StatusCode, data)
	}
	list := decodeJSON(t, data)
	entries, _ := list["entries"].([]any)
	if len(entries) != 1 || entries[0].(map[string]any)["name"] != "a.txt" {
		t.Fatalf("列目录结果不对: %s", data)
	}
	resp, body := h.do(t, http.MethodGet, "/api/file?path=/photos/a.txt", nil, "alice", "pa")
	if resp.StatusCode != http.StatusOK || string(body) != "hello sail" {
		t.Fatalf("下载失败: %d %q", resp.StatusCode, body)
	}

	// 外链:public 走 CDN,presign 走 S3 客户端。
	resp, data = h.do(t, http.MethodGet, "/api/url?path=/photos/a.txt&mode=public", nil, "alice", "pa")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("public url 失败: %d %s", resp.StatusCode, data)
	}
	if u, _ := decodeJSON(t, data)["url"].(string); u != "https://cdn.example.com/b/photos/a.txt" {
		t.Errorf("public url = %q", u)
	}
	resp, data = h.do(t, http.MethodGet, "/api/url?path=/photos/a.txt&mode=presign", nil, "alice", "pa")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("presign 失败: %d %s", resp.StatusCode, data)
	}
	if u, _ := decodeJSON(t, data)["url"].(string); !strings.Contains(u, "/b/photos/a.txt") {
		t.Errorf("presign url 未指向桶内 key: %q", u)
	}

	// 删除后根目录为空(S3 没有真实目录:/photos/ 随最后一个对象一起消失)。
	resp, data = h.do(t, http.MethodPost, "/api/delete", []byte(`{"paths":["/photos/a.txt"]}`), "alice", "pa")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("删除失败: %d %s", resp.StatusCode, data)
	}
	_, data = h.do(t, http.MethodGet, "/api/list?path=/", nil, "alice", "pa")
	if n := decodeJSON(t, data)["count"]; n != float64(0) {
		t.Errorf("删除后仍有条目: %s", data)
	}
}

// 热加载走协议无关的 applyUserTable → webGateway.swapUsers:
// 换表后旧凭据立即失效,新凭据可用,服务不重启。
func TestServeWebHotReloadSwapsUsers(t *testing.T) {
	h := newServeWebHarness(t, serveRuntimeOptions{})

	if resp, _ := h.do(t, http.MethodGet, "/api/session", nil, "alice", "pa"); resp.StatusCode != http.StatusOK {
		t.Fatalf("初始用户不可用: %d", resp.StatusCode)
	}

	if err := h.rt.applyUserTable([]config.UserConfig{{Name: "bob", Password: "pb"}}); err != nil {
		t.Fatalf("换表失败: %v", err)
	}

	if resp, _ := h.do(t, http.MethodGet, "/api/session", nil, "alice", "pa"); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("旧用户换表后仍可登录: %d", resp.StatusCode)
	}
	resp, data := h.do(t, http.MethodGet, "/api/session", nil, "bob", "pb")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("新用户不可用: %d %s", resp.StatusCode, data)
	}
	if got := decodeJSON(t, data)["user"]; got != "bob" {
		t.Errorf("会话用户 = %v,期望 bob", got)
	}
}

// 匿名运行期:cmd 的装配路径(anonymous settings → 伪用户栈 → webfs.Anonymous)
// 必须真的放行无凭据请求,并把会话标成 anonymous。
func TestServeWebAnonymousRuntime(t *testing.T) {
	h := newServeWebHarnessWith(t, serveRuntimeOptions{}, func(s *serveSettings) {
		s.user, s.password = "", ""
		s.anonymous = true
	})

	resp, data := h.do(t, http.MethodGet, "/api/session", nil, "", "")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("匿名 session = %d %s", resp.StatusCode, data)
	}
	sess := decodeJSON(t, data)
	if sess["anonymous"] != true || sess["user"] != "" {
		t.Errorf("匿名会话标记不对: %v", sess)
	}

	// 匿名上传 + 列表。
	if resp, data := h.do(t, http.MethodPut, "/api/file?path=/hello.txt", []byte("hi"), "", ""); resp.StatusCode != http.StatusOK {
		t.Fatalf("匿名上传 = %d %s", resp.StatusCode, data)
	}
	resp, data = h.do(t, http.MethodGet, "/api/list?path=/", nil, "", "")
	if resp.StatusCode != http.StatusOK || !strings.Contains(string(data), "hello.txt") {
		t.Fatalf("匿名列表 = %d %s", resp.StatusCode, data)
	}

	// 热加载用户表不应把匿名模式切回登录(require-auth 属冷区)。
	if err := h.rt.applyUserTable(effectiveUserTable(h.rt.settings)); err != nil {
		t.Fatalf("匿名热加载失败: %v", err)
	}
	if resp, _ := h.do(t, http.MethodGet, "/api/session", nil, "", ""); resp.StatusCode != http.StatusOK {
		t.Errorf("热加载后匿名 session = %d", resp.StatusCode)
	}
}

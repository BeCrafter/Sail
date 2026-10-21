package cmd

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/BeCrafter/sail/internal/config"
	"github.com/BeCrafter/sail/internal/fakes3"
	"github.com/BeCrafter/sail/internal/webui"
)

func newSettingsStoreForTest(t *testing.T, body string) (*sourceSettingsStore, string) {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	return newSourceSettingsStore(path), path
}

const settingsTestConfig = `default-profile: alpha
profiles:
  alpha:
    endpoint: https://a.example.com
    access-key: ALPHAKEY
    secret-key: ALPHASECRET
    bucket: bucket-a
    region: us-east-1
    path-style: true
    serve:
      prefix: team/
      users:
        - name: alice
          password: pw
          prefix: alice/
  beta:
    endpoint: https://b.example.com
    access-key: BETAKEY
    secret-key: BETASECRET
    bucket: bucket-b
    region: eu-west-1
`

func TestSettingsStoreListAndSave(t *testing.T) {
	store, path := newSettingsStoreForTest(t, settingsTestConfig)
	got, err := store.list()
	if err != nil {
		t.Fatal(err)
	}
	if got.Default != "alpha" || len(got.Sources) != 2 {
		t.Fatalf("list = %+v", got)
	}
	if got.Sources[0].Name != "alpha" || !got.Sources[0].HasSecret || got.Sources[0].AccessKey != "ALPHAKEY" {
		t.Fatalf("alpha view = %+v", got.Sources[0])
	}
	if strings.Contains(strings.ToLower(got.Sources[0].AccessKey), "secret") {
		t.Fatal("access key should not be a secret")
	}

	if err := store.save(settingsSourceInput{
		Name: "alpha", Endpoint: "https://new.example.com", AccessKey: "NEWKEY",
		SecretKey: "", Bucket: "bucket-new", Region: "ap-southeast-1", PathStyle: false, Default: true,
	}); err != nil {
		t.Fatal(err)
	}
	cfg, err := config.Load(path)
	if err != nil {
		t.Fatal(err)
	}
	a := cfg.Profiles["alpha"]
	if a.Endpoint != "https://new.example.com" || a.Bucket != "bucket-new" || a.SecretKey != "ALPHASECRET" {
		t.Fatalf("alpha after save = %+v", a)
	}
	if a.Serve.Prefix != "team/" || len(a.Serve.Users) != 1 {
		t.Fatalf("serve block was not preserved: %+v", a.Serve)
	}

	if err := store.save(settingsSourceInput{
		Name: "alpha", Endpoint: "https://new.example.com", AccessKey: "NEWKEY",
		Bucket: "bucket-new", Region: "ap-southeast-1", CDNBucketPath: "yes",
		CDNDomain: "https://cdn.example.com",
		Serve: &settingsServeInput{
			MaxUploadSize: "1GiB", ChunkedUpload: true, ChunkSize: "8MiB", DirCacheTTL: "30s",
		},
	}); err != nil {
		t.Fatal(err)
	}
	cfg, err = config.Load(path)
	if err != nil {
		t.Fatal(err)
	}
	a = cfg.Profiles["alpha"]
	if a.CDNBucketPath == nil || !*a.CDNBucketPath ||
		a.Serve.MaxUploadSize != "1GiB" || !a.Serve.ChunkedUpload || a.Serve.ChunkSize != "8MiB" ||
		a.Serve.DirCacheTTL != "30s" {
		t.Fatalf("advanced fields not saved: %+v", a)
	}
	if a.Serve.Prefix != "team/" {
		t.Fatalf("unexposed serve prefix should be preserved: %+v", a.Serve)
	}
	if len(a.Serve.Users) != 1 {
		t.Fatalf("unexposed users table should be preserved: %+v", a.Serve.Users)
	}

	if err := store.save(settingsSourceInput{
		Name: "gamma", Endpoint: "https://g.example.com", Bucket: "bucket-g", Region: "us-west-2", Default: true,
	}); err != nil {
		t.Fatal(err)
	}
	got, err = store.list()
	if err != nil {
		t.Fatal(err)
	}
	if got.Default != "gamma" || len(got.Sources) != 3 {
		t.Fatalf("after create = %+v", got)
	}
}

func TestSettingsStoreMissingConfig(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.yaml")
	store := newSourceSettingsStore(path)
	got, err := store.list()
	if err != nil {
		t.Fatalf("缺失配置应可列出空数据源: %v", err)
	}
	if got.Path != path || got.Default != "" || len(got.Sources) != 0 {
		t.Fatalf("空配置 list = %+v", got)
	}
	if err := store.save(settingsSourceInput{
		Name: "app", Endpoint: "https://app.example.com", Bucket: "bucket-app",
	}); err != nil {
		t.Fatalf("首次保存应创建配置文件: %v", err)
	}
	cfg, err := config.Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.DefaultProfile != "app" || cfg.Profiles["app"].Bucket != "bucket-app" {
		t.Fatalf("首次保存后的配置 = %+v", cfg)
	}
}

func TestSettingsOnlyShellWithoutSources(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.yaml")
	h := newWebMultiHandler(nil, "", webui.Handler())
	h.settings = newSourceSettingsStore(path)

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "127.0.0.1:12345"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `<div id="app"`) {
		t.Fatalf("没有数据源时 GET / = %d,未返回内置前端: %s", rec.Code, rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodGet, "/api/settings/sources", nil)
	req.RemoteAddr = "127.0.0.1:12345"
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"sources":[]`) {
		t.Fatalf("空设置列表 = %d %s", rec.Code, rec.Body.String())
	}
}

func TestSettingsStoreEnableDisable(t *testing.T) {
	store, path := newSettingsStoreForTest(t, settingsTestConfig)
	origProfile := profile
	t.Cleanup(func() { profile = origProfile })
	profile = "alpha"
	if err := store.setEnabled("alpha", false); err == nil || !strings.Contains(err.Error(), "started with") {
		t.Fatalf("explicit active profile should not be disabled: %v", err)
	}
	if err := store.remove("alpha"); err == nil || !strings.Contains(err.Error(), "started with") {
		t.Fatalf("explicit active profile should not be deleted: %v", err)
	}
	profile = ""

	if err := store.setEnabled("beta", false); err != nil {
		t.Fatal(err)
	}
	got, err := store.list()
	if err != nil {
		t.Fatal(err)
	}
	if got.Sources[1].Name != "beta" || got.Sources[1].Enabled {
		t.Fatalf("beta should be disabled: %+v", got.Sources)
	}
	if err := store.setDefault("beta"); err == nil {
		t.Fatal("disabled source should not become default")
	}
	if err := store.setEnabled("alpha", false); err == nil {
		t.Fatal("disabling the last enabled source should fail")
	}

	if err := store.setEnabled("beta", true); err != nil {
		t.Fatal(err)
	}
	if err := store.setEnabled("alpha", false); err != nil {
		t.Fatal(err)
	}
	cfg, err := config.Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.DefaultProfile != "beta" || !cfg.Profiles["alpha"].Disabled || cfg.Profiles["beta"].Disabled {
		t.Fatalf("after disabling default: default=%q alpha=%+v beta=%+v", cfg.DefaultProfile, cfg.Profiles["alpha"], cfg.Profiles["beta"])
	}
	got, err = store.list()
	if err != nil {
		t.Fatal(err)
	}
	if got.Default != "beta" || got.Sources[0].Enabled || !got.Sources[1].Enabled {
		t.Fatalf("list after disable = %+v", got)
	}
	if err := store.setEnabled("beta", false); err == nil {
		t.Fatal("disabling the last enabled source should fail")
	}
}

func TestSettingsStoreDeleteAndDefault(t *testing.T) {
	store, path := newSettingsStoreForTest(t, settingsTestConfig)
	if err := store.remove("alpha"); err != nil {
		t.Fatal(err)
	}
	cfg, err := config.Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.DefaultProfile != "beta" {
		t.Fatalf("default after deleting current = %q, want beta", cfg.DefaultProfile)
	}
	if _, ok := cfg.Profiles["alpha"]; ok {
		t.Fatal("alpha should be deleted")
	}
	if err := store.setDefault("beta"); err != nil {
		t.Fatal(err)
	}
	cfg, _ = config.Load(path)
	if cfg.DefaultProfile != "beta" {
		t.Fatalf("default = %q", cfg.DefaultProfile)
	}
	if err := store.remove("beta"); err == nil {
		t.Fatal("deleting the last profile should fail")
	}
}

func TestSettingsHTTPLocalOnly(t *testing.T) {
	store, _ := newSettingsStoreForTest(t, settingsTestConfig)
	h := newWebMultiHandler([]*webSource{fakeWebSource("alpha", "bucket-a", "a", true)}, "alpha", nil)
	h.settings = store

	req := httptest.NewRequest(http.MethodGet, "/api/settings/sources", nil)
	req.RemoteAddr = "127.0.0.1:12345"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("loopback status = %d body=%s", rec.Code, rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodGet, "/api/settings/sources", nil)
	req.RemoteAddr = "192.0.2.10:12345"
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("remote status = %d, want 403", rec.Code)
	}
}

func TestSettingsSaveReloadsSources(t *testing.T) {
	store, _ := newSettingsStoreForTest(t, settingsTestConfig)
	h := newWebMultiHandler([]*webSource{fakeWebSource("alpha", "bucket-a", "alpha", true)}, "alpha", nil)
	h.settings = store
	reloaded := 0
	h.reload = func() ([]*webSource, string, error) {
		reloaded++
		return []*webSource{
			fakeWebSource("alpha", "bucket-a", "alpha", true),
			fakeWebSource("gamma", "bucket-g", "gamma", true),
		}, "alpha", nil
	}

	body := `{"name":"gamma","endpoint":"https://g.example.com","bucket":"bucket-g","region":"us-west-2"}`
	req := httptest.NewRequest(http.MethodPost, "/api/settings/sources", strings.NewReader(body))
	req.RemoteAddr = "127.0.0.1:12345"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("save status = %d body=%s", rec.Code, rec.Body.String())
	}
	if reloaded != 1 {
		t.Fatalf("reload called %d times, want 1", reloaded)
	}
	if strings.Contains(rec.Body.String(), `"restartRequired":true`) {
		t.Fatalf("save should reload immediately: %s", rec.Body.String())
	}

	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/sources", nil))
	var got webSourcesResponse
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	if len(got.Sources) != 2 || got.Sources[1].Name != "gamma" {
		t.Fatalf("sources after save = %+v", got.Sources)
	}
}

func TestSettingsEnableReloadsSources(t *testing.T) {
	store, path := newSettingsStoreForTest(t, settingsTestConfig)
	h := newWebMultiHandler([]*webSource{
		fakeWebSource("alpha", "bucket-a", "alpha", true),
		fakeWebSource("beta", "bucket-b", "beta", true),
	}, "alpha", nil)
	h.settings = store
	h.reload = func() ([]*webSource, string, error) {
		return []*webSource{fakeWebSource("alpha", "bucket-a", "alpha", true)}, "alpha", nil
	}

	req := httptest.NewRequest(http.MethodPost, "/api/settings/enabled", strings.NewReader(`{"name":"beta","enabled":false}`))
	req.RemoteAddr = "127.0.0.1:12345"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("disable status = %d body=%s", rec.Code, rec.Body.String())
	}
	cfg, err := config.Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if !cfg.Profiles["beta"].Disabled {
		t.Fatal("beta should be disabled in the config file")
	}
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/sources", nil))
	var got webSourcesResponse
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	if len(got.Sources) != 1 || got.Sources[0].Name != "alpha" {
		t.Fatalf("disabled source should disappear: %+v", got.Sources)
	}
}

func TestSettingsTestConnection(t *testing.T) {
	s3srv := fakes3.New()
	defer s3srv.Close()
	body := fmt.Sprintf(`default-profile: test
profiles:
  test:
    endpoint: %s
    access-key: ak
    secret-key: sk
    bucket: qb
    region: us-east-1
    path-style: true
`, s3srv.URL())
	store, _ := newSettingsStoreForTest(t, body)
	if err := store.test(context.Background(), settingsSourceInput{
		Name: "test", Endpoint: s3srv.URL(), AccessKey: "ak", Bucket: "qb", PathStyle: true,
	}); err != nil {
		t.Fatalf("test connection failed: %v", err)
	}
	if err := store.test(context.Background(), settingsSourceInput{
		Name: "test", Endpoint: "http://127.0.0.1:1", AccessKey: "ak", Bucket: "qb", PathStyle: true,
	}); err == nil {
		t.Fatal("unreachable endpoint should fail")
	}
}

package cmd

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/BeCrafter/sail/internal/config"
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

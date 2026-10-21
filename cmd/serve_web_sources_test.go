package cmd

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func fakeWebSource(name, bucket, marker string, available bool) *webSource {
	return &webSource{
		id:        sourceID(name),
		name:      name,
		bucket:    bucket,
		available: available,
		handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			fmt.Fprintf(w, "%s:%s", marker, r.URL.Path)
		}),
	}
}

func TestWebMultiHandlerSourcesAndSwitch(t *testing.T) {
	alpha := fakeWebSource("alpha", "bucket-a", "alpha", true)
	beta := fakeWebSource("beta", "bucket-b", "beta", true)
	broken := fakeWebSource("broken", "bucket-c", "broken", false)
	h := newWebMultiHandler([]*webSource{broken, beta, alpha}, "alpha", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, "static")
	}))

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/sources", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("sources status = %d", rec.Code)
	}
	var got webSourcesResponse
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	if got.Default == "" || got.Selected != got.Default {
		t.Fatalf("default/selected = %q/%q", got.Default, got.Selected)
	}
	if len(got.Sources) != 3 || got.Sources[0].Name != "alpha" || !got.Sources[0].Default {
		t.Fatalf("sources = %+v", got.Sources)
	}
	var brokenView *webSourceView
	for i := range got.Sources {
		if got.Sources[i].Name == "broken" {
			brokenView = &got.Sources[i]
		}
	}
	if brokenView == nil || brokenView.Available {
		t.Fatalf("broken source should be listed as unavailable: %+v", brokenView)
	}

	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/list", nil))
	if body := rec.Body.String(); body != "alpha:/api/list" {
		t.Fatalf("default source routed to %q", body)
	}

	body := strings.NewReader(`{"id":"` + sourceID("beta") + `"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/source", body)
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("switch status = %d body=%s", rec.Code, rec.Body.String())
	}
	cookies := rec.Result().Cookies()
	if len(cookies) == 0 || cookies[0].Name != sailSourceCookie {
		t.Fatalf("missing source cookie: %+v", cookies)
	}

	req = httptest.NewRequest(http.MethodGet, "/api/list", nil)
	req.AddCookie(cookies[0])
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if body := rec.Body.String(); body != "beta:/api/list" {
		t.Fatalf("selected source routed to %q", body)
	}

	req = httptest.NewRequest(http.MethodGet, "/", nil)
	req.AddCookie(cookies[0])
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if body := rec.Body.String(); body != "static" {
		t.Fatalf("static handler routed to %q", body)
	}
}

func TestWebMultiHandlerRejectsMissingSource(t *testing.T) {
	h := newWebMultiHandler([]*webSource{fakeWebSource("alpha", "bucket-a", "alpha", true)}, "alpha", nil)
	body := strings.NewReader(`{"id":"` + sourceID("missing") + `"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/source", body)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestWebMultiHandlerReloadSources(t *testing.T) {
	h := newWebMultiHandler([]*webSource{fakeWebSource("alpha", "bucket-a", "alpha", true)}, "alpha", nil)
	h.reload = func() ([]*webSource, string, error) {
		return []*webSource{
			fakeWebSource("alpha", "bucket-a", "alpha", true),
			fakeWebSource("beta", "bucket-b", "beta", true),
		}, "beta", nil
	}
	if err := h.reloadSources(); err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/sources", nil))
	var got webSourcesResponse
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	if len(got.Sources) != 2 || got.Sources[0].Name != "beta" || !got.Sources[0].Default {
		t.Fatalf("after reload sources = %+v", got.Sources)
	}

	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/list", nil))
	if body := rec.Body.String(); body != "beta:/api/list" {
		t.Fatalf("reloaded default routed to %q", body)
	}

	h.reload = func() ([]*webSource, string, error) {
		return nil, "", fmt.Errorf("boom")
	}
	if err := h.reloadSources(); err == nil {
		t.Fatal("expected reload error")
	}
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/sources", nil))
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	if len(got.Sources) != 2 || got.Sources[0].Name != "beta" {
		t.Fatalf("failed reload should keep previous sources: %+v", got.Sources)
	}
}

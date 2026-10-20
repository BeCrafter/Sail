package cmd

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"log"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/BeCrafter/sail/internal/config"
	"github.com/BeCrafter/sail/internal/webfs"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// sailSourceCookie 记住浏览器当前选择的数据源。值用 profile 名的
// base64url 编码,避免 profile 名里的特殊字符破坏 Cookie 语法。
const sailSourceCookie = "sail_source"

// webSource 是一个可切换的数据源:一个 profile → 一套已装配好的网关。
// runtime 必须持有引用,否则其 S3 client / 目录缓存会被 GC 回收。
type webSource struct {
	id        string
	name      string
	bucket    string
	handler   http.Handler
	server    *webfs.Server
	runtime   *serveRuntime
	available bool
	errText   string
}

type webSourceView struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Bucket    string `json:"bucket,omitempty"`
	Default   bool   `json:"default"`
	Selected  bool   `json:"selected"`
	Available bool   `json:"available"`
	Error     string `json:"error,omitempty"`
}

type webSourcesResponse struct {
	Default  string          `json:"default"`
	Selected string          `json:"selected"`
	Manage   bool            `json:"manage"`
	Sources  []webSourceView `json:"sources"`
}

// webMultiHandler 在多个已构建好的 webfs.Server 之间路由。静态资源和
// /api/sources 由外壳处理,其余请求按 Cookie 选择数据源后原样交给对应网关。
type webMultiHandler struct {
	sources  []*webSource
	byID     map[string]*webSource
	def      *webSource
	static   http.Handler
	settings *sourceSettingsStore
}

func sourceID(name string) string {
	return base64.RawURLEncoding.EncodeToString([]byte(name))
}

func newWebSource(name, bucket string, rt *serveRuntime) *webSource {
	s := &webSource{
		id:      sourceID(name),
		name:    name,
		bucket:  bucket,
		runtime: rt,
	}
	if rt != nil {
		s.handler = rt.gw
		if g, ok := rt.gwi.(webGateway); ok {
			s.server = g.srv
		}
	}
	s.available = s.handler != nil && s.server != nil
	if !s.available {
		s.errText = "source is not initialized"
	}
	return s
}

func unavailableWebSource(name, reason string) *webSource {
	return &webSource{id: sourceID(name), name: name, available: false, errText: reason}
}

func newWebMultiHandler(sources []*webSource, defaultName string, static http.Handler) *webMultiHandler {
	h := &webMultiHandler{byID: make(map[string]*webSource, len(sources)), static: static}
	// 默认数据源排在最前面,其余按 profile 名字排序,侧栏顺序稳定。
	sort.SliceStable(sources, func(i, j int) bool {
		if sources[i].name == defaultName {
			return true
		}
		if sources[j].name == defaultName {
			return false
		}
		return sources[i].name < sources[j].name
	})
	h.sources = sources
	for _, s := range sources {
		h.byID[s.id] = s
	}
	if s := h.byID[sourceID(defaultName)]; s != nil && s.available {
		h.def = s
	}
	if h.def == nil {
		for _, s := range sources {
			if s.available {
				h.def = s
				break
			}
		}
	}
	return h
}

func (h *webMultiHandler) selected(r *http.Request) *webSource {
	if c, err := r.Cookie(sailSourceCookie); err == nil {
		if s := h.byID[c.Value]; s != nil && s.available {
			return s
		}
	}
	return h.def
}

func (h *webMultiHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	switch strings.TrimSuffix(r.URL.Path, "/") {
	case "/api/sources":
		h.handleSources(w, r)
		return
	case "/api/source":
		h.handleSource(w, r)
		return
	case "/api/settings/sources":
		h.handleSettingsSources(w, r)
		return
	case "/api/settings/default":
		h.handleSettingsDefault(w, r)
		return
	}

	if strings.HasPrefix(r.URL.Path, "/api/") {
		s := h.selected(r)
		if s == nil || s.handler == nil {
			writeSourceJSONError(w, http.StatusServiceUnavailable, "no data source is available")
			return
		}
		s.handler.ServeHTTP(w, r)
		return
	}

	if h.static != nil {
		if !h.authorized(w, r) {
			return
		}
		h.static.ServeHTTP(w, r)
		return
	}
	if s := h.selected(r); s != nil && s.handler != nil {
		s.handler.ServeHTTP(w, r)
		return
	}
	http.NotFound(w, r)
}

func (h *webMultiHandler) authorized(w http.ResponseWriter, r *http.Request) bool {
	if h.def == nil || h.def.server == nil {
		return true
	}
	if h.def.server.CheckAuth(r) {
		return true
	}
	h.def.server.WriteUnauthorized(w)
	return false
}

func (h *webMultiHandler) handleSources(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		writeSourceJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if !h.authorized(w, r) {
		return
	}
	selected := h.selected(r)
	h.writeSources(w, r, selected)
}

func (h *webMultiHandler) handleSource(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		writeSourceJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if !h.authorized(w, r) {
		return
	}
	var in struct {
		ID string `json:"id"`
	}
	body := http.MaxBytesReader(w, r.Body, 1<<20)
	if err := json.NewDecoder(body).Decode(&in); err != nil {
		writeSourceJSONError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	s := h.byID[in.ID]
	if s == nil || !s.available {
		writeSourceJSONError(w, http.StatusNotFound, "data source not found")
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     sailSourceCookie,
		Value:    s.id,
		Path:     "/",
		MaxAge:   365 * 24 * 60 * 60,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   r.TLS != nil,
	})
	h.writeSources(w, r, s)
}

func (h *webMultiHandler) writeSources(w http.ResponseWriter, r *http.Request, selected *webSource) {
	if selected == nil {
		selected = h.def
	}
	defID := ""
	if h.def != nil {
		defID = h.def.id
	}
	selectedID := ""
	if selected != nil {
		selectedID = selected.id
	}
	out := webSourcesResponse{Default: defID, Selected: selectedID, Manage: h.canManage(r), Sources: make([]webSourceView, 0, len(h.sources))}
	for _, s := range h.sources {
		out.Sources = append(out.Sources, webSourceView{
			ID:        s.id,
			Name:      s.name,
			Bucket:    s.bucket,
			Default:   h.def != nil && s.id == h.def.id,
			Selected:  selectedID != "" && s.id == selectedID,
			Available: s.available,
			Error:     s.errText,
		})
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(out)
}

func writeSourceJSONError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"error": map[string]string{"code": "source_error", "message": message},
	})
}

// buildWebSources 为配置文件里的每个 profile 构建一个 Web 数据源。
// 默认数据源构建失败不影响其它源;失败的 profile 仍会出现在列表里并标记
// available=false,便于用户看到配置存在但暂时不可用。
func buildWebSources(cfg *config.Config, o serveFlags, changed func(string) bool, active *serveRuntime, activeResolved *config.Resolved, logger *log.Logger) []*webSource {
	activeName := activeResolved.ProfileName
	names := make([]string, 0)
	if cfg != nil {
		names = make([]string, 0, len(cfg.Profiles)+1)
		for name := range cfg.Profiles {
			names = append(names, name)
		}
	}
	if len(names) == 0 {
		names = append(names, activeName)
	} else {
		// 配置文件存在但当前 profile 不在其中(例如用 flag 临时指定),仍要展示。
		found := false
		for _, name := range names {
			if name == activeName {
				found = true
				break
			}
		}
		if !found {
			names = append(names, activeName)
		}
	}
	sort.Strings(names)

	sources := make([]*webSource, 0, len(names))
	for _, name := range names {
		if name == activeName {
			sources = append(sources, newWebSource(name, activeResolved.Bucket, active))
			continue
		}
		pr, err := cfg.Resolve(name)
		if err != nil {
			logger.Printf("data source %q unavailable: %v", name, err)
			sources = append(sources, unavailableWebSource(name, err.Error()))
			continue
		}
		if pr.Bucket == "" {
			logger.Printf("data source %q unavailable: bucket is not configured", name)
			sources = append(sources, unavailableWebSource(name, "bucket is not configured"))
			continue
		}
		ps, err := mergeServeWeb(o, pr, changed)
		if err != nil {
			logger.Printf("data source %q unavailable: %v", name, err)
			sources = append(sources, unavailableWebSource(name, err.Error()))
			continue
		}
		prt, err := newServeRuntimeWith(o, pr, ps, changed, logger, webProtocolShell, serveRuntimeOptions{
			presignUsing: func(s3c *s3.Client) func(context.Context, string, string, time.Duration) (string, error) {
				return presignForServe(s3c, pr.Bucket)
			},
			publicURL: publicURLForServe(pr),
		})
		if err != nil {
			logger.Printf("data source %q unavailable: %v", name, err)
			sources = append(sources, unavailableWebSource(name, err.Error()))
			continue
		}
		sources = append(sources, newWebSource(name, pr.Bucket, prt))
	}
	return sources
}

func defaultWebSourceName(cfg *config.Config, activeName string) string {
	// 显式 --profile 优先;否则用配置里的 default-profile。
	if profile != "" {
		return activeName
	}
	if cfg != nil && cfg.DefaultProfile != "" {
		if _, ok := cfg.Profiles[cfg.DefaultProfile]; ok {
			return cfg.DefaultProfile
		}
	}
	return activeName
}

package cmd

import (
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"

	"github.com/BeCrafter/sail/internal/config"
)

var profileNameRE = regexp.MustCompile(`^[A-Za-z0-9._-]+$`)

// sourceSettingsStore 负责把设置页的改动原子写回配置文件。它只在服务端
// 本地使用,但读写仍加锁,避免两个浏览器标签同时保存时互相覆盖。
type sourceSettingsStore struct {
	path string
	mu   sync.Mutex
}

type settingsSourceView struct {
	Name      string `json:"name"`
	Endpoint  string `json:"endpoint"`
	AccessKey string `json:"accessKey"`
	HasSecret bool   `json:"hasSecret"`
	Bucket    string `json:"bucket"`
	Region    string `json:"region"`
	PathStyle bool   `json:"pathStyle"`
	CDNDomain string `json:"cdnDomain"`
	Default   bool   `json:"default"`
}

type settingsSourcesResponse struct {
	Path    string               `json:"path"`
	Default string               `json:"default"`
	Sources []settingsSourceView `json:"sources"`
}

type settingsSourceInput struct {
	Name      string `json:"name"`
	Endpoint  string `json:"endpoint"`
	AccessKey string `json:"accessKey"`
	SecretKey string `json:"secretKey"`
	Bucket    string `json:"bucket"`
	Region    string `json:"region"`
	PathStyle bool   `json:"pathStyle"`
	CDNDomain string `json:"cdnDomain"`
	Default   bool   `json:"default"`
}

func newSourceSettingsStore(path string) *sourceSettingsStore {
	if path == "" {
		path, _ = config.ConfigPath()
	}
	return &sourceSettingsStore{path: path}
}

func (s *sourceSettingsStore) load() (*config.Config, error) {
	if s.path == "" {
		return nil, errors.New("config file path is unavailable")
	}
	cfg, err := config.Load(s.path)
	if err != nil {
		return nil, err
	}
	if cfg == nil {
		cfg = &config.Config{}
	}
	if cfg.Profiles == nil {
		cfg.Profiles = map[string]config.Profile{}
	}
	return cfg, nil
}

func (s *sourceSettingsStore) list() (settingsSourcesResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	cfg, err := s.load()
	if err != nil {
		return settingsSourcesResponse{}, err
	}
	names := make([]string, 0, len(cfg.Profiles))
	for name := range cfg.Profiles {
		names = append(names, name)
	}
	sort.Strings(names)
	out := settingsSourcesResponse{
		Path:    s.path,
		Default: cfg.DefaultProfile,
		Sources: make([]settingsSourceView, 0, len(names)),
	}
	for _, name := range names {
		p := cfg.Profiles[name]
		out.Sources = append(out.Sources, settingsSourceView{
			Name: name, Endpoint: p.Endpoint, AccessKey: p.AccessKey,
			HasSecret: p.SecretKey != "", Bucket: p.Bucket, Region: p.Region,
			PathStyle: p.PathStyle, CDNDomain: p.CDNDomain,
			Default: cfg.DefaultProfile == name,
		})
	}
	return out, nil
}

func (s *sourceSettingsStore) save(in settingsSourceInput) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	cfg, err := s.load()
	if err != nil {
		return err
	}
	name := strings.TrimSpace(in.Name)
	if name == "" {
		return errors.New("data source name is required")
	}
	_, exists := cfg.Profiles[name]
	if !exists && !profileNameRE.MatchString(name) {
		return errors.New("data source name may only contain letters, numbers, dot, dash and underscore")
	}
	if strings.TrimSpace(in.Endpoint) == "" {
		return errors.New("endpoint is required")
	}
	if strings.TrimSpace(in.Bucket) == "" {
		return errors.New("bucket is required")
	}
	p := cfg.Profiles[name]
	p.Endpoint = strings.TrimSpace(in.Endpoint)
	p.AccessKey = strings.TrimSpace(in.AccessKey)
	// 编辑时密码留空表示保持原值;新建时留空则由 renderConfigFile 写
	// 成 ${SAIL_<PROFILE>_SECRET_KEY} 环境变量占位符。
	if in.SecretKey != "" {
		p.SecretKey = in.SecretKey
	}
	p.Bucket = strings.TrimSpace(in.Bucket)
	p.Region = strings.TrimSpace(in.Region)
	p.PathStyle = in.PathStyle
	p.CDNDomain = strings.TrimSpace(in.CDNDomain)
	cfg.Profiles[name] = p
	if in.Default || cfg.DefaultProfile == "" {
		cfg.DefaultProfile = name
	} else if cfg.DefaultProfile == name && len(cfg.Profiles) > 1 {
		// 取消当前默认项的勾选时,自动选一个其它 profile,避免留下空的默认值。
		names := make([]string, 0, len(cfg.Profiles))
		for n := range cfg.Profiles {
			if n != name {
				names = append(names, n)
			}
		}
		sort.Strings(names)
		cfg.DefaultProfile = names[0]
	}
	return s.write(cfg)
}

func (s *sourceSettingsStore) remove(name string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	cfg, err := s.load()
	if err != nil {
		return err
	}
	if _, ok := cfg.Profiles[name]; !ok {
		return errors.New("data source not found")
	}
	if len(cfg.Profiles) <= 1 {
		return errors.New("the last data source cannot be deleted")
	}
	delete(cfg.Profiles, name)
	if cfg.DefaultProfile == name {
		names := make([]string, 0, len(cfg.Profiles))
		for n := range cfg.Profiles {
			names = append(names, n)
		}
		sort.Strings(names)
		cfg.DefaultProfile = names[0]
	}
	return s.write(cfg)
}

func (s *sourceSettingsStore) setDefault(name string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	cfg, err := s.load()
	if err != nil {
		return err
	}
	if _, ok := cfg.Profiles[name]; !ok {
		return errors.New("data source not found")
	}
	cfg.DefaultProfile = name
	return s.write(cfg)
}

func (s *sourceSettingsStore) write(cfg *config.Config) error {
	data := []byte(renderConfigFile(cfg))
	dir := filepath.Dir(s.path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, ".sail-config-*.yaml")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		return err
	}
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmpName, s.path)
}

func (h *webMultiHandler) canManage(r *http.Request) bool {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func (h *webMultiHandler) handleSettingsSources(w http.ResponseWriter, r *http.Request) {
	if !h.canManage(r) {
		writeSourceJSONError(w, http.StatusForbidden, "settings are only available from localhost")
		return
	}
	if h.settings == nil {
		writeSourceJSONError(w, http.StatusServiceUnavailable, "settings store is unavailable")
		return
	}
	switch r.Method {
	case http.MethodGet:
		out, err := h.settings.list()
		if err != nil {
			writeSourceJSONError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeSettingsJSON(w, http.StatusOK, out)
	case http.MethodPost:
		var in settingsSourceInput
		if err := decodeSettingsJSON(w, r, &in); err != nil {
			writeSourceJSONError(w, http.StatusBadRequest, err.Error())
			return
		}
		if err := h.settings.save(in); err != nil {
			writeSourceJSONError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeSettingsJSON(w, http.StatusOK, map[string]any{"ok": true, "restartRequired": true})
	case http.MethodDelete:
		name := strings.TrimSpace(r.URL.Query().Get("name"))
		if name == "" {
			writeSourceJSONError(w, http.StatusBadRequest, "name is required")
			return
		}
		if err := h.settings.remove(name); err != nil {
			writeSourceJSONError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeSettingsJSON(w, http.StatusOK, map[string]any{"ok": true, "restartRequired": true})
	default:
		w.Header().Set("Allow", "GET, POST, DELETE")
		writeSourceJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (h *webMultiHandler) handleSettingsDefault(w http.ResponseWriter, r *http.Request) {
	if !h.canManage(r) {
		writeSourceJSONError(w, http.StatusForbidden, "settings are only available from localhost")
		return
	}
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		writeSourceJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if h.settings == nil {
		writeSourceJSONError(w, http.StatusServiceUnavailable, "settings store is unavailable")
		return
	}
	var in struct {
		Name string `json:"name"`
	}
	if err := decodeSettingsJSON(w, r, &in); err != nil {
		writeSourceJSONError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := h.settings.setDefault(strings.TrimSpace(in.Name)); err != nil {
		writeSourceJSONError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeSettingsJSON(w, http.StatusOK, map[string]any{"ok": true, "restartRequired": true})
}

func decodeSettingsJSON(w http.ResponseWriter, r *http.Request, dst any) error {
	body := http.MaxBytesReader(w, r.Body, 1<<20)
	return json.NewDecoder(body).Decode(dst)
}

func writeSettingsJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

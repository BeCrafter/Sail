package webfs

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"sync/atomic"
	"time"

	"github.com/BeCrafter/sail/internal/vfs"
)

// Config 是 Web 网关外壳的构造参数。
type Config struct {
	// Anonymous 为 true 时网关不校验 Basic 凭据:所有请求都路由到 Users 中
	// 唯一的一条匿名空间(Password 可为空)。Web 资源库默认匿名;WebDAV/SMB
	// 不走这个开关。
	Anonymous bool
	// Users 是用户路由表(每用户一个已构建好的 FileSystem)。非匿名模式下
	// 与 WebDAV/SMB 同一套语义:至少一名用户,不允许匿名共享。
	Users []UserEntry
	// MaxUploadSize 是单次上传的请求体上限(字节);<= 0 表示不限制。
	MaxUploadSize int64
	// MaxUploadSizeText 是上限的人类可读文本,用于错误指引文案。
	MaxUploadSizeText string
	// Static 处理非 /api/ 的请求(内置前端的静态资源);nil = 只提供 API。
	Static http.Handler
	// Logger 为空则不记录访问日志。
	Logger *log.Logger
	// Profile / Bucket / RootPrefix / Version 只用于 /api/session 的展示信息。
	Profile    string
	Bucket     string
	RootPrefix string
	Version    string
	// Presign 由调用方注入(需要 S3 客户端与桶名),nil = 该能力不可用。
	// 参数是「该用户的生效前缀」与「相对该前缀的逻辑路径」:物理 key 由两者
	// 拼出,协议壳不认识 S3,也就拼不出来。
	Presign func(ctx context.Context, effectivePrefix, logical string, expires time.Duration) (string, error)
	// PublicURL 由调用方注入(cdn-domain 配置),返回 false = 未配置 CDN。
	PublicURL func(effectivePrefix, logical string) (string, bool)
}

// UserEntry 是一名用户的路由表条目:凭据 + 该用户已构建好的文件系统。
// 两次 SwapUsers 传入同一指针即视为同一栈复用(缓存、预热原样保留)。
type UserEntry struct {
	Name       string
	Password   string
	FileSystem *FileSystem
	// Prefix 是该用户的生效前缀(仅用于展示与日志)。
	Prefix string
	// PrewarmDirs 是该用户空间内需要后台预热的目录。
	PrewarmDirs []string
}

// Server 是 Web 网关的 HTTP 外壳:认证 → 按用户路由 → JSON API / 静态资源。
type Server struct {
	anonymous     bool
	anonymousSpot atomic.Pointer[userEntry] // 匿名模式下唯一的空间
	users         atomic.Value              // map[string]*userEntry
	maxUploadSize int64
	maxUploadText string
	static        http.Handler
	logger        *log.Logger
	profile       string
	bucket        string
	rootPrefix    string
	version       string
	presign       func(ctx context.Context, effectivePrefix, logical string, expires time.Duration) (string, error)
	publicURL     func(effectivePrefix, logical string) (string, bool)
}

type userEntry struct {
	password string
	fs       *FileSystem
	prefix   string
}

// anonymousUser 是匿名模式在访问日志里使用的用户名。
const anonymousUser = "anonymous"

// NewServer 组装网关。与 WebDAV 壳同一条理由:认证与路由在进入内核之前
// 完成,内核不认识用户。
func NewServer(cfg Config) (*Server, error) {
	if cfg.Anonymous {
		if len(cfg.Users) != 1 {
			return nil, errors.New("webfs: 匿名模式需要且仅需要一个空间")
		}
	} else if len(cfg.Users) == 0 {
		return nil, errors.New("webfs: 缺少用户表,不允许匿名共享")
	}
	s := &Server{
		anonymous:     cfg.Anonymous,
		maxUploadSize: cfg.MaxUploadSize,
		maxUploadText: cfg.MaxUploadSizeText,
		static:        cfg.Static,
		logger:        cfg.Logger,
		profile:       cfg.Profile,
		bucket:        cfg.Bucket,
		rootPrefix:    cfg.RootPrefix,
		version:       cfg.Version,
		presign:       cfg.Presign,
		publicURL:     cfg.PublicURL,
	}
	if err := s.SwapUsers(cfg.Users); err != nil {
		return nil, err
	}
	return s, nil
}

// SwapUsers 原子替换用户路由表(配置热加载的 Swap 步):同一 FileSystem
// 指针 = 同一栈,只换凭据条目;新指针构建新条目并启动预热;消失的条目
// 自然退役(在途请求持旧引用完成)。
func (s *Server) SwapUsers(entries []UserEntry) error {
	if s.anonymous {
		if len(entries) != 1 {
			return errors.New("webfs: 匿名模式需要且仅需要一个空间")
		}
		e := entries[0]
		prev := s.anonymousSpot.Load()
		// 同一 FileSystem 指针 = 同一栈:热加载只换壳条目,不重复预热。
		s.anonymousSpot.Store(&userEntry{fs: e.FileSystem, prefix: e.Prefix})
		if prev == nil || prev.fs != e.FileSystem {
			s.prewarm(e.FileSystem, e.PrewarmDirs)
		}
		return nil
	}
	if len(entries) == 0 {
		return errors.New("webfs: 用户表不能为空")
	}
	table := make(map[string]*userEntry, len(entries))
	for _, e := range entries {
		if e.Name == "" {
			return errors.New("webfs: 用户名不能为空")
		}
		if e.Password == "" {
			return errors.New("webfs: 用户密码不能为空,不允许空口令")
		}
		if _, dup := table[e.Name]; dup {
			return fmt.Errorf("webfs: 用户名 %q 重复", e.Name)
		}
		table[e.Name] = &userEntry{password: e.Password, fs: e.FileSystem, prefix: e.Prefix}
	}
	prev, _ := s.users.Load().(map[string]*userEntry)
	s.users.Store(table)
	for _, e := range entries {
		old, ok := prev[e.Name]
		if ok && old.fs == e.FileSystem {
			continue // 同一栈:预热已经跑过,不重复
		}
		s.prewarm(e.FileSystem, e.PrewarmDirs)
	}
	return nil
}

// prewarm 为一个新栈启动后台预热;空清单直接返回。goroutine 的生命周期
// 由超时控制,不阻塞请求路径。
func (s *Server) prewarm(fs *FileSystem, dirs []string) {
	if len(dirs) == 0 {
		return
	}
	go func(fs *FileSystem, dirs []string) {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
		defer cancel()
		fs.Prewarm(ctx, dirs)
	}(fs, dirs)
}

func (s *Server) current() map[string]*userEntry {
	t, _ := s.users.Load().(map[string]*userEntry)
	return t
}

// ServeHTTP 是网关入口:先认证,再按 r.URL.Path 分派。
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	sw := &statusWriter{ResponseWriter: w, status: http.StatusOK}

	entry, user := s.authenticate(r)
	if s.anonymous {
		entry, user = s.anonymousSpot.Load(), anonymousUser
	}
	if entry == nil {
		s.unauthorized(sw)
		s.logRequest(r, "?", sw.status, start)
		return
	}
	req := &request{user: user, fs: entry.fs, prefix: entry.prefix, server: s, raw: r}

	if strings.HasPrefix(r.URL.Path, "/api/") {
		s.route(req, sw)
	} else if s.static != nil {
		s.static.ServeHTTP(sw, r)
	} else {
		http.NotFound(sw, r)
	}
	s.logRequest(r, user, sw.status, start)
}

// route 是 API 路由表。方法不匹配返回 405,未知路径 404——都是 JSON,
// 前端不必猜 HTML 错误页。
func (s *Server) route(req *request, w http.ResponseWriter) {
	// /api/raw/<逻辑路径> 是给 HTML 预览用的「保留目录结构」出口:iframe 里的
	// 相对链接(CSS/JS/图片)会按 URL 层级继续落到这里,而不是落到 SPA 回退页。
	// 它和 /api/file 共享同一套 stat/open/Range 实现,只是路径来自 URL 而不是 query。
	if strings.HasPrefix(req.raw.URL.Path, "/api/raw/") {
		if req.raw.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			writeJSON(w, http.StatusMethodNotAllowed, errorBody("method_not_allowed", "method "+req.raw.Method+" is not allowed here"))
			return
		}
		req.handleRaw(w)
		return
	}

	path := strings.TrimSuffix(req.raw.URL.Path, "/")
	if path == "" {
		path = "/"
	}
	handlers := map[string]map[string]apiHandler{
		"/api/session": {"GET": (*request).handleSession},
		"/api/list":    {"GET": (*request).handleList},
		"/api/stat":    {"GET": (*request).handleStat},
		"/api/usage":   {"GET": (*request).handleUsage},
		"/api/url":     {"GET": (*request).handleURL},
		"/api/file":    {"GET": (*request).handleDownload, "PUT": (*request).handleUpload},
		"/api/mkdir":   {"POST": (*request).handleMkdir},
		"/api/rename":  {"POST": (*request).handleRename},
		"/api/delete":  {"POST": (*request).handleDelete},
	}
	byMethod, ok := handlers[path]
	if !ok {
		writeJSON(w, http.StatusNotFound, errorBody("not_found", "unknown API path: "+path))
		return
	}
	h, ok := byMethod[req.raw.Method]
	if !ok {
		w.Header().Set("Allow", strings.Join(allowMethods(byMethod), ", "))
		writeJSON(w, http.StatusMethodNotAllowed, errorBody("method_not_allowed", "method "+req.raw.Method+" is not allowed here"))
		return
	}
	h(req, w)
}

func allowMethods(m map[string]apiHandler) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

// authenticate 校验 Basic 凭据并返回对应的用户条目。用户名不存在也走同一
// 条失败路径(不泄露用户是否存在),口令比对用常量时间。
func (s *Server) authenticate(r *http.Request) (*userEntry, string) {
	name, password, ok := r.BasicAuth()
	if !ok {
		return nil, ""
	}
	entry, ok := s.current()[name]
	if !ok {
		return nil, ""
	}
	if subtle.ConstantTimeCompare([]byte(password), []byte(entry.password)) != 1 {
		return nil, ""
	}
	return entry, name
}

func (s *Server) unauthorized(w http.ResponseWriter) {
	w.Header().Set("WWW-Authenticate", `Basic realm="sail", charset="UTF-8"`)
	writeJSON(w, http.StatusUnauthorized, errorBody("unauthorized", "authentication required"))
}

func (s *Server) logRequest(r *http.Request, user string, status int, start time.Time) {
	if s.logger == nil {
		return
	}
	s.logger.Printf("%s %s %d %s user=%s", r.Method, r.URL.Path, status, time.Since(start).Round(time.Millisecond), user)
}

// statusWriter 记录实际写出的状态码(访问日志用),并把 Write 显式落成 200。
type statusWriter struct {
	http.ResponseWriter
	status int
	wrote  bool
}

func (w *statusWriter) WriteHeader(code int) {
	if w.wrote {
		return
	}
	w.status = code
	w.wrote = true
	w.ResponseWriter.WriteHeader(code)
}

func (w *statusWriter) Write(b []byte) (int, error) {
	if !w.wrote {
		w.WriteHeader(http.StatusOK)
	}
	return w.ResponseWriter.Write(b)
}

// Unwrap 让 http.ResponseWriter 的可选能力(Flush/Hijack)在包装后仍可用。
func (w *statusWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

// request 是一次 API 调用的上下文:谁在调、用哪个内核栈、网关配置。
type request struct {
	user   string
	fs     *FileSystem
	prefix string
	server *Server
	raw    *http.Request
}

type apiHandler func(*request, http.ResponseWriter)

// writeJSON 输出 JSON 响应。
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	if v == nil {
		return
	}
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(v)
}

func errorBody(code, message string) map[string]any {
	return map[string]any{"error": map[string]string{"code": code, "message": message}}
}

// fail 把内核错误翻译成 HTTP 状态码 + 稳定错误码。错误码是前端做双语文案的
// 依据,文案本身只求可读(浏览器上还会被前端本地化文案覆盖)。
func fail(w http.ResponseWriter, err error) {
	status, code := mapError(err)
	writeJSON(w, status, errorBody(code, err.Error()))
}

func mapError(err error) (int, string) {
	switch {
	case err == nil:
		return http.StatusOK, ""
	case errors.Is(err, vfs.ErrNotExist):
		return http.StatusNotFound, "not_found"
	case errors.Is(err, vfs.ErrExist):
		return http.StatusConflict, "exists"
	case errors.Is(err, vfs.ErrTooLarge):
		return http.StatusRequestEntityTooLarge, "too_large"
	case errors.Is(err, vfs.ErrQuotaExceeded):
		return http.StatusInsufficientStorage, "quota_exceeded"
	case errors.Is(err, vfs.ErrInsufficientStorage):
		return http.StatusInsufficientStorage, "insufficient_storage"
	case errors.Is(err, vfs.ErrNotSupported):
		return http.StatusNotImplemented, "unsupported"
	case errors.Is(err, context.Canceled), errors.Is(err, context.DeadlineExceeded):
		return 499, "canceled"
	default:
		return http.StatusInternalServerError, "internal"
	}
}

// readJSONBody 解析请求体(上限 1MiB:这些接口的 body 只有路径与名字)。
func readJSONBody(r *http.Request, v any) error {
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		return err
	}
	if len(body) == 0 {
		return errors.New("empty request body")
	}
	return json.Unmarshal(body, v)
}

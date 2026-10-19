// Package webui 打包内置 Web 资源库的前端静态资源(index.html / app.js / app.css
// 与按需 vendor 的预览库),以 go:embed 编进二进制。
//
// 前端只与 internal/webfs 的 JSON API 对话,不认识 S3、也不需要 Node 运行时:
// 「单静态二进制、零运行时依赖」这条边界在 Web 端同样成立。
package webui

import (
	"embed"
	"io/fs"
	"net/http"
	"path"
	"strings"
)

//go:embed assets
var assets embed.FS

// Handler 返回前端资源处理器:命中真实文件就返回它,否则回落到 index.html
// (前端是单页应用,深链接刷新不该 404)。
func Handler() http.Handler {
	sub, err := fs.Sub(assets, "assets")
	if err != nil {
		// embed 的目录在编译期就固定,失败意味着打包有问题,只能 fail loud。
		panic("webui: embedded assets unavailable: " + err.Error())
	}
	return &spaHandler{root: sub}
}

type spaHandler struct{ root fs.FS }

func (h *spaHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
	if name == "" || name == "." {
		name = "index.html"
	}
	if fi, err := fs.Stat(h.root, name); err == nil && !fi.IsDir() {
		serveAsset(w, r, h.root, name)
		return
	}
	serveAsset(w, r, h.root, "index.html")
}

// serveAsset 输出单个资源并带上缓存头。
//
// index.html 必须每次校验(no-cache):它引用带版本号的静态资源,升级二进制
// 后浏览器要立刻拿到新页面;其余资源的 URL 里带版本(见 index.html),可以
// 长缓存 —— 这正是「升级即生效、又不反复回源」的常见做法。
func serveAsset(w http.ResponseWriter, r *http.Request, root fs.FS, name string) {
	data, err := fs.ReadFile(root, name)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	if ct := contentTypeOf(name); ct != "" {
		w.Header().Set("Content-Type", ct)
	}
	if name == "index.html" {
		w.Header().Set("Cache-Control", "no-cache")
	} else {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	}
	w.Header().Set("X-Content-Type-Options", "nosniff")
	_, _ = w.Write(data)
}

func contentTypeOf(name string) string {
	switch path.Ext(name) {
	case ".html":
		return "text/html; charset=utf-8"
	case ".css":
		return "text/css; charset=utf-8"
	case ".js", ".mjs":
		return "text/javascript; charset=utf-8"
	case ".json":
		return "application/json; charset=utf-8"
	case ".svg":
		return "image/svg+xml"
	case ".png":
		return "image/png"
	case ".ico":
		return "image/x-icon"
	case ".woff2":
		return "font/woff2"
	default:
		return ""
	}
}

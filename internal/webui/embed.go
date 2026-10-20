// Package webui 打包内置 Web 资源库的前端静态资源(index.html / app.js / app.css
// 与按需 vendor 的预览库),以 go:embed 编进二进制。
//
// 前端只与 internal/webfs 的 JSON API 对话,不认识 S3、也不需要 Node 运行时:
// 「单静态二进制、零运行时依赖」这条边界在 Web 端同样成立。
package webui

import (
	"bytes"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"io/fs"
	"net/http"
	"path"
	"strings"
	"sync"
)

//go:embed assets
var assets embed.FS

// 静态资源 URL 的版本占位符。index.html、app.js 里的懒加载路径和
// preview_xlsx.js 的静态 import 都用它;serveAsset 输出时替换成当前构建的
// 内容哈希。这样升级二进制后 URL 一定变化,浏览器不会继续用上一版缓存。
const assetVersionPlaceholder = "__SAIL_ASSET_V__"

var (
	assetVersionOnce  sync.Once
	assetVersionValue string
)

// assetVersion 对全部嵌入资源做一次内容哈希;只在 Handler 第一次输出时计算。
// 不依赖 git、构建时间或 VERSION,本地 make build(默认 dev)也能正确失效。
func assetVersion() string {
	assetVersionOnce.Do(func() {
		h := sha256.New()
		if err := fs.WalkDir(assets, ".", func(p string, d fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if d.IsDir() {
				return nil
			}
			data, err := fs.ReadFile(assets, p)
			if err != nil {
				return err
			}
			_, _ = h.Write([]byte(p))
			_, _ = h.Write([]byte{0})
			_, _ = h.Write(data)
			return nil
		}); err != nil {
			// embed 内容在编译期固定,读失败只能说明打包本身有问题。
			panic("webui: hash embedded assets: " + err.Error())
		}
		assetVersionValue = hex.EncodeToString(h.Sum(nil))[:12]
	})
	return assetVersionValue
}

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
// 后浏览器要立刻拿到新页面。其余资源只有带 ?v= 时才允许长缓存;无版本 URL
// (旧书签、旧页面)一律 no-cache,避免再次出现「二进制升级了但前端不更新」。
func serveAsset(w http.ResponseWriter, r *http.Request, root fs.FS, name string) {
	data, err := fs.ReadFile(root, name)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	if name == "index.html" || strings.HasSuffix(name, ".js") || strings.HasSuffix(name, ".mjs") {
		data = bytes.ReplaceAll(data, []byte(assetVersionPlaceholder), []byte(assetVersion()))
	}
	if ct := contentTypeOf(name); ct != "" {
		w.Header().Set("Content-Type", ct)
	}
	if name == "index.html" || r.URL.Query().Get("v") == "" {
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
	case ".woff":
		return "font/woff"
	case ".ttf":
		return "font/ttf"
	case ".otf":
		return "font/otf"
	case ".wasm":
		return "application/wasm"
	case ".bcmap", ".pfb", ".icc":
		return "application/octet-stream"
	case ".ftl":
		return "text/plain; charset=utf-8"
	default:
		return ""
	}
}

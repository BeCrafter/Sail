package webfs

import (
	"errors"
	"io"
	"mime"
	"net/http"
	"path"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/BeCrafter/sail/internal/mimetype"
	"github.com/BeCrafter/sail/internal/vfs"
)

// entryJSON 是返回给前端的条目形态。时间用毫秒时间戳:浏览器侧直接
// new Date(ms),不必各自解析格式。
func entryJSON(fi vfs.FileInfo) map[string]any {
	m := map[string]any{
		"name":        nameOf(fi),
		"path":        fi.Path,
		"dir":         fi.IsDir,
		"size":        fi.Size,
		"mtime":       fi.ModTime.UnixMilli(),
		"etag":        fi.ETag,
		"contentType": fi.ContentType,
	}
	return m
}

// nameOf 取条目的展示名:目录去掉结尾斜杠。
func nameOf(fi vfs.FileInfo) string {
	if fi.IsDir {
		return trimSlash(fi.Name)
	}
	return fi.Name
}

func trimSlash(s string) string {
	for len(s) > 0 && s[len(s)-1] == '/' {
		s = s[:len(s)-1]
	}
	return s
}

// quotaJSON 组装配额快照。limit 是 used+avail,前端据此画进度条;
// ok=false 表示这个后端没有配额口径(单用户不限量时也是 false)。
func quotaJSON(used, avail int64, ok bool) map[string]any {
	return map[string]any{"used": used, "avail": avail, "limit": used + avail, "ok": ok}
}

// handleSession 返回当前会话的信息:谁、哪个仓、能不能上传、配额多少。
// 前端首屏用它渲染侧栏与状态栏,不再需要「测试连接」这类探测。
func (r *request) handleSession(w http.ResponseWriter) {
	used, avail, ok := r.fs.QuotaUsage()
	writeJSON(w, http.StatusOK, map[string]any{
		"user":            r.user,
		"profile":         r.server.profile,
		"bucket":          r.server.bucket,
		"prefix":          strings.TrimSuffix(r.prefix, "/"),
		"rootPrefix":      strings.TrimSuffix(r.server.rootPrefix, "/"),
		"version":         r.server.version,
		"maxUploadSize":   r.server.maxUploadSize,
		"maxUploadText":   r.server.maxUploadText,
		"quota":           quotaJSON(used, avail, ok),
		"listingCacheTTL": r.fs.listingTTLSeconds(),
		"capabilities": map[string]bool{
			"presign":   r.server.presign != nil,
			"publicUrl": r.server.publicURL != nil,
		},
	})
}

// handleList 列目录。条目按「目录在前,然后按名字」排序:与文件管理器的
// 习惯一致,前端即使另有排序开关也从一个确定顺序起步。
func (r *request) handleList(w http.ResponseWriter) {
	logical, err := queryPath(r.raw.URL.Query(), "path")
	if err != nil {
		fail(w, err)
		return
	}
	entries, err := r.fs.ReadDir(r.raw.Context(), logical)
	if err != nil {
		fail(w, err)
		return
	}
	sort.SliceStable(entries, func(i, j int) bool {
		if entries[i].IsDir != entries[j].IsDir {
			return entries[i].IsDir
		}
		return entries[i].Name < entries[j].Name
	})
	out := make([]map[string]any, 0, len(entries))
	for _, e := range entries {
		out = append(out, entryJSON(e))
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"path":            logical,
		"entries":         out,
		"count":           len(out),
		"truncated":       false,
		"listingCacheTTL": r.fs.listingTTLSeconds(),
	})
}

// handleStat 取单个条目。
func (r *request) handleStat(w http.ResponseWriter) {
	logical, err := queryPath(r.raw.URL.Query(), "path")
	if err != nil {
		fail(w, err)
		return
	}
	fi, err := r.fs.Stat(r.raw.Context(), logical)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"entry": entryJSON(fi)})
}

// handleUsage 返回配额口径的用量(已用/可用/上限)。
func (r *request) handleUsage(w http.ResponseWriter) {
	used, avail, ok := r.fs.QuotaUsage()
	writeJSON(w, http.StatusOK, quotaJSON(used, avail, ok))
}

// handleURL 生成外链:mode=public 走 CDN 域名,mode=presign 走预签名。
// 两种能力都由调用方注入(cmd 侧持有 S3 客户端与配置),本包不认识 S3。
//
// 分片存储的文件在这里就拦下:预签名 URL 会把 manifest 当文件发出去,
// 与其给一个坏链接,不如让前端明确提示「请通过本页面下载」。
func (r *request) handleURL(w http.ResponseWriter) {
	q := r.raw.URL.Query()
	logical, err := queryPath(q, "path")
	if err != nil {
		fail(w, err)
		return
	}
	fi, err := r.fs.Stat(r.raw.Context(), logical)
	if err != nil {
		fail(w, err)
		return
	}
	if fi.IsDir {
		writeJSON(w, http.StatusBadRequest, errorBody("invalid", "path is a directory"))
		return
	}
	if fi.Chunked {
		writeJSON(w, http.StatusNotImplemented, errorBody("chunked",
			"this object is stored as chunks (--chunked-upload), so an external URL would return the manifest instead of the file; download it from this page instead"))
		return
	}
	switch q.Get("mode") {
	case "presign", "":
		if r.server.presign == nil {
			fail(w, vfs.ErrNotSupported)
			return
		}
		expires := 15 * time.Minute
		if s := q.Get("expires"); s != "" {
			if secs, perr := strconv.Atoi(s); perr == nil && secs > 0 {
				expires = time.Duration(secs) * time.Second
			}
		}
		url, err := r.server.presign(r.raw.Context(), r.prefix, logical, expires)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"mode": "presign", "url": url, "expires": int(expires.Seconds())})
	case "public":
		if r.server.publicURL == nil {
			fail(w, vfs.ErrNotSupported)
			return
		}
		url, ok := r.server.publicURL(r.prefix, logical)
		if !ok {
			fail(w, vfs.ErrNotSupported)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"mode": "public", "url": url})
	default:
		writeJSON(w, http.StatusBadRequest, errorBody("invalid", "mode must be public or presign"))
	}
}

// handleDownload 提供文件内容:inline(预览)或 attachment(下载)。
// Range/条件请求交给 http.ServeContent,内核的读句柄本身就是 io.Seeker
// (Seek 只重定位偏移,不整文件入内存)。
func (r *request) handleDownload(w http.ResponseWriter) {
	ctx := r.raw.Context()
	logical, err := queryPath(r.raw.URL.Query(), "path")
	if err != nil {
		fail(w, err)
		return
	}
	fi, err := r.fs.Stat(ctx, logical)
	if err != nil {
		fail(w, err)
		return
	}
	if fi.IsDir {
		writeJSON(w, http.StatusBadRequest, errorBody("invalid", "path is a directory"))
		return
	}
	rc, err := r.fs.OpenRead(ctx, logical, fi)
	if err != nil {
		fail(w, err)
		return
	}
	defer rc.Close()

	name := nameOf(fi)
	ct := fi.ContentType
	if ct == "" {
		ct = mimetype.Lookup(name, "")
	}
	if ct != "" {
		w.Header().Set("Content-Type", ct)
	}
	if fi.ETag != "" {
		w.Header().Set("ETag", `"`+fi.ETag+`"`)
	}
	if r.raw.URL.Query().Get("download") == "1" {
		w.Header().Set("Content-Disposition", contentDisposition("attachment", name))
	} else {
		w.Header().Set("Content-Disposition", contentDisposition("inline", name))
	}
	http.ServeContent(w, r.raw, name, fi.ModTime, rc)
}

// handleUpload 接收一次 PUT 上传:直接流式写入内核(内核按配置决定是否
// 分片),提交点在内核与配额装饰器里——本壳不落暂存、不缓存整个请求体。
func (r *request) handleUpload(w http.ResponseWriter) {
	ctx := r.raw.Context()
	logical, err := queryPath(r.raw.URL.Query(), "path")
	if err != nil {
		fail(w, err)
		return
	}
	if logical == "/" || hasTrailingSlash(logical) {
		writeJSON(w, http.StatusBadRequest, errorBody("invalid", "upload target must be a file path"))
		return
	}
	if r.server.maxUploadSize > 0 && r.raw.ContentLength > r.server.maxUploadSize {
		writeJSON(w, http.StatusRequestEntityTooLarge, errorBody("too_large",
			"file is larger than the "+r.server.maxUploadText+" limit"))
		return
	}

	body := io.Reader(r.raw.Body)
	if r.server.maxUploadSize > 0 {
		body = http.MaxBytesReader(w, r.raw.Body, r.server.maxUploadSize)
	}

	ct := r.raw.Header.Get("Content-Type")
	if ct == "" || mimetype.IsGenericBinary(ct) {
		if guess := mimetype.Lookup(logical, r.raw.URL.Query().Get("name")); guess != "" {
			ct = guess
		} else {
			ct = mimetype.OctetStream
		}
	}

	wh, err := r.fs.Create(ctx, logical, vfs.WriteOptions{ContentType: ct, ContentLength: r.raw.ContentLength})
	if err != nil {
		fail(w, err)
		return
	}
	if _, err := io.Copy(wh, body); err != nil {
		_ = wh.Abort()
		_ = wh.Close()
		fail(w, uploadError(err, r.server.maxUploadText))
		return
	}
	fi, err := wh.Commit(ctx)
	if err != nil {
		_ = wh.Close()
		fail(w, err)
		return
	}
	_ = wh.Close()
	r.fs.Invalidate(logical)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "entry": entryJSON(fi)})
}

// uploadError 把「读请求体失败」翻译成有意义的错误:超限是 MaxBytesReader
// 的唯一失败原因,其余原样上抛。
func uploadError(err error, limitText string) error {
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		msg := "file exceeds the upload size limit"
		if limitText != "" {
			msg += " (" + limitText + ")"
		}
		return &limitError{msg}
	}
	return err
}

type limitError struct{ msg string }

func (e *limitError) Error() string        { return e.msg }
func (e *limitError) Is(target error) bool { return target == vfs.ErrTooLarge }

// handleMkdir 新建目录(落一个 0 字节目录标记对象)。
func (r *request) handleMkdir(w http.ResponseWriter) {
	var body struct {
		Path string `json:"path"`
	}
	if err := readJSONBody(r.raw, &body); err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody("invalid", err.Error()))
		return
	}
	logical, err := logicalPath(body.Path)
	if err != nil {
		fail(w, err)
		return
	}
	if logical == "/" {
		writeJSON(w, http.StatusBadRequest, errorBody("invalid", "cannot create the root"))
		return
	}
	if err := r.fs.Mkdir(r.raw.Context(), logical); err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "path": strings.TrimSuffix(logical, "/") + "/"})
}

// handleRename 改名/移动(目录在壳内展开为递归复制 + 删除源)。
func (r *request) handleRename(w http.ResponseWriter) {
	var body struct {
		From string `json:"from"`
		To   string `json:"to"`
	}
	if err := readJSONBody(r.raw, &body); err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody("invalid", err.Error()))
		return
	}
	from, err := logicalPath(body.From)
	if err != nil {
		fail(w, err)
		return
	}
	to, err := logicalPath(body.To)
	if err != nil {
		fail(w, err)
		return
	}
	if from == "/" || to == "/" {
		writeJSON(w, http.StatusBadRequest, errorBody("invalid", "cannot rename the root"))
		return
	}
	if from == to {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "path": to})
		return
	}
	if err := r.fs.Rename(r.raw.Context(), from, to); err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "path": to})
}

// handleDelete 批量删除。目录必须显式带 recursive(前端对目录总是带上),
// 避免误删整棵子树。
func (r *request) handleDelete(w http.ResponseWriter) {
	var body struct {
		Paths     []string `json:"paths"`
		Recursive bool     `json:"recursive"`
	}
	if err := readJSONBody(r.raw, &body); err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody("invalid", err.Error()))
		return
	}
	if len(body.Paths) == 0 {
		writeJSON(w, http.StatusBadRequest, errorBody("invalid", "paths must not be empty"))
		return
	}
	deleted := 0
	for _, raw := range body.Paths {
		logical, err := logicalPath(raw)
		if err != nil {
			fail(w, err)
			return
		}
		if logical == "/" {
			writeJSON(w, http.StatusBadRequest, errorBody("invalid", "cannot delete the root"))
			return
		}
		fi, err := r.fs.Stat(r.raw.Context(), logical)
		if err != nil {
			fail(w, err)
			return
		}
		if fi.IsDir && !body.Recursive {
			writeJSON(w, http.StatusBadRequest, errorBody("invalid", "deleting a directory requires recursive=true"))
			return
		}
		if err := r.fs.Remove(r.raw.Context(), logical, true); err != nil {
			fail(w, err)
			return
		}
		deleted++
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "deleted": deleted})
}

// contentDisposition 生成带 RFC 5987 文件名的 Content-Disposition,
// 非 ASCII 名字(中文文件名很常见)才不会在浏览器里变成乱码。
func contentDisposition(kind, name string) string {
	return mime.FormatMediaType(kind, map[string]string{"filename": name})
}

func hasTrailingSlash(p string) bool {
	return len(p) > 1 && p[len(p)-1] == '/'
}

// listingTTLSeconds 报告缓存 TTL(秒),前端据此提示「外部改动的可见延迟」。
func (fs *FileSystem) listingTTLSeconds() int {
	if fs.dirs == nil {
		return 0
	}
	return int(fs.dirs.ttl.Seconds())
}

// baseNameOf 返回路径最后一段(供日志/调试)。
func baseNameOf(logical string) string { return path.Base(strings.TrimSuffix(logical, "/")) }

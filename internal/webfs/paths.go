// Package webfs 是 Web 协议壳:把 vfs.FileSystem 暴露成一组 JSON/HTTP 接口,
// 供内置的浏览器端资源库使用。与 webdavfs / smbfs 平行,同一批协议无关能力
// (前缀隔离、配额、分片存储、删除路径、目录标记)都来自内核,本包不直连 S3。
//
// 与另外两个壳的差异只在「如何把 HTTP 请求翻译成内核调用」:
//   - WebDAV 壳的契约由 x/net/webdav 定义(PROPFIND/PUT/MOVE…);
//   - SMB 壳的契约由 SMB2 库定义;
//   - 本壳的契约是 sail 自己的 JSON API(见 api.go 的路由表),由内置前端消费。
//
// 依赖方向:cmd → webfs → vfs。本包不得 import S3 SDK,也不得绕过 vfs 直连对象存储。
package webfs

import (
	"net/url"
	"path"
	"strings"

	"github.com/BeCrafter/sail/internal/vfs"
)

// logicalPath 把 API 传入的路径(query 里的 path= 或 mkdir/rename 的 body 字段)
// 归一成内核逻辑路径:必须以 "/" 开头、折叠重复斜杠、目录保留结尾 "/",
// 并拒绝任何 ".." 段(路径逃逸)。
//
// 与 webdavfs.davPath 同一套规则 —— 两个壳面对的是同一批路径,语义不该分叉。
// 传入空串表示根。
func logicalPath(raw string) (string, error) {
	if raw == "" {
		return "/", nil
	}
	if !strings.HasPrefix(raw, "/") {
		raw = "/" + raw
	}
	for _, seg := range strings.Split(raw, "/") {
		if seg == ".." {
			return "", vfs.ErrNotExist
		}
	}
	trailing := len(raw) > 1 && strings.HasSuffix(raw, "/")
	clean := path.Clean(raw)
	if clean == "/" {
		return "/", nil
	}
	if trailing {
		clean += "/"
	}
	return clean, nil
}

// splitDir 把逻辑路径拆成「父目录(带结尾 /)+ 末段名」。
// 根没有父目录,返回 ok=false。目录路径的末段名不带结尾斜杠。
func splitDir(logical string) (dir, name string, ok bool) {
	if logical == "/" {
		return "", "", false
	}
	trimmed := strings.TrimSuffix(logical, "/")
	idx := strings.LastIndex(trimmed, "/")
	if idx < 0 {
		return "", "", false
	}
	dir = trimmed[:idx+1]
	if dir == "" {
		dir = "/"
	}
	return dir, trimmed[idx+1:], true
}

// joinLogical 与内核同名逻辑一致:目录带结尾 "/" 时直接拼子名。
func joinLogical(dir, name string) string {
	if strings.HasSuffix(dir, "/") {
		return dir + name
	}
	return dir + "/" + name
}

// queryPath 从请求 query 里取路径参数并归一;缺失或非法都返回错误。
func queryPath(q url.Values, key string) (string, error) {
	return logicalPath(q.Get(key))
}

// isReservedName 判断条目是否是内核保留项(浏览时隐藏)。
// 目前只有 .sail/:开启 --chunked-upload 后分片与 manifest 落在那里,
// 对浏览器用户没有意义。
func isReservedName(name string) bool {
	return strings.TrimSuffix(name, "/") == sailReservedDir
}

// sailReservedDir 是内核保留前缀(与 webdavfs 保持一致的常量值)。
const sailReservedDir = ".sail"

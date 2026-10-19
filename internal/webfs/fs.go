package webfs

import (
	"context"
	"errors"
	"io"
	"log"
	"path"
	"strings"
	"time"

	"github.com/BeCrafter/sail/internal/mimetype"
	"github.com/BeCrafter/sail/internal/vfs"
)

// FileSystem 把 vfs.FileSystem 适配成 Web 壳需要的样子:目录列表缓存、
// Content-Type 兜底、保留前缀过滤、目录改名与建目录这类内核不直接提供、
// 但浏览器端必须有的语义。
//
// 一名用户一个实例(前缀隔离由内核的 s3fs 施加),实例与配额装饰器一一对应。
// 本类型不持有任何 S3 客户端:所有对象操作都经内核。
type FileSystem struct {
	core   vfs.FileSystem
	dirs   *listingCache
	logger *log.Logger
}

// NewFileSystem 包装内核。ttl > 0 时开启服务级目录列表缓存。
func NewFileSystem(core vfs.FileSystem, ttl time.Duration, logger *log.Logger) *FileSystem {
	fs := &FileSystem{core: core, logger: logger}
	if ttl > 0 {
		fs.dirs = newListingCache(ttl, logger)
	}
	return fs
}

// SetLogger 注入日志器(缓存回源失败的告警一并改道)。
func (fs *FileSystem) SetLogger(l *log.Logger) {
	fs.logger = l
	if fs.dirs != nil {
		fs.dirs.logger = l
	}
}

// Stat 取单个条目元信息。
func (fs *FileSystem) Stat(ctx context.Context, logical string) (vfs.FileInfo, error) {
	fi, err := fs.core.Stat(ctx, logical)
	if err != nil {
		return vfs.FileInfo{}, err
	}
	if isReservedName(fi.Name) {
		return vfs.FileInfo{}, notExist(logical)
	}
	return fs.withContentType(fi), nil
}

// ReadDir 列目录。返回值已过滤保留前缀,文件条目已补 Content-Type(列举
// 不带该字段,浏览器要按类型选预览方式)。
func (fs *FileSystem) ReadDir(ctx context.Context, logical string) ([]vfs.FileInfo, error) {
	entries, err := fs.readDir(ctx, logical)
	if err != nil {
		return nil, err
	}
	out := make([]vfs.FileInfo, 0, len(entries))
	for _, e := range entries {
		if isReservedName(e.Name) {
			continue
		}
		out = append(out, fs.withContentType(e))
	}
	return out, nil
}

func (fs *FileSystem) readDir(ctx context.Context, logical string) ([]vfs.FileInfo, error) {
	if fs.dirs == nil {
		return fs.core.ReadDir(ctx, logical)
	}
	if entries, fresh, ok := fs.dirs.get(logical); ok {
		if fresh {
			return entries, nil
		}
		// 过期:先回旧值,后台刷新,避免「浏览→刷新→再进」每次都阻塞在回源上。
		go fs.refresh(logical)
		return entries, nil
	}
	return fs.dirs.load(ctx, logical, func() ([]vfs.FileInfo, error) {
		return fs.core.ReadDir(ctx, logical)
	})
}

// refresh 后台回源刷新一条已过期的列表;失败保留旧值(下次访问再试)。
func (fs *FileSystem) refresh(logical string) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	entries, err := fs.core.ReadDir(ctx, logical)
	if err != nil {
		if fs.logger != nil {
			fs.logger.Printf("webfs: refreshing listing of %s failed, keeping the stale copy: %v", logical, err)
		}
		return
	}
	if fs.dirs != nil {
		fs.dirs.put(logical, entries)
	}
}

// OpenRead 打开读句柄。fi 来自同一次请求的 Stat:内核实现了 InfoOpener 时
// 可省掉一次 HEAD(慢后端上每次多一个 RTT)。
func (fs *FileSystem) OpenRead(ctx context.Context, logical string, fi vfs.FileInfo) (vfs.ReadSeekCloser, error) {
	if opener, ok := fs.core.(vfs.InfoOpener); ok {
		rc, err := opener.OpenReadWithInfo(ctx, logical, fi)
		if err == nil {
			return rc, nil
		}
		if !errors.Is(err, vfs.ErrNotSupported) {
			return nil, err
		}
		// 内核明确说「凭 fi 构造不安全」(如分片存储),退回完整路径。
	}
	return fs.core.OpenRead(ctx, logical)
}

// Create 打开写句柄。调用方负责 Commit 与随后调用 Invalidate。
func (fs *FileSystem) Create(ctx context.Context, logical string, opt vfs.WriteOptions) (vfs.WriteHandle, error) {
	w, err := fs.core.OpenWrite(ctx, logical)
	if err != nil {
		return nil, err
	}
	if wo, ok := w.(vfs.WriteOptioner); ok {
		wo.SetWriteOptions(opt)
	}
	return w, nil
}

// Mkdir 写一个 0 字节、key 以 "/" 结尾的目录标记对象:S3 没有目录,
// 不落标记对象的话浏览器里刚建的文件夹刷新即消失。
func (fs *FileSystem) Mkdir(ctx context.Context, logical string) error {
	logical = strings.TrimSuffix(logical, "/") + "/"
	if logical == "/" {
		return vfs.ErrExist
	}
	if _, err := fs.core.Stat(ctx, logical); err == nil {
		return vfs.ErrExist
	} else if !errors.Is(err, vfs.ErrNotExist) {
		return err
	}
	w, err := fs.core.OpenWrite(ctx, logical)
	if err != nil {
		return err
	}
	if _, err := w.Commit(ctx); err != nil {
		w.Close()
		return err
	}
	_ = w.Close()
	fs.Invalidate(logical)
	return nil
}

// Remove 删除一个条目(recursive=true 时连整棵子树)。
func (fs *FileSystem) Remove(ctx context.Context, logical string, recursive bool) error {
	if err := fs.core.Remove(ctx, logical, recursive); err != nil {
		return err
	}
	fs.Invalidate(logical)
	return nil
}

// Rename 改名/移动。内核的 Rename 只处理单个对象:目录级在这里展开成
// 「递归复制 + 删除源」——浏览器端的改名按钮对目录也必须可用。
func (fs *FileSystem) Rename(ctx context.Context, oldLogical, newLogical string) error {
	if oldLogical == "/" || newLogical == "/" {
		return vfs.ErrNotSupported
	}
	fi, err := fs.Stat(ctx, oldLogical)
	if err != nil {
		return err
	}
	if !fi.IsDir {
		if err := fs.core.Rename(ctx, oldLogical, newLogical); err != nil {
			return err
		}
		fs.Invalidate(oldLogical)
		fs.Invalidate(newLogical)
		return nil
	}
	return fs.renameDir(ctx, oldLogical, newLogical)
}

// renameDir 递归搬一个目录:逐文件复制(流式,不整文件入内存),成功后删源。
// 中途失败时源保持不变,目标可能半成品——这与 S3 上目录改名本就非原子的
// 事实一致;失败信息里带上已搬运数量,便于排查。
func (fs *FileSystem) renameDir(ctx context.Context, oldLogical, newLogical string) error {
	from := strings.TrimSuffix(oldLogical, "/") + "/"
	to := strings.TrimSuffix(newLogical, "/") + "/"
	if err := fs.copyTree(ctx, from, to); err != nil {
		return err
	}
	if err := fs.core.Remove(ctx, from, true); err != nil {
		return err
	}
	fs.Invalidate(from)
	fs.Invalidate(to)
	return nil
}

// copyTree 把一个前缀下的所有对象逐个复制到新前缀。
func (fs *FileSystem) copyTree(ctx context.Context, fromPrefix, toPrefix string) error {
	entries, err := fs.core.ReadDir(ctx, fromPrefix)
	if err != nil {
		return err
	}
	for _, e := range entries {
		if isReservedName(e.Name) {
			continue
		}
		dst := toPrefix + strings.TrimPrefix(e.Path, fromPrefix)
		if e.IsDir {
			if err := fs.copyTree(ctx, strings.TrimSuffix(e.Path, "/")+"/", strings.TrimSuffix(dst, "/")+"/"); err != nil {
				return err
			}
			continue
		}
		if err := fs.copyObject(ctx, e, dst); err != nil {
			return err
		}
	}
	return nil
}

func (fs *FileSystem) copyObject(ctx context.Context, e vfs.FileInfo, dst string) error {
	rc, err := fs.OpenRead(ctx, e.Path, e)
	if err != nil {
		return err
	}
	defer rc.Close()
	w, err := fs.Create(ctx, dst, vfs.WriteOptions{ContentType: e.ContentType, ContentLength: e.Size})
	if err != nil {
		return err
	}
	if _, err := io.Copy(w, rc); err != nil {
		w.Close()
		return err
	}
	if _, err := w.Commit(ctx); err != nil {
		w.Close()
		return err
	}
	return w.Close()
}

// QuotaUsage 取配额口径的只读快照(内核/配额装饰器可选实现)。
func (fs *FileSystem) QuotaUsage() (used, avail int64, ok bool) {
	if r, isReporter := fs.core.(quotaReporter); isReporter {
		return r.QuotaUsage()
	}
	return 0, 0, false
}

// Invalidate 使写入影响到的目录列表缓存失效:目标路径的整棵子树,加上父目录
// 与祖父目录。父目录的条目集合必然变了(新增/删除/改名都会反映在那里);祖父
// 目录只在父目录整体出现/消失时才变——删掉某个目录下最后一个对象即是如此,
// 只失效父目录会让祖父一级陈旧到 TTL 结束。只清这两级而不是一路到根:根键的
// 前缀匹配会清空整张表,那等于每次写入都丢掉所有子目录的缓存。
func (fs *FileSystem) Invalidate(logical string) {
	if fs.dirs == nil {
		return
	}
	fs.dirs.invalidate(logical)
	dir, _, ok := splitDir(logical)
	if !ok {
		return
	}
	fs.dirs.invalidateExact(dir)
	if grand, _, ok := splitDir(dir); ok {
		fs.dirs.invalidateExact(grand)
	}
}

// Prewarm 把一批目录先列一遍写进缓存;失败只告警。
func (fs *FileSystem) Prewarm(ctx context.Context, dirs []string) {
	if fs.dirs == nil || len(dirs) == 0 {
		return
	}
	fs.dirs.warm(ctx, dirs, func(c context.Context, logical string) ([]vfs.FileInfo, error) {
		return fs.core.ReadDir(c, logical)
	})
}

// withContentType 给列举得到的文件条目补 Content-Type:ListObjectsV2 不返回
// 该字段,浏览器要靠它决定「图片还是视频还是下载」。对象里已记录的类型优先。
func (fs *FileSystem) withContentType(fi vfs.FileInfo) vfs.FileInfo {
	if fi.IsDir || fi.ContentType != "" {
		return fi
	}
	ct := mimetype.Lookup(path.Base(fi.Name), "")
	if ct == "" {
		ct = mimetype.OctetStream
	}
	fi.ContentType = ct
	return fi
}

// quotaReporter 由内核可选实现(quotafs 满足),提供只读配额快照。
type quotaReporter interface {
	QuotaUsage() (used, avail int64, ok bool)
}

func notExist(logical string) error {
	return &notExistError{path: logical}
}

type notExistError struct{ path string }

func (e *notExistError) Error() string { return "webfs: " + e.path + ": not exist" }
func (e *notExistError) Is(target error) bool {
	return target == vfs.ErrNotExist
}
func (e *notExistError) Unwrap() error { return vfs.ErrNotExist }

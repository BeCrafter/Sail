package webfs

import (
	"context"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/BeCrafter/sail/internal/vfs"
)

// listingCache 是服务级目录列表缓存,与 webdavfs 的同名机制是同一套策略的
// 精简实现:浏览器反复「进目录 → 返回 → 再进」会把同一目录列很多遍,超大
// 目录(十几万条)一次列举可达数十秒,这层缓存把它吸收掉。
//
// 策略与 webdavfs 一致(两壳面对同一批后端,取舍不该分叉):
//  1. 命中且未过期 → 直接返回(亚毫秒);
//  2. 命中但已过期 → 先返回旧值,后台异步刷新(stale-while-revalidate);
//  3. 未命中 → 阻塞取一次,同一路径的并发请求合并成一次(避免翻页被放大)。
//
// 写操作(上传/删除/改名/建目录)立即失效对应目录及其祖先,所以自己的改动
// 不会因缓存而看不见;外部改动的可见延迟最长一个 TTL。
type listingCache struct {
	ttl    time.Duration
	logger *log.Logger

	mu       sync.Mutex
	entries  map[string]*listingEntry
	inflight map[string]*listingCall
}

type listingEntry struct {
	entries []vfs.FileInfo
	at      time.Time
}

type listingCall struct {
	done    chan struct{}
	entries []vfs.FileInfo
	err     error
}

func newListingCache(ttl time.Duration, logger *log.Logger) *listingCache {
	return &listingCache{
		ttl:      ttl,
		logger:   logger,
		entries:  map[string]*listingEntry{},
		inflight: map[string]*listingCall{},
	}
}

// cacheKey 归一缓存键:`/image` 与 `/image/` 是同一条,否则预热的键与请求
// 的键对不上,预热形同虚设。
func cacheKey(logical string) string {
	if logical == "/" {
		return "/"
	}
	return strings.TrimSuffix(logical, "/")
}

// get 返回缓存条目与是否新鲜。ok=false 表示完全没有缓存。
func (c *listingCache) get(logical string) (entries []vfs.FileInfo, fresh, ok bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, hit := c.entries[cacheKey(logical)]
	if !hit {
		return nil, false, false
	}
	return e.entries, time.Since(e.at) < c.ttl, true
}

// load 回源取一次列表并写缓存;同一路径的并发调用合并成一次回源。
func (c *listingCache) load(ctx context.Context, logical string, fetch func() ([]vfs.FileInfo, error)) ([]vfs.FileInfo, error) {
	key := cacheKey(logical)
	c.mu.Lock()
	if call, ok := c.inflight[key]; ok {
		c.mu.Unlock()
		select {
		case <-call.done:
			return call.entries, call.err
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	call := &listingCall{done: make(chan struct{})}
	c.inflight[key] = call
	c.mu.Unlock()

	entries, err := fetch()

	c.mu.Lock()
	call.entries, call.err = entries, err
	delete(c.inflight, key)
	if err == nil {
		c.entries[key] = &listingEntry{entries: entries, at: time.Now()}
	}
	c.mu.Unlock()
	close(call.done)
	return entries, err
}

// put 直接写入一条新鲜缓存(预热用)。
func (c *listingCache) put(logical string, entries []vfs.FileInfo) {
	c.mu.Lock()
	c.entries[cacheKey(logical)] = &listingEntry{entries: entries, at: time.Now()}
	c.mu.Unlock()
}

// invalidate 失效一个路径及其所有子路径的缓存。写入影响的是父目录列表,
// 删除/改名目录还要覆盖整棵子树(缓存以路径为键,子树各层各有一条)。
func (c *listingCache) invalidate(logical string) {
	prefix := cacheKey(logical)
	if prefix != "/" {
		prefix += "/"
	}
	c.mu.Lock()
	for k := range c.entries {
		if k == cacheKey(logical) || strings.HasPrefix(k, prefix) {
			delete(c.entries, k)
		}
	}
	c.mu.Unlock()
}

// invalidateExact 只失效一个路径自身的列表缓存,不触碰其子树。
// 用于「父目录/祖父目录的条目集合变了,但它们的子目录缓存仍然有效」的情形:
// 这里若走 invalidate("/"),前缀匹配会把整张表清空,等于每次写入都丢掉所有缓存。
func (c *listingCache) invalidateExact(logical string) {
	c.mu.Lock()
	delete(c.entries, cacheKey(logical))
	c.mu.Unlock()
}

// warm 预热一批目录:逐条回源写入缓存。失败只告警——预热是优化,不是正确性
// 的一部分(与 webdavfs 的预热取值一致)。
func (c *listingCache) warm(ctx context.Context, dirs []string, fetch func(context.Context, string) ([]vfs.FileInfo, error)) {
	for _, d := range dirs {
		logical, err := logicalPath(d)
		if err != nil {
			continue
		}
		entries, err := fetch(ctx, logical)
		if err != nil {
			if c.logger != nil {
				c.logger.Printf("webfs: prewarm %s failed: %v", logical, err)
			}
			continue
		}
		c.put(logical, entries)
	}
}

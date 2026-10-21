package cmd

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/BeCrafter/sail/internal/config"
	"github.com/BeCrafter/sail/internal/i18n"
	"github.com/BeCrafter/sail/internal/version"
	"github.com/BeCrafter/sail/internal/webfs"
	"github.com/BeCrafter/sail/internal/webui"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/spf13/cobra"
)

var serveWebOpts serveFlags

var serveWebCmd = &cobra.Command{
	Use:   "web",
	Short: "Serve a browser UI for a bucket (built-in media library)",
	Long: `Share a bucket with a browser: open http://host:port/ and you get a media library
(thumbnail grid or list, upload/download, rename/delete, new folder, search, previews for images,
video, audio, PDF, CSV, Markdown, HTML, code, Office documents, 3D models, archives and
PSD/TIFF/HEIC, and a usage bar). The sidebar lists every enabled profile in the config and starts on
default-profile (an explicit --profile wins); each source keeps its own bucket, credentials and
serve layout, and switching is handled by the browser without exposing storage credentials.

The UI is compiled into the binary (no Node, no npm, no static files to deploy) and talks to
the same protocol-independent core the other gateways use, so prefix isolation, quotas, chunked
storage and the delete path are one implementation, not three.

Design boundaries:
  - Anonymous by default: no login is required, so a fresh profile without a serve block works
    out of the box. Pass --require-auth (or set serve.web.require-auth: true) to require HTTP
    Basic; credentials then come from serve.users or serve.user/serve.password, falling back to
    the default sail/sail when neither is configured. Browsers keep Basic credentials for the
    session and there is no logout short of closing the browser, so require auth and put the
    gateway behind TLS (--tls-cert/--tls-key) whenever it is not on a trusted network.
  - If the requested port is already in use, the next free port is tried (up to 20) and the
    startup banner prints the port actually bound.
  - One user = one space: with require-auth and multi-user mode each user sees only their own
    prefix, and the quota reported in the UI is that user's serve.users quota. Anonymous mode
    serves the base prefix.
  - The browser never receives storage credentials: it only talks to this server.
  - Uploads stream straight into the core (no staging copy); with --chunked-upload on, files
    larger than --chunk-size are stored as chunks under the reserved .sail/ prefix, which the UI
    hides and which makes "copy public link" refuse (a presigned URL would return the manifest).
  - Directory listings are cached for --dir-cache-ttl; your own writes invalidate them at once,
    changes made elsewhere become visible within one TTL.
  - Previewers ship in the binary and load on demand: images, video, audio, PDF (PDF.js viewer),
    CSV, Markdown, HTML and code; Office (DOCX/XLSX/XLSM/PPTX), 3D (GLB/GLTF/OBJ/STL), archives
    (ZIP/TAR/TAR.GZ/TGZ/GZ with directory navigation and nested-archive preview), PSD, multi-page
    TIFF and HEIC/HEIF. XLSX formula results are evaluated for display, and formats without a
    preview fall back to download.

Examples:
  sail serve web --profile prod --listen :9090
  sail serve web --profile prod --prefix shared --require-auth \
    --user alice --password '***' --tls-cert c.pem --tls-key k.pem`,
	Args: cobra.NoArgs,
	RunE: runServeWeb,
}

func runServeWeb(cmd *cobra.Command, _ []string) error {
	o := serveWebOpts
	cfg, err := loadWebConfig()
	if err != nil {
		return err
	}
	r, err := webStartupResolved(cfg)
	if err != nil {
		return err
	}
	s, err := mergeServeWeb(o, r, cmd.Flags().Changed)
	if err != nil {
		return err
	}

	// 先绑定再建运行期:与 WebDAV 共用同一套端口探测,横幅与 URL 使用
	// 实际端口(原端口被占用时会向后找一个空闲端口)。即使没有任何可用
	// 数据源也要先监听:设置页本身要能打开,用户才能补全配置。
	ln, listenAddr, err := listenWithProbe(s.listen)
	if err != nil {
		return err
	}
	defer ln.Close()
	if listenAddr != s.listen && !strings.HasSuffix(s.listen, ":0") {
		fmt.Fprint(os.Stderr, i18n.Tf("  listen %s is in use; using %s\n", s.listen, listenAddr))
	}
	s.listen = listenAddr

	logger := log.New(os.Stderr, "", log.LstdFlags)

	// 一个进程展示配置里的全部 profile;浏览器用 Cookie 选择当前数据源,
	// 未选择时落到 default-profile(--profile 显式指定时以它为准)。
	// 缺失凭据/bucket 的 profile 会以 available=false 出现在列表里,
	// 不再阻止进程启动。
	sources := buildWebSources(cfg, o, cmd.Flags().Changed, nil, r, logger)
	multi := newWebMultiHandler(sources, defaultWebSourceName(cfg, r.ProfileName), webui.Handler())
	multi.settings = newSourceSettingsStore(serveWatchTarget())
	// 设置页保存后立即重建全部数据源;配置文件的普通改动也走同一条路径。
	multi.reload = func() ([]*webSource, string, error) {
		cfg2, err := loadWebConfig()
		if err != nil {
			return nil, "", err
		}
		r2, err := webStartupResolved(cfg2)
		if err != nil {
			return nil, "", err
		}
		return buildWebSources(cfg2, o, cmd.Flags().Changed, nil, r2, logger), defaultWebSourceName(cfg2, r2.ProfileName), nil
	}
	httpSrv := newServeHTTPServer(s.listen, multi)

	scheme := "http"
	if s.tlsCert != "" {
		scheme = "https"
	}
	if r.ProfileName == "" {
		fmt.Fprint(os.Stderr, i18n.Tf(
			"sail web started: %s://%s  no data source configured; open the settings page to add one  user=%s max-object-size=%s chunked=%s\n",
			scheme, s.listen, usersBanner(s), humanSize(s.maxUpload), chunkedText(s.chunkedUpload, s.chunkSize)))
	} else {
		fmt.Fprint(os.Stderr, i18n.Tf(
			"sail web started: %s://%s  bucket=%s profile=%s%s user=%s max-object-size=%s chunked=%s\n",
			scheme, s.listen, r.Bucket, r.ProfileName, exposePrefix(s.prefix), usersBanner(s),
			humanSize(s.maxUpload), chunkedText(s.chunkedUpload, s.chunkSize)))
	}
	for _, line := range userSpaceLines(s) {
		fmt.Fprint(os.Stderr, line)
	}
	for _, line := range authNoticeLines(s) {
		fmt.Fprint(os.Stderr, line)
	}
	if urls := serveURLs(scheme, s.listen); len(urls) > 0 {
		fmt.Fprint(os.Stderr, i18n.Tf("  open in a browser: %s\n", strings.Join(urls, "  ")))
		if len(urls) > 1 {
			fmt.Fprint(os.Stderr, i18n.T("  (localhost = this machine; LAN IP = other devices)\n"))
		}
	}

	// 与 WebDAV 一样支持用户表热加载(Web 壳的换表接口与 WebDAV 同构)。
	if serveUserFromFlags(cmd) {
		fmt.Fprint(os.Stderr, i18n.T("  users come from --user/--password flags: config file changes will NOT hot-apply; restart to change users\n"))
	} else if cfgFile := serveWatchTarget(); cfgFile != "" {
		// 首次安装还没有配置目录:设置页保存时会创建它。这里先建目录,
		// 让 fsnotify 能直接监听,而不是启动时先报一条 “cannot watch”。
		_ = os.MkdirAll(filepath.Dir(cfgFile), 0o700)
		watchConfig(context.Background(), cfgFile, 500*time.Millisecond, watchRebuildBackoff, func() {
			if err := multi.reloadSources(); err != nil {
				logger.Printf("config change detected: reloading data sources failed: %v", err)
				return
			}
			logger.Print("config change detected: data sources reloaded")
		}, logger)
	} else {
		fmt.Fprint(os.Stderr, i18n.T("  no config file path resolved: hot reload disabled\n"))
	}

	if s.tlsCert != "" {
		return httpSrv.ServeTLS(ln, s.tlsCert, s.tlsKey)
	}
	return httpSrv.Serve(ln)
}

// loadWebConfig 加载 Web 启动配置。首次安装还没有配置文件时返回空配置,
// 让设置页可以启动;文件存在但格式非法时仍然报错,不吞掉用户写坏的 YAML。
func loadWebConfig() (*config.Config, error) {
	cfg, err := config.LoadOptional(cfgPath)
	if err != nil {
		return nil, err
	}
	if cfg.Profiles == nil {
		cfg.Profiles = map[string]config.Profile{}
	}
	return cfg, nil
}

// webStartupResolved 选择启动时的「当前数据源」。它比 CLI 的 loadResolved
// 宽松:profile 存在但 endpoint / 密钥 / bucket 还没填完时也返回该 profile,
// 由 buildWebSources 标记为不可用;完全没有可用配置时返回一个零值,
// 让 Web 以「无数据源 + 设置页」模式启动。
func webStartupResolved(cfg *config.Config) (*config.Resolved, error) {
	if cfg == nil {
		return &config.Resolved{}, nil
	}
	name := profile
	explicit := name != ""
	if name == "" {
		name = cfg.DefaultProfile
	}
	if name == "" {
		name = firstEnabledProfile(cfg, "")
	}
	if name == "" {
		return &config.Resolved{}, nil
	}
	if _, ok := cfg.Profiles[name]; !ok {
		if explicit {
			// 显式 --profile 指向不存在的 profile:仍展示它并标记不可用,
			// 用户可以在设置页新建同名数据源。
			return &config.Resolved{ProfileName: name}, nil
		}
		name = firstEnabledProfile(cfg, "")
		if name == "" {
			return &config.Resolved{}, nil
		}
	}
	r, err := cfg.ResolveLoose(name)
	if err != nil {
		return nil, err
	}
	if cfgEndpoint != "" {
		r.Endpoint = cfgEndpoint
	}
	if cfgBucket != "" {
		r.Bucket = cfgBucket
	}
	return enabledWebResolved(cfg, r)
}

// enabledWebResolved 处理「默认数据源被禁用」的手工配置:没有显式 --profile
// 时自动落到按名字排序的第一个启用 profile;显式指定禁用 profile 则报错,
// 避免用户以为自己在看某个 bucket,实际却切到了另一个。所有数据源都被
// 禁用时返回零值,Web 仍可启动并通过设置页重新启用。
func enabledWebResolved(cfg *config.Config, r *config.Resolved) (*config.Resolved, error) {
	if cfg == nil || r == nil {
		return r, nil
	}
	p, ok := cfg.Profiles[r.ProfileName]
	if !ok || !p.Disabled {
		return r, nil
	}
	if profile != "" {
		return nil, fmt.Errorf("profile %q is disabled; enable it or choose another profile", r.ProfileName)
	}
	name := firstEnabledProfile(cfg, "")
	if name == "" {
		return &config.Resolved{}, nil
	}
	nr, err := cfg.ResolveLoose(name)
	if err != nil {
		return nil, err
	}
	if cfgEndpoint != "" {
		nr.Endpoint = cfgEndpoint
	}
	if cfgBucket != "" {
		nr.Bucket = cfgBucket
	}
	return nr, nil
}

// mergeServeWeb 在共用参数之外补 Web 专属部分:监听地址、TLS 对与认证开关。
// 认证默认关闭(匿名),这是 Web 资源库与 WebDAV/SMB 的关键差异:浏览器场景
// 零配置可用;要登录必须显式 require-auth,凭据沿用共享的 serve.users /
// serve.user/password,缺省回退 sail/sail。
//
// 监听地址刻意不继承 serve.listen:三种协议各跑各的进程,挤在同一个端口上
// 只会更意外;Web 自己的落点是 serve.web.listen。
func mergeServeWeb(o serveFlags, r *config.Resolved, changed func(string) bool) (serveSettings, error) {
	requireAuth := r.Serve.Web.RequireAuth
	if changed("require-auth") {
		requireAuth = o.requireAuth
	}
	s, err := mergeServeBaseWith(o, r, changed, !requireAuth)
	if err != nil {
		return serveSettings{}, err
	}
	s.anonymous = !requireAuth
	s.listen = pick(changed("listen"), o.listen, r.Serve.Web.Listen)
	s.tlsCert = pick(changed("tls-cert"), o.tlsCert, r.Serve.Web.TLSCert)
	s.tlsKey = pick(changed("tls-key"), o.tlsKey, r.Serve.Web.TLSKey)
	if (s.tlsCert == "") != (s.tlsKey == "") {
		return serveSettings{}, errors.New(i18n.T("--tls-cert and --tls-key must be supplied together"))
	}
	return s, nil
}

// webProtocolShell 是 Web 资源库的协议壳装配方式:壳对象持有目录列表缓存
// 与目录语义(建目录、目录改名、保留前缀过滤),网关负责认证与 JSON 路由。
var webProtocolShell = serveProtocol{
	merge: mergeServeWeb,
	newShell: func(rt *serveRuntime, st *userStack) any {
		return webfs.NewFileSystem(st.qfs, rt.settings.dirCacheTTL, rt.logger)
	},
	newGateway: func(rt *serveRuntime, entries []shellEntry) (http.Handler, serveGateway, error) {
		out, err := webEntries(entries)
		if err != nil {
			return nil, nil, err
		}
		gw, err := webfs.NewServer(webfs.Config{
			Anonymous:         rt.settings.anonymous,
			Users:             out,
			MaxUploadSize:     rt.settings.maxUpload,
			MaxUploadSizeText: humanSize(rt.settings.maxUpload),
			Static:            webui.Handler(),
			Logger:            rt.logger,
			Profile:           rt.profile,
			Bucket:            rt.bucket,
			RootPrefix:        corePrefix(rt.settings.prefix),
			Version:           version.Version,
			Presign:           rt.presign,
			PublicURL:         rt.publicURL,
		})
		if err != nil {
			return nil, nil, err
		}
		return gw, webGateway{gw}, nil
	},
}

func webEntries(entries []shellEntry) ([]webfs.UserEntry, error) {
	out := make([]webfs.UserEntry, 0, len(entries))
	for _, e := range entries {
		fs, ok := e.Shell.(*webfs.FileSystem)
		if !ok {
			return nil, fmt.Errorf("serve: 用户 %q 的协议壳不是 Web 文件系统", e.Name)
		}
		out = append(out, webfs.UserEntry{
			Name:        e.Name,
			Password:    e.Password,
			FileSystem:  fs,
			Prefix:      e.Prefix,
			PrewarmDirs: e.PrewarmDirs,
		})
	}
	return out, nil
}

// webGateway 把 webfs.Server 的换表接口适配成 serveGateway。
type webGateway struct{ srv *webfs.Server }

func (g webGateway) swapUsers(entries []shellEntry) error {
	out, err := webEntries(entries)
	if err != nil {
		return err
	}
	return g.srv.SwapUsers(out)
}

// presignForServe 构造 Web 侧的外链生成器:把「用户生效前缀 + 逻辑路径」
// 拼成物理 key,再交给 S3 预签名(P1 与 CLI 的 presign 是同一条路径)。
func presignForServe(s3c *s3.Client, bucket string) func(context.Context, string, string, time.Duration) (string, error) {
	ps := s3.NewPresignClient(s3c)
	return func(ctx context.Context, prefix, logical string, expires time.Duration) (string, error) {
		key := physicalKey(prefix, logical)
		req, err := ps.PresignGetObject(ctx, &s3.GetObjectInput{
			Bucket: aws.String(bucket),
			Key:    aws.String(key),
		}, s3.WithPresignExpires(expires))
		if err != nil {
			return "", err
		}
		return req.URL, nil
	}
}

// publicURLForServe 构造 CDN 公开链接生成器;未配置 cdn-domain 时返回 nil
// (前端据此隐藏「复制外链」)。
func publicURLForServe(r *config.Resolved) func(string, string) (string, bool) {
	if r.CDNDomain == "" {
		return nil
	}
	domain, bucket, inPath := r.CDNDomain, r.Bucket, r.CDNBucketPath
	return func(prefix, logical string) (string, bool) {
		return buildCDNURL(domain, bucket, physicalKey(prefix, logical), inPath), true
	}
}

// physicalKey 把生效前缀与逻辑路径拼成桶内 key。
func physicalKey(prefix, logical string) string {
	key := strings.TrimSuffix(prefix, "/") + "/" + strings.TrimPrefix(logical, "/")
	return strings.TrimPrefix(key, "/")
}

func init() {
	serveWebCmd.Flags().StringVar(&serveWebOpts.listen, "listen", ":9090", "listen address for the web library (serve.web.listen)")
	serveWebCmd.Flags().StringVar(&serveWebOpts.prefix, "prefix", "", "shared root prefix (mapped to /); out-of-prefix paths are always rejected")
	serveWebCmd.Flags().StringVar(&serveWebOpts.user, "user", "", "HTTP Basic user name (used only with --require-auth; empty = \"sail\" unless serve.user/serve.users is configured)")
	serveWebCmd.Flags().StringVar(&serveWebOpts.password, "password", "", "HTTP Basic password (used only with --require-auth; empty = \"sail\" unless serve.password/serve.users is configured)")
	serveWebCmd.Flags().BoolVar(&serveWebOpts.requireAuth, "require-auth", false, "require HTTP Basic login (default off: anonymous access; credentials come from serve.users or serve.user/serve.password, falling back to sail/sail)")
	serveWebCmd.Flags().StringVar(&serveWebOpts.tlsCert, "tls-cert", "", "TLS certificate; supply together with --tls-key to serve HTTPS (serve.web.tls-cert)")
	serveWebCmd.Flags().StringVar(&serveWebOpts.tlsKey, "tls-key", "", "TLS private key; supply together with --tls-cert (serve.web.tls-key)")
	serveWebCmd.Flags().StringVar(&serveWebOpts.backendMaxSize, "backend-max-object-size", "5TiB", "declared backend per-object limit (S3 has no capability negotiation, it can't be probed)")
	serveWebCmd.Flags().StringVar(&serveWebOpts.maxUploadSize, "max-upload-size", "", "per-file size limit, defaults to --backend-max-object-size (serve.max-upload-size)")
	serveWebCmd.Flags().StringVar(&serveWebOpts.stagingDir, "staging-dir", "", "staging directory used by the core when it has to buffer a write, defaults to the system temp dir")
	serveWebCmd.Flags().BoolVar(&serveWebOpts.chunkedUpload, "chunked-upload", false, "store files larger than --chunk-size as chunks plus a manifest (default off: 1 file = 1 object)")
	serveWebCmd.Flags().StringVar(&serveWebOpts.chunkSize, "chunk-size", "4GiB", "max physical chunk size and the chunked-storage threshold (5MiB ~ 5GiB); requires --chunked-upload")
	serveWebCmd.Flags().StringVar(&serveWebOpts.dirCacheTTL, "dir-cache-ttl", "60s", "how long a directory listing is cached (e.g. 60s, 10m; 0 disables); your own writes invalidate at once, changes made elsewhere take up to one TTL to appear")
	serveWebCmd.Flags().StringSliceVar(&serveWebOpts.prewarm, "prewarm", nil, "directories to keep hot in the background (comma-separated logical paths, e.g. /yiche,/modelImage); each is listed once at startup so the first visit does not pay the full listing cost")

	serveCmd.AddCommand(serveWebCmd)
}

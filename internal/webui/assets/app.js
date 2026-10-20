// Sail Media —— sail serve web 的内置资源库前端。
//
// 只与 /api/* 的 JSON 接口对话:不直连 S3、不依赖 Node、也不需要任何构建步骤。
// 出问题时的排查顺序:浏览器网络面板看 /api/* → sail 服务端访问日志
// (METHOD path status elapsed user=…) → 后端网关日志。
(() => {
  "use strict";

  const { createApp, ref, reactive, computed, watch, onMounted, nextTick } = Vue;

  // ---------------- 文案(中英) ----------------
  const I18N = {
    "zh-CN": {
      appTitle: "Sail 资源库",
      appSub: "S3 多媒体资源库",
      source: "数据源", menu: "侧栏",
      profile: "Profile", bucket: "Bucket", user: "用户", prefix: "空间前缀", anonymous: "匿名",
      used: "已用", unlimited: "不限量", quotaNote: "配额由 serve.users 的 quota 字段决定",
      maxUpload: "单文件上限", cacheNote: "目录列表缓存 {ttl}s:自己写入立即生效,别处的改动最长 {ttl}s 后可见",
      capPublic: "已启用 CDN 公开链接", capPresign: "已启用预签名链接", capNone: "未配置 CDN / 预签名,无法生成外链",
      size: "大小", modified: "修改时间", clearSearch: "清空搜索", details: "详情", themeToLight: "切换到浅色", themeToDark: "切换到深色",
      up: "返回上一级", home: "根目录", items: "个对象", search: "搜索文件名…", newFolder: "新建", upload: "上传",
      refresh: "刷新", grid: "网格", list: "列表", loading: "加载中…", loadFailed: "加载失败",
      retry: "重试", empty: "此目录为空", emptySub: "还没有任何文件或文件夹",
      noMatch: "没有匹配的项目", noMatchSub: "换个关键词,或清空搜索看全部",
      dragHint: "松开即可上传到当前目录", uploadTitle: "上传", downloading: "开始下载", 
      open: "打开", preview: "预览", download: "下载", rename: "重命名", del: "删除", copyLink: "复制链接",
      newFolderName: "文件夹名称", renameTo: "重命名为", confirmDel: "确定删除", confirmDelDir: "确定删除该目录及其全部内容",
      cancel: "取消", confirm: "确定", save: "保存",
      deleted: "已删除", renamed: "已重命名", created: "已创建", copied: "链接已复制", 
      uploadFailed: "上传失败", uploading: "上传中", uploaded: "上传完成", 
      close: "关闭", prev: "上一个", next: "下一个", zoomIn: "放大", zoomOut: "缩小", reset: "重置",
      noPreview: "该文件暂时无法预览", unsupportedPreview: "此格式的预览将在后续版本提供,可先下载查看",
      binary: "二进制文件", tooBigToPreview: "文件较大,已跳过文本预览,请下载查看",
      textTruncated: "(仅显示前 4 MB)", pdfHint: "PDF 由浏览器原生阅读器打开",
      copyFailed: "复制失败", needAuth: "登录已失效,请刷新页面重新输入账号",
      NotFound: "对象不存在", exists: "同名对象或目录已存在", too_large: "文件超过服务端上限",
      quota_exceeded: "超出空间配额", insufficient_storage: "存储空间不足", unsupported: "该能力未启用",
      invalid: "请求参数不合法", internal: "服务端内部错误", unauthorized: "需要登录",
      chunked: "该文件以分片方式存储,外链会返回 manifest,请直接在本页下载",
      publicLink: "公开链接", presignLink: "预签名链接", linkUnavailable: "未配置 CDN / 预签名能力",
      connectionOk: "已连接", connectionLost: "连接异常", sortName: "名称", sortSize: "大小", sortTime: "时间",
      path: "路径", itemsCount: "共 {n} 项", selectHint: "右键或点 ⋯ 打开操作菜单",
      markdown: "Markdown", csv: "表格", table: "表格", code: "代码", htmlPreview: "网页预览",
      folder: "文件夹", file: "文件", settings: "显示设置", language: "English",
      dropDisabled: "上传中,请稍候", archiveSoon: "压缩包预览将在后续版本提供",
    },
    en: {
      appTitle: "Sail Media",
      appSub: "S3 media library",
      source: "Source", menu: "Sidebar",
      profile: "Profile", bucket: "Bucket", user: "User", prefix: "Prefix", anonymous: "Anonymous",
      used: "Used", unlimited: "Unlimited", quotaNote: "Quota comes from the serve.users quota field",
      maxUpload: "Max file size", cacheNote: "Listings are cached for {ttl}s: your own writes apply at once, changes elsewhere take up to {ttl}s",
      capPublic: "CDN public links enabled", capPresign: "Presigned links enabled", capNone: "No CDN / presign configured, external links unavailable",
      size: "Size", modified: "Modified", clearSearch: "Clear search", details: "Details", themeToLight: "Switch to light", themeToDark: "Switch to dark",
      up: "Go up one level", home: "Root", items: "objects", search: "Search file names…", newFolder: "New", upload: "Upload",
      refresh: "Refresh", grid: "Grid", list: "List", loading: "Loading…", loadFailed: "Load failed",
      retry: "Retry", empty: "This folder is empty", emptySub: "There are no files or folders yet",
      noMatch: "No matching items", noMatchSub: "Try another keyword, or clear the search",
      dragHint: "Release to upload into this folder", uploadTitle: "Upload", downloading: "Downloading",
      open: "Open", preview: "Preview", download: "Download", rename: "Rename", del: "Delete", copyLink: "Copy link",
      newFolderName: "Folder name", renameTo: "Rename to", confirmDel: "Delete", confirmDelDir: "Delete this folder and everything in it",
      cancel: "Cancel", confirm: "Confirm", save: "Save",
      deleted: "Deleted", renamed: "Renamed", created: "Created", copied: "Link copied",
      uploadFailed: "Upload failed", uploading: "Uploading", uploaded: "Uploaded",
      close: "Close", prev: "Previous", next: "Next", zoomIn: "Zoom in", zoomOut: "Zoom out", reset: "Reset",
      noPreview: "This file cannot be previewed", unsupportedPreview: "Preview for this format is coming in a later release; download it for now",
      binary: "Binary file", tooBigToPreview: "File is large, skipped the text preview; download it instead",
      textTruncated: "(showing the first 4 MB)", pdfHint: "PDF is rendered by the browser's built-in viewer",
      copyFailed: "Copy failed", needAuth: "Session expired — reload the page and sign in again",
      NotFound: "Not found", exists: "A file or folder with that name already exists", too_large: "File exceeds the server limit",
      quota_exceeded: "Quota exceeded", insufficient_storage: "Not enough storage", unsupported: "Not enabled",
      invalid: "Invalid request", internal: "Server error", unauthorized: "Sign-in required",
      chunked: "This object is stored as chunks, so an external URL would return the manifest; download it here instead",
      publicLink: "Public link", presignLink: "Presigned link", linkUnavailable: "CDN / presign not configured",
      connectionOk: "Connected", connectionLost: "Connection problem", sortName: "Name", sortSize: "Size", sortTime: "Time",
      path: "Path", itemsCount: "{n} items", selectHint: "Right-click or press ⋯ for actions",
      markdown: "Markdown", csv: "Spreadsheet", table: "Table", code: "Code", htmlPreview: "HTML preview",
      folder: "Folder", file: "File", settings: "Settings", language: "中文",
      dropDisabled: "Upload in progress, please wait", archiveSoon: "Archive preview is coming in a later release",
    },
  };

  // ---------------- 图标(线性 SVG,与界面风格一致) ----------------
  const ICONS = {
    folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
    file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>',
    image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="m21 15-4.5-4.5L7 20"/></svg>',
    video: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3z"/></svg>',
    audio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V6l10-2v12"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/></svg>',
    code: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m8 7-5 5 5 5M16 7l5 5-5 5"/></svg>',
    pdf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M8 13h8M8 17h5"/></svg>',
    archive: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/><path d="M2 3h20v4H2z"/><path d="M10 12h4"/></svg>',
    model: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 9 5v8l-9 5-9-5V8z"/><path d="m3 8 9 5 9-5M12 13v8"/></svg>',
    office: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h6"/></svg>',
    grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
    list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M9 6h12M9 12h12M9 18h12"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M20 11a8 8 0 1 0-2.3 6.7"/><path d="M20 5v6h-6"/></svg>',
    up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m3 10 9-7 9 7v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 21V12h6v9"/></svg>',
    chevronLeft: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>',
    chevronRight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 20h16"/></svg>',
    link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/><path d="M10 11v5M14 11v5"/></svg>',
    more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>',
    eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    zoomIn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M11 8v6M8 11h6M20 20l-3.5-3.5"/></svg>',
    zoomOut: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M8 11h6M20 20l-3.5-3.5"/></svg>',
    reset: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 4v6h6"/><path d="M4.5 13a8 8 0 1 0 1.8-6.4L4 10"/></svg>',
    folderOpen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H6.5L3 19z"/><path d="M3 19h15l3-9H6.5z"/></svg>',
    menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
    sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4"/></svg>',
    moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/></svg>',
    warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4.5 21 19.5H3z"/><path d="M12 10v4M12 16.6v.4"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8.2v.4"/></svg>',
    uploadBig: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17V5M7 10l5-5 5 5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>',
  };

  // ---------------- 类型判定 ----------------
  const EXT_KIND = {
    png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", svg: "image",
    bmp: "image", ico: "image", avif: "image", apng: "image",
    mp4: "video", webm: "video", mov: "video", mkv: "video", avi: "video", m4v: "video", ogv: "video",
    mp3: "audio", wav: "audio", flac: "audio", ogg: "audio", m4a: "audio", aac: "audio", opus: "audio",
    pdf: "pdf",
    md: "md", markdown: "md",
    csv: "csv", tsv: "csv",
    html: "html", htm: "html",
    docx: "office", doc: "office", xlsx: "office", xls: "office", pptx: "office", ppt: "office",
    zip: "archive", tar: "archive", gz: "archive", tgz: "archive", bz2: "archive", xz: "archive", "7z": "archive",
    glb: "model", gltf: "model", obj: "model", stl: "model",
    psd: "psd", psb: "psd", tif: "convert", tiff: "convert", heic: "convert", heif: "convert",
    json: "code", jsonc: "code", yaml: "code", yml: "code", xml: "code", toml: "code", ini: "code",
    js: "code", mjs: "code", cjs: "code", ts: "code", tsx: "code", jsx: "code", vue: "code", svelte: "code",
    go: "code", py: "code", rb: "code", rs: "code", java: "code", kt: "code", swift: "code", php: "code",
    c: "code", h: "code", cpp: "code", hpp: "code", cs: "code", sh: "code", bash: "code", zsh: "code",
    css: "code", scss: "code", less: "code", sql: "code", lua: "code", r: "code", pl: "code", scala: "code",
    txt: "text", log: "text", text: "text", ini2: "text", env: "text",
  };

  const HLJS_LANG = {
    js: "javascript", mjs: "javascript", cjs: "javascript", ts: "typescript", tsx: "typescript", jsx: "javascript",
    go: "go", py: "python", rb: "ruby", rs: "rust", java: "java", kt: "kotlin", swift: "swift", php: "php",
    c: "c", h: "c", cpp: "cpp", hpp: "cpp", cs: "csharp", sh: "bash", bash: "bash", zsh: "bash",
    css: "css", scss: "scss", less: "less", sql: "sql", json: "json", yaml: "yaml", yml: "yaml",
    xml: "xml", html: "xml", toml: "ini", ini: "ini", md: "markdown", markdown: "markdown", lua: "lua",
  };

  function extOf(name) {
    const n = String(name || "").toLowerCase();
    const i = n.lastIndexOf(".");
    return i < 0 ? "" : n.slice(i + 1);
  }

  // kindOf 决定用哪种预览方式;null 表示当作不可预览的文件(给出下载入口)。
  function kindOf(entry) {
    if (!entry || entry.dir) return "dir";
    const ext = extOf(entry.name);
    if (EXT_KIND[ext]) return EXT_KIND[ext];
    const ct = String(entry.contentType || "");
    if (ct.startsWith("image/")) return "image";
    if (ct.startsWith("video/")) return "video";
    if (ct.startsWith("audio/")) return "audio";
    if (ct === "application/pdf") return "pdf";
    if (ct.startsWith("text/")) return "text";
    return null;
  }

  const KIND_ICON = {
    dir: "folder", image: "image", video: "video", audio: "audio", pdf: "pdf", md: "file",
    csv: "office", html: "code", office: "office", archive: "archive", model: "model",
    psd: "image", convert: "image", code: "code", text: "file",
  };

  // 磁贴配色类:KIND_CLASS 按预览类别,EXT_BADGE 是角标用的短名(长扩展名压缩成通用写法)。
  const KIND_CLASS = {
    dir: "t-folder", image: "t-image", video: "t-video", audio: "t-audio", pdf: "t-pdf",
    md: "t-md", csv: "t-csv", html: "t-html", office: "t-doc", archive: "t-archive",
    model: "t-model", psd: "t-psd", convert: "t-psd", code: "t-code", text: "t-file",
  };

  const EXT_BADGE = {
    markdown: "md", jpeg: "jpg", tiff: "tif", psb: "psd", heif: "heic", yaml: "yml",
    htm: "html", apng: "png", jsonc: "json", text: "txt",
  };

  // ---------------- 小工具 ----------------
  function fmtSize(n) {
    n = Number(n || 0);
    if (n < 1024) return n + " B";
    const units = ["KB", "MB", "GB", "TB", "PB"];
    let i = -1;
    do { n /= 1024; i++; } while (n >= 1024 && i < units.length - 1);
    return (n >= 10 ? n.toFixed(0) : n.toFixed(1)) + " " + units[i];
  }

  function fmtTime(ms) {
    // Go 的零值时间会以负毫秒传过来;2001 年以前的时间对对象存储没有意义,按「未知」处理。
    if (!ms || ms < 1e12) return "";
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return "";
    const p = (x) => String(x).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  function encPath(p) { return encodeURIComponent(p); }

  function fileURL(p, download) {
    return "/api/file?path=" + encPath(p) + (download ? "&download=1" : "");
  }

  // joinKey 用于「当前目录 + 新名字」;目录保持结尾斜杠。
  function joinKey(dir, name) {
    return (dir.endsWith("/") ? dir : dir + "/") + name;
  }

  async function request(path, opts) {
    const res = await fetch(path, Object.assign({ credentials: "same-origin" }, opts || {}));
    const ct = res.headers.get("content-type") || "";
    let data = null;
    if (ct.includes("application/json")) data = await res.json().catch(() => null);
    else data = await res.text().catch(() => "");
    if (!res.ok) {
      const detail = data && data.error ? data.error : null;
      const err = new Error((detail && detail.message) || res.statusText || "request failed");
      err.code = detail && detail.code;
      err.status = res.status;
      throw err;
    }
    return data;
  }

  const API = {
    session: () => request("/api/session"),
    list: (p) => request("/api/list?path=" + encPath(p)),
    usage: () => request("/api/usage"),
    mkdir: (p) => request("/api/mkdir", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: p }) }),
    rename: (from, to) => request("/api/rename", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from, to }) }),
    remove: (paths, recursive) => request("/api/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paths, recursive: !!recursive }) }),
    url: (p, mode) => request("/api/url?path=" + encPath(p) + "&mode=" + mode),
  };

  // 解析 CSV/TSV:支持引号包裹、引号转义、字段内换行。
  function parseDelimited(text, delim) {
    const rows = [];
    let row = [], field = "", quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else quoted = false;
        } else field += ch;
        continue;
      }
      if (ch === '"') { quoted = true; continue; }
      if (ch === delim) { row.push(field); field = ""; continue; }
      if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
      if (ch === "\r") continue;
      field += ch;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows.filter((r) => r.length > 1 || (r[0] || "").trim() !== "").slice(0, 5000);
  }

  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // 极简 Markdown 渲染:标题/列表/代码块/引用/链接/强调。
  // 不引入第三方库,也不把原始 HTML 直接塞进页面(先整体转义)。
  function renderMarkdown(src) {
    const lines = escapeHTML(src).split("\n");
    const out = [];
    let inCode = false, inList = false;
    const inline = (s) => s
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    const flushList = () => { if (inList) { out.push("</ul>"); inList = false; } };
    for (const raw of lines) {
      if (raw.startsWith("```")) {
        flushList();
        out.push(inCode ? "</code></pre>" : '<pre class="md-code"><code>');
        inCode = !inCode;
        continue;
      }
      if (inCode) { out.push(raw); continue; }
      const line = raw;
      if (/^\s*$/.test(line)) { flushList(); continue; }
      const h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) { flushList(); const lv = h[1].length; out.push("<h" + lv + ">" + inline(h[2]) + "</h" + lv + ">"); continue; }
      if (/^\s*[-*+]\s+/.test(line)) {
        if (!inList) { out.push("<ul>"); inList = true; }
        out.push("<li>" + inline(line.replace(/^\s*[-*+]\s+/, "")) + "</li>");
        continue;
      }
      if (/^>\s?/.test(line)) { flushList(); out.push("<blockquote>" + inline(line.replace(/^>\s?/, "")) + "</blockquote>"); continue; }
      flushList();
      out.push("<p>" + inline(line) + "</p>");
    }
    flushList();
    if (inCode) out.push("</code></pre>");
    return out.join("\n");
  }

  // ---------------- 主应用 ----------------
  const TEMPLATE = `
<div class="app">
  <div class="body">
    <div class="scrim" v-if="drawer" @click="drawer = false"></div>

    <aside class="sidebar" :class="{ open: drawer }">
      <div class="side-scroll">
        <div class="side-title">
          <img class="logo" src="/logo.svg" alt="" />
          <div class="txt">
            <div class="nm">{{ tt.appTitle }}</div>
            <div class="sub">{{ tt.appSub }}</div>
          </div>
        </div>

        <div class="side-group" v-if="session">
          <div class="side-group-head">{{ tt.source }}</div>
          <div class="profile-item active" :title="bucketLabel" @click="go('/')">
            <i class="dot" :class="connClass"></i>
            <div class="meta">
              <div class="nm">{{ session.profile || 'default' }}</div>
              <div class="bk">{{ bucketLabel }}</div>
            </div>
          </div>
        </div>

        <div class="side-card" v-if="session">
          <div class="kv"><span class="k">{{ tt.user }}</span><span class="v">{{ session.anonymous ? tt.anonymous : session.user }}</span></div>
          <div class="kv" v-if="session.prefix"><span class="k">{{ tt.prefix }}</span><span class="v mono" :title="session.prefix">{{ session.prefix }}/</span></div>
          <div class="kv"><span class="k">{{ tt.maxUpload }}</span><span class="v">{{ session.maxUploadText || '—' }}</span></div>
          <div class="kv" v-if="quota">
            <span class="k">{{ tt.used }}</span>
            <span class="v">{{ quota.limit > 0 ? fmtSize(quota.used) + ' / ' + fmtSize(quota.limit) : fmtSize(quota.used) + ' · ' + tt.unlimited }}</span>
          </div>
          <div class="quota-bar" :class="quotaClass" v-if="quota && quota.limit > 0"><i :style="{ width: usedPct + '%' }"></i></div>
        </div>

        <div class="side-note" v-if="capsText">{{ capsText }}</div>
        <div class="side-note" v-if="session && session.listingCacheTTL">{{ tt.cacheNote.split('{ttl}').join(session.listingCacheTTL) }}</div>

        <div class="side-foot">
          <span class="st" :class="connClass"></span>
          <span>{{ connText }}</span>
          <span class="grow"></span>
          <span>BeCrafter / Sail</span>
        </div>
      </div>
    </aside>

    <div class="main">
      <div class="main-toolbar">
        <button class="tb-ico" :disabled="atRoot" :title="tt.up" @click="goUp" v-html="icons.up"></button>
        <button class="btn ico only-narrow" :title="tt.menu" @click="drawer = !drawer" v-html="icons.menu"></button>

        <div class="crumb" v-if="!crumbCompact">
          <span class="seg root" :title="tt.home" @click="go('/')">
            <span v-html="icons.home"></span><span>{{ rootLabel }}</span>
          </span>
          <template v-for="(c, i) in crumbs" :key="c.path">
            <span class="sep">/</span>
            <span class="seg" :title="c.path" @click="go(c.path)">{{ c.name }}</span>
          </template>
        </div>
        <div class="crumb" v-else>
          <span class="seg root" :title="path" @click="atRoot ? null : goUp()">
            <span v-html="atRoot ? icons.home : icons.folderOpen"></span><span>{{ currentLabel }}</span>
          </span>
        </div>
        <span class="obj-count">{{ tt.itemsCount.replace('{n}', filtered.length) }}</span>

        <label class="search" :class="{ open: searchOpen }">
          <span v-html="icons.search" @click="tiny ? (searchOpen = true, $nextTick(() => searchBox && searchBox.focus())) : null"></span>
          <input ref="searchBox" v-model="search" :placeholder="tt.search" spellcheck="false" autocomplete="off"
                 @keydown.esc="search = ''; searchOpen = false" />
          <button class="clear" v-if="search" @click.prevent="search = ''" v-html="icons.close"></button>
        </label>

        <button class="btn tb-btn" @click="askMkdir"><span v-html="icons.plus"></span>{{ tt.newFolder }}</button>
        <button class="btn primary tb-btn" @click="pickFiles"><span v-html="icons.upload"></span>{{ tt.upload }}</button>
        <div class="seg-toggle">
          <button class="seg-btn" :class="{ on: !listMode }" :title="tt.grid" @click="setListMode(false)" v-html="icons.grid"></button>
          <button class="seg-btn" :class="{ on: listMode }" :title="tt.list" @click="setListMode(true)" v-html="icons.list"></button>
        </div>
        <button class="tb-ico only-wide" :title="tt.refresh" @click="reload" v-html="icons.refresh"></button>
        <button class="tb-ico" :title="themeTitle" @click="toggleTheme" v-html="theme === 'dark' ? icons.sun : icons.moon"></button>
      </div>

      <div class="content" :class="{ 'drag-over': dragOver }"
           @dragover.prevent="onDragOver" @dragenter.prevent="onDragOver"
           @dragleave="onDragLeave" @drop.prevent="onDrop">
        <div v-if="loading" class="empty-box">
          <div class="empty-ico"><div class="spin"></div></div>
          <div class="empty-title">{{ tt.loading }}</div>
        </div>

        <div v-else-if="error" class="empty-box">
          <div class="empty-ico" v-html="icons.warn"></div>
          <div class="empty-title">{{ tt.loadFailed }}</div>
          <div class="empty-sub">{{ error }}</div>
          <button class="btn" @click="reload">{{ tt.retry }}</button>
        </div>

        <div v-else-if="!filtered.length" class="empty-box">
          <div class="empty-ico" v-html="search ? icons.search : icons.folderOpen"></div>
          <div class="empty-title">{{ search ? tt.noMatch : tt.empty }}</div>
          <div class="empty-sub">{{ search ? tt.noMatchSub : tt.emptySub }}</div>
          <button class="btn" v-if="search" @click="search = ''">{{ tt.clearSearch }}</button>
          <button class="btn primary" v-else @click="pickFiles"><span v-html="icons.upload"></span>{{ tt.upload }}</button>
        </div>

        <div v-else-if="!listMode" class="grid">
          <div v-for="it in filtered" :key="it.path" class="card"
               :class="{ sel: selected && selected.path === it.path }" tabindex="0"
               @click="onCardClick(it)" @dblclick="open(it)" @contextmenu.prevent="openMenu($event, it)"
               @pointerdown="onPressStart($event, it)" @pointerup="cancelPress" @pointercancel="cancelPress"
               @pointerleave="cancelPress" @pointermove="cancelPress"
               @keydown.enter.prevent="open(it)" @keydown.space.prevent="select(it)">
            <div class="thumb" :class="thumbClass(it)">
              <span class="thumb-ico" v-if="it.dir" v-html="icons.folder"></span>
              <template v-else>
                <span class="thumb-ico" v-if="!it._thumb || !it._thumbLoaded || it._thumbFailed" v-html="iconFor(it)"></span>
                <img v-if="it._thumb" :src="it._thumb" :alt="it.name" loading="lazy" draggable="false"
                     :class="{ loaded: it._thumbLoaded && !it._thumbFailed }"
                     @load="it._thumbLoaded = true" @error="it._thumbFailed = true" />
              </template>
              <span class="badge" v-if="badgeOf(it)">{{ badgeOf(it) }}</span>
              <div class="card-overlay" @click.stop="onCardClick(it)">
                <button class="card-act-btn" :title="it.dir ? tt.open : tt.preview" @click.stop="open(it)"
                        v-html="it.dir ? icons.folderOpen : icons.eye"></button>
                <button class="card-act-btn" :title="tt.rename" @click.stop="renameEntry(it)" v-html="icons.edit"></button>
                <button class="card-act-btn" v-if="!it.dir" :title="tt.download" @click.stop="downloadEntry(it)" v-html="icons.download"></button>
                <button class="card-act-btn danger" :title="tt.del" @click.stop="deleteEntry(it)" v-html="icons.trash"></button>
                <button class="card-act-btn more" :title="tt.menu" @click.stop="openMenu($event, it)" v-html="icons.more"></button>
              </div>
            </div>
            <div class="card-body">
              <div class="nm" :title="it.name">{{ it.name }}</div>
              <div class="sub">
                <span>{{ it.dir ? tt.folder : fmtSize(it.size) }}</span>
                <span>{{ fmtTime(it.mtime) }}</span>
              </div>
            </div>
          </div>
        </div>

        <div v-else class="listview">
          <div v-for="it in filtered" :key="it.path" class="list-row"
               :class="{ sel: selected && selected.path === it.path }" tabindex="0"
               @click="onCardClick(it)" @dblclick="open(it)" @contextmenu.prevent="openMenu($event, it)"
               @pointerdown="onPressStart($event, it)" @pointerup="cancelPress" @pointercancel="cancelPress"
               @pointerleave="cancelPress" @pointermove="cancelPress"
               @keydown.enter.prevent="open(it)">
            <div class="ic" :class="thumbClass(it)">
              <template v-if="it.dir"><span v-html="icons.folder"></span></template>
              <template v-else>
                <span v-if="!it._thumb || !it._thumbLoaded || it._thumbFailed" v-html="iconFor(it)"></span>
                <img v-if="it._thumb" :src="it._thumb" :alt="it.name" loading="lazy" draggable="false"
                     :class="{ loaded: it._thumbLoaded && !it._thumbFailed }"
                     @load="it._thumbLoaded = true" @error="it._thumbFailed = true" />
              </template>
            </div>
            <div class="nm" :title="it.name">{{ it.name }}</div>
            <div class="sz">{{ it.dir ? '—' : fmtSize(it.size) }}</div>
            <div class="tm">{{ fmtTime(it.mtime) }}</div>
            <div class="row-actions">
              <button class="row-act-btn" :title="it.dir ? tt.open : tt.preview" @click.stop="open(it)"
                      v-html="it.dir ? icons.folderOpen : icons.eye"></button>
              <button class="row-act-btn" :title="tt.rename" @click.stop="renameEntry(it)" v-html="icons.edit"></button>
              <button class="row-act-btn" v-if="!it.dir" :title="tt.download" @click.stop="downloadEntry(it)" v-html="icons.download"></button>
              <button class="row-act-btn danger" :title="tt.del" @click.stop="deleteEntry(it)" v-html="icons.trash"></button>
              <button class="row-act-btn more" :title="tt.menu" @click.stop="openMenu($event, it)" v-html="icons.more"></button>
            </div>
          </div>
        </div>

        <div class="drop-mask" v-if="dragOver">
          <div class="drop-box">
            <span v-html="icons.uploadBig"></span>
            <div class="t">{{ tt.dragHint }}</div>
            <div class="s">{{ path }}</div>
          </div>
        </div>
      </div>

      <div class="statusbar">
        <span class="st" :class="connClass" :title="connText"></span>
        <span class="app-nm">{{ tt.appTitle }}<template v-if="versionLabel"> {{ versionLabel }}</template></span>
        <span class="item src" v-if="session"><span v-html="icons.folder"></span><span class="txt">{{ bucketLabel }}</span></span>
        <span class="grow"></span>
        <span class="item" v-if="quota" :title="tt.quotaNote">
          <span>{{ fmtSize(quota.used) }}<template v-if="quota.limit > 0"> / {{ fmtSize(quota.limit) }}</template></span>
          <span class="quota-bar" :class="quotaClass" v-if="quota.limit > 0"><i :style="{ width: usedPct + '%' }"></i></span>
        </span>
        <button class="sb-link" @click="toggleLang">{{ tt.language }}</button>
      </div>
    </div>

    <aside class="detail" v-if="selected">
      <div class="detail-preview" :class="thumbClass(selected)">
        <span v-if="selected.dir" class="thumb-ico" v-html="icons.folder"></span>
        <template v-else>
          <span class="thumb-ico" v-if="!selected._thumb || !selected._thumbLoaded || selected._thumbFailed" v-html="iconFor(selected)"></span>
          <img v-if="selected._thumb" :src="selected._thumb" :alt="selected.name"
               :class="{ loaded: selected._thumbLoaded && !selected._thumbFailed }"
               @load="selected._thumbLoaded = true" @error="selected._thumbFailed = true" />
        </template>
      </div>
      <div class="detail-head">
        <button class="btn ico detail-close" :title="tt.close" @click="select(null)" v-html="icons.close"></button>
        <div class="nm">{{ selected.name }}</div>
        <div class="kind">{{ kindLabel(selected) }}</div>
      </div>
      <div class="detail-body">
        <div class="kv" v-if="!selected.dir"><span class="k">{{ tt.size }}</span><span class="v">{{ fmtSize(selected.size) }}</span></div>
        <div class="kv"><span class="k">{{ tt.modified }}</span><span class="v">{{ fmtTime(selected.mtime) || '—' }}</span></div>
        <div class="kv"><span class="k">{{ tt.path }}</span><span class="v mono">{{ selected.path }}</span></div>
        <div class="kv" v-if="selected.contentType"><span class="k">Content-Type</span><span class="v mono">{{ selected.contentType }}</span></div>
        <div class="link-row" v-if="!selected.dir && canLink" @click="copyLink(selected)">
          <span v-html="icons.link"></span><span class="txt">{{ tt.publicLink }}</span>
        </div>
        <div class="side-note" v-else-if="!selected.dir">{{ tt.selectHint }}</div>
      </div>
      <div class="detail-actions">
        <button class="btn primary" @click="open(selected)">
          <span v-html="selected.dir ? icons.folderOpen : icons.eye"></span>{{ selected.dir ? tt.open : tt.preview }}
        </button>
        <button class="btn" v-if="!selected.dir" :title="tt.download" @click="downloadEntry(selected)" v-html="icons.download"></button>
        <button class="btn" :title="tt.rename" @click="renameEntry(selected)" v-html="icons.edit"></button>
        <button class="btn danger" :title="tt.del" @click="deleteEntry(selected)" v-html="icons.trash"></button>
      </div>
    </aside>
  </div>

  <!-- 右键/长按菜单 -->
  <div v-if="menu" class="menu" :style="{ left: menu.x + 'px', top: menu.y + 'px' }" @click.stop>
    <button v-if="coarse" @click="runMenu('info')" v-html="icons.info + tt.details"></button>
    <button v-if="menu.entry.dir" @click="runMenu('open')" v-html="icons.folderOpen + tt.open"></button>
    <template v-else>
      <button @click="runMenu('preview')" v-html="icons.eye + tt.preview"></button>
      <button @click="runMenu('download')" v-html="icons.download + tt.download"></button>
      <button v-if="canLink" @click="runMenu('link')" v-html="icons.link + tt.copyLink"></button>
    </template>
    <div class="sep"></div>
    <button @click="runMenu('rename')" v-html="icons.edit + tt.rename"></button>
    <button class="danger" @click="runMenu('delete')" v-html="icons.trash + tt.del"></button>
  </div>

  <!-- 输入/确认弹层 -->
  <div v-if="dialog" class="overlay" @click.self="closeDialog">
    <div class="dialog">
      <h3>{{ dialog.title }}</h3>
      <p v-if="dialog.message">{{ dialog.message }}</p>
      <input v-if="dialog.type === 'prompt'" ref="dlgInput" v-model="dialog.value" @keydown.enter.prevent="confirmDialog" />
      <div class="actions">
        <button class="btn" @click="closeDialog">{{ tt.cancel }}</button>
        <button class="btn primary" @click="confirmDialog">{{ tt.confirm }}</button>
      </div>
    </div>
  </div>

  <!-- 预览 -->
  <div v-if="preview" class="preview">
    <div class="preview-top">
      <div class="nm" :title="preview.entry.name">{{ preview.entry.name }}</div>
      <span class="cnt" v-if="previewIndex >= 0">{{ previewIndex + 1 }} / {{ previewables.length }}</span>
      <button class="pbtn pct" v-if="preview.kind === 'image'" :title="tt.reset" @click="resetZoom">{{ Math.round(pv.zoom * 100) }}%</button>
      <button class="pbtn" v-if="preview.kind === 'image'" :title="tt.zoomOut" @click="zoom(0.8)" v-html="icons.zoomOut"></button>
      <button class="pbtn" v-if="preview.kind === 'image'" :title="tt.zoomIn" @click="zoom(1.25)" v-html="icons.zoomIn"></button>
      <button class="pbtn" v-if="canLink" :title="tt.copyLink" @click="copyLink(preview.entry)" v-html="icons.link"></button>
      <button class="pbtn" :title="tt.download" @click="downloadEntry(preview.entry)"><span v-html="icons.download"></span></button>
      <button class="pbtn" :title="tt.close" @click="closePreview" v-html="icons.close"></button>
    </div>

    <div class="stage" :class="{ light: preview.kind !== 'image' }" @wheel.prevent="onWheel"
         @touchstart.passive="onTouchStart" @touchend="onTouchEnd" @dblclick="preview.kind === 'image' && toggleZoom()"
         @click.self="closePreview">
      <template v-if="preview.kind === 'image'">
        <img :src="preview.url" :alt="preview.entry.name" :class="{ zoomed: pv.zoom > 1 }"
             :style="{ transform: 'translate(' + pv.x + 'px,' + pv.y + 'px) scale(' + pv.zoom + ')' }"
             @pointerdown="onImgDown" @pointermove="onImgMove" @pointerup="onImgUp" @pointercancel="onImgUp"
             draggable="false" @error="preview.error = true" />
        <div class="pv-empty" v-if="preview.error">
          <div class="empty-ico" v-html="icons.warn"></div>
          {{ tt.noPreview }}
        </div>
      </template>
      <video v-else-if="preview.kind === 'video'" :src="preview.url" controls autoplay playsinline></video>
      <audio v-else-if="preview.kind === 'audio'" :src="preview.url" controls autoplay></audio>
      <div class="frame-wrap" v-else-if="preview.kind === 'pdf'"><iframe :src="preview.url" :title="preview.entry.name"></iframe></div>
      <div class="frame-wrap" v-else-if="preview.kind === 'html' && preview.html"><iframe sandbox :srcdoc="preview.html" :title="preview.entry.name"></iframe></div>
      <div class="table-wrap" v-else-if="preview.kind === 'csv' && preview.table">
        <table>
          <thead><tr><th v-for="(c, i) in preview.table[0]" :key="i">{{ c }}</th></tr></thead>
          <tbody><tr v-for="(row, ri) in preview.table.slice(1)" :key="ri"><td v-for="(c, i) in row" :key="i">{{ c }}</td></tr></tbody>
        </table>
      </div>
      <div class="code-box" v-else-if="preview.kind === 'code'"><pre v-html="preview.highlighted"></pre></div>
      <div class="code-box" v-else-if="preview.kind === 'text' || preview.kind === 'md'">
        <div class="line" v-for="(l, i) in preview.lines" :key="i"><span class="ln">{{ i + 1 }}</span>{{ l }}</div>
      </div>
      <div class="md" v-else-if="preview.kind === 'markdown'" v-html="preview.html"></div>
      <div class="pv-empty" v-else>
        <div class="empty-ico" v-html="icons.warn"></div>
        <div>{{ tt.unsupportedPreview }}</div>
        <button class="btn" @click="downloadEntry(preview.entry)"><span v-html="icons.download"></span>{{ tt.download }}</button>
      </div>
      <div class="trunc" v-if="preview.truncated">{{ tt.textTruncated }}</div>
    </div>

    <button class="pv-nav left" v-if="previewIndex > 0" :title="tt.prev" @click="stepPreview(-1)" v-html="icons.chevronLeft"></button>
    <button class="pv-nav right" v-if="previewIndex >= 0 && previewIndex < previewables.length - 1" :title="tt.next" @click="stepPreview(1)" v-html="icons.chevronRight"></button>
  </div>

  <!-- 上传队列 -->
  <div v-if="uploads.length" class="uploads">
    <div class="h"><span class="grow">{{ tt.uploading }} · {{ uploads.filter(u => u.state === 'uploading').length }}</span></div>
    <div class="u" v-for="u in uploads" :key="u.id">
      <div class="row">
        <span class="nm" :title="u.name">{{ u.name }}</span>
        <span class="pct">{{ u.state === 'done' ? '✓' : u.state === 'error' ? '✕' : u.pct + '%' }}</span>
      </div>
      <div class="quota-bar" :class="{ danger: u.state === 'error' }"><i :style="{ width: (u.state === 'done' ? 100 : u.pct) + '%' }"></i></div>
    </div>
  </div>

  <!-- Toast -->
  <div class="toasts">
    <div v-for="t in toasts" :key="t.id" class="toast" :class="t.kind">
      <div class="t">{{ t.title }}</div>
      <div class="s" v-if="t.sub">{{ t.sub }}</div>
    </div>
  </div>

  <input ref="picker" type="file" multiple style="display:none" @change="onPicked" />
</div>`;

  const app = createApp({
    template: TEMPLATE,
    setup() {
      const version = ref("");
      const icons = ICONS;
      const session = ref(null);
      const path = ref("/");
      const entries = ref([]);
      const loading = ref(true);
      const error = ref("");
      const search = ref("");
      const listMode = ref(localStorage.getItem("sail.listMode") === "1");
      const selected = ref(null);
      const dragOver = ref(false);
      const menu = ref(null);
      const dialog = ref(null);
      const picker = ref(null);
      const dlgInput = ref(null);
      const toasts = ref([]);
      const uploads = ref([]);
      const lang = ref(localStorage.getItem("sail.lang") || (String(navigator.language || "").toLowerCase().startsWith("zh") ? "zh-CN" : "en"));
      const preview = ref(null);
      const pv = reactive({ zoom: 1, x: 0, y: 0, dragging: false, sx: 0, sy: 0, ox: 0, oy: 0 });
      const quota = ref(null);
      const drawer = ref(false);
      const searchOpen = ref(false);
      const searchBox = ref(null);
      const winW = ref(window.innerWidth);
      const coarse = ref(!!(window.matchMedia && window.matchMedia("(hover: none)").matches));
      const savedTheme = (() => { try { return localStorage.getItem("sail.theme"); } catch (e) { return null; } })();
      const theme = ref(document.documentElement.dataset.theme || "light");
      const themeExplicit = ref(savedTheme === "light" || savedTheme === "dark");

      const tt = computed(() => I18N[lang.value] || I18N.en);
      const quotaInfo = () => (session.value && session.value.quota) || null;

      // ---- 派生状态 ----
      const atRoot = computed(() => path.value === "/");
      const drawerMode = computed(() => winW.value <= 1024);
      const crumbCompact = computed(() => winW.value <= 640);
      const tiny = computed(() => winW.value <= 560);
      const versionLabel = computed(() => (/\d/.test(version.value) ? "v" + version.value : ""));
      const bucketLabel = computed(() => {
        const s = session.value;
        if (!s) return "—";
        return (s.bucket || "—") + (s.prefix ? "/" + s.prefix : "");
      });
      const rootLabel = computed(() => bucketLabel.value);
      const currentLabel = computed(() => (crumbs.value.length ? crumbs.value[crumbs.value.length - 1].name : rootLabel.value));
      const capsText = computed(() => {
        const c = session.value && session.value.capabilities;
        if (!c) return "";
        const on = [];
        if (c.publicUrl) on.push(tt.value.capPublic);
        if (c.presign) on.push(tt.value.capPresign);
        return on.length ? on.join(" · ") : tt.value.capNone;
      });
      const themeTitle = computed(() => (theme.value === "dark" ? tt.value.themeToLight : tt.value.themeToDark));

      const crumbs = computed(() => {
        const p = path.value.replace(/^\/+|\/+$/g, "");
        if (!p) return [];
        const segs = p.split("/");
        const out = [];
        let acc = "";
        for (const s of segs) {
          acc += "/" + s;
          out.push({ name: s, path: acc + "/" });
        }
        return out;
      });

      const filtered = computed(() => {
        const q = search.value.trim().toLowerCase();
        let list = entries.value;
        if (q) list = list.filter((e) => e.name.toLowerCase().includes(q));
        return list
          .slice()
          .sort((a, b) => {
            if (a.dir !== b.dir) return a.dir ? -1 : 1;
            return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
          });
      });

      const previewables = computed(() => filtered.value.filter((e) => !e.dir));
      const previewIndex = computed(() => {
        if (!preview.value) return -1;
        return previewables.value.findIndex((e) => e.path === preview.value.entry.path);
      });

      const usedPct = computed(() => {
        const q = quota.value;
        if (!q || !q.limit) return 0;
        return Math.min(100, Math.round((q.used / q.limit) * 100));
      });
      const quotaClass = computed(() => (usedPct.value >= 95 ? "danger" : usedPct.value >= 80 ? "warn" : ""));
      const connClass = computed(() => (error.value ? "err" : "ok"));
      const connText = computed(() => {
        if (!session.value) return "";
        return error.value ? tt.value.connectionLost : tt.value.connectionOk;
      });
      const canLink = computed(() => {
        const c = session.value && session.value.capabilities;
        return !!(c && (c.publicUrl || c.presign));
      });

      function iconFor(it) {
        return icons[KIND_ICON[kindOf(it)] || "file"] || icons.file;
      }

      // thumbClass 给出磁贴的配色类(与「Sail 资源库」应用同一套类型配色)。
      function thumbClass(it) {
        if (!it) return "t-file";
        if (it.dir) return "t-folder";
        const ext = extOf(it.name);
        if (ext === "docx" || ext === "doc" || ext === "rtf") return "t-doc";
        if (ext === "xlsx" || ext === "xls") return "t-sheet";
        if (ext === "pptx" || ext === "ppt") return "t-slide";
        const k = kindOf(it);
        if (k === "office") return "t-doc";
        return KIND_CLASS[k] || "t-file";
      }

      // badgeOf 是磁贴右上角的类型角标(大写扩展名);目录与无扩展名不给角标。
      function badgeOf(it) {
        if (!it || it.dir) return "";
        const ext = extOf(it.name);
        if (!ext) return "";
        return (EXT_BADGE[ext] || ext).toUpperCase();
      }

      function kindLabel(it) {
        if (!it) return "";
        if (it.dir) return tt.value.folder;
        const ext = extOf(it.name).toUpperCase();
        return [ext, it.contentType].filter(Boolean).join(" · ") || tt.value.file;
      }

      function pathLabel(it) {
        return it.dir ? tt.value.folder : fmtSize(it.size);
      }

      // ---- 目录导航 ----
      function normalizePath(p) {
        p = String(p || "/").replace(/\\/g, "/");
        if (!p.startsWith("/")) p = "/" + p;
        const trailing = p.endsWith("/");
        const clean = p.replace(/\/{2,}/g, "/");
        if (clean === "/") return "/";
        return trailing ? clean : clean + "/";
      }

      function pathFromHash() {
        const h = location.hash.replace(/^#/, "");
        if (!h) return "/";
        try { return normalizePath(decodeURIComponent(h)); } catch { return "/"; }
      }

      // hash 里保留斜杠(只转义各段),这样地址栏是 #/photos/ 而不是 #%2Fphotos%2F。
      function syncHash(p) {
        const want = "#" + p.split("/").map(encodeURIComponent).join("/");
        if (location.hash !== want) history.replaceState(null, "", want);
      }

      function go(p) {
        const next = normalizePath(p);
        if (next === path.value) return;
        path.value = next;
        search.value = "";
        selected.value = null;
        menu.value = null;
        syncHash(next);
        load();
      }

      function goUp() {
        if (atRoot.value) return;
        const parts = path.value.replace(/\/$/, "").split("/");
        parts.pop();
        go(parts.join("/") + "/" || "/");
      }

      function setListMode(v) {
        listMode.value = v;
        localStorage.setItem("sail.listMode", v ? "1" : "0");
      }

      // ---- 数据加载 ----
      let loadToken = 0;
      async function load() {
        const token = ++loadToken;
        loading.value = true;
        error.value = "";
        try {
          const r = await API.list(path.value);
          if (token !== loadToken) return;
          entries.value = (r.entries || []).map((e) => {
            e._thumb = thumbFor(e);
            e._thumbLoaded = false;
            e._thumbFailed = false;
            return e;
          });
        } catch (e) {
          if (token !== loadToken) return;
          error.value = errText(e);
        } finally {
          if (token === loadToken) loading.value = false;
        }
      }

      function reload() { load(); refreshUsage(); }

      // 缩略图只给图片与可转码格式:视频/音频/文档不做缩略图。
      function thumbFor(e) {
        if (e.dir) return null;
        const k = kindOf(e);
        if (k === "image") return fileURL(e.path);
        return null;
      }

      async function boot() {
        path.value = pathFromHash();
        try {
          session.value = await API.session();
          quota.value = session.value.quota || null;
          version.value = session.value.version || "";
        } catch (e) {
          error.value = errText(e);
          loading.value = false;
          return;
        }
        await load();
      }

      async function refreshUsage() {
        try {
          const q = await API.usage();
          quota.value = q;
          if (session.value) session.value.quota = q;
        } catch { /* 用量刷新失败不打断浏览 */ }
      }

      // ---- 错误文案 ----
      function errText(e) {
        if (!e) return "";
        if (e.status === 401) return tt.value.needAuth;
        const code = e.code || "";
        const local = tt.value[code];
        if (local) return local;
        return e.message || String(e);
      }

      // ---- Toast ----
      let toastId = 0;
      function toast(title, sub, kind) {
        const id = ++toastId;
        toasts.value.push({ id, title, sub: sub || "", kind: kind || "" });
        setTimeout(() => { toasts.value = toasts.value.filter((t) => t.id !== id); }, 4200);
      }

      // ---- 弹层 ----
      function promptDialog(title, value) {
        return new Promise((resolve) => {
          dialog.value = { type: "prompt", title, value: value || "", resolve };
          nextTick(() => { if (dlgInput.value) { dlgInput.value.focus(); dlgInput.value.select(); } });
        });
      }

      function confirmDialogBox(title, message) {
        return new Promise((resolve) => {
          dialog.value = { type: "confirm", title, message: message || "", resolve };
        });
      }

      function closeDialog() {
        if (!dialog.value) return;
        dialog.value.resolve(null);
        dialog.value = null;
      }

      function confirmDialog() {
        if (!dialog.value) return;
        const v = dialog.value.type === "prompt" ? String(dialog.value.value || "").trim() : true;
        dialog.value.resolve(v);
        dialog.value = null;
      }

      // ---- 打开/预览 ----
      function open(it) {
        // 触屏是单击即开,没必要再在预览底下摊开一层详情面板。
        if (!coarse.value) selected.value = it;
        if (it.dir) { go(it.path); return; }
        openPreview(it);
      }

      function select(it) {
        selected.value = it || null;
      }

      // 长按(触屏)等价于右键:弹出操作菜单;鼠标右键走 contextmenu。
      let pressTimer = 0;
      let suppressClick = false;
      function onPressStart(e, it) {
        cancelPress();
        suppressClick = false;
        const x = e.clientX, y = e.clientY;
        pressTimer = setTimeout(() => {
          pressTimer = 0;
          suppressClick = true;
          openMenu({ clientX: x, clientY: y }, it);
        }, 480);
      }
      function cancelPress() {
        if (pressTimer) { clearTimeout(pressTimer); pressTimer = 0; }
      }

      // 卡片单击:触屏(没有 hover)直接预览;鼠标先选中(右侧详情面板),双击才打开
      // —— 与桌面应用的手感一致,悬停时叠出的按钮也各自直连动作。
      function onCardClick(it) {
        if (suppressClick) { suppressClick = false; return; }
        menu.value = null;
        if (coarse.value) { open(it); return; }
        select(it);
      }

      async function openPreview(it) {
        if (!it) return;
        const kind = kindOf(it);
        preview.value = {
          entry: it, kind: kind || "none", url: fileURL(it.path), text: "", lines: [],
          highlighted: "", html: "", table: null, truncated: false, error: false,
        };
        pv.zoom = 1; pv.x = 0; pv.y = 0;
        if (!kind || ["image", "video", "audio", "pdf"].includes(kind) || kind === "office" || kind === "archive" || kind === "model" || kind === "psd" || kind === "convert") return;

        // 文本类预览:先看大小,避免把几百 MB 的日志拉进浏览器。
        const MAX = 4 * 1024 * 1024;
        if (it.size > MAX) {
          preview.value.truncated = true;
        }
        try {
          const res = await fetch(preview.value.url, { credentials: "same-origin" });
          if (!res.ok) throw new Error("HTTP " + res.status);
          const text = await res.text();
          const cut = text.length > MAX ? text.slice(0, MAX) : text;
          preview.value.text = cut;
          preview.value.truncated = preview.value.truncated || text.length > MAX;
          if (kind === "code") {
            preview.value.highlighted = highlightText(cut, it.name);
          } else if (kind === "csv") {
            const delim = extOf(it.name) === "tsv" ? "\t" : ",";
            preview.value.table = parseDelimited(cut, delim);
          } else if (kind === "html") {
            preview.value.html = cut;
          } else if (kind === "md") {
            preview.value.html = renderMarkdown(cut);
            preview.value.kind = "markdown";
          } else {
            preview.value.lines = cut.split("\n");
          }
        } catch (e) {
          preview.value.error = true;
        }
      }

      function highlightText(text, name) {
        const code = escapeHTML(text);
        const ext = extOf(name);
        if (window.hljs) {
          const language = HLJS_LANG[ext];
          try {
            if (language && window.hljs.getLanguage(language)) {
              return window.hljs.highlight(text, { language, ignoreIllegals: true }).value;
            }
            return window.hljs.highlightAuto(text).value;
          } catch { /* 退回未高亮 */ }
        }
        return code;
      }

      function closePreview() {
        preview.value = null;
        pv.zoom = 1; pv.x = 0; pv.y = 0;
      }

      function stepPreview(delta) {
        const list = previewables.value;
        if (!list.length) return;
        let i = previewIndex.value;
        if (i < 0) i = 0;
        let n = i + delta;
        while (n >= 0 && n < list.length && !kindOf(list[n])) n += delta;
        if (n < 0 || n >= list.length) return;
        openPreview(list[n]);
        if (!coarse.value) selected.value = list[n];
      }

      // ---- 图片缩放/平移 ----
      function zoom(factor) {
        pv.zoom = Math.min(8, Math.max(0.2, pv.zoom * factor));
        if (pv.zoom <= 1) { pv.x = 0; pv.y = 0; }
      }
      function resetZoom() { pv.zoom = 1; pv.x = 0; pv.y = 0; }
      function onWheel(e) {
        if (!preview.value || preview.value.kind !== "image") return;
        zoom(e.deltaY < 0 ? 1.12 : 0.9);
      }
      function onImgDown(e) {
        if (pv.zoom <= 1) return;
        pv.dragging = true; pv.sx = e.clientX; pv.sy = e.clientY; pv.ox = pv.x; pv.oy = pv.y;
        try { e.target.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      }
      function onImgMove(e) {
        if (!pv.dragging) return;
        pv.x = pv.ox + (e.clientX - pv.sx);
        pv.y = pv.oy + (e.clientY - pv.sy);
      }
      function onImgUp() { pv.dragging = false; }

      // ---- 动作 ----
      function downloadEntry(it) {
        const a = document.createElement("a");
        a.href = fileURL(it.path, true);
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        a.remove();
      }

      async function askMkdir() {
        const name = await promptDialog(tt.value.newFolderName, "");
        if (!name) return;
        try {
          await API.mkdir(joinKey(path.value, name) + "/");
          toast(tt.value.created, name, "ok");
          reload();
        } catch (e) {
          toast(tt.value.loadFailed, errText(e), "err");
        }
      }

      async function renameEntry(it) {
        const name = await promptDialog(tt.value.renameTo, it.name);
        if (!name || name === it.name) return;
        const to = joinKey(path.value, name) + (it.dir ? "/" : "");
        try {
          await API.rename(it.path, to);
          toast(tt.value.renamed, name, "ok");
          // 详情面板还开着时同步名字/路径,别让用户看到旧值。
          if (selected.value && selected.value.path === it.path) {
            const upd = { ...selected.value, name, path: to };
            upd._thumb = thumbFor(upd);
            upd._thumbLoaded = false;
            upd._thumbFailed = false;
            selected.value = upd;
          }
          reload();
        } catch (e) {
          toast(tt.value.loadFailed, errText(e), "err");
        }
      }

      async function deleteEntry(it) {
        const title = it.dir ? tt.value.confirmDelDir : tt.value.confirmDel;
        const ok = await confirmDialogBox(title, it.name);
        if (!ok) return;
        try {
          await API.remove([it.path], !!it.dir);
          toast(tt.value.deleted, it.name, "ok");
          if (preview.value && preview.value.entry.path === it.path) closePreview();
          if (selected.value && selected.value.path === it.path) selected.value = null;
          reload();
        } catch (e) {
          toast(tt.value.loadFailed, errText(e), "err");
        }
      }

      async function copyLink(it) {
        const caps = (session.value && session.value.capabilities) || {};
        const modes = [];
        if (caps.publicUrl) modes.push("public");
        if (caps.presign) modes.push("presign");
        if (!modes.length) { toast(tt.value.linkUnavailable, "", "warn"); return; }
        let lastErr = null;
        for (const mode of modes) {
          try {
            const r = await API.url(it.path, mode);
            await copyText(r.url);
            toast(tt.value.copied, r.url, "ok");
            return;
          } catch (e) {
            lastErr = e;
          }
        }
        toast(tt.value.copyFailed, errText(lastErr), "err");
      }

      async function copyText(text) {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(text);
          return;
        }
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand("copy"); } finally { ta.remove(); }
      }

      // ---- 右键菜单 ----
      function openMenu(e, it) {
        // 触屏上详情面板会盖住整屏,菜单里单独给「详情」入口,长按本身不选中。
        if (!coarse.value) selected.value = it;
        const x = Math.min(e.clientX, window.innerWidth - 200);
        const y = Math.min(e.clientY, window.innerHeight - 200);
        menu.value = { x, y, entry: it };
      }

      function closeMenu() { menu.value = null; }

      function runMenu(action) {
        if (action === "info") {
          const it = menu.value && menu.value.entry;
          menu.value = null;
          select(it);
          return;
        }
        const it = menu.value && menu.value.entry;
        closeMenu();
        if (!it) return;
        if (action === "open") open(it);
        else if (action === "preview") openPreview(it);
        else if (action === "download") downloadEntry(it);
        else if (action === "link") copyLink(it);
        else if (action === "rename") renameEntry(it);
        else if (action === "delete") deleteEntry(it);
      }

      // ---- 上传 ----
      function pickFiles() { if (picker.value) picker.value.click(); }

      function onPicked(e) {
        const files = Array.from(e.target.files || []);
        e.target.value = "";
        enqueueUploads(files);
      }

      let dragDepth = 0;
      function onDragOver() { dragDepth = Math.max(dragDepth, 1); dragOver.value = true; }
      function onDragLeave() { dragDepth = 0; dragOver.value = false; }
      function onDrop(e) {
        dragDepth = 0;
        dragOver.value = false;
        const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
        if (files.length) enqueueUploads(files);
      }

      let uploadId = 0;
      let active = 0;
      const queue = [];

      function enqueueUploads(files) {
        for (const f of files) {
          const item = reactive({ id: ++uploadId, name: f.name, pct: 0, state: "queued", file: f });
          uploads.value.push(item);
          queue.push(item);
        }
        pump();
      }

      function pump() {
        while (active < 3 && queue.length) {
          const item = queue.shift();
          active++;
          uploadOne(item).finally(() => {
            active--;
            pump();
            setTimeout(() => { uploads.value = uploads.value.filter((u) => u.state !== "done" || Date.now() - u.doneAt < 4000); }, 4000);
          });
        }
      }

      function uploadOne(item) {
        return new Promise((resolve) => {
          item.state = "uploading";
          const dest = joinKey(path.value, item.name);
          const xhr = new XMLHttpRequest();
          xhr.open("PUT", "/api/file?path=" + encPath(dest) + "&name=" + encPath(item.name));
          xhr.setRequestHeader("Content-Type", item.file.type || "application/octet-stream");
          xhr.upload.onprogress = (ev) => {
            if (ev.lengthComputable) item.pct = Math.round((ev.loaded / ev.total) * 100);
          };
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              item.pct = 100;
              item.state = "done";
              item.doneAt = Date.now();
              toast(tt.value.uploaded, item.name, "ok");
              load();
              refreshUsage();
            } else {
              let msg = "HTTP " + xhr.status;
              try {
                const body = JSON.parse(xhr.responseText);
                if (body && body.error) { msg = errText({ code: body.error.code, status: xhr.status, message: body.error.message }); }
              } catch { /* keep default */ }
              item.state = "error";
              item.doneAt = Date.now();
              toast(tt.value.uploadFailed, item.name + ": " + msg, "err");
            }
            resolve();
          };
          xhr.onerror = () => {
            item.state = "error";
            item.doneAt = Date.now();
            toast(tt.value.uploadFailed, item.name, "err");
            resolve();
          };
          xhr.send(item.file);
        });
      }

      // ---- 语言 / 主题 / 视口 ----
      function toggleLang() {
        lang.value = lang.value === "zh-CN" ? "en" : "zh-CN";
        localStorage.setItem("sail.lang", lang.value);
        document.documentElement.lang = lang.value;
      }

      function setTheme(v) {
        theme.value = v;
        document.documentElement.dataset.theme = v;
      }

      // applyTheme 是用户显式选择:记住它,系统主题变化不再跟着走。
      function applyTheme(v) {
        setTheme(v);
        themeExplicit.value = true;
        try { localStorage.setItem("sail.theme", v); } catch (e) { /* 隐私模式忽略 */ }
      }

      function toggleTheme() { applyTheme(theme.value === "dark" ? "light" : "dark"); }

      function onSchemeChange(e) { if (!themeExplicit.value) setTheme(e.matches ? "dark" : "light"); }

      function onResize() {
        winW.value = window.innerWidth;
        if (!drawerMode.value) drawer.value = false;
        if (!tiny.value) searchOpen.value = false;
      }

      // ---- 触屏手势 ----
      let touchStart = null;
      function onTouchStart(e) {
        const t = e.touches && e.touches[0];
        if (!t) return;
        touchStart = { x: t.clientX, y: t.clientY };
      }
      function onTouchEnd(e) {
        const s = touchStart;
        touchStart = null;
        if (!s || !preview.value) return;
        const t = e.changedTouches && e.changedTouches[0];
        if (!t) return;
        const dx = t.clientX - s.x, dy = t.clientY - s.y;
        if (preview.value.kind === "image" && pv.zoom > 1) return; // 放大后留给拖拽平移
        if (Math.abs(dx) > 64 && Math.abs(dx) > Math.abs(dy) * 1.3) stepPreview(dx < 0 ? 1 : -1);
      }

      function toggleZoom() {
        if (pv.zoom > 1) { resetZoom(); return; }
        pv.zoom = 2.5; pv.x = 0; pv.y = 0;
      }

      // ---- 全局键盘/点击 ----
      function onKey(e) {
        if (e.key === "Escape") {
          if (dialog.value) return closeDialog();
          if (menu.value) return closeMenu();
          if (preview.value) return closePreview();
          if (selected.value) return select(null);
          return;
        }
        if (preview.value) {
          if (e.key === "ArrowLeft") { e.preventDefault(); return stepPreview(-1); }
          if (e.key === "ArrowRight") { e.preventDefault(); return stepPreview(1); }
          if (preview.value.kind === "image") {
            if (e.key === "+" || e.key === "=") { e.preventDefault(); return zoom(1.25); }
            if (e.key === "-" || e.key === "_") { e.preventDefault(); return zoom(0.8); }
            if (e.key === "0") { e.preventDefault(); return resetZoom(); }
          }
          return;
        }
        if (e.key === "Enter" && selected.value) { e.preventDefault(); return open(selected.value); }
        if (e.altKey && e.key === "ArrowLeft") { e.preventDefault(); goUp(); }
      }

      function onDocClick() { if (menu.value) closeMenu(); }

      function onHashChange() {
        const p = pathFromHash();
        if (p !== path.value) { path.value = p; load(); }
      }

      // 防止把文件拖到窗口空白处时浏览器直接打开它。
      function preventWindowDrop(e) { e.preventDefault(); }

      onMounted(() => {
        document.documentElement.lang = lang.value;
        window.addEventListener("keydown", onKey);
        window.addEventListener("click", onDocClick);
        window.addEventListener("hashchange", onHashChange);
        window.addEventListener("resize", onResize);
        window.addEventListener("orientationchange", onResize);
        window.addEventListener("dragover", preventWindowDrop);
        window.addEventListener("drop", preventWindowDrop);
        if (window.matchMedia) {
          const mq = window.matchMedia("(prefers-color-scheme: dark)");
          if (mq.addEventListener) mq.addEventListener("change", onSchemeChange);
          const hover = window.matchMedia("(hover: none)");
          if (hover.addEventListener) hover.addEventListener("change", (e) => { coarse.value = e.matches; });
        }
        boot();
      });

      return {
        icons, tt, session, path, entries, loading, error, search, listMode, selected,
        dragOver, menu, dialog, picker, dlgInput, toasts, uploads, preview, quota, pv, version,
        drawer, searchOpen, searchBox, theme, themeTitle,
        atRoot, crumbs, filtered, previewables, previewIndex, usedPct, quotaClass, connClass, connText, canLink,
        drawerMode, crumbCompact, tiny, coarse, versionLabel, bucketLabel, rootLabel, currentLabel, capsText,
        fmtSize, fmtTime, iconFor, thumbClass, badgeOf, kindLabel, pathLabel,
        go, goUp, setListMode, reload, open, openPreview, select, onCardClick, onPressStart, cancelPress,
        closePreview, stepPreview, zoom, resetZoom, toggleZoom, onWheel, onImgDown, onImgMove, onImgUp,
        onTouchStart, onTouchEnd, toggleTheme,
        downloadEntry, askMkdir, renameEntry, deleteEntry, copyLink, openMenu, runMenu,
        pickFiles, onPicked, onDragOver, onDragLeave, onDrop, closeDialog, confirmDialog, toggleLang,
      };
    },
  });

  app.mount("#app");
})();

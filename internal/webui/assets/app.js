// Sail Media —— sail serve web 的内置资源库前端。
//
// 只与 /api/* 的 JSON 接口对话:不直连 S3、不依赖 Node、也不需要任何构建步骤。
// 出问题时的排查顺序:浏览器网络面板看 /api/* → sail 服务端访问日志
// (METHOD path status elapsed user=…) → 后端网关日志。
(() => {
  "use strict";

  // 静态资源版本由 Go 端按嵌入内容计算并替换(见 internal/webui/embed.go)。
  // 首屏引用和下面懒加载的库都带同一个 ?v=,升级二进制后浏览器不会继续
  // 复用上一版的 app.js/app.css/预览库。
  const ASSET_VERSION = "__SAIL_ASSET_V__";
  // 拆分写,避免 Go 端替换真实版本时把“是否未注入”的判断也一起改掉。
  const ASSET_VERSION_PLACEHOLDER = "__SAIL_" + "ASSET_V__";
  function assetURL(p) {
    if (!p || !ASSET_VERSION || ASSET_VERSION === ASSET_VERSION_PLACEHOLDER) return p;
    return p + (p.includes("?") ? "&" : "?") + "v=" + encodeURIComponent(ASSET_VERSION);
  }

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
      close: "关闭", prev: "上一个", next: "下一个", zoomIn: "放大", zoomOut: "缩小", reset: "重置", fitWidth: "适应宽度", findInPDF: "在 PDF 中查找", pdfThumbnails: "缩略图",
      noPreview: "该文件暂时无法预览", unsupportedPreview: "此格式暂不支持在线预览,可先下载查看",
      mediaError: "无法播放此视频或音频,可能是文件损坏,或浏览器不支持该编码",
      previewFailed: "预览加载失败", loadingPreview: "正在加载预览…",
      tooBigOffice: "文件超过 40 MB,无法在线预览,请下载查看",
      tooBigModel: "文件超过 120 MB,无法在线预览,请下载查看",
      tooBigImage: "文件超过 80 MB,无法在线预览,请下载查看",
      imageTooLarge: "图片像素尺寸过大,无法在浏览器中解码,请下载查看",
      tooBigArchive: "压缩包超过 120 MB,无法在线预览,请下载解压",
      tooBigText: "文件超过 32 MB,无法在线预览,请下载查看",
      archiveTooBigUnpacked: "解压后体积过大,无法在浏览器中预览,请下载后用本地工具解压",
      legacyDoc: "旧版 .doc 暂不支持在线预览,请另存为 .docx 后打开",
      legacyPpt: "旧版 .ppt 暂不支持在线预览,请另存为 .pptx 后打开",
      legacyXls: "旧版 .xls 暂不支持在线预览,请另存为 .xlsx 后打开",
      modelHint: "拖动旋转 · 滚轮缩放 · 双击复位视角", modelHintTouch: "单指旋转 · 双指缩放 · 双击复位", resetView: "复位视角",
      xlsxTruncated: "内容过大,仅预览前 {rows} 行 × {cols} 列(原表 {totalRows}×{totalCols})",
      xlsxReady: "就绪", xlsxSum: "求和={sum}", xlsxAvg: "平均={avg}", xlsxCount: "计数={count}", xlsxNumCount: "数值={n}",
      archiveUnsupported: "此压缩格式暂不支持在线预览,可先下载后用本地工具解压",
      archiveEmpty: "压缩包为空", archiveSummary: "{n} 个文件 · 解压后 {size}", archiveTooMany: "条目过多,仅显示前 {n} 个",
      archiveBack: "返回目录", archiveUp: "上一级目录", archiveRoot: "压缩包根目录",
      archiveSelectFile: "选择左侧文件查看内容", archiveSelectFileHint: "文件夹在左侧展开,压缩包可继续进入",
      archiveEntryUnsupported: "此文件格式暂不支持在线预览,可下载后查看",
      archiveEntryFailed: "压缩包内的文件读取失败", archiveLoading: "正在读取压缩包…",
      archiveOpen: "打开", archiveContents: "压缩包内容", archiveNested: "压缩包内的压缩包",
      binary: "二进制文件",
      textTruncated: "(仅显示前 4 MB)", pdfHint: "PDF 由内置 PDF.js 阅读器打开",
      copyFailed: "复制失败", needAuth: "登录已失效,请刷新页面重新输入账号",
      NotFound: "对象不存在", exists: "同名对象或目录已存在", too_large: "文件超过服务端上限",
      quota_exceeded: "超出空间配额", insufficient_storage: "存储空间不足", unsupported: "该能力未启用",
      invalid: "请求参数不合法", internal: "服务端内部错误", unauthorized: "需要登录",
      chunked: "该文件以分片方式存储,外链会返回 manifest,请直接在本页下载",
      publicLink: "公开链接", presignLink: "预签名链接", linkUnavailable: "未配置 CDN / 预签名能力",
      connectionOk: "已连接", connectionLost: "连接异常", sortName: "名称", sortSize: "大小", sortTime: "时间",
      path: "路径", itemsCount: "共 {n} 项", selectHint: "右键或点 ⋯ 打开操作菜单",
      selectHintTouch: "点 ⋯ 打开操作菜单", detailEmpty: "选择一个文件,在这里查看详情",
      markdown: "Markdown", csv: "表格", table: "表格", code: "代码", htmlPreview: "网页预览",
      folder: "文件夹", file: "文件", settings: "显示设置", language: "English",
      dropDisabled: "上传中,请稍候",
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
      close: "Close", prev: "Previous", next: "Next", zoomIn: "Zoom in", zoomOut: "Zoom out", reset: "Reset", fitWidth: "Fit width", findInPDF: "Find in PDF", pdfThumbnails: "Page thumbnails",
      noPreview: "This file cannot be previewed", unsupportedPreview: "Preview is not available for this format; download it instead",
      mediaError: "Cannot play this video or audio. The file may be damaged or use a codec this browser does not support.",
      previewFailed: "Failed to load preview", loadingPreview: "Loading preview…",
      tooBigOffice: "File is larger than 40 MB and cannot be previewed here; download it instead",
      tooBigModel: "File is larger than 120 MB and cannot be previewed here; download it instead",
      tooBigImage: "File is larger than 80 MB and cannot be previewed here; download it instead",
      imageTooLarge: "The image has too many pixels to decode in the browser; download it instead",
      tooBigArchive: "Archive is larger than 120 MB and cannot be previewed here; download and extract it",
      tooBigText: "File is larger than 32 MB and cannot be previewed here; download it instead",
      archiveTooBigUnpacked: "The archive is too large after decompression to preview here; download and extract it locally",
      legacyDoc: "Legacy .doc is not supported. Save it as .docx and reopen.",
      legacyPpt: "Legacy .ppt is not supported. Save it as .pptx and reopen.",
      legacyXls: "Legacy .xls is not supported. Save it as .xlsx and reopen.",
      modelHint: "Drag to rotate · scroll to zoom · double-click to reset", modelHintTouch: "Drag to rotate · pinch to zoom · double-tap to reset", resetView: "Reset view",
      xlsxTruncated: "Large sheet: showing the first {rows} rows × {cols} columns (of {totalRows}×{totalCols}). Download for the full file.",
      xlsxReady: "Ready", xlsxSum: "Sum={sum}", xlsxAvg: "Avg={avg}", xlsxCount: "Count={count}", xlsxNumCount: "Numeric={n}",
      archiveUnsupported: "This archive format cannot be previewed here; download it and extract it locally",
      archiveEmpty: "The archive is empty", archiveSummary: "{n} files · {size} uncompressed", archiveTooMany: "Too many entries; showing the first {n}",
      archiveBack: "Back to files", archiveUp: "Parent folder", archiveRoot: "Archive root",
      archiveSelectFile: "Select a file on the left to preview it", archiveSelectFileHint: "Open folders in the directory tree; nested archives can be entered too",
      archiveEntryUnsupported: "Preview is not available for this format; download the file to open it",
      archiveEntryFailed: "Could not read the file inside this archive", archiveLoading: "Reading archive…",
      archiveOpen: "Open", archiveContents: "Archive contents", archiveNested: "Nested archive",
      binary: "Binary file",
      textTruncated: "(showing the first 4 MB)", pdfHint: "PDF is rendered by the built-in PDF.js viewer",
      copyFailed: "Copy failed", needAuth: "Session expired — reload the page and sign in again",
      NotFound: "Not found", exists: "A file or folder with that name already exists", too_large: "File exceeds the server limit",
      quota_exceeded: "Quota exceeded", insufficient_storage: "Not enough storage", unsupported: "Not enabled",
      invalid: "Invalid request", internal: "Server error", unauthorized: "Sign-in required",
      chunked: "This object is stored as chunks, so an external URL would return the manifest; download it here instead",
      publicLink: "Public link", presignLink: "Presigned link", linkUnavailable: "CDN / presign not configured",
      connectionOk: "Connected", connectionLost: "Connection problem", sortName: "Name", sortSize: "Size", sortTime: "Time",
      path: "Path", itemsCount: "{n} items", selectHint: "Right-click or press ⋯ for actions",
      selectHintTouch: "Tap ⋯ for actions", detailEmpty: "Select a file to see its details here",
      markdown: "Markdown", csv: "Spreadsheet", table: "Table", code: "Code", htmlPreview: "HTML preview",
      folder: "Folder", file: "File", settings: "Settings", language: "中文",
      dropDisabled: "Upload in progress, please wait",
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
    thumbnails: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.2"/><rect x="3" y="14" width="7" height="7" rx="1.2"/><rect x="14" y="3" width="7" height="18" rx="1.2"/></svg>',
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
    docx: "docx", doc: "legacyDoc", xlsx: "xlsx", xlsm: "xlsx", xls: "legacyXls",
    pptx: "pptx", ppt: "legacyPpt",
    zip: "archive", tar: "archive", gz: "archive", tgz: "archive", bz2: "archive", xz: "archive",
    "7z": "archive", rar: "archive", zst: "archive",
    glb: "model", gltf: "model", obj: "model", stl: "model",
    psd: "psd", psb: "psd", tif: "tiff", tiff: "tiff", heic: "heic", heif: "heic",
    json: "code", jsonc: "code", yaml: "code", yml: "code", xml: "code", toml: "code", ini: "code",
    js: "code", mjs: "code", cjs: "code", ts: "code", tsx: "code", jsx: "code", vue: "code", svelte: "code",
    go: "code", py: "code", rb: "code", rs: "code", java: "code", kt: "code", swift: "code", php: "code",
    c: "code", h: "code", cpp: "code", hpp: "code", cs: "code", sh: "code", bash: "code", zsh: "code",
    css: "code", scss: "code", less: "code", sql: "code", lua: "code", r: "code", pl: "code", scala: "code",
    txt: "text", log: "text", text: "text", ini2: "text", env: "text",
    mod: "text", sum: "text", lock: "text", gitignore: "text", gitattributes: "text",
    editorconfig: "text", npmrc: "text", yarnrc: "text", dockerignore: "text", properties: "text",
    conf: "text", config: "text", service: "text", mk: "text", cmake: "text", gradle: "text",
    proto: "code", graphql: "code", gql: "code", nix: "code", tf: "code", hcl: "code",
  };

  // 压缩包里没有对象存储的 Content-Type;这些无扩展名/特殊文件按文本预览。
  const TEXT_BASENAMES = new Set([
    "dockerfile", "makefile", "license", "licence", "readme", "changelog", "authors",
    "notice", "copying", "contributing", "codeowners", "procfile", "vagrantfile",
  ]);

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

  function extIsArchive(name) {
    return EXT_KIND[extOf(name)] === "archive";
  }

  function archiveKindOf(name) {
    const kind = kindOf({ name });
    if (kind) return kind;
    const base = String(name || "").split("/").pop().toLowerCase();
    if (TEXT_BASENAMES.has(base)) return "text";
    return null;
  }

  // Sail 内置的压缩包读取器覆盖 zip / tar / tar.gz / 单文件 gz;
  // bz2、xz、7z、rar、zst 仍显示压缩包图标,但打开时明确提示下载后解压。
  function archiveFlavor(name) {
    const ext = extOf(name);
    if (ext === "zip") return "zip";
    if (ext === "tar") return "tar";
    if (ext === "tgz") return "targz";
    if (ext === "gz") return /\.tar\.gz$/i.test(String(name || "")) ? "targz" : "gz";
    return "";
  }

  const KIND_ICON = {
    dir: "folder", image: "image", video: "video", audio: "audio", pdf: "pdf", md: "file",
    csv: "office", html: "code", docx: "office", xlsx: "office", pptx: "office",
    legacyDoc: "office", legacyXls: "office", legacyPpt: "office", archive: "archive", model: "model",
    psd: "image", tiff: "image", heic: "image", code: "code", text: "file",
  };

  // 磁贴配色类:KIND_CLASS 按预览类别,EXT_BADGE 是角标用的短名(长扩展名压缩成通用写法)。
  const KIND_CLASS = {
    dir: "t-folder", image: "t-image", video: "t-video", audio: "t-audio", pdf: "t-pdf",
    md: "t-md", csv: "t-csv", html: "t-html", docx: "t-doc", xlsx: "t-sheet", pptx: "t-slide",
    legacyDoc: "t-doc", legacyXls: "t-sheet", legacyPpt: "t-slide", archive: "t-archive",
    model: "t-model", psd: "t-psd", tiff: "t-image", heic: "t-image", code: "t-code", text: "t-file",
  };

  const EXT_BADGE = {
    markdown: "md", jpeg: "jpg", tiff: "tif", psb: "psd", heif: "heic", yaml: "yml",
    htm: "html", apng: "png", jsonc: "json", text: "txt",
  };

  // 压缩包内条目没有对象存储的 Content-Type,生成 Blob / PDF 阅读器 URL 时
  // 按扩展名补一个。只覆盖预览会直接交给浏览器的格式。
  const MIME_BY_EXT = {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
    svg: "image/svg+xml", bmp: "image/bmp", ico: "image/x-icon", avif: "image/avif",
    mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", mkv: "video/x-matroska",
    avi: "video/x-msvideo", m4v: "video/mp4", ogv: "video/ogg",
    mp3: "audio/mpeg", wav: "audio/wav", flac: "audio/flac", ogg: "audio/ogg", m4a: "audio/mp4",
    aac: "audio/aac", opus: "audio/ogg",
    pdf: "application/pdf", html: "text/html;charset=utf-8", htm: "text/html;charset=utf-8",
    md: "text/markdown;charset=utf-8", markdown: "text/markdown;charset=utf-8",
    csv: "text/csv;charset=utf-8", tsv: "text/tab-separated-values;charset=utf-8",
    txt: "text/plain;charset=utf-8", log: "text/plain;charset=utf-8", json: "application/json;charset=utf-8",
    css: "text/css;charset=utf-8", js: "text/javascript;charset=utf-8", mjs: "text/javascript;charset=utf-8",
    xml: "application/xml;charset=utf-8", svgz: "image/svg+xml",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    xlsm: "application/vnd.ms-excel.sheet.macroEnabled.12",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    zip: "application/zip", tar: "application/x-tar", gz: "application/gzip", tgz: "application/gzip",
    glb: "model/gltf-binary", gltf: "model/gltf+json", obj: "text/plain;charset=utf-8", stl: "model/stl",
    psd: "image/vnd.adobe.photoshop", tif: "image/tiff", tiff: "image/tiff", heic: "image/heic", heif: "image/heif",
  };

  function mimeOf(name) {
    return MIME_BY_EXT[extOf(name)] || "application/octet-stream";
  }

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

  // HTML 预览走保留目录结构的出口:页面里的 ./app.css、../logo.png 会按
  // 浏览器规则继续请求 /api/raw/...,而不是落到 SPA 的 index.html。
  function rawURL(p) {
    return "/api/raw" + String(p || "/").split("/").map(encodeURIComponent).join("/");
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

  // ---------------- 懒加载的内置预览库 ----------------
  // Office/3D 预览库体积较大(合计约 3.8 MB),只有真正打开对应文件时才加载,
  // 不拖慢资源库首屏。全部随二进制内置,离线/内网同样可用。
  const LIB_REGISTRY = {
    jszip: { src: "/lib/jszip.min.js", global: "JSZip" },
    docx: { src: "/lib/docx-preview.min.js", global: "docx", deps: ["jszip"] },
    exceljs: { src: "/lib/exceljs.min.js", global: "ExcelJS" },
    echarts: { src: "/lib/echarts.min.js", global: "echarts" }, // pptx-preview 的图表节点
    pptx: { src: "/lib/pptx-preview.bundle.js", global: "pptxPreview", deps: ["echarts"] },
    pako: { src: "/lib/pako.min.js", global: "pako" }, // UTIF 解压 TIFF / 解压 tar.gz
    utif: { src: "/lib/UTIF.js", global: "UTIF", deps: ["pako"] },
    agpsd: { src: "/lib/ag-psd.bundle.js", global: "agPsd" },
    heic: { src: "/lib/heic2any.min.js", global: "heic2any" },
  };
  const libCache = new Map();
  function loadLib(name) {
    const spec = LIB_REGISTRY[name];
    if (!spec) return Promise.reject(new Error("unknown library: " + name));
    if (!libCache.has(name)) {
      const p = (async () => {
        if (spec.deps) await Promise.all(spec.deps.map(loadLib));
        if (window[spec.global]) return window[spec.global];
        await new Promise((resolve, reject) => {
          const s = document.createElement("script");
          s.src = assetURL(spec.src);
          s.onload = () => (window[spec.global] ? resolve() : reject(new Error("library failed: " + name)));
          s.onerror = () => { s.remove(); reject(new Error("library failed: " + name)); };
          document.head.appendChild(s);
        });
        return window[spec.global];
      })();
      p.catch(() => libCache.delete(name));
      libCache.set(name, p);
    }
    return libCache.get(name);
  }

  // ES module(three.js 与 xlsx 网格工具)走动态 import;同样做单例缓存和失败重试。
  const moduleCache = new Map();
  function loadModule(path) {
    if (!moduleCache.has(path)) {
      const p = import(assetURL(path));
      p.catch(() => moduleCache.delete(path));
      moduleCache.set(path, p);
    }
    return moduleCache.get(path);
  }

  const PV_OFFICE_MAX = 40 * 1024 * 1024;
  const PV_MODEL_MAX = 120 * 1024 * 1024;
  const PV_IMAGE_MAX = 80 * 1024 * 1024;
  const PV_IMAGE_PIXELS = 80 * 1000 * 1000;
  const PV_ARCHIVE_MAX = 120 * 1024 * 1024;
  const PV_ARCHIVE_UNPACKED_MAX = 512 * 1024 * 1024;
  const PV_TEXT_MAX = 4 * 1024 * 1024;

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
            <div class="thumb" :class="thumbClass(it)" @click="it.dir && open(it)">
              <span class="thumb-ico" v-if="it.dir" v-html="icons.folder"></span>
              <template v-else>
                <span class="thumb-ico" v-if="!it._thumb || !it._thumbLoaded || it._thumbFailed" v-html="iconFor(it)"></span>
                <img v-if="it._thumb" :src="it._thumb" :alt="it.name" loading="lazy" draggable="false"
                     :class="{ loaded: it._thumbLoaded && !it._thumbFailed }"
                     @load="it._thumbLoaded = true" @error="it._thumbFailed = true" />
              </template>
              <span class="badge" v-if="badgeOf(it)">{{ badgeOf(it) }}</span>
              <div class="card-overlay" @click.stop="onCardClick(it)" @dblclick.stop="open(it)">
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

    <div class="detail-scrim" v-if="selected" @click="select(null)"></div>
    <aside class="detail" :class="{ empty: !selected }">
      <template v-if="selected">
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
          <div class="side-note" v-else-if="!selected.dir">{{ coarse ? tt.selectHintTouch : tt.selectHint }}</div>
        </div>
        <div class="detail-actions">
          <button class="btn primary" @click="open(selected)">
            <span v-html="selected.dir ? icons.folderOpen : icons.eye"></span>{{ selected.dir ? tt.open : tt.preview }}
          </button>
          <button class="btn" v-if="!selected.dir" :title="tt.download" @click="downloadEntry(selected)" v-html="icons.download"></button>
          <button class="btn" :title="tt.rename" @click="renameEntry(selected)" v-html="icons.edit"></button>
          <button class="btn danger" :title="tt.del" @click="deleteEntry(selected)" v-html="icons.trash"></button>
        </div>
      </template>
      <div class="detail-empty" v-else>
        <span class="empty-ico" v-html="icons.file"></span>
        <div>{{ tt.detailEmpty }}</div>
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
      <button class="pbtn" v-if="preview.arcEntry" :title="tt.archiveBack" @click="backToArchive" v-html="icons.chevronLeft"></button>
      <div v-if="preview.arc" ref="arcTopCrumb" class="nm arc-top-crumb" :title="arcTopTitle">
        <template v-for="(c, i) in arcCrumbs" :key="i">
          <span v-if="i" class="arc-sep">/</span>
          <button class="arc-crumb-btn" :class="{ cur: i === arcCrumbs.length - 1 }" :title="c.name" @click="arcGoCrumb(i)">{{ c.name }}</button>
        </template>
        <template v-if="preview.arcEntry">
          <span class="arc-sep">/</span>
          <span class="arc-top-file">{{ preview.arcEntry.base }}</span>
        </template>
      </div>
      <div v-else class="nm" :title="preview.entry.name">{{ preview.entry.name }}</div>
      <template v-if="preview.kind === 'pdf'">
        <button class="pbtn" :title="tt.prev" @click="pdfGo(-1)" v-html="icons.chevronLeft"></button>
        <span class="cnt pv-page">{{ preview.page || 1 }} / {{ preview.pages || 1 }}</span>
        <button class="pbtn" :title="tt.next" @click="pdfGo(1)" v-html="icons.chevronRight"></button>
        <button class="pbtn pdf-zoom" :title="tt.zoomOut" @click="pdfZoom(0.9)" v-html="icons.zoomOut"></button>
        <button class="pbtn pct pdf-zoom" :title="tt.fitWidth" @click="pdfFit">{{ pdfScalePct }}</button>
        <button class="pbtn pdf-zoom" :title="tt.zoomIn" @click="pdfZoom(1.25)" v-html="icons.zoomIn"></button>
        <button class="pbtn pdf-thumb" :class="{ on: preview.pdfSidebarOpen }" :title="tt.pdfThumbnails" @click="pdfThumbnails" v-html="icons.thumbnails"></button>
        <button class="pbtn pdf-find" :title="tt.findInPDF" @click="pdfSearch" v-html="icons.search"></button>
      </template>
      <template v-else-if="(preview.kind === 'pptx' && preview.pages) || (preview.decoded && preview.pages > 1)">
        <button class="pbtn" :title="tt.prev" @click="previewGo(-1)" v-html="icons.chevronLeft"></button>
        <span class="cnt pv-page">{{ preview.page + 1 }} / {{ preview.pages }}</span>
        <button class="pbtn" :title="tt.next" @click="previewGo(1)" v-html="icons.chevronRight"></button>
      </template>
      <span class="cnt" v-else-if="previewIndex >= 0 && !preview.arcEntry && !preview.arc">{{ previewIndex + 1 }} / {{ previewables.length }}</span>
      <button class="pbtn pct" v-if="preview.kind === 'image'" :title="tt.reset" @click="resetZoom">{{ Math.round(pv.zoom * 100) }}%</button>
      <button class="pbtn" v-if="preview.kind === 'model'" :title="tt.resetView" @click="resetModelCamera" v-html="icons.reset"></button>
      <button class="pbtn" v-if="preview.kind === 'image'" :title="tt.zoomOut" @click="zoom(0.8)" v-html="icons.zoomOut"></button>
      <button class="pbtn" v-if="preview.kind === 'image'" :title="tt.zoomIn" @click="zoom(1.25)" v-html="icons.zoomIn"></button>
      <button class="pbtn" v-if="canLink && !preview.arcEntry" :title="tt.copyLink" @click="copyLink(preview.entry)" v-html="icons.link"></button>
      <button class="pbtn" :title="tt.download" @click="downloadCurrent"><span v-html="icons.download"></span></button>
      <button class="pbtn" :title="tt.close" @click="closePreview" v-html="icons.close"></button>
    </div>

    <div class="stage" :class="{ light: preview.kind !== 'image' || !!preview.arc, 'arc-split': !!preview.arc, 'arc-previewing': !!(preview.arc && preview.arcEntry) }" @wheel="onWheel"
         @touchstart.passive="onTouchStart" @touchend="onTouchEnd" @dblclick="preview.kind === 'image' && toggleZoom()"
         @click.self="closePreview">
      <aside class="pv-archive-side" v-if="preview.arc">
        <div class="pv-archive-head">
          <button v-if="canArcUp" class="arc-up" :title="tt.archiveUp" @click="arcGoUp" v-html="icons.chevronLeft"></button>
          <span class="ico" v-html="icons.archive"></span>
          <span class="arc-sum">{{ arcSummary }}</span>
        </div>
        <div class="pv-archive-list">
          <div v-for="(e, i) in arcRows" :key="i" class="pv-archive-row" tabindex="0"
               :class="{ dir: e.isDir, nested: e.isArchive, active: !!preview.arcEntry && preview.arcEntry.fullName === e.fullName }"
               :aria-current="preview.arcEntry && preview.arcEntry.fullName === e.fullName ? 'true' : null"
               @click="arcOpen(e)" @keydown.enter.prevent="arcOpen(e)">
            <span class="ico" v-html="e.isDir ? icons.folder : iconFor({ name: e.base, dir: false })"></span>
            <span class="nm" :title="e.fullName">{{ e.base }}</span>
            <span class="sz" v-if="!e.isDir">{{ fmtSize(e.size) }}</span>
            <span class="arc-actions">
              <button v-if="!e.isDir" class="lnk arc-action" :title="tt.download" @click.stop="downloadArchiveEntry(e)" v-html="icons.download"></button>
            </span>
          </div>
          <div v-if="!arcRows.length" class="pv-archive-empty">{{ tt.archiveEmpty }}</div>
        </div>
        <div v-if="arcTruncated" class="pv-archive-note">{{ tt.archiveTooMany.replace('{n}', '2000') }}</div>
      </aside>
      <div class="pv-archive-placeholder" v-if="preview.arc && !preview.arcEntry">
        <div class="empty-ico" v-html="icons.archive"></div>
        <div class="t">{{ tt.archiveSelectFile }}</div>
        <div class="s">{{ tt.archiveSelectFileHint }}</div>
      </div>
      <div class="pv-empty" v-if="preview.message">
        <div class="empty-ico" v-html="icons.warn"></div>
        <div>{{ preview.message }}</div>
        <button class="btn" @click="downloadCurrent"><span v-html="icons.download"></span>{{ tt.download }}</button>
      </div>
      <template v-else-if="preview.kind === 'image'">
        <img v-if="preview.url" :src="preview.url" :alt="preview.entry.name" :class="{ zoomed: pv.zoom > 1 }"
             :style="{ transform: 'translate(' + pv.x + 'px,' + pv.y + 'px) scale(' + pv.zoom + ')' }"
             @pointerdown="onImgDown" @pointermove="onImgMove" @pointerup="onImgUp" @pointercancel="onImgUp"
             draggable="false" @error="preview && (preview.error = true)" />
        <div class="pv-empty" v-if="preview.error">
          <div class="empty-ico" v-html="icons.warn"></div>
          {{ tt.noPreview }}
        </div>
      </template>
      <div class="pv-media" v-else-if="preview.kind === 'video' || preview.kind === 'audio'">
        <video v-if="preview.kind === 'video' && preview.url" :src="preview.url" controls autoplay playsinline
               @canplay="preview && (preview.loading = false, preview.mediaError = false)"
               @error="preview && (preview.loading = false, preview.mediaError = true)"></video>
        <audio v-else-if="preview.url" :src="preview.url" controls autoplay
               @canplay="preview && (preview.loading = false, preview.mediaError = false)"
               @error="preview && (preview.loading = false, preview.mediaError = true)"></audio>
        <div class="pv-empty" v-if="preview.mediaError">
          <div class="empty-ico" v-html="icons.warn"></div>
          <div>{{ tt.mediaError }}</div>
          <button class="btn" @click="downloadCurrent"><span v-html="icons.download"></span>{{ tt.download }}</button>
        </div>
      </div>
      <div class="frame-wrap pdf-frame" v-else-if="preview.kind === 'pdf' && preview.url">
        <iframe ref="pdfFrame" :src="pdfViewerURL(preview.url)" :title="preview.entry.name" @load="onPdfLoad"></iframe>
      </div>
      <div class="frame-wrap html-frame" v-else-if="preview.kind === 'html'">
        <iframe v-if="preview.htmlSrcdoc" :srcdoc="preview.htmlSrcdoc"
                sandbox="allow-scripts allow-forms allow-modals allow-popups allow-downloads"
                :title="preview.entry.name"></iframe>
        <iframe v-else-if="preview.url" :src="preview.url" sandbox="allow-scripts allow-forms allow-modals allow-popups allow-downloads"
                :title="preview.entry.name"></iframe>
      </div>
      <div class="pv-office docx" v-else-if="preview.kind === 'docx'" ref="docxHost"></div>
      <div class="pv-office xlsx" v-else-if="preview.kind === 'xlsx'" ref="xlsxHost"></div>
      <div class="pv-office pptx" v-else-if="preview.kind === 'pptx'" ref="pptxHost"></div>
      <div class="pv-model" v-else-if="preview.kind === 'model'">
        <canvas ref="modelCanvas" class="pv-canvas" :title="coarse ? tt.modelHintTouch : tt.modelHint" @dblclick="resetModelCamera"></canvas>
        <div class="pv-model-hint">{{ coarse ? tt.modelHintTouch : tt.modelHint }}</div>
      </div>
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
      <div class="pv-empty" v-else-if="preview.kind === 'none'">
        <div class="empty-ico" v-html="icons.warn"></div>
        <div>{{ tt.unsupportedPreview }}</div>
        <button class="btn" @click="downloadEntry(preview.entry)"><span v-html="icons.download"></span>{{ tt.download }}</button>
      </div>
      <div class="pv-loading" v-if="preview.loading">
        <span class="spin"></span>
        <span>{{ preview.progressText || tt.loadingPreview }}</span>
      </div>
      <div class="trunc" v-if="preview.truncated">{{ tt.textTruncated }}</div>
    </div>

    <button class="pv-nav left" v-if="!preview.arc && !preview.arcEntry && previewIndex > 0 && preview.kind !== 'pptx' && !(preview.decoded && preview.pages > 1)" :title="tt.prev" @click="stepPreview(-1)" v-html="icons.chevronLeft"></button>
    <button class="pv-nav right" v-if="!preview.arc && !preview.arcEntry && previewIndex >= 0 && previewIndex < previewables.length - 1 && preview.kind !== 'pptx' && !(preview.decoded && preview.pages > 1)" :title="tt.next" @click="stepPreview(1)" v-html="icons.chevronRight"></button>
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
      // Office / 3D 预览的挂载点与运行时资源(同一时间只可能有一个预览打开)。
      const docxHost = ref(null);
      const xlsxHost = ref(null);
      const pptxHost = ref(null);
      const modelCanvas = ref(null);
      const pdfFrame = ref(null);
      let previewToken = 0;       // 换文件/关闭时作废进行中的异步加载
      let officeDispose = null;   // docx/xlsx 的清理函数
      let pptxApi = null;         // pptx-preview 模块
      let pptxViewer = null;      // pptx-preview 实例
      let pptxBuf = null;
      let pptxAspect = 16 / 9;
      let pptxSize = { w: 0, h: 0 };
      let pptxRemounting = false;
      let pptxResizeTimer = 0;
      let xlsxSheets = null;
      let xlsxUnbind = null;
      let modelHandle = null;     // { dispose, resetCamera }
      let modelObserver = null;
      let docxObserver = null;
      let decodedState = null;    // TIFF/PSD/HEIC 解码后的画布/页数据
      let decodedURL = "";        // 解码图片的 object URL,关闭时 revoke
      let archiveObjectURLs = []; // 压缩包内条目预览产生的 Blob URL
      let pdfPollTimer = 0;       // PDF.js 文档就绪前的轮询句柄
      let pdfUnbind = null;       // 解除 PDF.js eventBus 监听
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

      // ---- 压缩包目录视图 ----
      function currentArcLevel() {
        const arc = preview.value && preview.value.arc;
        if (!arc || !arc.levels || !arc.levels.length) return null;
        return arc.levels[arc.levels.length - 1];
      }

      // arcRows 只返回「当前目录的直接子项」。zip 里经常只有文件路径、没有显式
      // 目录条目,所以父目录在这里按路径前缀补出来;嵌套压缩包沿用同一套。
      const arcRows = computed(() => {
        const level = currentArcLevel();
        if (!level) return [];
        const dir = (preview.value.arc && preview.value.arc.dir) || "";
        const prefix = dir ? dir.replace(/\/+$/, "") + "/" : "";
        const map = new Map();
        for (const e of level.entries) {
          if (!e.name || !e.name.startsWith(prefix)) continue;
          const rest = e.name.slice(prefix.length);
          if (!rest) continue;
          const slash = rest.indexOf("/");
          if (slash >= 0) {
            const base = rest.slice(0, slash);
            if (!base) continue;
            const fullName = prefix + base;
            const old = map.get(base);
            map.set(base, {
              base, fullName, isDir: true, isArchive: false, size: 0,
              entry: old && old.entry ? old.entry : null,
            });
          } else {
            if (e.isDir) {
              map.set(rest, { base: rest, fullName: prefix + rest, isDir: true, isArchive: false, size: 0, entry: e });
            } else {
              const base = rest;
              map.set(base, {
                base, fullName: e.name, isDir: false, isArchive: extIsArchive(e.name),
                size: e.size || 0, entry: e,
              });
            }
          }
        }
        return Array.from(map.values()).sort((a, b) => {
          if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
          return a.base.localeCompare(b.base, undefined, { numeric: true, sensitivity: "base" });
        });
      });

      const arcCrumbs = computed(() => {
        const arc = preview.value && preview.value.arc;
        if (!arc) return [];
        const out = arc.levels.map((lv, i) => ({ name: lv.name, level: i, dir: "" }));
        const dir = arc.dir || "";
        if (dir) {
          const parts = dir.split("/").filter(Boolean);
          parts.forEach((part, i) => {
            out.push({ name: part, level: arc.levels.length - 1, dir: parts.slice(0, i + 1).join("/") });
          });
        }
        return out;
      });

      // 顶部横条的面包屑:文件预览时把文件名作为最后一段,不再和左侧重复。
      const arcTopTitle = computed(() => {
        const parts = arcCrumbs.value.map((c) => c.name);
        if (preview.value && preview.value.arcEntry) parts.push(preview.value.arcEntry.base);
        return parts.join(" / ");
      });
      const arcTopCrumb = ref(null);
      watch(
        () => {
          const pvNow = preview.value;
          if (!pvNow || !pvNow.arc) return "";
          return (pvNow.arc.dir || "") + "|" + pvNow.arc.levels.length + "|" + (pvNow.arcEntry ? pvNow.arcEntry.fullName : "");
        },
        () => {
          nextTick(() => {
            const el = arcTopCrumb.value;
            if (el) el.scrollLeft = el.scrollWidth;
          });
        }
      );

      const canArcUp = computed(() => {
        const arc = preview.value && preview.value.arc;
        if (!arc) return false;
        return !!(arc.dir || (arc.levels && arc.levels.length > 1));
      });

      const arcSummary = computed(() => {
        const level = currentArcLevel();
        if (!level) return "";
        return tt.value.archiveSummary
          .replace("{n}", level.fileCount)
          .replace("{size}", fmtSize(level.total));
      });

      const arcTruncated = computed(() => {
        const level = currentArcLevel();
        return !!(level && level.truncated);
      });

      const pdfScalePct = computed(() => {
        const scale = preview.value && preview.value.pdfScale;
        return Math.round((scale || 1) * 100) + "%";
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
        if (ext === "xlsx" || ext === "xlsm" || ext === "xls") return "t-sheet";
        if (ext === "pptx" || ext === "ppt") return "t-slide";
        return KIND_CLASS[kindOf(it)] || "t-file";
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
        const token = ++previewToken;
        disposePreviewResources();
        preview.value = {
          entry: it, kind: kind || "none", url: fileURL(it.path), text: "", lines: [],
          highlighted: "", html: "", htmlSrcdoc: "", table: null, truncated: false, error: false, mediaError: false,
          loading: false, message: "", page: 0, pages: 0, progress: -1, progressText: "",
          arc: null, arcRoot: null, arcEntry: null, decoded: false, pdfScale: 1, pdfSidebarOpen: false,
        };
        pv.zoom = 1; pv.x = 0; pv.y = 0;

        // 旧版二进制 Office 格式没有可靠的纯 JS 解析器:明确提示另存为新格式,
        // 而不是丢一个永远转圈的空壳。
        if (kind === "legacyDoc" || kind === "legacyPpt" || kind === "legacyXls") {
          preview.value.message = tt.value[kind];
          return;
        }

        if (kind === "docx" || kind === "xlsx" || kind === "pptx") {
          if (it.size > PV_OFFICE_MAX) {
            preview.value.message = tt.value.tooBigOffice;
            return;
          }
          preview.value.loading = true;
          await nextTick();
          if (token !== previewToken) return;
          const job = kind === "docx" ? mountDocx : kind === "xlsx" ? mountXlsx : mountPptx;
          job(it, token).catch((e) => failPreview(token, e));
          return;
        }

        if (kind === "model") {
          if (it.size > PV_MODEL_MAX) {
            preview.value.message = tt.value.tooBigModel;
            return;
          }
          preview.value.loading = true;
          await nextTick();
          if (token !== previewToken) return;
          mountModel(it, token).catch((e) => failPreview(token, e));
          return;
        }

        // PSD / TIFF / HEIC 浏览器不能直接显示,先在本地解码成位图再复用图片预览。
        if (kind === "psd" || kind === "tiff" || kind === "heic") {
          if (it.size > PV_IMAGE_MAX) {
            preview.value.message = tt.value.tooBigImage;
            return;
          }
          preview.value.loading = true;
          await nextTick();
          if (token !== previewToken) return;
          mountDecodedImage(it, kind, token).catch((e) => failPreview(token, e));
          return;
        }

        if (kind === "archive") {
          if (it.size > PV_ARCHIVE_MAX) {
            preview.value.message = tt.value.tooBigArchive;
            return;
          }
          preview.value.loading = true;
          await nextTick();
          if (token !== previewToken) return;
          mountArchive(it, token).catch((e) => failPreview(token, e));
          return;
        }

        // HTML 直接交给 iframe 流式加载:不经过 fetch/srcdoc,页面里的相对
        // CSS/JS/图片才能保持原有目录关系,页面脚本也能正常执行。
        // sail-preview=1 让服务端只在预览时注入滚动条样式(不改原文件);
        // theme 用于让 iframe 内部的滚动条与应用主题保持一致。
        if (kind === "html") {
          preview.value.url = rawURL(it.path) + "?sail-preview=1&theme=" + encodeURIComponent(theme.value);
          return;
        }

        if (!kind || kind === "image" || kind === "pdf") return;
        if (kind === "video" || kind === "audio") {
          // 大视频(MOV 可能几十 MB)在 canplay 前先给一个加载态,避免黑屏。
          preview.value.loading = true;
          return;
        }

        // 文本类预览:先看大小,避免把几百 MB 的日志拉进浏览器。
        const MAX = PV_TEXT_MAX;
        if (it.size > MAX) {
          preview.value.truncated = true;
        }
        preview.value.loading = true;
        try {
          const res = await fetch(preview.value.url, { credentials: "same-origin" });
          if (!res.ok) throw new Error("HTTP " + res.status);
          const text = await res.text();
          if (token !== previewToken) return;
          const cut = text.length > MAX ? text.slice(0, MAX) : text;
          preview.value.text = cut;
          preview.value.truncated = preview.value.truncated || text.length > MAX;
          if (kind === "code") {
            preview.value.highlighted = highlightText(cut, it.name);
          } else if (kind === "csv") {
            const delim = extOf(it.name) === "tsv" ? "\t" : ",";
            preview.value.table = parseDelimited(cut, delim);
          } else if (kind === "md") {
            preview.value.html = renderMarkdown(cut);
            preview.value.kind = "markdown";
          } else {
            preview.value.lines = cut.split("\n");
          }
        } catch (e) {
          if (token === previewToken) {
            preview.value.message = tt.value.previewFailed + (e && e.message ? ": " + e.message : "");
          }
        } finally {
          if (token === previewToken) preview.value.loading = false;
        }
      }

      // ---- Office / 3D 预览:按需加载库、独立挂载、关闭时彻底释放 ----
      function disposePreviewResources() {
        if (officeDispose) { try { officeDispose(); } catch { /* ignore */ } officeDispose = null; }
        if (docxObserver) { try { docxObserver.disconnect(); } catch { /* ignore */ } docxObserver = null; }
        if (modelObserver) { try { modelObserver.disconnect(); } catch { /* ignore */ } modelObserver = null; }
        if (pptxViewer) { try { pptxViewer.destroy(); } catch { /* ignore */ } pptxViewer = null; }
        if (xlsxUnbind) { try { xlsxUnbind(); } catch { /* ignore */ } xlsxUnbind = null; }
        if (modelHandle) { try { modelHandle.dispose(); } catch { /* ignore */ } modelHandle = null; }
        if (pptxResizeTimer) { clearTimeout(pptxResizeTimer); pptxResizeTimer = 0; }
        pptxApi = null;
        pptxBuf = null;
        pptxSize = { w: 0, h: 0 };
        xlsxSheets = null;
        decodedState = null;
        unbindPdf();
        for (const url of archiveObjectURLs) {
          try { URL.revokeObjectURL(url); } catch { /* ignore */ }
        }
        archiveObjectURLs = [];
        if (decodedURL) {
          try { URL.revokeObjectURL(decodedURL); } catch { /* ignore */ }
          decodedURL = "";
        }
      }

      function failPreview(token, e) {
        if (token !== previewToken || !preview.value) return;
        preview.value.loading = false;
        preview.value.message = tt.value.previewFailed + (e && e.message ? ": " + e.message : "");
      }

      async function fetchPreviewBuffer(it, token, limit) {
        // 压缩包内条目没有自己的 /api/file 路径,由 arcPreview 先解出 Blob URL。
        const res = await fetch(it.url || fileURL(it.path), { credentials: "same-origin" });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const buf = await res.arrayBuffer();
        if (token === previewToken && limit && buf.byteLength > limit) {
          throw new Error(tt.value.tooBigOffice);
        }
        return buf;
      }

      // DOCX:docx-preview 渲染分页纸面,再做 CJK 字体/行高修补与「缩到容器宽度」。
      async function mountDocx(it, token) {
        try {
          const [docxLib, JSZip, fonts] = await Promise.all([
            loadLib("docx"), loadLib("jszip"), loadModule("/lib/preview_docx_fonts.js"),
          ]);
          const buf = await fetchPreviewBuffer(it, token, PV_OFFICE_MAX);
          if (token !== previewToken) return;
          const theme = await readDocxTheme(JSZip, fonts, buf);
          if (token !== previewToken) return;
          const host = docxHost.value;
          if (!host) throw new Error("preview host missing");
          host.innerHTML = "";
          await docxLib.renderAsync(buf, host, null, {
            className: "docx", inWrapper: true, ignoreWidth: false, breakPages: true,
          });
          if (token !== previewToken) return;
          fonts.patchDocxPreview(host, theme);
          applyDocxFit(host, fonts);
          if (typeof ResizeObserver !== "undefined") {
            docxObserver = new ResizeObserver(() => applyDocxFit(host, fonts));
            docxObserver.observe(host);
          }
          preview.value.loading = false;
        } catch (e) {
          failPreview(token, e);
        }
      }

      async function readDocxTheme(JSZip, fonts, buf) {
        try {
          const zip = await JSZip.loadAsync(buf);
          const theme = zip.file("word/theme/theme1.xml");
          const styles = zip.file("word/styles.xml");
          return {
            ...(theme ? fonts.themeEastAsiaFonts(await theme.async("text")) : {}),
            defaultParagraph: styles ? fonts.defaultParagraphFont(await styles.async("text")) : "",
          };
        } catch {
          return {};
        }
      }

      function applyDocxFit(host, fonts) {
        if (!host) return;
        const wrap = host.querySelector(".docx-wrapper") || host;
        const page = host.querySelector("section.docx") || host.querySelector(".docx-wrapper > .docx");
        if (!page) return;
        wrap.style.zoom = "1";
        const cs = window.getComputedStyle(host);
        const pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
        const avail = Math.max(0, host.clientWidth - pad);
        const pageW = page.offsetWidth || page.getBoundingClientRect().width || 0;
        const z = fonts && fonts.docxFitZoom ? fonts.docxFitZoom(pageW, avail) : 1;
        wrap.style.zoom = String(z || 1);
      }

      // XLSX:ExcelJS 解析 + 只读网格(与 vanor 预览同一套表格工具),支持多表切换、
      // 单元格选区、公式栏、行列统计与复制。
      async function mountXlsx(it, token) {
        try {
          const [ExcelJS, JSZip, px] = await Promise.all([
            loadLib("exceljs"), loadLib("jszip"), loadModule("/lib/preview_xlsx.js"),
          ]);
          const buf = await fetchPreviewBuffer(it, token, PV_OFFICE_MAX);
          if (token !== previewToken) return;
          const wb = new ExcelJS.Workbook();
          await wb.xlsx.load(buf);
          if (token !== previewToken) return;
          const sheets = px.workbookToSheets(wb);
          if (!sheets.length) throw new Error("empty workbook");

          // 浮动图片是可选增强:解析失败不影响表格主体。
          try {
            const pxi = await loadModule("/lib/preview_xlsx_images.js");
            const zip = await JSZip.loadAsync(buf);
            const entries = {};
            await Promise.all(Object.entries(zip.files).map(async ([p, f]) => {
              if (f.dir) return;
              if (!/^(xl\/|\[Content_Types\]\.xml)/.test(p)) return;
              entries[p] = await f.async(/\.(png|jpe?g|gif|webp|bmp)$/i.test(p) ? "uint8array" : "string");
            }));
            px.mergeSheetImages(sheets, pxi.collectXlsxImages(entries));
          } catch (e) {
            console.warn("[xlsx images]", e);
          }
          if (token !== previewToken) return;

          const host = xlsxHost.value;
          if (!host) throw new Error("preview host missing");
          host.innerHTML = px.sheetsToHtml(sheets, 0);
          const note = host.querySelector(".pv-xlsx-note[data-truncated]");
          if (note) {
            const s = sheets.find((x) => x.truncated) || sheets[0];
            note.textContent = tt.value.xlsxTruncated
              .replace("{rows}", s.rows).replace("{cols}", s.cols)
              .replace("{totalRows}", s.totalRows).replace("{totalCols}", s.totalCols);
          }
          xlsxSheets = sheets;
          xlsxUnbind = bindXlsx(host, sheets, px);
          preview.value.loading = false;
        } catch (e) {
          failPreview(token, e);
        }
      }

      // 表格交互:切表、点选/拖选、方向键移动、复制、公式栏与选区统计。
      function bindXlsx(host, sheets, px) {
        const root = host.querySelector(".pv-xlsx");
        if (!root) return null;
        let sel = null;
        let dragging = false;

        const activeSheet = () => {
          const tab = root.querySelector(".pv-xlsx-tab.active");
          return tab ? Number(tab.getAttribute("data-sheet")) || 0 : 0;
        };
        const range = () => {
          if (!sel) return null;
          return {
            r0: Math.min(sel.r0, sel.r1), c0: Math.min(sel.c0, sel.c1),
            r1: Math.max(sel.r0, sel.r1), c1: Math.max(sel.c0, sel.c1),
          };
        };
        const paintFx = () => {
          const nameEl = root.querySelector("[data-fx-name]");
          const valEl = root.querySelector("[data-fx-val]");
          const status = root.querySelector("[data-xlsx-status]");
          const g = sel ? sheets[sel.sheet] : null;
          if (!sel || !g) {
            if (nameEl) nameEl.textContent = "";
            if (valEl) { valEl.textContent = ""; valEl.removeAttribute("title"); }
            if (status) status.textContent = tt.value.xlsxReady;
            return;
          }
          if (nameEl) nameEl.textContent = px.formatCellRef(sel.ar, sel.ac);
          const cell = g.cells && g.cells[sel.ar - 1] ? g.cells[sel.ar - 1][sel.ac - 1] : null;
          const text = cell && !cell.skip ? String(cell.text == null ? "" : cell.text) : "";
          // 公式栏优先显示原公式,结果已经在网格里;这样复制/核对公式才有意义。
          const shown = cell && !cell.skip && cell.formula ? String(cell.formula) : text;
          if (valEl) { valEl.textContent = shown; valEl.title = shown; }
          if (status) {
            const st = px.selectionStats(g, range());
            const parts = [];
            if (st.numericCount > 0) {
              parts.push(tt.value.xlsxSum.replace("{sum}", fmtStat(st.sum)));
              if (st.numericCount > 1) parts.push(tt.value.xlsxAvg.replace("{avg}", fmtStat(st.avg)));
              parts.push(tt.value.xlsxNumCount.replace("{n}", st.numericCount));
            }
            parts.push(tt.value.xlsxCount.replace("{count}", st.count));
            status.textContent = parts.join("  ");
          }
        };
        const paint = () => {
          root.querySelectorAll(".pv-xlsx-sel, .pv-xlsx-active").forEach((el) => {
            el.classList.remove("pv-xlsx-sel", "pv-xlsx-active");
          });
          if (!sel) return paintFx();
          const g = sheets[sel.sheet];
          const r = range();
          const panel = root.querySelector('.pv-xlsx-panel[data-sheet="' + sel.sheet + '"]');
          if (g && panel && r) {
            panel.querySelectorAll("td[data-r][data-c]").forEach((td) => {
              const rr = +td.getAttribute("data-r");
              const cc = +td.getAttribute("data-c");
              if (rr >= r.r0 && rr <= r.r1 && cc >= r.c0 && cc <= r.c1) td.classList.add("pv-xlsx-sel");
              if (rr === sel.ar && cc === sel.ac) td.classList.add("pv-xlsx-active");
            });
          }
          paintFx();
        };
        const fmtStat = (n) => {
          if (!Number.isFinite(n)) return "";
          const a = Math.abs(n);
          if (a >= 1e9 || (a > 0 && a < 1e-6)) return String(n);
          return String(Math.round(n * 1000) / 1000);
        };
        const hit = (target) => {
          if (!target || !target.closest) return null;
          const td = target.closest("td[data-r][data-c]");
          if (td) {
            const r = +td.getAttribute("data-r");
            const c = +td.getAttribute("data-c");
            const o = px.clampToOriginCell(sheets[activeSheet()], r, c);
            return { kind: "cell", r, c, ar: o.r, ac: o.c };
          }
          const col = target.closest("th.pv-xlsx-colh[data-c]");
          if (col) return { kind: "col", c: +col.getAttribute("data-c") };
          const row = target.closest("th.pv-xlsx-rowh[data-r]");
          if (row) return { kind: "row", r: +row.getAttribute("data-r") };
          if (target.closest("th.pv-xlsx-corner")) return { kind: "corner" };
          return null;
        };

        root.querySelectorAll(".pv-xlsx-tab").forEach((btn) => {
          btn.addEventListener("click", () => {
            const i = btn.getAttribute("data-sheet");
            root.querySelectorAll(".pv-xlsx-tab").forEach((b) => b.classList.toggle("active", b === btn));
            root.querySelectorAll(".pv-xlsx-panel").forEach((p) => {
              p.classList.toggle("active", p.getAttribute("data-sheet") === i);
            });
            sel = null;
            paint();
          });
        });

        const onDown = (e) => {
          if (e.button != null && e.button !== 0) return;
          if (e.target.closest && e.target.closest(".pv-xlsx-tab")) return;
          if (!e.target.closest || !e.target.closest(".pv-xlsx-scroll")) return;
          const h = hit(e.target);
          if (!h) return;
          const g = sheets[activeSheet()];
          if (!g) return;
          e.preventDefault();
          try { root.focus({ preventScroll: true }); } catch { /* ignore */ }
          const sheet = activeSheet();
          if (h.kind === "cell") {
            sel = { sheet, r0: h.r, c0: h.c, r1: h.r, c1: h.c, ar: h.ar, ac: h.ac };
          } else if (h.kind === "col") {
            sel = { sheet, r0: 1, c0: h.c, r1: g.rows, c1: h.c, ar: 1, ac: h.c };
          } else if (h.kind === "row") {
            sel = { sheet, r0: h.r, c0: 1, r1: h.r, c1: g.cols, ar: h.r, ac: 1 };
          } else {
            sel = { sheet, r0: 1, c0: 1, r1: g.rows, c1: g.cols, ar: 1, ac: 1 };
          }
          dragging = true;
          paint();
        };
        const onMove = (e) => {
          if (!dragging || !sel) return;
          const el = document.elementFromPoint && document.elementFromPoint(e.clientX, e.clientY);
          const h = hit(el);
          if (!h || h.kind !== "cell") return;
          sel.r1 = h.r;
          sel.c1 = h.c;
          paint();
        };
        const onUp = () => { dragging = false; };
        const onKey = (e) => {
          if (!preview.value || preview.value.kind !== "xlsx") return;
          const g = sheets[activeSheet()];
          if (!g) return;
          const mod = e.metaKey || e.ctrlKey;
          if (mod && e.key.toLowerCase() === "c" && sel) {
            e.preventDefault();
            e.stopPropagation();
            copyText(px.selectionToTsv(g, range()))
              .then(() => toast(tt.value.copied, "", "ok"))
              .catch(() => toast(tt.value.copyFailed, "", "err"));
            return;
          }
          if (mod && e.key.toLowerCase() === "a") {
            e.preventDefault();
            e.stopPropagation();
            sel = { sheet: activeSheet(), r0: 1, c0: 1, r1: g.rows, c1: g.cols, ar: 1, ac: 1 };
            paint();
            return;
          }
          if (e.key === "Escape") {
            if (!sel) return;
            e.preventDefault();
            e.stopPropagation();
            sel = null;
            paint();
            return;
          }
          if (!sel) return;
          const map = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
          const d = map[e.key];
          if (!d) return;
          e.preventDefault();
          e.stopPropagation();
          let ar = Math.max(1, Math.min(g.rows, sel.ar + d[0]));
          let ac = Math.max(1, Math.min(g.cols, sel.ac + d[1]));
          while (g.rowHidden && g.rowHidden[ar - 1] && ar > 1 && ar < g.rows) ar += d[0];
          while (g.colHidden && g.colHidden[ac - 1] && ac > 1 && ac < g.cols) ac += d[1];
          const o = px.clampToOriginCell(g, ar, ac);
          if (e.shiftKey) {
            sel.r1 = o.r;
            sel.c1 = o.c;
          } else {
            sel = { sheet: sel.sheet, r0: o.r, c0: o.c, r1: o.r, c1: o.c, ar: o.r, ac: o.c };
          }
          paint();
        };

        root.addEventListener("pointerdown", onDown);
        document.addEventListener("pointermove", onMove);
        document.addEventListener("pointerup", onUp);
        document.addEventListener("pointercancel", onUp);
        root.addEventListener("keydown", onKey);
        paint();
        return () => {
          root.removeEventListener("pointerdown", onDown);
          document.removeEventListener("pointermove", onMove);
          document.removeEventListener("pointerup", onUp);
          document.removeEventListener("pointercancel", onUp);
          root.removeEventListener("keydown", onKey);
        };
      }

      // PPTX:pptx-preview 逐页渲染;先修掉 pptxgenjs 常见的幽灵 Content-Type 条目。
      async function mountPptx(it, token) {
        try {
          const [api, JSZip] = await Promise.all([loadLib("pptx"), loadLib("jszip")]);
          const raw = await fetchPreviewBuffer(it, token, PV_OFFICE_MAX);
          if (token !== previewToken) return;
          const buf = await sanitizePptx(JSZip, raw);
          if (token !== previewToken) return;
          const host = pptxHost.value;
          if (!host) throw new Error("preview host missing");
          pptxApi = api;
          pptxBuf = buf;
          pptxSize = { w: 0, h: 0 };
          await remountPptx(host, token, true);
          preview.value.loading = false;
        } catch (e) {
          failPreview(token, e);
        }
      }

      async function sanitizePptx(JSZip, buf) {
        pptxAspect = 16 / 9;
        const zip = await JSZip.loadAsync(buf);
        try {
          const pres = zip.file("ppt/presentation.xml");
          if (pres) {
            const xml = await pres.async("text");
            const tag = /<p:sldSz\b[^>/]*/.exec(xml) ? /<p:sldSz\b[^>/]*/.exec(xml)[0] : "";
            const cx = Number(/cx="(\d+)"/.exec(tag) ? /cx="(\d+)"/.exec(tag)[1] : 0);
            const cy = Number(/cy="(\d+)"/.exec(tag) ? /cy="(\d+)"/.exec(tag)[1] : 0);
            pptxAspect = cx > 0 && cy > 0 ? cx / cy : 16 / 9;
          }
        } catch {
          pptxAspect = 16 / 9;
        }
        const ctFile = zip.file("[Content_Types].xml");
        if (!ctFile) return buf;
        const ct = await ctFile.async("text");
        const fixed = ct.replace(/<Override\b[^>]*\/>/g, (tag) => {
          const m = /PartName="([^"]+)"/.exec(tag);
          if (!m) return tag;
          const entry = zip.files[m[1].replace(/^\//, "")];
          return entry && !entry.dir ? tag : "";
        });
        if (fixed === ct) return buf;
        zip.file("[Content_Types].xml", fixed);
        return zip.generateAsync({ type: "arraybuffer" });
      }

      function pptxFitSize(aw, ah, ar) {
        const pad = 8;
        const ratio = ar > 0 ? ar : 16 / 9;
        let maxW = Math.floor(aw || 0) - pad;
        let maxH = Math.floor(ah || 0) - pad;
        if (maxW < 8 || maxH < 8) { maxW = 760; maxH = 540; }
        let w = maxW;
        let h = Math.round(w / ratio);
        if (h > maxH) { h = maxH; w = Math.round(h * ratio); }
        return { w: Math.max(1, w), h: Math.max(1, h) };
      }

      async function remountPptx(host, token, force) {
        if (!pptxApi || !pptxBuf || pptxRemounting || !host) return;
        const rect = host.getBoundingClientRect();
        const { w, h } = pptxFitSize(rect.width, rect.height, pptxAspect);
        if (!force && Math.abs(w - pptxSize.w) < 2 && Math.abs(h - pptxSize.h) < 2) return;
        pptxRemounting = true;
        const idx = pptxViewer ? Math.max(0, pptxViewer.currentIndex || 0) : 0;
        try {
          try { if (pptxViewer) pptxViewer.destroy(); } catch { /* ignore */ }
          pptxViewer = null;
          host.innerHTML = "";
          pptxViewer = pptxApi.init(host, { width: w, height: h, mode: "slide" });
          pptxSize = { w, h };
          await pptxViewer.preview(pptxBuf);
          if (token !== previewToken) return;
          const pages = pptxViewer.slideCount || 0;
          preview.value.pages = pages;
          const go = idx > 0 && idx < pages ? idx : 0;
          if (go > 0) pptxViewer.renderSingleSlide(go);
          preview.value.page = go;
        } finally {
          pptxRemounting = false;
        }
      }

      function pptxGo(delta) {
        if (!pptxViewer || !preview.value || preview.value.kind !== "pptx") return;
        const pages = preview.value.pages || pptxViewer.slideCount || 0;
        if (!pages) return;
        const next = ((preview.value.page || 0) + delta + pages) % pages;
        pptxViewer.renderSingleSlide(next);
        preview.value.page = next;
      }

      // 3D:GLB/GLTF/OBJ/STL,OrbitControls + 环境光照,自动居中并按最大边缩放。
      async function mountModel(it, token) {
        let renderer = null, scene = null, camera = null, controls = null, root = null;
        let raf = 0;
        let disposed = false;
        // 清理函数要在渲染器创建后就能用:关闭预览时模型可能仍在下载,不能等 loadAsync 返回。
        const cleanup = () => {
          if (disposed) return;
          disposed = true;
          cancelAnimationFrame(raf);
          if (modelObserver) { try { modelObserver.disconnect(); } catch { /* ignore */ } modelObserver = null; }
          if (controls) { try { controls.dispose(); } catch { /* ignore */ } controls = null; }
          if (root) { disposeObject3D(root); root = null; }
          if (scene && scene.environment) { try { scene.environment.dispose(); } catch { /* ignore */ } }
          if (renderer) {
            try { renderer.forceContextLoss(); } catch { /* ignore */ }
            try { renderer.dispose(); } catch { /* ignore */ }
            renderer = null;
          }
        };
        try {
          const THREE = await loadModule("/lib/three.bundle.min.js");
          const canvas = modelCanvas.value;
          if (!canvas) throw new Error("canvas missing");
          const host = canvas.parentElement;
          if (!host) throw new Error("canvas host missing");

          renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
          renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
          renderer.outputColorSpace = THREE.SRGBColorSpace;
          renderer.toneMapping = THREE.ACESFilmicToneMapping;
          renderer.toneMappingExposure = 1.05;
          renderer.setClearColor(0x000000, 0);
          scene = new THREE.Scene();
          camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
          camera.position.set(0, 0.6, 3.2);

          const pmrem = new THREE.PMREMGenerator(renderer);
          scene.environment = pmrem.fromScene(new THREE.RoomEnvironment(), 0.04).texture;
          pmrem.dispose();
          scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.1));
          const key = new THREE.DirectionalLight(0xffffff, 1.15);
          key.position.set(3, 5, 4);
          scene.add(key);
          const fill = new THREE.DirectionalLight(0xffffff, 0.35);
          fill.position.set(-4, -2, -3);
          scene.add(fill);

          controls = new THREE.OrbitControls(camera, canvas);
          controls.enableDamping = true;
          controls.dampingFactor = 0.08;
          controls.target.set(0, 0, 0);
          controls.update();
          // 载入完成前先挂一个「可取消」的句柄,关闭预览能立即停掉 RAF/观察器。
          modelHandle = { resetCamera: () => {}, dispose: cleanup };

          const resize = () => {
            const w = host.clientWidth || 1;
            const h = host.clientHeight || 1;
            renderer.setSize(w, h, false);
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
          };
          resize();
          modelObserver = new ResizeObserver(resize);
          modelObserver.observe(host);

          const manager = new THREE.LoadingManager();
          manager.onProgress = (_url, loaded, total) => {
            if (token !== previewToken || !preview.value) return;
            preview.value.progress = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : -1;
            preview.value.progressText = total > 0 ? loaded + " / " + total : "";
          };
          // .gltf 的外部 .bin/贴图按「同目录兄弟对象」解析,否则会落到 /api/xxx。
          const dir = it.path.slice(0, it.path.lastIndexOf("/") + 1);
          manager.setURLModifier((url) => {
            if (/^(data:|blob:|https?:)/i.test(url)) return url;
            if (url.indexOf("/api/file?") === 0) return url;
            if (url.indexOf("/api/") === 0) return fileURL(dir + url.slice(5));
            // 压缩包内的 .gltf 无法从对象存储相对路径取兄弟文件;自包含的
            // GLB/OBJ/STL 仍可预览,引用外部 .bin/贴图的 GLTF 会按原样失败。
            if (it._arc) return String(url).replace(/^\.\//, "");
            // GLTFLoader 会把 .gltf 里的相对 .bin/贴图路径原样交给这里;
            // 统一按「模型所在目录的兄弟对象」映射到 /api/file。
            const clean = String(url).replace(/^\.\//, "");
            return fileURL(dir + clean.replace(/^\//, ""));
          });

          const modelURL = it.url || fileURL(it.path);
          const ext = extOf(it.name);
          if (ext === "glb" || ext === "gltf") {
            const gltf = await new THREE.GLTFLoader(manager).loadAsync(modelURL);
            root = gltf.scene;
          } else if (ext === "obj") {
            root = await new THREE.OBJLoader(manager).loadAsync(modelURL);
          } else if (ext === "stl") {
            const geo = await new THREE.STLLoader(manager).loadAsync(modelURL);
            const mat = new THREE.MeshStandardMaterial({ color: 0x9aa3b2, metalness: 0.15, roughness: 0.55 });
            root = new THREE.Mesh(geo, mat);
          } else {
            throw new Error("unsupported model format");
          }
          if (token !== previewToken) {
            cleanup();
            return;
          }

          // OBJ 常见没有标准材质:给个中性灰,否则在 environment 下会发黑。
          if (ext === "obj") {
            root.traverse((o) => {
              if (o.isMesh && (!o.material || (o.material.type === "MeshPhongMaterial" && !o.material.map))) {
                o.material = new THREE.MeshStandardMaterial({ color: 0xaab2c0, metalness: 0.1, roughness: 0.65 });
              }
            });
          }

          scene.add(root);
          const home = fitModelObject(THREE, root, camera, controls);
          const resetCamera = () => {
            camera.position.copy(home.pos);
            controls.target.set(0, 0, 0);
            controls.update();
          };
          preview.value.loading = false;
          preview.value.progressText = "";
          const loop = () => {
            if (token !== previewToken) return;
            controls.update();
            renderer.render(scene, camera);
            raf = requestAnimationFrame(loop);
          };
          loop();
          modelHandle = { resetCamera, dispose: cleanup };
        } catch (e) {
          cleanup();
          failPreview(token, e);
        }
      }

      // PSD / TIFF / HEIC:解码成位图后切换成普通图片预览(缩放/平移/下载都复用)。
      async function mountDecodedImage(it, kind, token) {
        try {
          const buf = await fetchPreviewBuffer(it, token, PV_IMAGE_MAX);
          if (token !== previewToken) return;
          if (kind === "heic") {
            const heic2any = await loadLib("heic");
            const out = await heic2any({
              blob: new Blob([buf], { type: "image/heic" }),
              toType: "image/jpeg",
              quality: 0.92,
            });
            if (token !== previewToken) return;
            const blob = Array.isArray(out) ? out[0] : out;
            if (!blob) throw new Error("HEIC 中没有可显示的图像");
            setDecodedImage(URL.createObjectURL(blob), 1, 0);
            return;
          }
          if (kind === "psd") {
            const agPsd = await loadLib("agpsd");
            const psd = agPsd.readPsd(buf, {
              useImageData: true,
              skipLayerImageData: true,
              skipThumbnail: true,
              skipLinkedFilesData: true,
            });
            if (token !== previewToken) return;
            if (!psd || !psd.imageData) throw new Error("PSD 没有合成图像");
            if (psd.imageData.width * psd.imageData.height > PV_IMAGE_PIXELS) {
              throw new Error(tt.value.imageTooLarge);
            }
            const blob = await imageDataToBlob(psd.imageData);
            if (token !== previewToken) return;
            setDecodedImage(URL.createObjectURL(blob), 1, 0);
            return;
          }
          // TIFF:解出全部 IFD,先显示第一页;多页时顶部可翻页。
          const UTIF = await loadLib("utif");
          const ifds = UTIF.decode(buf);
          if (!ifds || !ifds.length) throw new Error("TIFF 中没有图像");
          decodedState = { type: "tiff", buf, ifds, UTIF };
          await showTiffPage(0, token);
        } catch (e) {
          failPreview(token, e);
        }
      }

      async function showTiffPage(index, token) {
        if (!decodedState || decodedState.type !== "tiff" || !preview.value) return;
        const { UTIF, buf, ifds } = decodedState;
        const page = Math.max(0, Math.min(ifds.length - 1, index));
        const ifd = ifds[page];
        // 多页 TIFF 只解码当前页,避免一次把几十页全部展开。
        if (!ifd.data) UTIF.decodeImage(buf, ifd);
        const w = Number(ifd.width) || 1;
        const h = Number(ifd.height) || 1;
        if (!ifd.data || w < 1 || h < 1) throw new Error("TIFF 页面解码失败");
        if (w * h > PV_IMAGE_PIXELS) throw new Error(tt.value.imageTooLarge);
        const rgba = UTIF.toRGBA8(ifd);
        const blob = await rgbaToBlob(rgba, w, h);
        if (token !== previewToken) return;
        setDecodedImage(URL.createObjectURL(blob), ifds.length, page);
      }

      function setDecodedImage(url, pages, page) {
        const pvNow = preview.value;
        if (!pvNow) {
          try { URL.revokeObjectURL(url); } catch { /* ignore */ }
          return;
        }
        if (decodedURL) {
          try { URL.revokeObjectURL(decodedURL); } catch { /* ignore */ }
        }
        decodedURL = url;
        pvNow.url = url;
        pvNow.kind = "image";
        pvNow.decoded = true;
        pvNow.pages = pages;
        pvNow.page = page;
        pvNow.loading = false;
        pvNow.progressText = "";
        pv.zoom = 1;
        pv.x = 0;
        pv.y = 0;
      }

      function decodedGo(delta) {
        if (!decodedState || decodedState.type !== "tiff" || !preview.value) return;
        const pages = decodedState.ifds.length;
        if (pages < 2) return;
        const next = ((preview.value.page || 0) + delta + pages) % pages;
        showTiffPage(next, previewToken).catch((e) => failPreview(previewToken, e));
      }

      function previewGo(delta) {
        if (!preview.value) return;
        if (preview.value.kind === "pptx") return pptxGo(delta);
        if (preview.value.decoded) return decodedGo(delta);
      }

      function imageDataToBlob(imageData) {
        const canvas = document.createElement("canvas");
        canvas.width = imageData.width;
        canvas.height = imageData.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return Promise.reject(new Error("canvas unavailable"));
        ctx.putImageData(imageData, 0, 0);
        return canvasToBlob(canvas);
      }

      function rgbaToBlob(rgba, w, h) {
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return Promise.reject(new Error("canvas unavailable"));
        const data = new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength), w, h);
        ctx.putImageData(data, 0, 0);
        return canvasToBlob(canvas);
      }

      function canvasToBlob(canvas) {
        return new Promise((resolve, reject) => {
          try {
            canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("encode failed")), "image/png");
          } catch (e) {
            reject(e);
          }
        });
      }

      // ---- 压缩包浏览器 ----
      // 目录在浏览器里直接解析 zip/tar,gz 用 pako 解压;内层压缩包可以继续进入,
      // 内层普通文件复用外层同一套预览器(先解成 Blob URL,再交给对应 mount* 函数)。
      async function parseArchiveBuffer(buf, name) {
        const flavor = archiveFlavor(name);
        if (!flavor) throw new Error(tt.value.archiveUnsupported);
        if (flavor === "zip") {
          const JSZip = await loadLib("jszip");
          const zip = await JSZip.loadAsync(buf);
          return archiveLevelFromZip(name, zip);
        }
        let data = new Uint8Array(buf);
        if (flavor === "targz" || flavor === "gz") {
          const pako = await loadLib("pako");
          const unpacked = gzipUnpackedSize(data);
          if (unpacked > PV_ARCHIVE_UNPACKED_MAX) throw new Error(tt.value.archiveTooBigUnpacked);
          try {
            data = pako.ungzip(data);
          } catch {
            throw new Error("gzip 数据损坏或不完整");
          }
          if (data.length > PV_ARCHIVE_UNPACKED_MAX) throw new Error(tt.value.archiveTooBigUnpacked);
        }
        let list = [];
        if (flavor === "tar" || flavor === "targz") list = parseTar(data);
        if (!list.length && flavor === "gz") {
          // 单个 .gz 不是 tar:按一个文件展示,点击可下载解压后的内容。
          list = [{ name: name.replace(/\.gz$/i, ""), isDir: false, size: data.length, offset: 0 }];
        } else if (!list.length) {
          throw new Error("不是可识别的 tar 包");
        }
        const total = list.reduce((sum, e) => sum + (e.isDir ? 0 : e.size), 0);
        return makeArchiveLevel(name, { data }, list, total, list.length > 2000);
      }

      function archiveLevelFromZip(name, zip) {
        const list = [];
        let total = 0;
        let truncated = false;
        for (const [zipName, f] of Object.entries(zip.files)) {
          if (list.length >= 2000) { truncated = true; break; }
          if (isArchiveJunk(zipName)) continue;
          const clean = cleanArchiveName(zipName);
          if (!clean) continue;
          const size = f.dir ? 0 : Number(f._data && f._data.uncompressedSize) || 0;
          total += size;
          list.push({ name: clean, isDir: !!f.dir, size, zipName });
        }
        return makeArchiveLevel(name, { zip }, list, total, truncated);
      }

      function makeArchiveLevel(name, handle, entries, total, truncated) {
        entries.sort((a, b) => {
          if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
          return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
        });
        const capped = entries.slice(0, 2000);
        return {
          name, handle, entries: capped, total,
          truncated: !!truncated || entries.length > capped.length,
          fileCount: capped.filter((e) => !e.isDir).length,
        };
      }

      async function readArchiveEntry(level, entry) {
        if (!level || !entry) throw new Error("entry missing");
        if (level.handle && level.handle.zip) {
          const f = level.handle.zip.file(entry.zipName || entry.name);
          if (!f) throw new Error("条目不存在");
          return await f.async("uint8array");
        }
        if (level.handle && level.handle.data) {
          if (entry.offset == null) return level.handle.data;
          return level.handle.data.subarray(entry.offset, entry.offset + entry.size);
        }
        throw new Error("archive handle missing");
      }

      async function mountArchive(it, token) {
        try {
          const buf = await fetchPreviewBuffer(it, token, PV_ARCHIVE_MAX);
          if (token !== previewToken) return;
          const level = await parseArchiveBuffer(buf, it.name);
          if (token !== previewToken || !preview.value) return;
          preview.value.arc = { levels: [level], dir: "" };
          preview.value.arcRoot = it;
          preview.value.arcEntry = null;
          preview.value.loading = false;
        } catch (e) {
          failPreview(token, e);
        }
      }

      function arcOpen(row) {
        const pvNow = preview.value;
        if (!pvNow || !pvNow.arc || !row) return;
        if (row.isDir) {
          if (pvNow.arcEntry) backToArchive();
          pvNow.arc.dir = row.fullName;
          return;
        }
        const kind = archiveKindOf(row.base);
        if (kind === "archive") {
          if (!archiveFlavor(row.base)) {
            toast(tt.value.archiveUnsupported, row.base, "err");
            return;
          }
          enterNestedArchive(row);
          return;
        }
        if (!kind) {
          toast(tt.value.archiveEntryUnsupported, row.base, "err");
          return;
        }
        arcPreview(row);
      }

      function arcGoUp() {
        if (preview.value && preview.value.arcEntry) backToArchive();
        const arc = preview.value && preview.value.arc;
        if (!arc) return;
        if (arc.dir) {
          const parts = arc.dir.split("/").filter(Boolean);
          parts.pop();
          arc.dir = parts.join("/");
          return;
        }
        if (arc.levels.length > 1) arc.levels.pop();
      }

      function arcGoCrumb(index) {
        const crumb = arcCrumbs.value[index];
        if (preview.value && preview.value.arcEntry) backToArchive();
        const arc = preview.value && preview.value.arc;
        if (!crumb || !arc) return;
        arc.levels.splice(crumb.level + 1);
        arc.dir = crumb.dir;
      }

      async function enterNestedArchive(row) {
        if (preview.value && preview.value.arcEntry) backToArchive();
        const pvNow = preview.value;
        const level = currentArcLevel();
        if (!pvNow || !level || !row.entry) return;
        if (row.size > PV_ARCHIVE_MAX) {
          toast(tt.value.tooBigArchive, row.base, "err");
          return;
        }
        const arcRef = pvNow.arc;
        pvNow.loading = true;
        try {
          const bytes = await readArchiveEntry(level, row.entry);
          if (!preview.value || preview.value.arc !== arcRef) return;
          const nested = await parseArchiveBuffer(bytes, row.base);
          if (!preview.value || preview.value.arc !== arcRef) return;
          arcRef.levels.push(nested);
          arcRef.dir = "";
          pvNow.loading = false;
        } catch (e) {
          if (preview.value && preview.value.arc === arcRef) {
            pvNow.loading = false;
            toast(tt.value.archiveEntryFailed, String((e && e.message) || e), "err");
          }
        }
      }

      function beginArcEntry(row, kind) {
        const pvNow = preview.value;
        const level = currentArcLevel();
        const entry = row.entry;
        const virtual = {
          name: row.base,
          path: (level ? level.name : "") + "!/" + entry.name,
          dir: false, size: entry.size || 0, mtime: entry.mtime || 0, contentType: "", _arc: true,
        };
        Object.assign(pvNow, {
          entry: virtual, kind: kind || "none", url: "", text: "", lines: [], highlighted: "",
          html: "", htmlSrcdoc: "", table: null, truncated: false, error: false, mediaError: false,
          loading: false, message: "", page: 0, pages: 0, progress: -1, progressText: "",
          decoded: false, pdfScale: 1, pdfSidebarOpen: false,
          arcEntry: { level, entry, base: row.base, fullName: row.fullName },
        });
        pv.zoom = 1; pv.x = 0; pv.y = 0;
        return virtual;
      }

      function applyTextPreview(kind, text, name) {
        const pvNow = preview.value;
        if (!pvNow) return;
        const cut = text.length > PV_TEXT_MAX ? text.slice(0, PV_TEXT_MAX) : text;
        pvNow.text = cut;
        pvNow.truncated = text.length > PV_TEXT_MAX;
        if (kind === "code") {
          pvNow.highlighted = highlightText(cut, name);
        } else if (kind === "csv") {
          pvNow.table = parseDelimited(cut, extOf(name) === "tsv" ? "\t" : ",");
        } else if (kind === "md") {
          pvNow.html = renderMarkdown(cut);
          pvNow.kind = "markdown";
        } else {
          pvNow.lines = cut.split("\n");
        }
        pvNow.loading = false;
      }

      function isTextKind(kind) {
        return kind === "code" || kind === "text" || kind === "md" || kind === "csv";
      }

      async function arcPreview(row) {
        const level = currentArcLevel();
        if (!level || !row.entry) return;
        const kind = archiveKindOf(row.base);
        if (!kind) { toast(tt.value.archiveEntryUnsupported, row.base, "err"); return; }
        if (kind === "archive") { enterNestedArchive(row); return; }

        const token = ++previewToken;
        disposePreviewResources();
        const it = beginArcEntry(row, kind);

        if (kind === "legacyDoc" || kind === "legacyPpt" || kind === "legacyXls") {
          preview.value.message = tt.value[kind];
          return;
        }
        if ((kind === "docx" || kind === "xlsx" || kind === "pptx") && row.size > PV_OFFICE_MAX) {
          preview.value.message = tt.value.tooBigOffice;
          return;
        }
        if (kind === "model" && row.size > PV_MODEL_MAX) {
          preview.value.message = tt.value.tooBigModel;
          return;
        }
        if ((kind === "psd" || kind === "tiff" || kind === "heic" || kind === "image") && row.size > PV_IMAGE_MAX) {
          preview.value.message = tt.value.tooBigImage;
          return;
        }
        if (isTextKind(kind) && row.size > PV_TEXT_MAX * 8) {
          preview.value.message = tt.value.tooBigText;
          return;
        }

        preview.value.loading = true;
        try {
          const bytes = await readArchiveEntry(level, row.entry);
          if (token !== previewToken || !preview.value) return;
          if (isTextKind(kind)) {
            applyTextPreview(kind, new TextDecoder("utf-8").decode(bytes), row.base);
            return;
          }
          if (kind === "html") {
            preview.value.htmlSrcdoc = await archiveHTMLDoc(level, row.entry, bytes);
            preview.value.loading = false;
            return;
          }

          const url = URL.createObjectURL(new Blob([bytes], { type: mimeOf(row.base) }));
          archiveObjectURLs.push(url);
          it.url = url;
          preview.value.url = url;

          if (kind === "docx" || kind === "xlsx" || kind === "pptx") {
            preview.value.loading = true;
            await nextTick();
            if (token !== previewToken) return;
            const job = kind === "docx" ? mountDocx : kind === "xlsx" ? mountXlsx : mountPptx;
            job(it, token).catch((e) => failPreview(token, e));
            return;
          }
          if (kind === "model") {
            preview.value.loading = true;
            await nextTick();
            if (token !== previewToken) return;
            mountModel(it, token).catch((e) => failPreview(token, e));
            return;
          }
          if (kind === "psd" || kind === "tiff" || kind === "heic") {
            preview.value.loading = true;
            await nextTick();
            if (token !== previewToken) return;
            mountDecodedImage(it, kind, token).catch((e) => failPreview(token, e));
            return;
          }
          if (kind === "video" || kind === "audio") {
            preview.value.loading = true;
            return;
          }
          preview.value.loading = false;
        } catch (e) {
          failPreview(token, e);
        }
      }

      function backToArchive() {
        if (!preview.value || !preview.value.arcEntry) return;
        previewToken += 1;
        disposePreviewResources();
        const pvNow = preview.value;
        const root = pvNow.arcRoot || pvNow.entry;
        Object.assign(pvNow, {
          entry: root, kind: "archive", url: "", text: "", lines: [], highlighted: "", html: "", htmlSrcdoc: "",
          table: null, truncated: false, error: false, mediaError: false, loading: false,
          message: "", page: 0, pages: 0, progress: -1, progressText: "", decoded: false,
          pdfScale: 1, pdfSidebarOpen: false, arcEntry: null,
        });
        pv.zoom = 1; pv.x = 0; pv.y = 0;
      }

      // HTML 压缩包条目:把页面里的相对 CSS/JS/图片解出来内联成 data URL,
      // 再用 srcdoc 交给 sandbox iframe。sandbox 没有 allow-same-origin,
      // 不能加载父页面的 blob: URL,也不能读取本应用的 API/凭据。
      async function archiveHTMLDoc(level, entry, bytes) {
        try {
          const html = new TextDecoder("utf-8").decode(bytes);
          const doc = new DOMParser().parseFromString(html, "text/html");
          const baseDir = archiveDirname(entry.name);
          const jobs = [];
          const attrs = "img[src],script[src],source[src],video[src],audio[src],track[src],iframe[src],embed[src],input[src],link[href],object[data]";
          for (const el of doc.querySelectorAll(attrs)) {
            const attr = el.tagName === "OBJECT" ? "data" : el.tagName === "LINK" ? "href" : "src";
            const ref = el.getAttribute(attr);
            if (!ref) continue;
            jobs.push(archiveResourceDataURL(level, baseDir, ref, 0).then((url) => {
              if (url) el.setAttribute(attr, url);
            }));
          }
          for (const el of doc.querySelectorAll("[srcset]")) {
            const refs = String(el.getAttribute("srcset") || "").split(",").map((part) => {
              const bits = part.trim().split(/\s+/);
              return { ref: bits.shift() || "", descriptor: bits.join(" ") };
            });
            jobs.push(Promise.all(refs.map(async (item) => {
              const url = await archiveResourceDataURL(level, baseDir, item.ref, 0);
              return url ? url + (item.descriptor ? " " + item.descriptor : "") : item.ref + (item.descriptor ? " " + item.descriptor : "");
            })).then((items) => el.setAttribute("srcset", items.join(", "))));
          }
          for (const el of doc.querySelectorAll("style")) {
            const css = el.textContent || "";
            jobs.push(rewriteArchiveCSS(level, baseDir, css, 0).then((next) => { el.textContent = next; }));
          }
          for (const el of doc.querySelectorAll("[style]")) {
            const css = el.getAttribute("style") || "";
            jobs.push(rewriteArchiveCSS(level, baseDir, css, 0).then((next) => { el.setAttribute("style", next); }));
          }
          await Promise.all(jobs);
          const style = doc.createElement("style");
          style.textContent = previewScrollbarCSS(theme.value);
          (doc.head || doc.documentElement).appendChild(style);
          return "<!doctype html>\n" + doc.documentElement.outerHTML;
        } catch {
          return new TextDecoder("utf-8").decode(bytes);
        }
      }

      async function archiveResourceDataURL(level, baseDir, ref, depth) {
        if (depth > 4) return "";
        const clean = String(ref || "").trim();
        if (!clean || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(clean)) return "";
        let raw = clean.split("#")[0].split("?")[0];
        if (!raw) return "";
        try { raw = decodeURIComponent(raw); } catch { /* keep raw */ }
        const joined = raw.startsWith("/") ? raw.replace(/^\/+/, "") : (baseDir ? baseDir + "/" : "") + raw;
        const targetPath = normalizeArchivePath(joined);
        if (!targetPath) return "";
        const target = level.entries.find((e) => !e.isDir && e.name === targetPath);
        if (!target) return "";
        try {
          const data = await readArchiveEntry(level, target);
          if (/\.css$/i.test(target.name)) {
            const css = await rewriteArchiveCSS(level, archiveDirname(target.name), new TextDecoder("utf-8").decode(data), depth + 1);
            return dataURLFor(new TextEncoder().encode(css), "text/css;charset=utf-8");
          }
          return dataURLFor(data, mimeOf(target.name));
        } catch {
          return "";
        }
      }

      async function rewriteArchiveCSS(level, baseDir, css, depth) {
        if (!css || depth > 4) return css;
        const re = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
        const refs = [];
        let m;
        while ((m = re.exec(css))) refs.push(m[2]);
        const map = new Map();
        for (const ref of refs) {
          if (map.has(ref)) continue;
          const url = await archiveResourceDataURL(level, baseDir, ref, depth + 1);
          if (url) map.set(ref, url);
        }
        return css.replace(re, (whole, quote, ref) => {
          const url = map.get(ref);
          return url ? 'url("' + url + '")' : whole;
        });
      }

      function dataURLFor(bytes, mime) {
        let text = "";
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
          text += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
        }
        return "data:" + (mime || "application/octet-stream") + ";base64," + btoa(text);
      }

      function archiveDirname(name) {
        const s = String(name || "");
        const i = s.lastIndexOf("/");
        return i < 0 ? "" : s.slice(0, i);
      }

      function normalizeArchivePath(path) {
        const out = [];
        for (const part of String(path || "").replace(/\\/g, "/").split("/")) {
          if (!part || part === ".") continue;
          if (part === "..") out.pop();
          else out.push(part);
        }
        return out.join("/");
      }

      function previewScrollbarCSS(themeName) {
        const thumb = themeName === "dark" ? "rgba(255, 255, 255, 0.12)" : "rgba(18, 25, 38, 0.1)";
        return "html{scrollbar-width:thin;scrollbar-color:" + thumb + " transparent}" +
          "::-webkit-scrollbar{width:10px;height:10px}" +
          "::-webkit-scrollbar-thumb{background:" + thumb + ";border-radius:5px;border:3px solid transparent;background-clip:content-box}" +
          "::-webkit-scrollbar-corner{background:transparent}";
      }

      async function downloadArchiveEntry(row) {
        const level = currentArcLevel();
        if (!level || !row || !row.entry) return;
        try {
          const bytes = await readArchiveEntry(level, row.entry);
          const blob = new Blob([bytes], { type: mimeOf(row.base) });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = row.base || "file";
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 10000);
        } catch (e) {
          toast(tt.value.previewFailed, String((e && e.message) || e), "err");
        }
      }

      function downloadCurrent() {
        const pvNow = preview.value;
        if (!pvNow) return;
        if (pvNow.arcEntry) downloadArchiveEntry({ base: pvNow.arcEntry.base, entry: pvNow.arcEntry.entry });
        else downloadEntry(pvNow.entry);
      }

      function cleanArchiveName(name) {
        let n = String(name || "").replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/{2,}/g, "/");
        n = normalizeArchivePath(n);
        return n;
      }

      function isArchiveJunk(name) {
        const n = cleanArchiveName(name);
        if (!n) return true;
        if (n === ".DS_Store" || n.endsWith("/.DS_Store")) return true;
        if (n.startsWith("__MACOSX/")) return true;
        if (n.split("/").some((p) => p.startsWith("._"))) return true;
        return false;
      }

      function gzipUnpackedSize(data) {
        if (!data || data.length < 18) return 0;
        const n = data[data.length - 4] | (data[data.length - 3] << 8) |
          (data[data.length - 2] << 16) | (data[data.length - 1] << 24);
        return n >>> 0;
      }

      function parseTar(bytes) {
        const dec = new TextDecoder("utf-8");
        const cstr = (b, off, len) => {
          let end = off;
          const max = Math.min(b.length, off + len);
          while (end < max && b[end] !== 0) end++;
          return dec.decode(b.subarray(off, end)).trim();
        };
        const out = [];
        let off = 0;
        let longName = "";
        while (off + 512 <= bytes.length) {
          let zero = true;
          for (let i = 0; i < 512; i++) {
            if (bytes[off + i] !== 0) { zero = false; break; }
          }
          if (zero) break;
          const block = bytes.subarray(off, off + 512);
          const size = parseInt(cstr(block, 124, 12) || "0", 8) || 0;
          const type = String.fromCharCode(block[156] || 48);
          const dataOff = off + 512;
          if (type === "L") {
            longName = dec.decode(bytes.subarray(dataOff, dataOff + size)).replace(/\0+$/, "");
            off = dataOff + Math.ceil(size / 512) * 512;
            continue;
          }
          if (type === "x" || type === "g") {
            off = dataOff + Math.ceil(size / 512) * 512;
            continue;
          }
          let name = longName || cstr(block, 0, 100);
          longName = "";
          const prefix = cstr(block, 345, 155);
          if (prefix) name = prefix + "/" + name;
          name = cleanArchiveName(name);
          const isDir = type === "5" || name.endsWith("/");
          const mtime = (parseInt(cstr(block, 136, 12) || "0", 8) || 0) * 1000;
          if (name && !isArchiveJunk(name)) {
            out.push({ name, isDir, size: isDir ? 0 : size, mtime, offset: dataOff });
          }
          off = dataOff + (isDir ? 0 : Math.ceil(size / 512) * 512);
        }
        return out;
      }

      function fitModelObject(THREE, root, camera, controls) {
        const box = new THREE.Box3().setFromObject(root);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z, 0.001);
        root.position.sub(center);
        root.scale.setScalar(2 / maxDim);
        // 按包围球而不是最大边长取景:立方体/斜放的模型才不会被裁掉四角。
        const radius = Math.max(0.001, (size.length() / 2) * (2 / maxDim));
        const fov = (camera.fov * Math.PI) / 180;
        const dist = (radius / Math.sin(fov / 2)) * 1.28;
        // 3/4 视角:正对模型时立方体只会看到一个平面,看不出体积。
        const pos = new THREE.Vector3(0.62, 0.48, 0.82).normalize().multiplyScalar(dist);
        camera.position.copy(pos);
        camera.near = Math.max(0.001, dist / 1000);
        camera.far = Math.max(100, dist * 100);
        camera.updateProjectionMatrix();
        controls.target.set(0, 0, 0);
        controls.update();
        return { pos };
      }

      function disposeObject3D(root) {
        if (!root) return;
        root.traverse((o) => {
          if (o.geometry) { try { o.geometry.dispose(); } catch { /* ignore */ } }
          const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
          for (const m of mats) {
            for (const v of Object.values(m)) {
              if (v && v.isTexture) { try { v.dispose(); } catch { /* ignore */ } }
            }
            try { m.dispose(); } catch { /* ignore */ }
          }
        });
      }

      function resetModelCamera() { if (modelHandle) modelHandle.resetCamera(); }

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

      // ---- PDF.js 阅读器 ----
      function pdfViewerURL(src) {
        if (!src) return "";
        let absolute = src;
        try { absolute = new URL(src, location.href).href; } catch { /* keep as-is */ }
        const q = new URLSearchParams({
          file: absolute,
          locale: String(lang.value || "").toLowerCase().startsWith("zh") ? "zh-CN" : "en-US",
          theme: theme.value === "dark" ? "dark" : "light",
        });
        return "/lib/pdfjs/web/viewer.html?" + q.toString();
      }

      function pdfApplication() {
        const win = pdfFrame.value && pdfFrame.value.contentWindow;
        return win && win.PDFViewerApplication;
      }

      function unbindPdf() {
        if (pdfPollTimer) { clearInterval(pdfPollTimer); pdfPollTimer = 0; }
        if (pdfUnbind) {
          try { pdfUnbind(); } catch { /* ignore */ }
          pdfUnbind = null;
        }
      }

      function onPdfLoad() {
        unbindPdf();
        const bind = () => {
          const app = pdfApplication();
          const viewer = app && app.pdfViewer;
          if (!viewer || !app.eventBus) return false;
          const update = () => {
            if (!preview.value || preview.value.kind !== "pdf") return;
            preview.value.page = viewer.currentPageNumber || 1;
            preview.value.pages = viewer.pagesCount || 0;
            preview.value.pdfScale = viewer.currentScale || 1;
            preview.value.pdfSidebarOpen = !!(app.viewsManager && app.viewsManager.isOpen);
          };
          const events = ["pagesinit", "pagechanging", "scalechanging", "documentloaded", "pagerendered", "sidebarviewchanged"];
          for (const name of events) app.eventBus.on(name, update);
          pdfUnbind = () => {
            for (const name of events) {
              try { app.eventBus.off(name, update); } catch { /* ignore */ }
            }
          };
          update();
          return true;
        };
        if (bind()) return;
        // PDF.js 是 ES module,iframe load 时 viewer 可能还没初始化完。
        let tries = 0;
        pdfPollTimer = setInterval(() => {
          if (bind() || ++tries > 60) {
            if (pdfPollTimer) { clearInterval(pdfPollTimer); pdfPollTimer = 0; }
          }
        }, 100);
      }

      function pdfGo(delta) {
        const app = pdfApplication();
        const viewer = app && app.pdfViewer;
        if (!viewer || !preview.value) return;
        const pages = preview.value.pages || viewer.pagesCount || 1;
        const next = Math.min(pages, Math.max(1, (preview.value.page || viewer.currentPageNumber || 1) + delta));
        viewer.currentPageNumber = next;
        preview.value.page = next;
      }

      function pdfZoom(factor) {
        const app = pdfApplication();
        const viewer = app && app.pdfViewer;
        if (!viewer || !preview.value) return;
        const next = Math.min(8, Math.max(0.2, (viewer.currentScale || 1) * factor));
        viewer.currentScale = next;
        preview.value.pdfScale = next;
      }

      function pdfFit() {
        const app = pdfApplication();
        const viewer = app && app.pdfViewer;
        if (!viewer) return;
        viewer.currentScaleValue = "page-width";
      }

      function pdfThumbnails() {
        const app = pdfApplication();
        const vm = app && app.viewsManager;
        if (!vm || !preview.value) return;
        // SidebarView.THUMBS = 1. 点击「缩略图」时:已打开且就在缩略图视图则关闭;
        // 打开但停在大纲/附件/图层时切回缩略图;未打开则打开。
        if (vm.isOpen && vm.visibleView === 1) {
          vm.close();
        } else {
          if (!vm.isOpen) vm.open();
          if (vm.active !== 1) vm.switchView(1);
        }
        preview.value.pdfSidebarOpen = !!vm.isOpen;
      }

      function pdfSearch() {
        const app = pdfApplication();
        if (!app || !app.findBar) return;
        app.findBar.toggle();
        setTimeout(() => {
          const win = pdfFrame.value && pdfFrame.value.contentWindow;
          const input = win && win.document && win.document.getElementById("findInput");
          if (input) { try { input.focus(); input.select(); } catch { /* ignore */ } }
        }, 80);
      }

      function closePreview() {
        previewToken += 1;
        disposePreviewResources();
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
        e.preventDefault();
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
        // pptx-preview 的幻灯片尺寸在 init 时固定,容器变化后按新比例重挂;
        // 防抖避免拖拽窗口时反复销毁/重建。
        if (preview.value && preview.value.kind === "pptx" && pptxBuf) {
          if (pptxResizeTimer) clearTimeout(pptxResizeTimer);
          pptxResizeTimer = setTimeout(() => {
            pptxResizeTimer = 0;
            if (preview.value && preview.value.kind === "pptx" && pptxHost.value) {
              remountPptx(pptxHost.value, previewToken, false).catch((e) => console.warn("[pptx remount]", e));
            }
          }, 120);
        }
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
        // Office/3D 里横向滑动用于滚动/旋转,不抢成「上一个/下一个」。
        if (["docx", "xlsx", "pptx", "model"].includes(preview.value.kind)) return;
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
          // PPTX/多页 TIFF:左右键翻页;XLSX:左右键交给表格选区;其余类型左右键切换文件。
          if (preview.value.decoded && preview.value.pages > 1) {
            if (e.key === "ArrowLeft") { e.preventDefault(); return decodedGo(-1); }
            if (e.key === "ArrowRight") { e.preventDefault(); return decodedGo(1); }
          } else if (preview.value.kind === "pptx") {
            if (e.key === "ArrowLeft") { e.preventDefault(); return pptxGo(-1); }
            if (e.key === "ArrowRight") { e.preventDefault(); return pptxGo(1); }
          } else if (preview.value.kind === "xlsx") {
            // 由 bindXlsx 的 keydown 处理;这里不再抢方向键。
          } else {
            if (e.key === "ArrowLeft") { e.preventDefault(); return stepPreview(-1); }
            if (e.key === "ArrowRight") { e.preventDefault(); return stepPreview(1); }
          }
          if (preview.value.kind === "image") {
            if (e.key === "+" || e.key === "=") { e.preventDefault(); return zoom(1.25); }
            if (e.key === "-" || e.key === "_") { e.preventDefault(); return zoom(0.8); }
            if (e.key === "0") { e.preventDefault(); return resetZoom(); }
          }
          if (preview.value.kind === "model" && (e.key === "0" || e.key === "r" || e.key === "R")) {
            e.preventDefault();
            return resetModelCamera();
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
        docxHost, xlsxHost, pptxHost, modelCanvas, pdfFrame,
        drawer, searchOpen, searchBox, theme, themeTitle,
        atRoot, crumbs, filtered, previewables, previewIndex, usedPct, quotaClass, connClass, connText, canLink,
        arcRows, arcCrumbs, arcTopCrumb, arcTopTitle, canArcUp, arcSummary, arcTruncated, pdfScalePct, pdfViewerURL, onPdfLoad, pdfThumbnails,
        drawerMode, crumbCompact, tiny, coarse, versionLabel, bucketLabel, rootLabel, currentLabel, capsText,
        fmtSize, fmtTime, iconFor, thumbClass, badgeOf, kindLabel, pathLabel,
        go, goUp, setListMode, reload, open, openPreview, select, onCardClick, onPressStart, cancelPress,
        closePreview, stepPreview, zoom, resetZoom, toggleZoom, onWheel, onImgDown, onImgMove, onImgUp,
        onTouchStart, onTouchEnd, toggleTheme, pptxGo, previewGo, decodedGo, resetModelCamera, downloadArchiveEntry,
        downloadCurrent, arcOpen, arcGoUp, arcGoCrumb, backToArchive, pdfGo, pdfZoom, pdfFit, pdfSearch,
        downloadEntry, askMkdir, renameEntry, deleteEntry, copyLink, openMenu, runMenu,
        pickFiles, onPicked, onDragOver, onDragLeave, onDrop, closeDialog, confirmDialog, toggleLang,
      };
    },
  });

  app.mount("#app");
})();

// Sail 资源库 PDF 预览主题桥接。
// PDF.js 的 viewer 运行在独立文档里,父页面的 CSS 变量传不进来;这里只读取
// 预览 URL 上的 theme 参数,把 color-scheme 和 data-sail-theme 放到根节点,
// 由 sail-pdf.css 负责具体的配色。脚本独立成文件,避免放宽 viewer.html 的 CSP。
(function () {
  try {
    var theme = new URLSearchParams(window.location.search).get("theme");
    theme = theme === "dark" ? "dark" : "light";
    var root = document.documentElement;
    root.dataset.sailTheme = theme;
    root.style.colorScheme = theme;
  } catch (e) {
    /* 主题读取失败时保留 PDF.js 默认配色 */
  }
})();

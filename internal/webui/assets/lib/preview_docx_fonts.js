// DOCX 预览：公文/CJK 字体回退、行高修补（纯函数，可 node:test）。
// 不改 docx-preview vendor；渲染后由 <vanor-file-preview> 调用 patchDocxPreview。

/** 仿宋（GB/T 9704 正文）。Mac 已装名在前，不用宋体冒充。 */
export const DOCX_FONT_FANGSONG = [
  "STFangsong", "华文仿宋", "FangSong", "FangSong_GB2312", "仿宋_GB2312",
];
/** 黑体（一级标题）。 */
export const DOCX_FONT_HEITI = ["黑体", "SimHei", "STHeiti", "Heiti SC"];
/** 楷体（附注）。 */
export const DOCX_FONT_KAITI = [
  "楷体_GB2312", "KaiTi_GB2312", "KaiTi", "STKaiti", "华文楷体", "Kaiti SC",
];
/** 小标宋（红头/标题）。 */
export const DOCX_FONT_XIAOBIAOSONG = [
  "方正小标宋简体", "FZXiaoBiaoSong-B05S", "STZhongsong", "华文中宋", "Songti SC",
];
/** 宋体。 */
export const DOCX_FONT_SONGTI = ["宋体", "SimSun", "STSong", "Songti SC"];

const STACKS = {
  fangsong: DOCX_FONT_FANGSONG,
  heiti: DOCX_FONT_HEITI,
  kaiti: DOCX_FONT_KAITI,
  xiaobiaosong: DOCX_FONT_XIAOBIAOSONG,
  songti: DOCX_FONT_SONGTI,
};

const ALIAS = new Map();
for (const [id, names] of Object.entries(STACKS)) {
  for (const n of names) ALIAS.set(n.toLowerCase(), id);
}
for (const [name, id] of [
  ["仿宋", "fangsong"], ["仿宋体", "fangsong"], ["华文仿宋体", "fangsong"],
  ["楷体", "kaiti"], ["楷体_gb2312", "kaiti"],
  ["方正小标宋", "xiaobiaosong"], ["小标宋", "xiaobiaosong"],
  ["nsimsun", "songti"], ["新宋体", "songti"], ["华文宋体", "songti"], ["stsong", "songti"],
  ["华文黑体", "heiti"], ["heiti tc", "heiti"], ["stheiti", "heiti"],
]) ALIAS.set(name, id);

const LATIN_RE = /^(calibri|cambria(?: math)?|arial|times(?: new roman)?|georgia|helvetica(?: neue)?|segoe ui|aptos|tahoma|verdana|trebuchet ms|comic sans ms|courier new|consolas|candara|constantia|corbel|garamond|palatino(?: linotype)?|century(?: gothic)?|goudy|minion)$/i;
/** 多族共用的回退名：单独出现才触发族，已展开列表里不再另开一族。 */
const SHARED_FALLBACK = new Set(["songti sc", "simsun", "stsong", "noto serif cjk sc"]);
const MINOR_H_RE = /--docx-minorHAnsi-font/i;
const MAJOR_H_RE = /--docx-majorHAnsi-font/i;
const MINOR_E_RE = /--docx-minorEastAsia-font/i;
const MAJOR_E_RE = /--docx-majorEastAsia-font/i;
const MINOR_E_VAR = "var(--docx-minorEastAsia-font)";
const MAJOR_E_VAR = "var(--docx-majorEastAsia-font)";
const AT_LEAST_RE = /line-height\s*:\s*calc\s*\(\s*100%\s*\+\s*([0-9.]+)pt\s*\)/gi;

/** 拆 font-family 列表（引号、var()）。 */
export function parseFontFamily(value) {
  const s = String(value || "").trim();
  if (!s) return [];
  const parts = [];
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /[\s,]/.test(s[i])) i++;
    if (i >= s.length) break;
    if (s.startsWith("var(", i)) {
      let depth = 0;
      let j = i;
      for (; j < s.length; j++) {
        if (s[j] === "(") depth++;
        else if (s[j] === ")") {
          depth--;
          if (depth === 0) {
            j++;
            break;
          }
        }
      }
      parts.push(s.slice(i, j).trim());
      i = j;
      continue;
    }
    if (s[i] === "'" || s[i] === "\"") {
      const q = s[i];
      let j = i + 1;
      let buf = "";
      while (j < s.length && s[j] !== q) {
        if (s[j] === "\\") {
          buf += s[j + 1] || "";
          j += 2;
          continue;
        }
        buf += s[j++];
      }
      parts.push(buf);
      i = j + 1;
      continue;
    }
    let j = i;
    while (j < s.length && s[j] !== ",") j++;
    parts.push(s.slice(i, j).trim());
    i = j;
  }
  return parts.filter(Boolean);
}

function quoteFont(name) {
  const n = String(name || "").trim();
  if (!n) return "";
  if (/^var\(/i.test(n)) return n;
  if ((n.startsWith("\"") && n.endsWith("\"")) || (n.startsWith("'") && n.endsWith("'"))) return n;
  if (/[\s]/.test(n) || /[#$'()[\]{}]/.test(n)) return `"${n.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
  return n;
}

function insertAfter(arr, index, item) {
  arr.splice(index + 1, 0, item);
}

/**
 * 按公文/CJK 族补全 font-family；西文或 theme 拉丁变量后接东亚回退。
 * 可重复调用不重复追加。
 */
export function expandDocxFontFamily(value) {
  const parts = parseFontFamily(value);
  if (!parts.length) return "";

  const have = new Set(parts.map((p) => p.toLowerCase()));
  const out = parts.slice();
  const triggered = new Set();
  let hasLatin = false;
  let hasCjk = false;
  let hasMinorH = false;
  let hasMajorH = false;
  const alreadyGeneric = parts.some((p) => /^(serif|sans-serif)$/i.test(p));

  for (const p of parts) {
    if (MINOR_H_RE.test(p)) hasMinorH = true;
    if (MAJOR_H_RE.test(p)) hasMajorH = true;
    if (MINOR_E_RE.test(p) || MAJOR_E_RE.test(p)) hasCjk = true;
    const key = p.toLowerCase();
    const stack = ALIAS.get(key);
    if (stack) {
      if (SHARED_FALLBACK.has(key) && (hasCjk || alreadyGeneric || parts.length > 1)) continue;
      triggered.add(stack);
      hasCjk = true;
    } else if (LATIN_RE.test(p)) {
      hasLatin = true;
    }
  }

  if (hasMinorH && !parts.some((p) => MINOR_E_RE.test(p))) {
    const i = out.findIndex((p) => MINOR_H_RE.test(p));
    insertAfter(out, i, MINOR_E_VAR);
    have.add(MINOR_E_VAR.toLowerCase());
    triggered.add("fangsong");
    hasCjk = true;
  }
  if (hasMajorH && !parts.some((p) => MAJOR_E_RE.test(p))) {
    const i = out.findIndex((p) => MAJOR_H_RE.test(p));
    insertAfter(out, i, MAJOR_E_VAR);
    have.add(MAJOR_E_VAR.toLowerCase());
    triggered.add("xiaobiaosong");
    hasCjk = true;
  }
  if (!hasCjk && (hasLatin || parts.length)) triggered.add("fangsong");

  const append = (name) => {
    const key = name.toLowerCase();
    if (have.has(key)) return;
    have.add(key);
    out.push(name);
  };
  for (const id of triggered) {
    for (const n of STACKS[id]) append(n);
  }
  if (triggered.size) {
    const generic = triggered.has("heiti") && triggered.size === 1 ? "sans-serif" : "serif";
    append(generic);
  }
  return out.map(quoteFont).join(", ");
}

function isFangsongFace(name) {
  const n = String(name || "").trim();
  if (!n) return false;
  return ALIAS.get(n.toLowerCase()) === "fangsong" || /^仿宋/.test(n);
}

/** 西文 + 宋体（docDefaults）且默认段落是仿宋时，把宋体换成默认段落字体。 */
export function preferFangsongOverDocDefaults(value, defaultFont) {
  if (!isFangsongFace(defaultFont)) return String(value || "");
  const parts = parseFontFamily(value);
  let hasLatin = false;
  let hasSongti = false;
  let hasOtherCjk = false;
  for (const p of parts) {
    if (LATIN_RE.test(p)) hasLatin = true;
    const stack = ALIAS.get(p.toLowerCase());
    if (stack === "songti" || p === "宋体") hasSongti = true;
    else if (stack && stack !== "songti") hasOtherCjk = true;
  }
  if (!hasLatin || !hasSongti || hasOtherCjk) return String(value || "");
  return parts.map((p) => (
    ALIAS.get(p.toLowerCase()) === "songti" || p === "宋体" ? defaultFont : p
  )).join(", ");
}

/** 只改 font-family 声明。defaultFont 为仿宋时改写 docDefaults 宋体。 */
export function rewriteDocxFontCss(css, defaultFont = "") {
  return String(css || "").replace(/font-family\s*:\s*([^;}{]+)/gi, (_, val) => {
    const imp = /\s*!important\s*$/i.test(val);
    let raw = val.replace(/\s*!important\s*$/i, "").trim();
    raw = preferFangsongOverDocDefaults(raw, defaultFont);
    return `font-family: ${expandDocxFontFamily(raw)}${imp ? " !important" : ""}`;
  });
}

/** Word atLeast `calc(100% + Npt)` → `Npt`；已有倍数/固定值不改。 */
export function normalizeDocxLineHeight(value) {
  const s = String(value || "").trim();
  const m = /^calc\(\s*100%\s*\+\s*([0-9.]+)pt\s*\)$/i.exec(s);
  return m ? `${m[1]}pt` : s;
}

export function rewriteDocxLineHeight(css) {
  return String(css || "").replace(AT_LEAST_RE, "line-height: $1pt");
}

/** text-align:justify 补 inter-ideograph；已有则不动。 */
export function rewriteDocxJustify(css) {
  return String(css || "")
    .replace(/text-align\s*:\s*justify\s*;(?!\s*text-justify)/gi, "text-align: justify; text-justify: inter-ideograph;")
    .replace(/text-align\s*:\s*justify(?=\s*})/gi, "text-align: justify; text-justify: inter-ideograph");
}

/** styles.xml 默认段落（w:default="1"）的 eastAsia / ascii。 */
export function defaultParagraphFont(stylesXml) {
  const s = String(stylesXml || "");
  for (const m of s.matchAll(/<(?:\w+:)?style\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?style>/gi)) {
    const attrs = m[1];
    const body = m[2];
    const type = /(?:\w+:)?type="([^"]+)"/.exec(attrs)?.[1];
    const def = /(?:\w+:)?default="([^"]+)"/.exec(attrs)?.[1];
    if (type !== "paragraph" || def !== "1") continue;
    const rfonts = /<(?:\w+:)?rFonts\b([^>]*)\/?>/i.exec(body);
    if (!rfonts) return "";
    const a = rfonts[1];
    const east = /(?:\w+:)?eastAsia="([^"]*)"/.exec(a)?.[1] || "";
    const ascii = /(?:\w+:)?ascii="([^"]*)"/.exec(a)?.[1] || "";
    return (east || ascii).trim();
  }
  return "";
}

/** theme1.xml → { major, minor } 东亚 typeface。 */
export function themeEastAsiaFonts(xml) {
  const s = String(xml || "");
  const eaIn = (tag) => {
    const block = new RegExp(`<(?:\\w+:)?${tag}\\b[\\s\\S]*?</(?:\\w+:)?${tag}>`, "i").exec(s);
    if (!block) return "";
    const m = /<(?:\w+:)?ea\b[^>]*\btypeface="([^"]*)"/i.exec(block[0]);
    return m ? String(m[1] || "").trim() : "";
  };
  return { major: eaIn("majorFont"), minor: eaIn("minorFont") };
}

function rewriteStyleSheet(css, defaultFont = "") {
  return rewriteDocxJustify(rewriteDocxLineHeight(rewriteDocxFontCss(css, defaultFont)));
}

function themeVarsCss(theme = {}) {
  const major = expandDocxFontFamily(theme.major || DOCX_FONT_XIAOBIAOSONG[0]);
  const minor = expandDocxFontFamily(theme.minor || theme.defaultParagraph || DOCX_FONT_FANGSONG[0]);
  return `.docx{--docx-majorEastAsia-font:${major};--docx-minorEastAsia-font:${minor}}`;
}

function defaultParagraphCss(font) {
  if (!font) return "";
  return `section.docx{font-family:${expandDocxFontFamily(font)}}`;
}

/**
 * 改写已渲染树：style 标签、行内 font/line-height、注入东亚 theme 变量。
 * 默认段落字体插在树末尾，压过库的 docDefaults 宋体。
 * @param {ParentNode} root
 * @param {{ major?: string, minor?: string, defaultParagraph?: string } | string} [theme]
 */
export function patchDocxPreview(root, theme) {
  if (!root) return;
  const fonts = typeof theme === "string" ? themeEastAsiaFonts(theme) : (theme || {});
  const defaultFont = fonts.defaultParagraph || "";
  const styles = root.querySelectorAll?.("style") || [];
  for (const el of styles) {
    if (el.getAttribute?.("data-vanor-docx-theme") != null) continue;
    if (el.getAttribute?.("data-vanor-docx-default") != null) continue;
    const next = rewriteStyleSheet(el.textContent || "", defaultFont);
    if (next !== el.textContent) el.textContent = next;
  }
  const inlines = root.querySelectorAll?.("[style]") || [];
  for (const el of inlines) {
    const st = el.style;
    if (!st) continue;
    if (st.fontFamily) {
      st.fontFamily = expandDocxFontFamily(preferFangsongOverDocDefaults(st.fontFamily, defaultFont));
    }
    if (st.lineHeight) st.lineHeight = normalizeDocxLineHeight(st.lineHeight);
    if (String(st.textAlign || "").toLowerCase() === "justify" && !st.textJustify) {
      st.textJustify = "inter-ideograph";
    }
  }
  if (typeof document === "undefined" || !document.createElement) return;
  if (!root.querySelector?.("style[data-vanor-docx-theme]")) {
    const st = document.createElement("style");
    st.setAttribute("data-vanor-docx-theme", "");
    st.textContent = themeVarsCss(fonts);
    root.insertBefore(st, root.firstChild);
  }
  const defCss = defaultParagraphCss(defaultFont);
  if (defCss && !root.querySelector?.("style[data-vanor-docx-default]")) {
    const st = document.createElement("style");
    st.setAttribute("data-vanor-docx-default", "");
    st.textContent = defCss;
    root.appendChild(st);
  }
}

/** 页宽超出可用宽时缩到刚好放下；已能放下则 1。 */
export function docxFitZoom(pageWidth, availWidth) {
  const page = Number(pageWidth) || 0;
  const avail = Number(availWidth) || 0;
  if (page <= 0 || avail <= 0) return 1;
  if (page <= avail) return 1;
  return Math.max(0.2, Math.round((avail / page) * 1000) / 1000);
}

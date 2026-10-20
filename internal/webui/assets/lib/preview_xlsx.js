// ExcelJS workbook → 只读 HTML 网格（纯函数，可 node:test；不依赖浏览器 DOM）。
// <vanor-file-preview> 挂载时调用 workbookToSheets / sheetsToHtml。

import { evaluateWorkbookFormulas } from "./preview_xlsx_formula.js";

export const XLSX_MAX_ROWS = 1000;
export const XLSX_MAX_COLS = 64;
export const XLSX_COL_HEAD_W = 40;
export const XLSX_ROW_HEAD_H = 24;
export const XLSX_FX_H_MIN = 28;
export const XLSX_FX_H_MAX = 160;
export const XLSX_FX_H_DEFAULT = 28;
/** Excel 默认列宽（字符）。 */
export const XLSX_DEFAULT_COL_WIDTH = 8.43;
/** Calibri 11 近似 maxDigitWidth。 */
export const XLSX_MDW = 7;

/**
 * Excel 列宽（字符）→ 像素（Calibri 11，MDW=7）。
 * width < 1: floor(w * (MDW+5))；否则 floor(w * MDW + 5)。默认 8.43 → 64。
 */
export function excelColWidthToPx(w) {
  const width = Number(w) > 0 ? Number(w) : XLSX_DEFAULT_COL_WIDTH;
  const mdw = XLSX_MDW;
  if (width < 1) return Math.max(0, Math.floor(width * (mdw + 5)));
  return Math.floor(width * mdw + 5);
}

/** Excel 标准 indexed 调色板（64）。 */
export const XLSX_INDEXED_COLORS = [
  "000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF",
  "000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF",
  "800000", "008000", "000080", "808000", "800080", "008080", "C0C0C0", "808080",
  "9999FF", "993366", "FFFFCC", "CCFFFF", "660066", "FF8080", "0066CC", "CCCCFF",
  "000080", "FF00FF", "FFFF00", "00FFFF", "800080", "800000", "008080", "0000FF",
  "00CCFF", "CCFFFF", "CCFFCC", "FFFF99", "99CCFF", "FF99CC", "CC99FF", "FFCC99",
  "3366FF", "33CCCC", "99CC00", "FFCC00", "FF9900", "FF6600", "666699", "969696",
  "003366", "339966", "003300", "333300", "993300", "993366", "333399", "333333",
];

/** OOXML EMU → CSS px（96dpi：914400/96 = 9525）。 */
export function emuToPx(emu) {
  const n = Number(emu) || 0;
  return n / 9525;
}

function bytesToDataUrl(bytes, mime) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (typeof Buffer !== "undefined") {
    return `data:${mime || "image/png"};base64,${Buffer.from(u8).toString("base64")}`;
  }
  const chunk = 0x8000;
  let bin = "";
  for (let i = 0; i < u8.length; i += chunk) {
    bin += String.fromCharCode.apply(null, u8.subarray(i, i + chunk));
  }
  return `data:${mime || "image/png"};base64,${btoa(bin)}`;
}

function sumRange(arr, endExclusive) {
  let s = 0;
  const n = Math.max(0, Math.min(arr.length, endExclusive));
  for (let i = 0; i < n; i++) s += arr[i] || 0;
  return s;
}

/**
 * 将 collectXlsxImages 结果挂到 workbookToSheets 产出的 grids 上。
 * @param {object[]} sheets
 * @param {Array<{ sheetName?: string, sheetIndex?: number, images?: object[] }>} groups
 */
export function mergeSheetImages(sheets, groups) {
  if (!sheets?.length || !groups?.length) return sheets;
  const byName = new Map();
  for (const g of groups) {
    if (g?.sheetName != null) byName.set(String(g.sheetName), g);
  }
  for (let i = 0; i < sheets.length; i++) {
    const sheet = sheets[i];
    const hit = byName.get(sheet.name) || groups.find((g) => g.sheetIndex === i) || groups[i];
    const raw = hit?.images || [];
    sheet.images = raw.filter((img) => {
      const r0 = Number(img.r0) || 0;
      const c0 = Number(img.c0) || 0;
      return r0 < sheet.rows && c0 < sheet.cols;
    });
  }
  return sheets;
}

function imageBoxCss(grid, img) {
  const colW = grid.colWidths || [];
  const rowH = grid.rowHeights || [];
  const r0 = Number(img.r0) || 0;
  const c0 = Number(img.c0) || 0;
  const r1 = Number(img.r1) || r0;
  const c1 = Number(img.c1) || c0;
  const left = sumRange(colW, c0) + emuToPx(img.dx0);
  const top = sumRange(rowH, r0) + emuToPx(img.dy0);
  let width;
  let height;
  if (img.extCx > 0 || img.extCy > 0) {
    width = Math.max(1, emuToPx(img.extCx));
    height = Math.max(1, emuToPx(img.extCy));
  } else {
    const right = sumRange(colW, c1) + emuToPx(img.dx1);
    const bottom = sumRange(rowH, r1) + emuToPx(img.dy1);
    width = Math.max(1, right - left);
    height = Math.max(1, bottom - top);
  }
  return {
    left: Math.round(left * 100) / 100,
    top: Math.round(top * 100) / 100,
    width: Math.round(width * 100) / 100,
    height: Math.round(height * 100) / 100,
  };
}

/** Excel ARGB（AARRGGBB）→ CSS #rrggbb 或 rgba。 */
export function argbToCss(argb) {
  if (argb == null || argb === "") return "";
  let s = String(argb).replace(/^#/, "").toUpperCase();
  if (s.length === 6) s = `FF${s}`;
  if (s.length !== 8 || !/^[0-9A-F]{8}$/.test(s)) return "";
  const a = parseInt(s.slice(0, 2), 16) / 255;
  const r = parseInt(s.slice(2, 4), 16);
  const g = parseInt(s.slice(4, 6), 16);
  const b = parseInt(s.slice(6, 8), 16);
  if (a >= 0.999) return `#${s.slice(2).toLowerCase()}`;
  return `rgba(${r},${g},${b},${Math.round(a * 1000) / 1000})`;
}

function hexToRgb(hex) {
  const s = String(hex || "").replace(/^#/, "");
  if (s.length !== 6) return null;
  return {
    r: parseInt(s.slice(0, 2), 16),
    g: parseInt(s.slice(2, 4), 16),
    b: parseInt(s.slice(4, 6), 16),
  };
}

function rgbToHex(r, g, b) {
  const h = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** Office tint：正数变亮、负数变暗。 */
export function applyTint(hex, tint) {
  const rgb = hexToRgb(hex);
  if (!rgb) return "";
  const t = Number(tint) || 0;
  if (!t) return rgbToHex(rgb.r, rgb.g, rgb.b);
  const adj = (c) => (t < 0 ? c * (1 + t) : c * (1 - t) + 255 * t);
  return rgbToHex(adj(rgb.r), adj(rgb.g), adj(rgb.b));
}

/**
 * 从 theme1 XML 抽取 scheme 色（lt1/dk1/lt2/dk2/accent1-6/hlink/folHlink）。
 * theme index（ExcelJS）：0=lt1,1=dk1,2=lt2,3=dk2,4=accent1… 
 */
export function parseThemeColors(themeXml) {
  const text = String(themeXml || "");
  const clrScheme = text.match(/<(?:[a-z0-9]+:)?clrScheme\b[^>]*>([\s\S]*?)<\/(?:[a-z0-9]+:)?clrScheme>/i)?.[1] || "";
  const order = ["lt1", "dk1", "lt2", "dk2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"];
  const byName = {};
  for (const name of order) {
    const block = clrScheme.match(new RegExp(`<(?:[a-z0-9]+:)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:[a-z0-9]+:)?${name}>`, "i"))?.[1] || "";
    const srgb = block.match(/srgbClr[^>]*\bval\s*=\s*"([0-9A-Fa-f]{6})"/i)?.[1];
    const sys = block.match(/sysClr[^>]*\blastClr\s*=\s*"([0-9A-Fa-f]{6})"/i)?.[1]
      || block.match(/sysClr[^>]*\bval\s*=\s*"(window|windowText)"/i)?.[1];
    if (srgb) byName[name] = `#${srgb.toLowerCase()}`;
    else if (sys === "window") byName[name] = "#ffffff";
    else if (sys === "windowText") byName[name] = "#000000";
    else if (sys && /^[0-9a-fA-F]{6}$/.test(sys)) byName[name] = `#${sys.toLowerCase()}`;
  }
  // 缺省 Office 主题回退
  const defaults = {
    lt1: "#ffffff", dk1: "#000000", lt2: "#e7e6e6", dk2: "#44546a",
    accent1: "#4472c4", accent2: "#ed7d31", accent3: "#a5a5a5", accent4: "#ffc000",
    accent5: "#5b9bd5", accent6: "#70ad47", hlink: "#0563c1", folHlink: "#954f72",
  };
  const scheme = order.map((n) => byName[n] || defaults[n]);
  return { scheme, byName };
}

/** 从 ExcelJS workbook 提取 themeCtx。 */
export function themeCtxFromWorkbook(workbook) {
  try {
    const xml = workbook?._themes?.theme1 || workbook?.themes?.theme1 || "";
    if (xml) return parseThemeColors(xml);
  } catch {
    /* ignore */
  }
  return parseThemeColors("");
}

/**
 * ExcelJS color 对象 → CSS 色。
 * @param {{ argb?: string, theme?: number, tint?: number, indexed?: number }} color
 * @param {{ scheme?: string[] }|null} themeCtx
 */
export function resolveExcelColor(color, themeCtx = null) {
  if (!color || typeof color !== "object") return "";
  if (color.argb) return argbToCss(color.argb);
  if (color.indexed != null) {
    const idx = Number(color.indexed);
    if (idx === 64 || idx === 65) return ""; // auto / system
    const hex = XLSX_INDEXED_COLORS[idx];
    if (!hex) return "";
    return applyTint(`#${hex}`, color.tint);
  }
  if (color.theme != null) {
    const scheme = themeCtx?.scheme || parseThemeColors("").scheme;
    const base = scheme[Number(color.theme)] || "";
    if (!base) return "";
    return applyTint(base, color.tint);
  }
  return "";
}

/** 列号 1-based → A, B, …, AA。 */
export function colLetters(n) {
  let x = Number(n) || 0;
  if (x < 1) return "";
  let s = "";
  while (x > 0) {
    x -= 1;
    s = String.fromCharCode(65 + (x % 26)) + s;
    x = Math.floor(x / 26);
  }
  return s;
}

/** 解析 "A1:B2" → { r1, c1, r2, c2 }（1-based）。 */
export function parseA1Range(ref) {
  const m = String(ref || "").match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i);
  if (!m) return null;
  const col = (letters) => {
    let n = 0;
    for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n;
  };
  return {
    r1: +m[2],
    c1: col(m[1]),
    r2: +m[4],
    c2: col(m[3]),
  };
}

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** ExcelJS cell.value → 展示文本。 */
export function cellDisplayText(value) {
  if (value == null || value === "") return "";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "string") return value;
  if (value instanceof Date) {
    const y = value.getFullYear();
    const mo = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    const h = value.getHours();
    const mi = value.getMinutes();
    const se = value.getSeconds();
    if (!h && !mi && !se) return `${y}-${mo}-${d}`;
    return `${y}-${mo}-${d} ${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
  }
  if (typeof value === "object") {
    if (value.richText && Array.isArray(value.richText)) {
      return value.richText.map((t) => t.text || "").join("");
    }
    if (value.text != null) return String(value.text);
    if (value.result != null) return cellDisplayText(value.result);
    if (value.formula != null && value.result === undefined) return `=${value.formula}`;
    if (value.sharedFormula != null) return "";
    if (value.error != null) return String(value.error);
    if (value.hyperlink != null) return cellDisplayText(value.text ?? value.hyperlink);
  }
  return String(value);
}

/** 细网格已由 CSS 画右/下边；仅在粗线/虚线/显式色时再写边框，避免叠成粗线。 */
function borderSideCss(side, themeCtx) {
  if (!side || side.style === "none" || !side.style) return "";
  const st = String(side.style);
  const isThin = st === "thin" || st === "hair";
  const isDash = /dashed|dotted|dashDot/i.test(st);
  const isThick = st === "thick" || st === "medium" || st === "mediumDashed" || st === "mediumDotted";
  const color = resolveExcelColor(side.color, themeCtx);
  // 普通细实线交给网格线，避免邻格叠加变粗
  if (isThin && !isDash && (!color || color === "#000000" || color === "#000")) return "";
  if (!isThick && !isDash && !color) return "";
  const w = isThick ? "2px" : "1px";
  const style =
    st.includes("dash") || st === "mediumDashed" ? "dashed"
      : st.includes("dot") || st === "mediumDotted" ? "dotted"
        : "solid";
  return `${w} ${style} ${color || "#000"}`;
}

/** ExcelJS style → CSS 声明字符串（不含引号转义）。 */
export function styleToCss(style, themeCtx = null) {
  if (!style) return "";
  const parts = [];
  const font = style.font || {};
  if (font.bold) parts.push("font-weight:700");
  if (font.italic) parts.push("font-style:italic");
  if (font.strike) parts.push("text-decoration:line-through");
  if (font.underline) parts.push("text-decoration:underline");
  if (font.size) parts.push(`font-size:${font.size}pt`);
  if (font.name) {
    parts.push(
      `font-family:${JSON.stringify(String(font.name))},Calibri,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif`,
    );
  }
  const fc = resolveExcelColor(font.color, themeCtx);
  if (fc) parts.push(`color:${fc}`);
  const fill = style.fill;
  if (fill?.type === "pattern" && (fill.pattern === "solid" || fill.fgColor)) {
    const bg = resolveExcelColor(fill.fgColor, themeCtx) || resolveExcelColor(fill.bgColor, themeCtx);
    if (bg) parts.push(`background:${bg}`);
  } else if (fill?.fgColor) {
    const bg = resolveExcelColor(fill.fgColor, themeCtx);
    if (bg) parts.push(`background:${bg}`);
  }
  const al = style.alignment || {};
  if (al.horizontal) {
    const map = { left: "left", center: "center", right: "right", justify: "justify", fill: "left", distributed: "justify" };
    if (map[al.horizontal]) parts.push(`text-align:${map[al.horizontal]}`);
  }
  if (al.vertical) {
    const map = { top: "top", middle: "middle", center: "middle", bottom: "bottom" };
    if (map[al.vertical]) parts.push(`vertical-align:${map[al.vertical]}`);
  }
  // 换行由 .pv-xlsx-wrap 控制，避免 style 里写 pre-wrap 导致默认软折行
  const indent = Number(al.indent) || 0;
  if (indent > 0) parts.push(`padding-left:${indent * 10}px`);
  const b = style.border || {};
  for (const [k, cssKey] of [["top", "border-top"], ["bottom", "border-bottom"], ["left", "border-left"], ["right", "border-right"]]) {
    const css = borderSideCss(b[k], themeCtx);
    if (css) parts.push(`${cssKey}:${css}`);
  }
  return parts.join(";");
}

/** 1-based 行列 → A1。 */
export function formatCellRef(row, col) {
  const r = Number(row) || 0;
  const c = Number(col) || 0;
  if (r < 1 || c < 1) return "";
  return `${colLetters(c)}${r}`;
}

function richRunHtml(run, themeCtx) {
  const text = escapeHtml(run?.text ?? "");
  if (!text) return "";
  const font = run.font || {};
  const parts = [];
  if (font.bold) parts.push("font-weight:700");
  if (font.italic) parts.push("font-style:italic");
  if (font.strike) parts.push("text-decoration:line-through");
  if (font.underline) parts.push("text-decoration:underline");
  if (font.size) parts.push(`font-size:${font.size}pt`);
  const c = resolveExcelColor(font.color, themeCtx);
  if (c) parts.push(`color:${c}`);
  if (!parts.length) return text;
  return `<span style="${escapeHtml(parts.join(";"))}">${text}</span>`;
}

/** 单元格内容 HTML（富文本 / 链接 / 纯文本）。 */
export function cellInnerHtml(cell, themeCtx = null) {
  const value = cell?.value;
  if (value && typeof value === "object" && Array.isArray(value.richText)) {
    return value.richText.map((r) => richRunHtml(r, themeCtx)).join("");
  }
  let text = "";
  try {
    if (cell?.text != null && String(cell.text) !== "") text = String(cell.text);
    else text = cellDisplayText(value);
  } catch {
    text = "";
  }
  const href = value && typeof value === "object" ? value.hyperlink : null;
  if (href && typeof href === "string" && /^(https?:|mailto:)/i.test(href)) {
    return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(text || href)}</a>`;
  }
  return escapeHtml(text);
}

function readFreeze(sheet) {
  try {
    const views = sheet.views || sheet.model?.views || [];
    const v = views[0] || {};
    const state = String(v.state || "").toLowerCase();
    if (state !== "frozen" && state !== "frozenSplit") {
      // ExcelJS sometimes only sets ySplit/xSplit
      if (!(v.ySplit > 0 || v.xSplit > 0)) return { ySplit: 0, xSplit: 0 };
    }
    return {
      ySplit: Math.max(0, Number(v.ySplit) || 0),
      xSplit: Math.max(0, Number(v.xSplit) || 0),
    };
  } catch {
    return { ySplit: 0, xSplit: 0 };
  }
}

function readTabColor(sheet, themeCtx) {
  try {
    const tc = sheet.properties?.tabColor || sheet.model?.properties?.tabColor;
    return resolveExcelColor(tc, themeCtx) || "";
  } catch {
    return "";
  }
}

/**
 * 将 ExcelJS Worksheet 转为网格快照。
 * @param {object} sheet ExcelJS worksheet
 * @param {{ maxRows?: number, maxCols?: number, themeCtx?: object }} [opts]
 */
export function worksheetToGrid(sheet, opts = {}) {
  const maxRows = Number(opts.maxRows) > 0 ? Number(opts.maxRows) : XLSX_MAX_ROWS;
  const maxCols = Number(opts.maxCols) > 0 ? Number(opts.maxCols) : XLSX_MAX_COLS;
  const themeCtx = opts.themeCtx || null;
  const name = sheet.name || "Sheet";

  let dimR = 0;
  let dimC = 0;
  try {
    if (sheet.dimensions) {
      dimR = sheet.dimensions.bottom || 0;
      dimC = sheet.dimensions.right || 0;
    }
  } catch {
    /* ignore */
  }
  if (!dimR || !dimC) {
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      dimR = Math.max(dimR, rowNumber);
      row.eachCell({ includeEmpty: false }, (_cell, colNumber) => {
        dimC = Math.max(dimC, colNumber);
      });
    });
  }
  dimR = Math.max(dimR, 1);
  dimC = Math.max(dimC, 1);

  const truncated = dimR > maxRows || dimC > maxCols;
  const rows = Math.min(dimR, maxRows);
  const cols = Math.min(dimC, maxCols);
  const freeze = readFreeze(sheet);

  const mergeMap = new Map(); // "r,c" -> { rowspan, colspan } | "skip"
  const mergeRefs = sheet.model?.merges || [];
  for (const ref of mergeRefs) {
    const range = typeof ref === "string" ? parseA1Range(ref) : null;
    if (!range) continue;
    const { r1, c1, r2, c2 } = range;
    if (r1 > rows || c1 > cols) continue;
    const rr2 = Math.min(r2, rows);
    const cc2 = Math.min(c2, cols);
    for (let r = r1; r <= rr2; r++) {
      for (let c = c1; c <= cc2; c++) {
        if (r === r1 && c === c1) mergeMap.set(`${r},${c}`, { rowspan: rr2 - r1 + 1, colspan: cc2 - c1 + 1 });
        else mergeMap.set(`${r},${c}`, "skip");
      }
    }
  }

  const colHidden = [];
  const colWidths = [];
  for (let c = 1; c <= cols; c++) {
    const col = sheet.getColumn(c);
    const hidden = !!(col?.hidden || col?.state === "hidden");
    colHidden.push(hidden);
    const w = col?.width;
    colWidths.push(hidden ? 0 : excelColWidthToPx(w));
  }
  const rowHidden = [];
  const rowHeights = [];
  for (let r = 1; r <= rows; r++) {
    const excelRow = sheet.getRow(r);
    const hidden = !!(excelRow?.hidden);
    rowHidden.push(hidden);
    const h = excelRow?.height;
    // pt → px @96dpi
    rowHeights.push(hidden ? 0 : (h && h > 0 ? Math.round(h * (96 / 72)) : 20));
  }

  const cells = [];
  for (let r = 1; r <= rows; r++) {
    const rowArr = [];
    const excelRow = sheet.getRow(r);
    for (let c = 1; c <= cols; c++) {
      const merge = mergeMap.get(`${r},${c}`);
      if (merge === "skip") {
        rowArr.push({ skip: true, r, c });
        continue;
      }
      const cell = excelRow.getCell(c);
      let text = "";
      try {
        if (cell.text != null && String(cell.text) !== "") text = String(cell.text);
        else text = cellDisplayText(cell.value);
      } catch {
        text = "";
      }
      const wrap = !!(cell.style?.alignment?.wrapText) || /[\r\n]/.test(text);
      let formula = "";
      if (cell.value && typeof cell.value === "object") {
        if (cell.value.formula != null) formula = "=" + String(cell.value.formula).replace(/^=/, "");
        else if (cell.value.sharedFormula != null) formula = "=" + String(cell.value.sharedFormula);
      }
      let css = styleToCss(cell.style, themeCtx);
      const num = typeof cell.value === "number" ? cell.value
        : (typeof cell.value === "object" && typeof cell.value?.result === "number" ? cell.value.result : null);
      if (num != null && !cell.style?.alignment?.horizontal && !/(?:^|;)text-align:/.test(css)) {
        css = css ? `${css};text-align:right` : "text-align:right";
      }
      const bg = (css.match(/(?:^|;)background:([^;]+)/) || [])[1] || "";
      const color = (css.match(/(?:^|;)color:([^;]+)/) || [])[1] || "";
      rowArr.push({
        text,
        formula,
        html: cellInnerHtml(cell, themeCtx),
        css,
        bg,
        color,
        wrap,
        rowspan: merge?.rowspan || 1,
        colspan: merge?.colspan || 1,
        r,
        c,
        num,
      });
    }
    cells.push(rowArr);
  }

  return {
    name,
    rows,
    cols,
    cells,
    colWidths,
    rowHeights,
    colHidden,
    rowHidden,
    freezeY: Math.min(freeze.ySplit, rows),
    freezeX: Math.min(freeze.xSplit, cols),
    tabColor: readTabColor(sheet, themeCtx),
    truncated,
    totalRows: dimR,
    totalCols: dimC,
  };
}

/** ExcelJS Workbook → sheet 网格列表。 */
export function workbookToSheets(workbook, opts = {}) {
  // 很多导出器不写公式缓存值;先算一遍,避免把 "=SUM(A1:A9)" 当文本显示。
  if (opts.calculateFormulas !== false) {
    try {
      evaluateWorkbookFormulas(workbook);
    } catch (e) {
      console.warn("[xlsx formulas]", e);
    }
  }
  const themeCtx = opts.themeCtx || themeCtxFromWorkbook(workbook);
  const sheets = [];
  workbook.eachSheet((sheet) => {
    sheets.push(worksheetToGrid(sheet, { ...opts, themeCtx }));
  });
  return sheets;
}

function freezeOffsets(grid) {
  const fy = grid.freezeY || 0;
  const fx = grid.freezeX || 0;
  const rowTops = [];
  let acc = XLSX_ROW_HEAD_H;
  for (let r = 0; r < fy; r++) {
    rowTops.push(acc);
    acc += grid.rowHeights[r] || 0;
  }
  const colLefts = [];
  acc = XLSX_COL_HEAD_W;
  for (let c = 0; c < fx; c++) {
    colLefts.push(acc);
    acc += grid.colWidths[c] || 0;
  }
  return { rowTops, colLefts };
}

/** 单表网格 → HTML 片段（table；有浮动图时外包叠层）。 */
export function gridToTableHtml(grid) {
  const { rowTops, colLefts } = freezeOffsets(grid);
  let tableWidth = XLSX_COL_HEAD_W;
  for (const w of grid.colWidths || []) tableWidth += w || 0;
  const colgroup = grid.colWidths.map((w, i) =>
    `<col style="width:${w}px;min-width:${w}px"${grid.colHidden?.[i] ? ' class="pv-xlsx-hcol"' : ""}>`).join("");
  let head = "<tr><th class=\"pv-xlsx-corner\"></th>";
  for (let c = 1; c <= grid.cols; c++) {
    const freeze = c <= (grid.freezeX || 0);
    const left = freeze ? colLefts[c - 1] : null;
    const cls = freeze ? "pv-xlsx-colh pv-xlsx-fc" : "pv-xlsx-colh";
    const st = left != null ? ` style="left:${left}px"` : "";
    const hide = grid.colHidden?.[c - 1] ? " pv-xlsx-hcol" : "";
    head += `<th class="${cls}${hide}" data-c="${c}"${st}>${colLetters(c)}</th>`;
  }
  head += "</tr>";

  let body = "";
  for (let r = 0; r < grid.rows; r++) {
    const h = grid.rowHeights[r] || 20;
    const rowHide = grid.rowHidden?.[r];
    const freezeR = r < (grid.freezeY || 0);
    const top = freezeR ? rowTops[r] : null;
    const trCls = [
      rowHide ? "pv-xlsx-hrow" : "",
      freezeR ? "pv-xlsx-fr" : "",
    ].filter(Boolean).join(" ");
    const trSt = [
      `height:${h}px`,
      `max-height:${h}px`,
      top != null ? `top:${top}px` : "",
    ].filter(Boolean).join(";");
    body += `<tr${trCls ? ` class="${trCls}"` : ""} style="${trSt}"><th class="pv-xlsx-rowh${freezeR ? " pv-xlsx-fr" : ""}" data-r="${r + 1}" style="height:${h}px;max-height:${h}px${top != null ? `;top:${top}px` : ""}">${r + 1}</th>`;
    for (let c = 0; c < grid.cols; c++) {
      const cell = grid.cells[r][c];
      if (!cell || cell.skip) continue;
      const rowSpan = cell.rowspan || 1;
      const colSpan = cell.colspan || 1;
      const rs = rowSpan > 1 ? ` rowspan="${rowSpan}"` : "";
      const cs = colSpan > 1 ? ` colspan="${colSpan}"` : "";
      let cellH = 0;
      for (let i = 0; i < rowSpan; i++) cellH += grid.rowHeights[r + i] || 20;
      const freezeC = c < (grid.freezeX || 0);
      const classes = [
        freezeR ? "pv-xlsx-fr" : "",
        freezeC ? "pv-xlsx-fc" : "",
        grid.colHidden?.[c] ? "pv-xlsx-hcol" : "",
      ].filter(Boolean).join(" ");
      const styles = [
        `height:${cellH}px`,
        `max-height:${cellH}px`,
      ];
      if (cell.css) styles.push(cell.css);
      if (freezeC) styles.push(`left:${colLefts[c]}px`);
      if (freezeR && top != null) styles.push(`top:${top}px`);
      const st = ` style="${escapeHtml(styles.join(";"))}"`;
      const cls = classes ? ` class="${classes}"` : "";
      const inner = cell.html != null ? cell.html : escapeHtml(cell.text);
      const clipCls = cell.wrap ? "pv-xlsx-clip pv-xlsx-wrap" : "pv-xlsx-clip";
      body += `<td${rs}${cs}${cls}${st} data-r="${r + 1}" data-c="${c + 1}">` +
        `<div class="${clipCls}" style="height:${cellH}px;max-height:${cellH}px">${inner}</div></td>`;
    }
    body += "</tr>";
  }
  const table =
    `<table class="pv-xlsx-table" data-rows="${grid.rows}" data-cols="${grid.cols}"` +
    ` style="width:${tableWidth}px;min-width:${tableWidth}px">` +
    `<colgroup><col style="width:${XLSX_COL_HEAD_W}px;min-width:${XLSX_COL_HEAD_W}px">${colgroup}</colgroup>` +
    `<thead>${head}</thead><tbody>${body}</tbody></table>`;

  const imgs = Array.isArray(grid.images) ? grid.images : [];
  if (!imgs.length) return `<div class="pv-xlsx-sheet">${table}</div>`;

  let overlay = "";
  for (const img of imgs) {
    if (!img?.bytes) continue;
    const box = imageBoxCss(grid, img);
    const src = bytesToDataUrl(img.bytes, img.mime);
    overlay +=
      `<img src="${escapeHtml(src)}" alt=""` +
      ` style="left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px">`;
  }
  return (
    `<div class="pv-xlsx-sheet">${table}` +
    (overlay
      ? `<div class="pv-xlsx-imgs" style="left:${XLSX_COL_HEAD_W}px;top:${XLSX_ROW_HEAD_H}px" aria-hidden="true">${overlay}</div>`
      : "") +
    `</div>`
  );
}

/** 多表 → 完整 HTML（含 tab 栏占位，由调用方切换 active）。 */
export function sheetsToHtml(sheets, activeIndex = 0) {
  if (!sheets?.length) return `<div class="pv-xlsx-empty"></div>`;
  const idx = Math.min(Math.max(0, activeIndex), sheets.length - 1);
  const tabs = sheets.map((s, i) => {
    const tabSt = s.tabColor ? ` style="--pv-tab:${escapeHtml(s.tabColor)}"` : "";
    return `<button type="button" class="pv-xlsx-tab${i === idx ? " active" : ""}${s.tabColor ? " has-color" : ""}" data-sheet="${i}"${tabSt}>${escapeHtml(s.name)}</button>`;
  }).join("");
  const panels = sheets.map((s, i) =>
    `<div class="pv-xlsx-panel${i === idx ? " active" : ""}" data-sheet="${i}">${gridToTableHtml(s)}</div>`).join("");
  const trunc = sheets.some((s) => s.truncated);
  const note = trunc
    ? `<div class="pv-xlsx-note" data-truncated="1"></div>`
    : "";
  const fx =
    `<div class="pv-xlsx-fx" aria-label="formula bar" style="height:${XLSX_FX_H_DEFAULT}px">` +
    `<div class="pv-xlsx-fx-body">` +
    `<div class="pv-xlsx-fx-name" data-fx-name></div>` +
    `<div class="pv-xlsx-fx-val" data-fx-val></div>` +
    `</div>` +
    `<div class="pv-xlsx-fx-resize" data-fx-resize title="Drag to resize"></div>` +
    `</div>`;
  return (
    `<div class="pv-xlsx" tabindex="0">${note}${fx}` +
    `<div class="pv-xlsx-scroll">${panels}</div>` +
    `<div class="pv-xlsx-tabs">${tabs}</div>` +
    `<div class="pv-xlsx-status" data-xlsx-status></div>` +
    `</div>`
  );
}

/**
 * 表格坐标系命中：相对 table 左上的像素 → 1-based 行列。
 * @param {number} x
 * @param {number} y
 * @param {{ colWidths?: number[], rowHeights?: number[], cols?: number, rows?: number }} grid
 * @param {{ colHeadW?: number, rowHeadH?: number, colWidths?: number[], rowHeights?: number[] }} [metrics]
 */
export function hitTestGrid(x, y, grid, metrics = null) {
  const colHeadW = metrics?.colHeadW > 0 ? metrics.colHeadW : XLSX_COL_HEAD_W;
  const rowHeadH = metrics?.rowHeadH > 0 ? metrics.rowHeadH : XLSX_ROW_HEAD_H;
  const colW = metrics?.colWidths?.length ? metrics.colWidths : (grid.colWidths || []);
  const rowH = metrics?.rowHeights?.length ? metrics.rowHeights : (grid.rowHeights || []);
  const cols = grid.cols || colW.length;
  const rows = grid.rows || rowH.length;
  if (!(Number.isFinite(x) && Number.isFinite(y))) return null;
  if (x < 0 || y < 0) return null;

  if (x < colHeadW && y < rowHeadH) return { kind: "corner" };

  let c = 0;
  if (x >= colHeadW) {
    let acc = colHeadW;
    c = cols;
    for (let i = 0; i < cols; i++) {
      acc += colW[i] || 0;
      if (x < acc) {
        c = i + 1;
        break;
      }
    }
    if (x >= acc && cols > 0) c = cols;
  }

  let r = 0;
  if (y >= rowHeadH) {
    let acc = rowHeadH;
    r = rows;
    for (let i = 0; i < rows; i++) {
      acc += rowH[i] || 0;
      if (y < acc) {
        r = i + 1;
        break;
      }
    }
    if (y >= acc && rows > 0) r = rows;
  }

  if (x < colHeadW && r >= 1) return { kind: "row", r };
  if (y < rowHeadH && c >= 1) return { kind: "col", c };
  if (r >= 1 && c >= 1) return { kind: "cell", r, c };
  return null;
}

/** 将 skip 合并格钳到该合并区左上角（或原格）。 */
export function clampToOriginCell(grid, r, c) {
  const rr = Math.max(1, Math.min(grid.rows, r));
  const cc = Math.max(1, Math.min(grid.cols, c));
  const cell = grid.cells?.[rr - 1]?.[cc - 1];
  if (cell && !cell.skip) return { r: rr, c: cc };
  for (let i = 0; i < rr; i++) {
    for (let j = 0; j < cc; j++) {
      const hit = grid.cells?.[i]?.[j];
      if (!hit || hit.skip) continue;
      const rs = hit.rowspan || 1;
      const cs = hit.colspan || 1;
      if (rr >= i + 1 && rr <= i + rs && cc >= j + 1 && cc <= j + cs) {
        return { r: i + 1, c: j + 1 };
      }
    }
  }
  return { r: rr, c: cc };
}

function normRange(range, grid) {
  let r0 = Math.min(range.r0, range.r1);
  let r1 = Math.max(range.r0, range.r1);
  let c0 = Math.min(range.c0, range.c1);
  let c1 = Math.max(range.c0, range.c1);
  r0 = Math.max(1, Math.min(grid.rows, r0));
  r1 = Math.max(1, Math.min(grid.rows, r1));
  c0 = Math.max(1, Math.min(grid.cols, c0));
  c1 = Math.max(1, Math.min(grid.cols, c1));
  return { r0, c0, r1, c1 };
}

function cellAt(grid, r, c) {
  return grid.cells?.[r - 1]?.[c - 1] || null;
}

/** 选区 → TSV（合并格仅左上有值）。 */
export function selectionToTsv(grid, range) {
  const { r0, c0, r1, c1 } = normRange(range, grid);
  const lines = [];
  for (let r = r0; r <= r1; r++) {
    if (grid.rowHidden?.[r - 1]) continue;
    const cols = [];
    for (let c = c0; c <= c1; c++) {
      if (grid.colHidden?.[c - 1]) continue;
      const cell = cellAt(grid, r, c);
      if (!cell || cell.skip) cols.push("");
      else cols.push(String(cell.text ?? "").replace(/\t/g, " ").replace(/\r?\n/g, " "));
    }
    lines.push(cols.join("\t"));
  }
  return lines.join("\n");
}

/** 选区 → 简易 HTML table（带 bgcolor/color）。 */
export function selectionToHtml(grid, range) {
  const { r0, c0, r1, c1 } = normRange(range, grid);
  let html = "<table>";
  for (let r = r0; r <= r1; r++) {
    if (grid.rowHidden?.[r - 1]) continue;
    html += "<tr>";
    for (let c = c0; c <= c1; c++) {
      if (grid.colHidden?.[c - 1]) continue;
      const cell = cellAt(grid, r, c);
      if (!cell || cell.skip) {
        html += "<td></td>";
        continue;
      }
      const st = [];
      if (cell.bg) st.push(`background:${cell.bg}`);
      if (cell.color) st.push(`color:${cell.color}`);
      const attr = st.length ? ` style="${escapeHtml(st.join(";"))}"` : "";
      html += `<td${attr}>${escapeHtml(cell.text ?? "")}</td>`;
    }
    html += "</tr>";
  }
  html += "</table>";
  return html;
}

/** 选区数值汇总（求和/计数/平均）。 */
export function selectionStats(grid, range) {
  const { r0, c0, r1, c1 } = normRange(range, grid);
  let sum = 0;
  let n = 0;
  let cellCount = 0;
  for (let r = r0; r <= r1; r++) {
    if (grid.rowHidden?.[r - 1]) continue;
    for (let c = c0; c <= c1; c++) {
      if (grid.colHidden?.[c - 1]) continue;
      const cell = cellAt(grid, r, c);
      if (!cell || cell.skip) continue;
      cellCount += 1;
      if (typeof cell.num === "number" && Number.isFinite(cell.num)) {
        sum += cell.num;
        n += 1;
      }
    }
  }
  return {
    sum,
    count: cellCount,
    numericCount: n,
    avg: n ? sum / n : null,
  };
}

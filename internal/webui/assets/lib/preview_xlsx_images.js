// OOXML drawings → 浮动图片锚点（纯函数；不依赖 DOMParser / ExcelJS getImages）。
// xlsx = zip；运行时由 preview 用 JSZip 填 entries，测试可手造 Map。

export const XLSX_IMG_MAX_PER_SHEET = 40;
export const XLSX_IMG_MAX_BYTES = 8 * 1024 * 1024;

function normPath(p) {
  return String(p || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
}

function getEntry(entries, path) {
  const key = normPath(path);
  if (entries instanceof Map) {
    if (entries.has(key)) return entries.get(key);
    for (const [k, v] of entries) {
      if (normPath(k) === key) return v;
    }
    return undefined;
  }
  if (entries[key] != null) return entries[key];
  for (const k of Object.keys(entries || {})) {
    if (normPath(k) === key) return entries[k];
  }
  return undefined;
}

function asText(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (v instanceof Uint8Array) return new TextDecoder("utf-8").decode(v);
  if (ArrayBuffer.isView(v)) return new TextDecoder("utf-8").decode(v);
  return String(v);
}

function asBytes(v) {
  if (v == null) return null;
  if (v instanceof Uint8Array) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  if (typeof v === "string") return new TextEncoder().encode(v);
  return null;
}

function dirname(p) {
  const s = normPath(p);
  const i = s.lastIndexOf("/");
  return i < 0 ? "" : s.slice(0, i);
}

function resolveRel(baseFile, target) {
  let t = String(target || "").replace(/\\/g, "/");
  if (!t) return "";
  if (t.startsWith("/")) return normPath(t);
  // OOXML rels often use ../media/image1.png relative to xl/drawings/
  const base = dirname(baseFile);
  const parts = (base ? `${base}/` : "") + t;
  const stack = [];
  for (const seg of parts.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") stack.pop();
    else stack.push(seg);
  }
  return stack.join("/");
}

function mimeFromPath(path) {
  const ext = normPath(path).split(".").pop()?.toLowerCase() || "";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  if (ext === "bmp") return "image/bmp";
  return "image/png";
}

/** 解析 *.rels → Map<rId, { target, type }>；Target 相对 partPath 所在目录。 */
function parseRelsForPart(xml, partPath) {
  // partPath e.g. xl/drawings/drawing1.xml → Rel targets relative to dirname(partPath)
  const map = new Map();
  const text = asText(xml);
  const re = /<[^>]*\bRelationship\b[^>]*>/gi;
  let m;
  while ((m = re.exec(text))) {
    const tag = m[0];
    const id = tag.match(/\bId\s*=\s*"([^"]+)"/i)?.[1];
    const target = tag.match(/\bTarget\s*=\s*"([^"]+)"/i)?.[1];
    const type = tag.match(/\bType\s*=\s*"([^"]+)"/i)?.[1] || "";
    if (!id || !target) continue;
    map.set(id, { target: resolveRel(partPath, target), type });
  }
  return map;
}

function relsPathFor(partPath) {
  const p = normPath(partPath);
  const dir = dirname(p);
  const base = p.slice(dir.length ? dir.length + 1 : 0);
  return dir ? `${dir}/_rels/${base}.rels` : `_rels/${base}.rels`;
}

function parseWorkbookSheets(workbookXml) {
  const sheets = [];
  const text = asText(workbookXml);
  const re = /<[^>]*\bsheet\b[^>]*>/gi;
  let m;
  while ((m = re.exec(text))) {
    const tag = m[0];
    if (/\bsheets\b/i.test(tag) && !/\bname\s*=/i.test(tag)) continue;
    const name = tag.match(/\bname\s*=\s*"([^"]*)"/i)?.[1];
    const rid = tag.match(/\br:id\s*=\s*"([^"]+)"/i)?.[1] || tag.match(/\bId\s*=\s*"([^"]+)"/i)?.[1];
    if (name != null && rid) sheets.push({ name, rid });
  }
  return sheets;
}

function tagInner(xml, tagName) {
  const re = new RegExp(`<(?:[\\w.]+:)?${tagName}\\b[^>]*>([\\s\\S]*?)</(?:[\\w.]+:)?${tagName}>`, "i");
  return xml.match(re)?.[1] || "";
}

function childInt(xml, tagName, fallback = 0) {
  const re = new RegExp(`<(?:[\\w.]+:)?${tagName}\\b[^>]*>([^<]*)</(?:[\\w.]+:)?${tagName}>`, "i");
  const m = xml.match(re);
  if (!m) return fallback;
  const n = Number(String(m[1]).trim());
  return Number.isFinite(n) ? n : fallback;
}

function parseMarker(block) {
  return {
    col: childInt(block, "col", 0),
    colOff: childInt(block, "colOff", 0),
    row: childInt(block, "row", 0),
    rowOff: childInt(block, "rowOff", 0),
  };
}

function findBlipEmbed(picXml) {
  const m =
    picXml.match(/\br:embed\s*=\s*"([^"]+)"/i) ||
    picXml.match(/\bembed\s*=\s*"([^"]+)"/i);
  return m?.[1] || "";
}

function parseAnchors(drawingXml, drawingRels, entries, opts) {
  const maxPer = Number(opts?.maxPerSheet) > 0 ? Number(opts.maxPerSheet) : XLSX_IMG_MAX_PER_SHEET;
  const maxBytes = Number(opts?.maxBytes) > 0 ? Number(opts.maxBytes) : XLSX_IMG_MAX_BYTES;
  const text = asText(drawingXml);
  const images = [];
  const anchorRe = /<(?:[\w.]+:)?(twoCellAnchor|oneCellAnchor)\b[^>]*>([\s\S]*?)<\/(?:[\w.]+:)?\1>/gi;
  let m;
  while ((m = anchorRe.exec(text))) {
    if (images.length >= maxPer) break;
    const kind = m[1].toLowerCase();
    const body = m[2];
    if (!/<(?:[\w.]+:)?pic\b/i.test(body)) continue;
    const pic = tagInner(body, "pic") || body;
    const embed = findBlipEmbed(pic);
    if (!embed) continue;
    const rel = drawingRels.get(embed);
    const mediaPath = rel?.target;
    if (!mediaPath) continue;
    const bytes = asBytes(getEntry(entries, mediaPath));
    if (!bytes || bytes.byteLength === 0 || bytes.byteLength > maxBytes) continue;

    const fromXml = tagInner(body, "from");
    const from = parseMarker(fromXml);
    let r1 = from.row;
    let c1 = from.col;
    let dx1 = 0;
    let dy1 = 0;
    let extCx = 0;
    let extCy = 0;
    if (kind === "twocellanchor") {
      const to = parseMarker(tagInner(body, "to"));
      r1 = to.row;
      c1 = to.col;
      dx1 = to.colOff;
      dy1 = to.rowOff;
    } else {
      const extTag = body.match(/<(?:[\w.]+:)?ext\b[^>]*>/i)?.[0] || "";
      extCx = Number(extTag.match(/\bcx\s*=\s*"(\d+)"/i)?.[1] || 0);
      extCy = Number(extTag.match(/\bcy\s*=\s*"(\d+)"/i)?.[1] || 0);
    }

    images.push({
      r0: from.row,
      c0: from.col,
      r1,
      c1,
      dx0: from.colOff,
      dy0: from.rowOff,
      dx1,
      dy1,
      extCx,
      extCy,
      mime: mimeFromPath(mediaPath),
      bytes,
    });
  }
  return images;
}

/**
 * 从 xlsx zip entries 收集各表浮动图片。
 * @param {Map<string, string|Uint8Array>|Record<string, string|Uint8Array>} entries
 * @param {{ maxPerSheet?: number, maxBytes?: number }} [opts]
 * @returns {Array<{ sheetName: string, sheetIndex: number, images: object[] }>}
 */
export function collectXlsxImages(entries, opts = {}) {
  try {
    const wbXml = getEntry(entries, "xl/workbook.xml");
    if (wbXml == null) return [];
    const sheetMetas = parseWorkbookSheets(wbXml);
    if (!sheetMetas.length) return [];

    const wbRels = parseRelsForPart(getEntry(entries, "xl/_rels/workbook.xml.rels"), "xl/workbook.xml");
    const out = [];

    for (let i = 0; i < sheetMetas.length; i++) {
      const meta = sheetMetas[i];
      const sheetRel = wbRels.get(meta.rid);
      const sheetPath = sheetRel?.target;
      if (!sheetPath) {
        out.push({ sheetName: meta.name, sheetIndex: i, images: [] });
        continue;
      }
      const sheetRels = parseRelsForPart(getEntry(entries, relsPathFor(sheetPath)), sheetPath);
      let drawingPath = "";
      for (const { target, type } of sheetRels.values()) {
        if (/\/drawing/i.test(type) || /drawings\//i.test(target)) {
          drawingPath = target;
          break;
        }
      }
      if (!drawingPath) {
        out.push({ sheetName: meta.name, sheetIndex: i, images: [] });
        continue;
      }
      const drawingXml = getEntry(entries, drawingPath);
      const drawingRelsRaw = getEntry(entries, relsPathFor(drawingPath));
      const drawingRels = parseRelsForPart(drawingRelsRaw, drawingPath);
      const images = drawingXml ? parseAnchors(drawingXml, drawingRels, entries, opts) : [];
      out.push({ sheetName: meta.name, sheetIndex: i, images });
    }
    return out;
  } catch {
    return [];
  }
}

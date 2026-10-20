// ExcelJS 不会计算公式:很多导出工具只写 <f> 而不写缓存值,直接渲染会把
// "=SUM(C5:F5)" 当成文本显示。这里在生成网格前做一次轻量计算,保留原公式
// 供公式栏展示,只把结果写回单元格。
//
// 目标不是复刻整个 Excel 函数库,而是覆盖资源库里最常见的计算:四则运算、
// 括号/百分比、跨表引用、区域、SUM/AVERAGE/COUNT/IF/ROUND/VLOOKUP 等。
// 遇到不支持的函数或循环引用时保持原公式不动,让用户至少能看到公式本身。

const MAX_RANGE_CELLS = 200000;

const ERR = {
  DIV0: "#DIV/0!",
  NAME: "#NAME?",
  NUM: "#NUM!",
  REF: "#REF!",
  VALUE: "#VALUE!",
  NA: "#N/A",
};

class FormulaError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function fail(code) {
  throw new FormulaError(code);
}

function normalizeSheetName(name) {
  let s = String(name == null ? "" : name).trim();
  if (s.startsWith("'") && s.endsWith("'")) s = s.slice(1, -1).replace(/''/g, "'");
  return s.toLowerCase();
}

function colToNum(letters) {
  let n = 0;
  for (const ch of String(letters || "").toUpperCase()) {
    const v = ch.charCodeAt(0) - 64;
    if (v < 1 || v > 26) return 0;
    n = n * 26 + v;
  }
  return n;
}

function cellKey(r, c) {
  return r + "," + c;
}

function rangeCells(r1, c1, r2, c2) {
  const rr1 = Math.min(r1, r2);
  const rr2 = Math.max(r1, r2);
  const cc1 = Math.min(c1, c2);
  const cc2 = Math.max(c1, c2);
  return { r1: rr1, c1: cc1, r2: rr2, c2: cc2, count: (rr2 - rr1 + 1) * (cc2 - cc1 + 1) };
}

function readSimpleRef(src, at) {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d+)/.exec(src.slice(at));
  if (!m) return null;
  return {
    end: at + m[0].length,
    r: Number(m[2]),
    c: colToNum(m[1]),
  };
}

function tokenize(src, currentSheet) {
  const tokens = [];
  const n = src.length;
  let i = 0;
  const isIdentStart = (ch) => /[A-Za-z_$\u4e00-\u9fff]/.test(ch);
  const isIdentPart = (ch) => /[A-Za-z0-9_.$\u4e00-\u9fff]/.test(ch);

  while (i < n) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }

    if (ch === '"') {
      let j = i + 1;
      let value = "";
      let closed = false;
      while (j < n) {
        if (src[j] === '"') {
          if (src[j + 1] === '"') { value += '"'; j += 2; continue; }
          j++;
          closed = true;
          break;
        }
        value += src[j++];
      }
      if (!closed) fail(ERR.VALUE);
      tokens.push({ type: "str", value });
      i = j;
      continue;
    }

    if (ch === "'") {
      let j = i + 1;
      let name = "";
      let closed = false;
      while (j < n) {
        if (src[j] === "'") {
          if (src[j + 1] === "'") { name += "'"; j += 2; continue; }
          j++;
          closed = true;
          break;
        }
        name += src[j++];
      }
      if (!closed || src[j] !== "!") fail(ERR.NAME);
      const ref = readSimpleRef(src, j + 1);
      if (!ref) fail(ERR.REF);
      let end = ref.end;
      let r2 = ref.r;
      let c2 = ref.c;
      if (src[end] === ":") {
        const ref2 = readSimpleRef(src, end + 1);
        if (!ref2) fail(ERR.REF);
        r2 = ref2.r;
        c2 = ref2.c;
        end = ref2.end;
      }
      tokens.push({ type: "ref", sheet: name, r1: ref.r, c1: ref.c, r2, c2 });
      i = end;
      continue;
    }

    if (ch === "#") {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9/!?]/.test(src[j])) j++;
      tokens.push({ type: "err", value: src.slice(i, j).toUpperCase() });
      i = j;
      continue;
    }

    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(src[i + 1] || ""))) {
      const m = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i));
      if (!m) fail(ERR.VALUE);
      tokens.push({ type: "num", value: Number(m[0]) });
      i += m[0].length;
      continue;
    }

    if (isIdentStart(ch)) {
      const start = i;
      let j = i;
      if (src[j] === "$") j++;
      const lettersStart = j;
      while (j < n && /[A-Za-z]/.test(src[j])) j++;
      const letters = src.slice(lettersStart, j);
      let k = j;
      if (src[k] === "$") k++;
      const digitsStart = k;
      while (k < n && /[0-9]/.test(src[k])) k++;
      // 像 A1 / $A$1 这样的引用;LOG10( 这种名字后面紧跟 '(' 的按函数处理。
      if (letters && letters.length <= 3 && k > digitsStart && src[k] !== "(") {
        let end = k;
        let r2 = Number(src.slice(digitsStart, k));
        let c2 = colToNum(letters);
        if (src[end] === ":") {
          const ref2 = readSimpleRef(src, end + 1);
          if (ref2) {
            r2 = ref2.r;
            c2 = ref2.c;
            end = ref2.end;
          }
        }
        tokens.push({
          type: "ref",
          sheet: currentSheet,
          r1: Number(src.slice(digitsStart, k)),
          c1: colToNum(letters),
          r2,
          c2,
        });
        i = end;
        continue;
      }

      j = start;
      while (j < n && isIdentPart(src[j])) j++;
      const name = src.slice(start, j);
      if (src[j] === "!") {
        const ref = readSimpleRef(src, j + 1);
        if (!ref) fail(ERR.REF);
        let end = ref.end;
        let r2 = ref.r;
        let c2 = ref.c;
        if (src[end] === ":") {
          const ref2 = readSimpleRef(src, end + 1);
          if (ref2) {
            r2 = ref2.r;
            c2 = ref2.c;
            end = ref2.end;
          }
        }
        tokens.push({ type: "ref", sheet: name, r1: ref.r, c1: ref.c, r2, c2 });
        i = end;
        continue;
      }
      if (src[j] === "(") {
        tokens.push({ type: "func", name: name.toUpperCase() });
        i = j;
        continue;
      }
      tokens.push({ type: "name", name: name.toUpperCase() });
      i = j;
      continue;
    }

    const two = src.slice(i, i + 2);
    if (two === "<=" || two === ">=" || two === "<>") {
      tokens.push({ type: "op", value: two });
      i += 2;
      continue;
    }
    if ("+-*/^&=<>%(),;:".includes(ch)) {
      tokens.push({ type: "op", value: ch });
      i++;
      continue;
    }
    fail(ERR.VALUE);
  }
  tokens.push({ type: "eof" });
  return tokens;
}

function flattenValue(value, out = []) {
  if (value == null) {
    out.push(value);
  } else if (value.__range) {
    if (!value._values) {
      if (value.count > MAX_RANGE_CELLS) fail(ERR.NUM);
      const rows = [];
      for (let r = value.r1; r <= value.r2; r++) {
        const row = [];
        for (let c = value.c1; c <= value.c2; c++) row.push(value.evaluator.valueOf(value.sheet, r, c));
        rows.push(row);
      }
      value._values = rows;
    }
    for (const row of value._values) for (const v of row) flattenValue(v, out);
  } else if (Array.isArray(value)) {
    for (const v of value) flattenValue(v, out);
  } else {
    out.push(value);
  }
  return out;
}

function firstValue(value) {
  if (value && value.__range) {
    const vals = flattenValue(value);
    return vals.length ? vals[0] : 0;
  }
  if (Array.isArray(value)) return firstValue(value[0]);
  return value;
}

function toNumber(value) {
  const v = firstValue(value);
  if (v == null || v === "") return 0;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v instanceof Date) return (v.getTime() - Date.UTC(1899, 11, 30)) / 86400000;
  if (typeof v === "string") {
    const s = v.trim().replace(/,/g, "");
    if (s === "") return 0;
    const n = Number(s);
    if (Number.isNaN(n)) fail(ERR.VALUE);
    return n;
  }
  fail(ERR.VALUE);
}

function toText(value) {
  const v = firstValue(value);
  if (v == null) return "";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

function toBool(value) {
  const v = firstValue(value);
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return v !== "";
  return !!v;
}

function numericValues(args) {
  const out = [];
  for (const v of flattenValue(args)) {
    if (typeof v === "number" && Number.isFinite(v)) out.push(v);
    else if (typeof v === "boolean") out.push(v ? 1 : 0);
  }
  return out;
}

function compareValues(a, b) {
  const x = firstValue(a);
  const y = firstValue(b);
  if (typeof x === "number" && typeof y === "number") return x === y ? 0 : x < y ? -1 : 1;
  const xs = toText(x);
  const ys = toText(y);
  if (xs === ys) return 0;
  return xs < ys ? -1 : 1;
}

function roundTo(n, digits, mode) {
  const d = Math.trunc(toNumber(digits));
  const p = Math.pow(10, d);
  const x = n * p;
  if (!Number.isFinite(x)) fail(ERR.NUM);
  let y;
  if (mode === "up") y = Math.ceil(Math.abs(x)) * Math.sign(x);
  else if (mode === "down") y = Math.floor(Math.abs(x)) * Math.sign(x);
  else y = Math.sign(x) * Math.round(Math.abs(x));
  return y / p;
}

function criteriaMatcher(criteria) {
  if (criteria instanceof RegExp) return (v) => criteria.test(toText(v));
  const raw = toText(criteria);
  const m = /^(<=|>=|<>|=|<|>)?(.*)$/.exec(raw);
  const op = m[1] || "=";
  const operand = m[2];
  const n = operand.trim() === "" ? NaN : Number(operand);
  return (value) => {
    if (op === "=") {
      if (Number.isFinite(n)) return toNumber(value) === n;
      return toText(value).toLowerCase() === operand.toLowerCase();
    }
    if (op === "<>") {
      if (Number.isFinite(n)) return toNumber(value) !== n;
      return toText(value).toLowerCase() !== operand.toLowerCase();
    }
    const cmp = Number.isFinite(n) ? toNumber(value) - n : compareValues(value, operand);
    if (op === "<") return cmp < 0;
    if (op === ">") return cmp > 0;
    if (op === "<=") return cmp <= 0;
    if (op === ">=") return cmp >= 0;
    return false;
  };
}

function rangeMatrix(value) {
  if (!value || !value.__range) {
    const vals = flattenValue(value);
    return [vals];
  }
  if (!value._values) flattenValue(value);
  return value._values || [];
}

function callFunction(name, args) {
  const fn = String(name || "").toUpperCase().replace(/^_XLFN\./, "");
  switch (fn) {
    case "SUM": return numericValues(args).reduce((a, b) => a + b, 0);
    case "PRODUCT": {
      const vals = numericValues(args);
      return vals.length ? vals.reduce((a, b) => a * b, 1) : 0;
    }
    case "AVERAGE": {
      const vals = numericValues(args);
      if (!vals.length) fail(ERR.DIV0);
      return vals.reduce((a, b) => a + b, 0) / vals.length;
    }
    case "MIN": {
      const vals = numericValues(args);
      return vals.length ? Math.min(...vals) : 0;
    }
    case "MAX": {
      const vals = numericValues(args);
      return vals.length ? Math.max(...vals) : 0;
    }
    case "COUNT": return numericValues(args).length;
    case "COUNTA": return flattenValue(args).filter((v) => v != null && v !== "").length;
    case "MEDIAN": {
      const vals = numericValues(args).sort((a, b) => a - b);
      if (!vals.length) fail(ERR.NUM);
      const mid = Math.floor(vals.length / 2);
      return vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
    }
    case "ABS": return Math.abs(toNumber(args[0]));
    case "SIGN": return Math.sign(toNumber(args[0]));
    case "INT": return Math.floor(toNumber(args[0]));
    case "TRUNC": {
      const n = toNumber(args[0]);
      const d = args.length > 1 ? Math.trunc(toNumber(args[1])) : 0;
      const p = Math.pow(10, d);
      return Math.trunc(n * p) / p;
    }
    case "ROUND": return roundTo(toNumber(args[0]), args[1], "half");
    case "ROUNDUP": return roundTo(toNumber(args[0]), args[1], "up");
    case "ROUNDDOWN": return roundTo(toNumber(args[0]), args[1], "down");
    case "CEILING": {
      const n = toNumber(args[0]);
      const sig = args.length > 1 ? toNumber(args[1]) : 1;
      return sig === 0 ? 0 : Math.ceil(n / sig) * sig;
    }
    case "FLOOR": {
      const n = toNumber(args[0]);
      const sig = args.length > 1 ? toNumber(args[1]) : 1;
      return sig === 0 ? 0 : Math.floor(n / sig) * sig;
    }
    case "MOD": {
      const n = toNumber(args[0]);
      const d = toNumber(args[1]);
      if (d === 0) fail(ERR.DIV0);
      return ((n % d) + d) % d;
    }
    case "POWER": return Math.pow(toNumber(args[0]), toNumber(args[1]));
    case "SQRT": {
      const n = toNumber(args[0]);
      if (n < 0) fail(ERR.NUM);
      return Math.sqrt(n);
    }
    case "EXP": return Math.exp(toNumber(args[0]));
    case "LN": {
      const n = toNumber(args[0]);
      if (n <= 0) fail(ERR.NUM);
      return Math.log(n);
    }
    case "LOG10": {
      const n = toNumber(args[0]);
      if (n <= 0) fail(ERR.NUM);
      return Math.log10(n);
    }
    case "LOG": {
      const n = toNumber(args[0]);
      const base = args.length > 1 ? toNumber(args[1]) : 10;
      if (n <= 0 || base <= 0 || base === 1) fail(ERR.NUM);
      return Math.log(n) / Math.log(base);
    }
    case "IF": return toBool(args[0]) ? args[1] : (args.length > 2 ? args[2] : false);
    case "IFERROR": return args[0];
    case "IFNA": return args[0];
    case "AND": return flattenValue(args).every(toBool);
    case "OR": return flattenValue(args).some(toBool);
    case "NOT": return !toBool(args[0]);
    case "TRUE": return true;
    case "FALSE": return false;
    case "CONCAT":
    case "CONCATENATE": return flattenValue(args).map(toText).join("");
    case "LEN": return toText(args[0]).length;
    case "LEFT": {
      const s = toText(args[0]);
      const n = args.length > 1 ? Math.max(0, Math.trunc(toNumber(args[1]))) : 1;
      return s.slice(0, n);
    }
    case "RIGHT": {
      const s = toText(args[0]);
      const n = args.length > 1 ? Math.max(0, Math.trunc(toNumber(args[1]))) : 1;
      return n === 0 ? "" : s.slice(-n);
    }
    case "MID": {
      const s = toText(args[0]);
      const start = Math.max(1, Math.trunc(toNumber(args[1])));
      const n = Math.max(0, Math.trunc(toNumber(args[2])));
      return s.slice(start - 1, start - 1 + n);
    }
    case "TRIM": return toText(args[0]).trim().replace(/\s+/g, " ");
    case "UPPER": return toText(args[0]).toUpperCase();
    case "LOWER": return toText(args[0]).toLowerCase();
    case "PROPER": return toText(args[0]).replace(/\b\w/g, (c) => c.toUpperCase());
    case "VALUE": {
      const n = Number(toText(args[0]).replace(/,/g, ""));
      if (Number.isNaN(n)) fail(ERR.VALUE);
      return n;
    }
    case "REPT": return toText(args[0]).repeat(Math.max(0, Math.trunc(toNumber(args[1]))));
    case "TEXT": {
      const n = toNumber(args[0]);
      const fmt = toText(args[1]);
      if (/0\.0+/.test(fmt)) {
        const decimals = (fmt.split(".")[1].match(/0/g) || []).length;
        return n.toFixed(decimals);
      }
      return String(n);
    }
    case "SUMIF": {
      const values = flattenValue(args[0]);
      const match = criteriaMatcher(args[1]);
      const sums = args.length > 2 ? flattenValue(args[2]) : values;
      let total = 0;
      for (let i = 0; i < values.length; i++) {
        if (match(values[i])) total += toNumber(sums[i]);
      }
      return total;
    }
    case "COUNTIF": {
      const values = flattenValue(args[0]);
      const match = criteriaMatcher(args[1]);
      return values.filter(match).length;
    }
    case "AVERAGEIF": {
      const values = flattenValue(args[0]);
      const match = criteriaMatcher(args[1]);
      const sums = args.length > 2 ? flattenValue(args[2]) : values;
      let total = 0;
      let count = 0;
      for (let i = 0; i < values.length; i++) {
        if (match(values[i])) { total += toNumber(sums[i]); count++; }
      }
      if (!count) fail(ERR.DIV0);
      return total / count;
    }
    case "VLOOKUP": {
      const needle = firstValue(args[0]);
      const matrix = rangeMatrix(args[1]);
      const col = Math.trunc(toNumber(args[2]));
      const exact = args.length > 3 ? !toBool(args[3]) : true;
      let found = null;
      for (const row of matrix) {
        const hit = compareValues(row[0], needle) === 0;
        if (exact) {
          if (hit) { found = row; break; }
        } else if (compareValues(row[0], needle) <= 0) {
          found = row;
        }
      }
      if (!found) fail(ERR.NA);
      if (col < 1 || col > found.length) fail(ERR.REF);
      return found[col - 1];
    }
    case "INDEX": {
      const matrix = rangeMatrix(args[0]);
      const row = Math.trunc(toNumber(args[1]));
      const col = args.length > 2 ? Math.trunc(toNumber(args[2])) : 1;
      if (row < 1 || row > matrix.length || col < 1 || col > (matrix[0]?.length || 0)) fail(ERR.REF);
      return matrix[row - 1][col - 1];
    }
    case "MATCH": {
      const needle = firstValue(args[0]);
      const values = flattenValue(args[1]);
      const mode = args.length > 2 ? Math.trunc(toNumber(args[2])) : 1;
      if (mode === 0) {
        const idx = values.findIndex((v) => compareValues(v, needle) === 0);
        if (idx < 0) fail(ERR.NA);
        return idx + 1;
      }
      let candidate = -1;
      for (let i = 0; i < values.length; i++) {
        const cmp = compareValues(values[i], needle);
        if (mode > 0 ? cmp <= 0 : cmp >= 0) candidate = i;
      }
      if (candidate < 0) fail(ERR.NA);
      return candidate + 1;
    }
    case "CHOOSE": {
      const idx = Math.trunc(toNumber(args[0]));
      if (idx < 1 || idx >= args.length) fail(ERR.VALUE);
      return args[idx];
    }
    case "DATE": {
      const y = Math.trunc(toNumber(args[0]));
      const m = Math.trunc(toNumber(args[1]));
      const d = Math.trunc(toNumber(args[2]));
      return new Date(Date.UTC(y, m - 1, d));
    }
    case "YEAR": {
      const d = firstValue(args[0]);
      const date = d instanceof Date ? d : new Date(toNumber(d) * 86400000 + Date.UTC(1899, 11, 30));
      return date.getUTCFullYear();
    }
    case "MONTH": {
      const d = firstValue(args[0]);
      const date = d instanceof Date ? d : new Date(toNumber(d) * 86400000 + Date.UTC(1899, 11, 30));
      return date.getUTCMonth() + 1;
    }
    case "DAY": {
      const d = firstValue(args[0]);
      const date = d instanceof Date ? d : new Date(toNumber(d) * 86400000 + Date.UTC(1899, 11, 30));
      return date.getUTCDate();
    }
    default:
      fail(ERR.NAME);
  }
}

function applyOperator(op, a, b) {
  switch (op) {
    case "+": return toNumber(a) + toNumber(b);
    case "-": return toNumber(a) - toNumber(b);
    case "*": return toNumber(a) * toNumber(b);
    case "/": {
      const d = toNumber(b);
      if (d === 0) fail(ERR.DIV0);
      return toNumber(a) / d;
    }
    case "^": {
      const n = Math.pow(toNumber(a), toNumber(b));
      if (Number.isNaN(n)) fail(ERR.NUM);
      return n;
    }
    case "&": return toText(a) + toText(b);
    case "=": return compareValues(a, b) === 0;
    case "<>": return compareValues(a, b) !== 0;
    case "<": return compareValues(a, b) < 0;
    case ">": return compareValues(a, b) > 0;
    case "<=": return compareValues(a, b) <= 0;
    case ">=": return compareValues(a, b) >= 0;
    default: fail(ERR.VALUE);
  }
}

const PRECEDENCE = {
  "=": 1, "<>": 1, "<": 1, ">": 1, "<=": 1, ">=": 1,
  "&": 2,
  "+": 3, "-": 3,
  "*": 4, "/": 4,
  "^": 5,
};

class Parser {
  constructor(tokens, sheet, evaluator) {
    this.tokens = tokens;
    this.pos = 0;
    this.sheet = sheet;
    this.evaluator = evaluator;
  }

  peek() { return this.tokens[this.pos]; }

  next() { return this.tokens[this.pos++]; }

  expect(type, value) {
    const t = this.next();
    if (t.type !== type || (value != null && t.value !== value)) fail(ERR.VALUE);
    return t;
  }

  parse() {
    const value = this.parseExpression(0);
    if (this.peek().type !== "eof") fail(ERR.VALUE);
    return firstValue(value);
  }

  parseExpression(minPrec) {
    let left = this.parseUnary();
    for (;;) {
      const t = this.peek();
      if (t.type !== "op") break;
      const prec = PRECEDENCE[t.value];
      if (prec == null || prec < minPrec) break;
      this.next();
      const right = this.parseExpression(prec + (t.value === "^" ? 0 : 1));
      left = applyOperator(t.value, left, right);
    }
    return left;
  }

  parseUnary() {
    const t = this.peek();
    if (t.type === "op" && (t.value === "+" || t.value === "-")) {
      this.next();
      const v = this.parseUnary();
      return t.value === "-" ? -toNumber(v) : toNumber(v);
    }
    let value = this.parsePrimary();
    while (this.peek().type === "op" && this.peek().value === "%") {
      this.next();
      value = toNumber(value) / 100;
    }
    return value;
  }

  parsePrimary() {
    const t = this.next();
    if (t.type === "num") return t.value;
    if (t.type === "str") return t.value;
    if (t.type === "err") fail(t.value);
    if (t.type === "name") {
      if (t.name === "TRUE") return true;
      if (t.name === "FALSE") return false;
      fail(ERR.NAME);
    }
    if (t.type === "ref") {
      const sheet = t.sheet || this.sheet;
      const range = rangeCells(t.r1, t.c1, t.r2, t.c2);
      if (range.count === 1) return this.evaluator.valueOf(sheet, t.r1, t.c1);
      return {
        __range: true,
        evaluator: this.evaluator,
        sheet,
        ...range,
      };
    }
    if (t.type === "func") {
      this.expect("op", "(");
      const args = [];
      if (!(this.peek().type === "op" && this.peek().value === ")")) {
        for (;;) {
          args.push(this.parseExpression(0));
          const sep = this.peek();
          if (sep.type === "op" && (sep.value === "," || sep.value === ";")) { this.next(); continue; }
          break;
        }
      }
      this.expect("op", ")");
      return callFunction(t.name, args);
    }
    if (t.type === "op" && t.value === "(") {
      const value = this.parseExpression(0);
      this.expect("op", ")");
      return value;
    }
    fail(ERR.VALUE);
  }
}

function evalFormula(sheet, formula, evaluator) {
  const parser = new Parser(tokenize(formula, sheet), sheet, evaluator);
  return parser.parse();
}

/**
 * 计算 workbook 中缺少缓存值的公式,把结果写回 ExcelJS cell.value。
 * 返回 { evaluated, failed } 统计,便于调试/测试。
 *
 * @param {object} workbook ExcelJS Workbook
 */
export function evaluateWorkbookFormulas(workbook) {
  const sheets = [];
  const byName = new Map();
  workbook.eachSheet((ws) => {
    const cells = new Map();
    ws.eachRow({ includeEmpty: false }, (row, r) => {
      row.eachCell({ includeEmpty: false }, (cell, c) => {
        cells.set(cellKey(r, c), cell);
      });
    });
    const sh = { name: ws.name, cells };
    sheets.push(sh);
    byName.set(normalizeSheetName(ws.name), sh);
  });

  const memo = new Map();
  const visiting = new Set();
  const FAILED = Symbol("failed");
  let evaluated = 0;
  let failed = 0;

  const evaluator = {
    valueOf(sheetName, r, c) {
      const sh = byName.get(normalizeSheetName(sheetName)) || byName.get(normalizeSheetName(sheetName?.name)) || sheets[0];
      if (!sh) return 0;
      const key = sh.name + "!" + r + "," + c;
      if (memo.has(key)) {
        const cached = memo.get(key);
        if (cached === FAILED) fail(ERR.REF);
        return cached;
      }
      if (visiting.has(key)) fail(ERR.REF);
      const cell = sh.cells.get(cellKey(r, c));
      if (!cell) return 0;
      const value = cell.value;
      if (value && typeof value === "object" && !(value instanceof Date)) {
        if (value.formula != null || value.sharedFormula != null) {
          if (value.result !== undefined && value.result !== null && value.result !== "") {
            memo.set(key, value.result);
            return value.result;
          }
          if (value.formula == null) {
            // 共享公式只有主单元格带公式文本;没有展开能力时不硬算。
            memo.set(key, FAILED);
            fail(ERR.REF);
          }
          visiting.add(key);
          try {
            const result = evalFormula(sh.name, String(value.formula).replace(/^=/, ""), evaluator);
            cell.value = { ...value, formula: value.formula, result };
            memo.set(key, result);
            evaluated++;
            return result;
          } catch (e) {
            memo.set(key, FAILED);
            failed++;
            throw e;
          } finally {
            visiting.delete(key);
          }
        }
        if (Array.isArray(value.richText)) {
          const text = value.richText.map((run) => run?.text || "").join("");
          memo.set(key, text);
          return text;
        }
        if (value.text != null && value.hyperlink != null) {
          memo.set(key, String(value.text));
          return String(value.text);
        }
        if (value.error != null) fail(String(value.error));
      }
      memo.set(key, value);
      return value;
    },
  };

  for (const sh of sheets) {
    for (const [key, cell] of sh.cells) {
      const value = cell.value;
      if (!value || typeof value !== "object") continue;
      if (value.formula == null && value.sharedFormula == null) continue;
      const [r, c] = key.split(",").map(Number);
      try {
        evaluator.valueOf(sh.name, r, c);
      } catch {
        // 单个公式失败不阻塞其它表;原公式保持原样。
      }
    }
  }
  return { evaluated, failed };
}

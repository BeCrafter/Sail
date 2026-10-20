// 公式计算的独立冒烟测试:由 preview_xlsx_test.go 调用(没有 node 时跳过)。
// 用 ExcelJS 生成内存工作簿,覆盖实际资源库里出现过的 SUM、区域、跨表、
// IF/ROUND、VLOOKUP 和公式栏保留。
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ExcelJS = require("../assets/lib/exceljs.min.js");
const { evaluateWorkbookFormulas } = await import("../assets/lib/preview_xlsx_formula.js");
const { workbookToSheets } = await import("../assets/lib/preview_xlsx.js");

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet("Sheet 1");
const ws2 = wb.addWorksheet("Sheet2");

ws.getCell("A1").value = 1;
ws.getCell("A2").value = 2;
ws.getCell("A3").value = 3;
ws.getCell("A4").value = { formula: "SUM(A1:A3)" };
ws.getCell("A5").value = { formula: 'IF(A4>5,"ok","bad")' };
ws.getCell("A6").value = { formula: "ROUND(1.235,2)" };
ws.getCell("A7").value = { formula: "SUM(A1:A3)*2+1" };
ws.getCell("A9").value = "x";
ws.getCell("B1").value = 10;
ws.getCell("B2").value = 20;
ws.getCell("A10").value = { formula: "SUMIF(A1:A3,\">1\")" };
ws2.getCell("A1").value = 10;
ws2.getCell("A2").value = { formula: "'Sheet 1'!A4+Sheet2!A1" };
ws2.getCell("A3").value = { formula: "SUM('Sheet 1'!A1:A3)" };
ws2.getCell("A4").value = { formula: "VLOOKUP(2,'Sheet 1'!A1:B2,2,FALSE)" };

const stats = evaluateWorkbookFormulas(wb);
assert(stats.failed === 0, `不应有失败公式,实际 ${stats.failed}`);
assert(ws.getCell("A4").text === "6", "SUM 结果应为 6");
assert(ws.getCell("A5").text === "ok", "IF 结果应为 ok");
assert(ws.getCell("A6").text === "1.24", "ROUND 结果应为 1.24");
assert(ws.getCell("A7").text === "13", "四则运算结果应为 13");
assert(ws.getCell("A10").text === "5", "SUMIF 结果应为 5");
assert(ws2.getCell("A2").text === "16", "跨表加法结果应为 16");
assert(ws2.getCell("A3").text === "6", "跨表区域 SUM 结果应为 6");
assert(ws2.getCell("A4").text === "20", "VLOOKUP 结果应为 20");
assert(ws.getCell("A4").value.formula === "SUM(A1:A3)", "公式栏必须保留原公式");

const sheets = workbookToSheets(wb);
const g = sheets[0];
assert(g.cells[3][0].text === "6", "网格应显示公式结果而不是公式文本");
assert(g.cells[3][0].formula === "=SUM(A1:A3)", "公式栏的数据源必须保留原公式");
assert(g.cells[4][0].text === "ok", "网格 IF 结果不对");
assert(!g.cells[3][0].text.startsWith("="), "网格不能显示 =SUM(...)");

console.log("preview_xlsx_formula: ok");

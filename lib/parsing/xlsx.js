import { ExcelJS } from "./runtime.js";

// ── xlsx→CSV ───────────────────────────────────────────────────────────────────
export async function xlsxBufferToCSV(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) return "";
  const csvRows = [];
  ws.eachRow({ includeEmpty: true }, (row) => {
    const vals = (row.values || []).slice(1).map(v => {
      if (v == null) return "";
      if (typeof v === "object") {
        if (v.richText) return v.richText.map(r => r.text).join("");
        if (v.result != null) return String(v.result);
        if (v instanceof Date) return v.toISOString().split("T")[0];
        return String(v);
      }
      const s = String(v);
      if (s.includes(",") || s.includes('"') || s.includes("\n"))
        return '"' + s.replace(/"/g, '""') + '"';
      return s;
    });
    csvRows.push(vals.join(","));
  });
  return csvRows.join("\n");
}

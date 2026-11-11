import { createRequire } from "module";
import path from "path";

const _require = createRequire(import.meta.url);
export const Papa = _require("papaparse");
export const ExcelJS = _require("exceljs");
export const pdfjsLib = _require("pdfjs-dist/legacy/build/pdf.mjs");

// ── pdfjs font path ────────────────────────────────────────────────────────────
export const _pdfjsFontPath = path.join(
  path.dirname(_require.resolve("pdfjs-dist/package.json")),
  "standard_fonts"
) + "/";

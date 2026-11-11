// lib/parsers.js — public API of the statement/holdings parsers.
// The implementation lives in lib/parsing/*; this file only re-exports it so imports stay unchanged.

export { pdfjsLib, _pdfjsFontPath } from "./parsing/runtime.js";
export { xlsxBufferToCSV } from "./parsing/xlsx.js";
export { autoCategorise, loadCategoriesForBulk } from "./parsing/categorise.js";
export { BANK_REGISTRY, BANK_COLUMN_MAP, parseBankCSV, autoDetectBank, parseCSV } from "./parsing/bank.js";
export { parseDateIN, parseAmtBudget, parseDateForRegion } from "./parsing/dates.js";
export { extractPDFText, parseUSPDF, parseIndianPDF } from "./parsing/bankPdf.js";
export { detectAndParseHoldings, parseTransactionCSV, scoreHoldings, scoreTransactions } from "./parsing/holdings.js";
export { parseNSDLCASStatement } from "./parsing/cas.js";
export { parseFidelityPDFStatement } from "./parsing/fidelityPdf.js";

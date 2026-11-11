/**
 * services/budget.service.js — bank-statement import, transactions, categories,
 * and analytics. Descriptions/balances are encrypted at rest; decryption happens
 * only here when reading back.
 */
export { nameAppearsAsHolder, detectMemberFromText, extractLast4, uploadStatement, listBanks, listStatements, setTxnCategory, recategorise, debugPdf } from "./budget/statements.js";
export { listCategories, createCategory, updateCategory, deleteCategory, getCategoryLimits, setCategoryLimit, deleteCategoryLimit } from "./budget/categories.js";
export { listGoals, createGoal, updateGoal, deleteGoal, benchmark } from "./budget/goals.js";
export { resolveTransactionAllocations, getSplits, setSplits } from "./budget/splits.js";
export { familyAnalytics, familyTransactions } from "./budget/analytics.js";
export { normalizeMerchant, merchantRollup, detectRecurring } from "./budget/merchants.js";

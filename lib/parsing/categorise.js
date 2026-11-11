import { supabase } from "../db.js";

// ── autoCategorise ─────────────────────────────────────────────────────────────
// Synchronous — caller must pre-load cats once (avoids N+1 DB query per transaction).
// Usage: const { data: cats } = await supabase.from("budget_categories").select("id,name,keywords");
//        const category = autoCategorise(desc, cats);
export function autoCategorise(description, cats = []) {
  const desc = description.toLowerCase();
  for (const cat of cats) {
    if (!cat.keywords) continue;
    for (const kw of cat.keywords.split(",").map(k => k.trim()).filter(Boolean)) {
      if (desc.includes(kw)) return cat.name;
    }
  }
  return "Other";
}

// Helper: load categories once from DB (system defaults + user-created), for use before a bulk categorisation loop.
export async function loadCategoriesForBulk(userId) {
  try {
    const { data } = await supabase
      .from("budget_categories")
      .select("id,name,keywords")
      .or(`user_id.eq.${userId},user_id.is.null`);
    return data || [];
  } catch { return []; }
}

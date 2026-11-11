import { supabase } from "../../lib/db.js";
import { catLimitId, err } from "./shared.js";

export async function listCategories(userId) {
  // Returns system defaults (user_id IS NULL) + user's own categories (user_id = userId)
  const { data, error } = await supabase
    .from("budget_categories")
    .select("*")
    .or(`user_id.eq.${userId},user_id.is.null`)
    .order("name");
  if (error) throw new Error(error.message);
  return data || [];
}

export async function createCategory(userId, name, keywords, icon, color, monthly_limit, is_essential) {
  const id = "cat_" + Date.now().toString(36);
  const row = { id, user_id: userId, name, keywords: keywords || "" };
  if (icon          !== undefined) row.icon          = icon;
  if (color         !== undefined) row.color         = color;
  if (monthly_limit !== undefined) row.monthly_limit = Number(monthly_limit) || 0;
  if (is_essential !== undefined) row.is_essential = Boolean(is_essential);
  const { error } = await supabase.from("budget_categories").insert(row);
  if (error) throw new Error(error.message);
  return { ok: true, id };
}

export async function updateCategory(userId, id, name, keywords, icon, color, monthly_limit, is_essential) {
  const patch = {};
  if (name          !== undefined) patch.name          = name;
  if (keywords      !== undefined) patch.keywords      = keywords;
  if (icon          !== undefined) patch.icon          = icon;
  if (color         !== undefined) patch.color         = color;
  if (monthly_limit !== undefined) patch.monthly_limit = Number(monthly_limit) || 0;
  if (is_essential !== undefined) patch.is_essential = Boolean(is_essential);
  // Transactions store the category NAME (text), not its id, so a rename has to
  // carry over to them or they'd be orphaned under the old name.
  let oldName = null;
  if (patch.name !== undefined) {
    patch.name = String(patch.name).trim();
    if (!patch.name) throw err("Category name cannot be empty", 400);
    const { data: cur, error: curErr } = await supabase
      .from("budget_categories").select("name").eq("id", id).eq("user_id", userId).maybeSingle();
    if (curErr) throw new Error(curErr.message);
    if (!cur) throw err("Category not found (system defaults can't be edited)", 404);
    if (cur.name !== patch.name) {
      const { data: dup } = await supabase.from("budget_categories").select("id")
        .or(`user_id.eq.${userId},user_id.is.null`).eq("name", patch.name).neq("id", id).limit(1);
      if (dup?.length) throw err(`A category named "${patch.name}" already exists`, 409);
      oldName = cur.name;
    }
  }
  // Only allow editing user-owned categories (user_id = userId); system defaults (NULL) are read-only
  const { error } = await supabase
    .from("budget_categories")
    .update(patch)
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);

  let transactionsUpdated = 0;
  if (oldName) {
    const { data: moved, error: txErr } = await supabase
      .from("budget_transactions").update({ category: patch.name })
      .eq("user_id", userId).eq("category", oldName).select("id");
    if (txErr) {
      // keep category + transactions consistent: undo the rename
      await supabase.from("budget_categories").update({ name: oldName }).eq("id", id).eq("user_id", userId);
      throw new Error(txErr.message);
    }
    transactionsUpdated = moved?.length || 0;
  }
  return { ok: true, transactionsUpdated };
}

export async function deleteCategory(userId, id) {
  // Only allow deleting user-owned categories; system defaults are protected
  await supabase.from("budget_categories").delete().eq("id", id).eq("user_id", userId);
  return { ok: true };
}

// ── Per-member category limit overrides (migrations/0032) ─────────────────────
// budget_categories.monthly_limit stays the shared/family value; a row here
// overrides it for one specific member. No override for a (category, member)
// pair falls back to the shared value — resolved here, not in SQL, so the
// fallback logic lives in one place.

/** Every category with its effective limit for one member: the override if
 *  one exists, else the shared family limit, with `is_override` so the UI
 *  can show "using shared limit" vs a value the user actually set. */
export async function getCategoryLimits(userId, memberId) {
  const categories = await listCategories(userId);
  if (!memberId) {
    return categories.map(c => ({ category_id: c.id, monthly_limit: c.monthly_limit || 0, is_override: false }));
  }
  const { data, error } = await supabase
    .from("budget_category_limits")
    .select("category_id, monthly_limit")
    .eq("user_id", userId).eq("member_id", memberId);
  if (error) throw new Error(error.message);
  const overrides = new Map((data || []).map(r => [r.category_id, r.monthly_limit]));
  return categories.map(c => overrides.has(c.id)
    ? { category_id: c.id, monthly_limit: overrides.get(c.id), is_override: true }
    : { category_id: c.id, monthly_limit: c.monthly_limit || 0, is_override: false });
}

/** Upsert one member's limit override for a category. */
export async function setCategoryLimit(userId, categoryId, memberId, monthlyLimit) {
  if (!categoryId || !memberId) throw err("category_id and member_id are required", 400);
  const limit = Number(monthlyLimit) || 0;
  const { data: existing } = await supabase
    .from("budget_category_limits").select("id")
    .eq("user_id", userId).eq("category_id", categoryId).eq("member_id", memberId).single();
  if (existing) {
    const { error } = await supabase.from("budget_category_limits")
      .update({ monthly_limit: limit, updated_at: new Date().toISOString() }).eq("id", existing.id).eq("user_id", userId);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase.from("budget_category_limits").insert({
      id: catLimitId(), user_id: userId, category_id: categoryId, member_id: memberId, monthly_limit: limit,
    });
    if (error) throw new Error(error.message);
  }
  return { ok: true, category_id: categoryId, member_id: memberId, monthly_limit: limit };
}

/** Remove a member's override — that category reverts to the shared family limit. */
export async function deleteCategoryLimit(userId, categoryId, memberId) {
  await supabase.from("budget_category_limits").delete()
    .eq("user_id", userId).eq("category_id", categoryId).eq("member_id", memberId);
  return { ok: true };
}

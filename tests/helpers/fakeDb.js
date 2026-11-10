/**
 * fakeDb.js - a small in-memory stand-in for the Supabase client, for tests that drive the
 * real routers and services. It implements the PostgREST subset this app uses (select /
 * insert / upsert / update / delete, eq, neq, gt(e), lt(e), is, in, like, ilike, not, or,
 * order, limit, range, single, maybeSingle, count) plus auth.getUser and storage.
 * Anything it does not understand THROWS, so a new query shape fails loudly instead of
 * silently matching nothing (which would make security tests pass for the wrong reason).
 */

const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

const likeToRe = (pat, flags) =>
  new RegExp("^" + String(pat).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".") + "$", flags);

const same = (a, b) => (a == null || b == null ? a == null && b == null : String(a) === String(b));

function cmp(row, col, op, val) {
  const v = row[col];
  switch (op) {
    case "eq":    return same(v, val);
    case "neq":   return !same(v, val);
    case "gt":    return v != null && v > val;
    case "gte":   return v != null && v >= val;
    case "lt":    return v != null && v < val;
    case "lte":   return v != null && v <= val;
    case "is":    return val === null || val === "null" ? v == null : v === (val === "true" || val === true);
    case "in":    return (Array.isArray(val) ? val : String(val).replace(/^\(|\)$/g, "").split(",")).some((x) => same(v, x));
    case "like":  return v != null && likeToRe(val, "").test(String(v));
    case "ilike": return v != null && likeToRe(val, "i").test(String(v));
    default: throw new Error(`fakeDb: unsupported filter operator "${op}"`);
  }
}

function splitTop(str) {
  const out = []; let depth = 0, cur = "";
  for (const ch of str) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

function orPredicate(expr) {
  const parts = splitTop(expr);
  if (parts.some((p) => /^(and|or|not)\(/.test(p))) throw new Error(`fakeDb: nested or() not supported: ${expr}`);
  const conds = parts.map((p) => {
    const m = p.match(/^([^.]+)\.([a-z]+)\.(.*)$/);
    if (!m) throw new Error(`fakeDb: cannot parse or() condition "${p}"`);
    return { col: m[1], op: m[2], val: m[3] };
  });
  return (row) => conds.some((c) => cmp(row, c.col, c.op, c.val));
}

export function createFakeDb({ users = {} } = {}) {
  const state = { tables: {}, storage: { uploads: [], removed: [], signed: [] } };

  const rowsOf = (t) => (state.tables[t] ||= []);

  function builder(table) {
    const q = { op: "select", preds: [], payload: null, order: [], limit: null, range: null,
                single: false, maybe: false, count: null, head: false, selectAfter: false, onConflict: "id", ignoreDup: false };
    const add = (op) => (col, val) => { q.preds.push((r) => cmp(r, col, op, val)); return b; };
    const b = {
      select(_cols, opts = {}) { if (q.op === "select") { q.count = opts.count || null; q.head = !!opts.head; } else q.selectAfter = true; return b; },
      insert(p) { q.op = "insert"; q.payload = p; return b; },
      upsert(p, opts = {}) { q.op = "upsert"; q.payload = p; q.onConflict = opts.onConflict || "id"; q.ignoreDup = !!opts.ignoreDuplicates; return b; },
      update(p) { q.op = "update"; q.payload = p; return b; },
      delete(opts = {}) { q.op = "delete"; q.count = opts.count || null; return b; },
      eq: add("eq"), neq: add("neq"), gt: add("gt"), gte: add("gte"), lt: add("lt"), lte: add("lte"),
      is: add("is"), in: add("in"), like: add("like"), ilike: add("ilike"),
      not(col, op, val) { q.preds.push((r) => !cmp(r, col, op, val)); return b; },
      or(expr) { q.preds.push(orPredicate(expr)); return b; },
      order(col, o = {}) { q.order.push([col, o.ascending !== false]); return b; },
      limit(n) { q.limit = n; return b; },
      range(a, z) { q.range = [a, z]; return b; },
      single() { q.single = true; return b; },
      maybeSingle() { q.maybe = true; return b; },
      then(res, rej) { return Promise.resolve().then(run).then(res, rej); },
    };

    function shape(rows, extra = {}) {
      let out = rows;
      if (q.single) {
        if (out.length !== 1) return { data: null, error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" }, ...extra };
        out = out[0];
      } else if (q.maybe) {
        if (out.length > 1) return { data: null, error: { code: "PGRST116", message: "multiple rows returned" }, ...extra };
        out = out[0] ?? null;
      }
      return { data: clone(out), error: null, ...extra };
    }

    function run() {
      const all = rowsOf(table);
      const match = (r) => q.preds.every((p) => p(r));
      if (q.op === "select") {
        let rows = all.filter(match);
        for (const [col, asc] of [...q.order].reverse()) {
          rows = [...rows].sort((x, y) => (x[col] > y[col] ? 1 : x[col] < y[col] ? -1 : 0) * (asc ? 1 : -1));
        }
        const total = rows.length;
        if (q.range) rows = rows.slice(q.range[0], q.range[1] + 1);
        if (q.limit != null) rows = rows.slice(0, q.limit);
        if (q.head) return { data: null, error: null, count: total };
        return shape(rows, q.count ? { count: total } : {});
      }
      if (q.op === "insert" || q.op === "upsert") {
        const list = (Array.isArray(q.payload) ? q.payload : [q.payload]).map(clone);
        const keys = q.onConflict.split(",").map((s) => s.trim());
        const written = [];
        for (const row of list) {
          const idx = all.findIndex((r) => keys.every((k) => same(r[k], row[k]) && row[k] !== undefined));
          if (q.op === "insert") {
            if (idx >= 0 && row.id !== undefined) return { data: null, error: { code: "23505", message: `duplicate key on ${table}` } };
            all.push(row); written.push(row);
          } else if (idx >= 0) {
            if (!q.ignoreDup) { Object.assign(all[idx], row); written.push(all[idx]); }
          } else { all.push(row); written.push(row); }
        }
        return q.selectAfter ? shape(written) : { data: null, error: null };
      }
      if (q.op === "update") {
        const hit = all.filter(match);
        for (const r of hit) Object.assign(r, clone(q.payload));
        return q.selectAfter ? shape(hit) : { data: null, error: null, count: hit.length };
      }
      if (q.op === "delete") {
        const hit = all.filter(match);
        state.tables[table] = all.filter((r) => !hit.includes(r));
        return { data: null, error: null, ...(q.count ? { count: hit.length } : {}) };
      }
      throw new Error(`fakeDb: unsupported operation ${q.op}`);
    }
    return b;
  }

  const client = {
    from: builder,
    rpc: () => { throw new Error("fakeDb: rpc() is not supported"); },
    auth: {
      getUser: async (token) => {
        const user = users[token];
        return user ? { data: { user }, error: null } : { data: { user: null }, error: { message: "invalid token" } };
      },
    },
    storage: {
      from: (bucket) => ({
        upload: async (path, buf, opts) => { state.storage.uploads.push({ bucket, path, opts }); return { data: { path }, error: null }; },
        remove: async (paths) => { state.storage.removed.push(...paths.map((p) => `${bucket}/${p}`)); return { data: [], error: null }; },
        createSignedUrl: async (path) => { state.storage.signed.push(`${bucket}/${path}`); return { data: { signedUrl: `https://storage.test/${bucket}/${path}?token=x` }, error: null }; },
        download: async () => ({ data: new Blob(["x"]), error: null }),
      }),
    },
  };

  return {
    client,
    storage: state.storage,
    reset(seed = {}) {
      state.tables = {};
      for (const [t, rows] of Object.entries(seed)) state.tables[t] = rows.map(clone);
      state.storage.uploads.length = state.storage.removed.length = state.storage.signed.length = 0;
    },
    /** Deep copy of every table, optionally ignoring some (e.g. audit_logs). */
    snapshot(ignore = []) {
      return clone(Object.fromEntries(Object.entries(state.tables).filter(([t]) => !ignore.includes(t))));
    },
  };
}

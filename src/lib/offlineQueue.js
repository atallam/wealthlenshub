/**
 * offlineQueue.js — IndexedDB-backed offline write queue.
 *
 * When the user is offline, POST /api/transactions requests are stored here.
 * The service worker's Background Sync flushes them on reconnect.
 *
 * Usage:
 *   import { queueRequest, isOnline } from "../lib/offlineQueue.js";
 *
 *   if (!isOnline()) {
 *     await queueRequest("/api/transactions", "POST", headers, body);
 *     registerSync(); // ask SW to sync when back online
 *   }
 */

const DB_NAME  = "wealthlens-offline";
const DB_VER   = 1;
const TX_STORE = "pending-transactions";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = e => {
      e.target.result.createObjectStore(TX_STORE, { keyPath: "id", autoIncrement: true });
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

export function isOnline() {
  return navigator.onLine !== false;
}

/**
 * Add a failed request to the offline queue.
 * @param {string} url
 * @param {string} method
 * @param {Record<string,string>} headers
 * @param {string} body  — JSON-stringified body
 */
export async function queueRequest(url, method, headers, body) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TX_STORE, "readwrite");
    tx.objectStore(TX_STORE).add({ url, method, headers, body, queued_at: Date.now() });
    tx.oncomplete = resolve;
    tx.onerror    = reject;
  });
}

/** Ask the service worker to flush the queue via Background Sync */
export async function registerSync() {
  try {
    const reg = await navigator.serviceWorker.ready;
    if ("sync" in reg) await reg.sync.register("sync-transactions");
  } catch (e) {
    console.warn("[OfflineQueue] Background Sync not supported:", e);
  }
}

/** How many items are currently queued */
export async function pendingCount() {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(TX_STORE, "readonly");
      const r = tx.objectStore(TX_STORE).count();
      r.onsuccess = () => resolve(r.result);
      r.onerror   = reject;
    });
  } catch { return 0; }
}

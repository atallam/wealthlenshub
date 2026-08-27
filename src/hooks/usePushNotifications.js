/**
 * usePushNotifications — Web Push subscription lifecycle hook.
 *
 * Usage:
 *   const { supported, subscribed, loading, toggle } = usePushNotifications();
 */
import { useState, useEffect, useCallback } from "react";
import { api as apiFetch } from "../lib/api.js";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

export function usePushNotifications() {
  const [supported,  setSupported]  = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [loading,    setLoading]    = useState(false);
  const [publicKey,  setPublicKey]  = useState(null);

  // Check support + existing subscription on mount
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    setSupported(true);

    (async () => {
      try {
        // Fetch VAPID public key from server
        const { publicKey: pk, enabled } = await apiFetch("/api/push/vapid-key");
        if (!enabled) return;
        setPublicKey(pk);

        // Check if already subscribed
        const reg = await navigator.serviceWorker.ready;
        const existing = await reg.pushManager.getSubscription();
        setSubscribed(!!existing);
      } catch (e) {
        console.warn("[Push] init error:", e);
      }
    })();
  }, []);

  const subscribe = useCallback(async () => {
    if (!publicKey) return;
    setLoading(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setLoading(false); return; }

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      await apiFetch("/api/push/subscribe", { method: "POST", body: JSON.stringify(sub) });
      setSubscribed(true);
    } catch (e) {
      console.warn("[Push] subscribe error:", e);
    }
    setLoading(false);
  }, [publicKey]);

  const unsubscribe = useCallback(async () => {
    setLoading(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await apiFetch("/api/push/unsubscribe", {
          method: "DELETE",
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setSubscribed(false);
    } catch (e) {
      console.warn("[Push] unsubscribe error:", e);
    }
    setLoading(false);
  }, []);

  const toggle = useCallback(() => {
    subscribed ? unsubscribe() : subscribe();
  }, [subscribed, subscribe, unsubscribe]);

  return { supported, subscribed, loading, toggle };
}

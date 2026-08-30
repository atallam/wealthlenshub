/**
 * usePushNotifications — Web Push subscription lifecycle hook.
 *
 * Usage:
 *   const { supported, subscribed, loading, toggle } = usePushNotifications();
 *
 * Note: every failure path below reports itself via the toast system —
 * previously several of these (missing VAPID key, denied permission,
 * failed subscribe call) failed silently, which made the Enable button
 * on the Settings screen look broken with no feedback to the user.
 */
import { useState, useEffect, useCallback } from "react";
import { api as apiFetch } from "../lib/api.js";
import { useToast } from "../components/shared/Toast.jsx";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

export function usePushNotifications() {
  const toast = useToast();
  const [supported,  setSupported]  = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [loading,    setLoading]    = useState(false);
  const [publicKey,  setPublicKey]  = useState(null);
  const [serverEnabled, setServerEnabled] = useState(true); // assume yes until we hear otherwise

  // Check support + existing subscription on mount
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    setSupported(true);

    (async () => {
      try {
        // Fetch VAPID public key from server
        const { publicKey: pk, enabled } = await apiFetch("/api/push/vapid-key");
        setServerEnabled(!!enabled);
        if (!enabled) return;
        setPublicKey(pk);

        // Check if already subscribed
        const reg = await navigator.serviceWorker.ready;
        const existing = await reg.pushManager.getSubscription();
        setSubscribed(!!existing);
      } catch (e) {
        console.warn("[Push] init error:", e);
        setServerEnabled(false);
      }
    })();
  }, []);

  const subscribe = useCallback(async () => {
    if (!serverEnabled || !publicKey) {
      toast?.error("Push notifications aren't configured on the server yet.");
      return;
    }
    setLoading(true);
    try {
      const reg = await navigator.serviceWorker.ready;

      if (Notification.permission === "denied") {
        toast?.error("Notifications are blocked for this site — enable them in your browser's site settings.");
        setLoading(false);
        return;
      }

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        toast?.info("Notification permission wasn't granted.");
        setLoading(false);
        return;
      }

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      await apiFetch("/api/push/subscribe", { method: "POST", body: JSON.stringify(sub) });
      setSubscribed(true);
      toast?.success("Push notifications enabled on this device.");
    } catch (e) {
      console.warn("[Push] subscribe error:", e);
      toast?.error("Couldn't enable push notifications: " + (e?.message || "unknown error"));
    }
    setLoading(false);
  }, [publicKey, serverEnabled, toast]);

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
      toast?.info("Push notifications disabled.");
    } catch (e) {
      console.warn("[Push] unsubscribe error:", e);
      toast?.error("Couldn't disable push notifications: " + (e?.message || "unknown error"));
    }
    setLoading(false);
  }, [toast]);

  const toggle = useCallback(() => {
    subscribed ? unsubscribe() : subscribe();
  }, [subscribed, subscribe, unsubscribe]);

  return { supported, subscribed, loading, toggle };
}

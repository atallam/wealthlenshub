// InstallPrompt.jsx — PWA install banner
// Shows a bottom banner when the browser fires beforeinstallprompt.
// Dismissed state persists in sessionStorage (re-shows on next session).

import { useState, useEffect } from "react";

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [visible, setVisible]               = useState(false);
  const [installing, setInstalling]         = useState(false);

  useEffect(() => {
    // Already dismissed this session
    if (sessionStorage.getItem("pwa-install-dismissed")) return;

    // Already running as installed PWA
    if (window.matchMedia("(display-mode: standalone)").matches) return;

    const handler = e => {
      e.preventDefault();
      setDeferredPrompt(e);
      setVisible(true);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (!visible || !deferredPrompt) return null;

  const dismiss = () => {
    sessionStorage.setItem("pwa-install-dismissed", "1");
    setVisible(false);
  };

  const install = async () => {
    setInstalling(true);
    try {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === "accepted") setVisible(false);
    } finally {
      setInstalling(false);
      setDeferredPrompt(null);
    }
  };

  return (
    <div style={{
      position: "fixed",
      bottom: "env(safe-area-inset-bottom, 0px)",
      left: 0,
      right: 0,
      zIndex: 9999,
      padding: "0 .75rem .75rem",
      // Push up above bottom nav on mobile
      paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 4.5rem)",
      pointerEvents: "none",
    }}>
      <div style={{
        background: "linear-gradient(135deg, #0d3d35, #0f2e28)",
        border: "1px solid rgba(76,175,154,.35)",
        borderRadius: 14,
        padding: ".85rem 1rem",
        display: "flex",
        alignItems: "center",
        gap: ".85rem",
        boxShadow: "0 8px 32px rgba(0,0,0,.45)",
        pointerEvents: "auto",
        maxWidth: 480,
        margin: "0 auto",
      }}>
        <img src="/icon-192.png" alt="" width={40} height={40}
          style={{ borderRadius: 10, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: ".82rem", fontWeight: 700, color: "#e8f5f0", lineHeight: 1.3 }}>
            Add WealthLens to Home Screen
          </div>
          <div style={{ fontSize: ".68rem", color: "rgba(200,230,220,.6)", marginTop: ".18rem" }}>
            One tap access to your portfolio
          </div>
        </div>
        <div style={{ display: "flex", gap: ".5rem", flexShrink: 0 }}>
          <button onClick={dismiss} style={{
            padding: ".35rem .65rem",
            background: "transparent",
            border: "1px solid rgba(76,175,154,.25)",
            color: "rgba(200,230,220,.5)",
            borderRadius: 8,
            fontSize: ".7rem",
            cursor: "pointer",
          }}>
            Not now
          </button>
          <button onClick={install} disabled={installing} style={{
            padding: ".35rem .85rem",
            background: "#4caf9a",
            border: "none",
            color: "#071a16",
            borderRadius: 8,
            fontSize: ".72rem",
            fontWeight: 700,
            cursor: installing ? "wait" : "pointer",
            opacity: installing ? .7 : 1,
          }}>
            {installing ? "…" : "Install"}
          </button>
        </div>
      </div>
    </div>
  );
}

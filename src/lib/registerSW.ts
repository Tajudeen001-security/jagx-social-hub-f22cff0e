// Registers /sw.js (app shell + offline videos) outside Lovable preview.
// Keeps firebase-messaging-sw.js untouched.

function inPreview(): boolean {
  if (typeof window === "undefined") return true;
  if (window.top !== window.self) return true; // iframe (preview)
  const h = window.location.hostname;
  if (h.startsWith("id-preview--") || h.startsWith("preview--")) return true;
  if (h === "lovableproject.com" || h.endsWith(".lovableproject.com")) return true;
  if (h === "lovableproject-dev.com" || h.endsWith(".lovableproject-dev.com")) return true;
  if (h === "beta.lovable.dev" || h.endsWith(".beta.lovable.dev")) return true;
  if (new URLSearchParams(window.location.search).has("sw") &&
      new URLSearchParams(window.location.search).get("sw") === "off") return true;
  return false;
}

export function registerAppShellSW() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  if (!import.meta.env.PROD) return;
  if (inPreview()) {
    // Make sure no stale shell SW is left registered.
    navigator.serviceWorker.getRegistrations().then((regs) => {
      regs.forEach((r) => {
        const u = r.active?.scriptURL || "";
        if (u.endsWith("/sw.js")) r.unregister().catch(() => undefined);
      });
    }).catch(() => undefined);
    return;
  }
  navigator.serviceWorker
    .register("/sw.js", { scope: "/" })
    .catch((e) => console.warn("[sw] register failed:", e));
}
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

/**
 * Bridges the FCM service worker's `PUSH_NAVIGATE` postMessage to React Router.
 * Mount once near the top of the app, inside <BrowserRouter>.
 */
export function PushDeepLinkBridge() {
  const navigate = useNavigate();
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data) return;
      if (data.type === "PUSH_NAVIGATE") {
        const url = typeof data.url === "string" ? data.url : "/";
        if (!url.startsWith("/")) return;
        navigate(url);
      } else if (data.type === "PUSH_FOREGROUND") {
        const url = typeof data.url === "string" ? data.url : "/";
        toast(data.title || "Notification", {
          description: data.body || "",
          action: { label: "Open", onClick: () => navigate(url) },
        });
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [navigate]);
  return null;
}

export default PushDeepLinkBridge;

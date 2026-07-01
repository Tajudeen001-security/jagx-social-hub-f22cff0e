import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Download, Trash2, Play, WifiOff, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  listOffline,
  downloadVideo,
  removeOffline,
  clearOffline,
  getOfflineUrl,
  totalOfflineBytes,
  getCacheLimitMB,
  setCacheLimitMB,
  estimateDeviceStorage,
  evictUntilFits,
  type OfflineMeta,
} from "@/lib/offlineDownloads";

const fmtMB = (b: number) => `${(b / 1024 / 1024).toFixed(1)} MB`;

const OfflineVideosPage = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [enabled, setEnabled] = useState<boolean>(localStorage.getItem("jagx_offline_enabled") === "1");
  const [count, setCount] = useState<number>(() => Number(localStorage.getItem("jagx_offline_count") || "10"));
  const [items, setItems] = useState<OfflineMeta[]>(listOffline());
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null);
  const [limitMB, setLimitMB] = useState<number>(getCacheLimitMB());
  const [device, setDevice] = useState<{ quota: number; usage: number } | null>(null);

  useEffect(() => { estimateDeviceStorage().then(setDevice); }, [items.length]);

  useEffect(() => {
    const refresh = () => setItems(listOffline());
    window.addEventListener("jagx-offline-changed", refresh);
    return () => window.removeEventListener("jagx-offline-changed", refresh);
  }, []);

  const toggleEnabled = (v: boolean) => {
    setEnabled(v);
    localStorage.setItem("jagx_offline_enabled", v ? "1" : "0");
  };

  const saveCount = (n: number) => {
    const v = Math.max(1, Math.min(100, n || 1));
    setCount(v);
    localStorage.setItem("jagx_offline_count", String(v));
  };

  const syncNow = async () => {
    if (!user) return;
    setBusy(true);
    try {
      // Ensure we have headroom before pulling anything new.
      await evictUntilFits(0);
      // Prefer videos from people the user follows, then their own, then global recent.
      const { data: follows } = await supabase
        .from("followers").select("following_id").eq("follower_id", user.id);
      const ids = (follows || []).map((f: any) => f.following_id);
      ids.push(user.id);
      let q = supabase.from("posts")
        .select("id, user_id, content, video_url")
        .not("video_url", "is", null)
        .order("created_at", { ascending: false })
        .limit(count);
      if (ids.length) q = q.in("user_id", ids);
      let { data: posts } = await q;
      if (!posts || posts.length === 0) {
        const fallback = await supabase.from("posts")
          .select("id, user_id, content, video_url")
          .not("video_url", "is", null)
          .order("created_at", { ascending: false }).limit(count);
        posts = fallback.data || [];
      }
      const already = new Set(listOffline().map((x) => x.id));
      const todo = (posts as any[]).filter((p) => !already.has(p.id)).slice(0, count);
      if (todo.length === 0) { toast.success("Already up to date"); return; }
      const userIds = Array.from(new Set(todo.map((p) => p.user_id)));
      const { data: profs } = await supabase
        .from("profiles").select("user_id, username").in("user_id", userIds);
      const nameMap = new Map((profs || []).map((p: any) => [p.user_id, p.username]));
      let ok = 0;
      for (const p of todo) {
        try {
          await downloadVideo(
            { id: p.id, user_id: p.user_id, username: nameMap.get(p.user_id) || null, title: p.content || "Video", thumb: null },
            p.video_url,
          );
          ok++;
        } catch (e) { /* skip */ }
      }
      toast.success(`Downloaded ${ok} video${ok === 1 ? "" : "s"}`);
    } catch (e: any) {
      toast.error(e?.message || "Sync failed");
    } finally { setBusy(false); }
  };

  const playOffline = async (id: string) => {
    const url = await getOfflineUrl(id);
    if (!url) { toast.error("Not available"); return; }
    setPlaying(url);
  };

  return (
    <div className="min-h-screen bg-background pb-24">
      <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-xl border-b border-border/30">
        <div className="flex items-center gap-3 px-4 h-14">
          <button onClick={() => navigate(-1)} aria-label="Back"><ArrowLeft className="size-5" /></button>
          <h1 className="text-base font-semibold flex items-center gap-2"><WifiOff className="size-4" /> Offline Videos</h1>
        </div>
      </header>

      <div className="px-4 py-5 space-y-5">
        <section className="rounded-2xl bg-surface border border-border/30 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold">Enable offline downloads</p>
              <p className="text-[11px] text-muted-foreground">Watch saved videos with no data.</p>
            </div>
            <button onClick={() => toggleEnabled(!enabled)} aria-pressed={enabled}
              className={`relative w-11 h-6 rounded-full transition-colors ${enabled ? "gold-gradient" : "bg-muted"}`}>
              <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow-md transition-transform ${enabled ? "translate-x-5" : "translate-x-0.5"}`} />
            </button>
          </div>

          {enabled && (
            <>
              <div className="flex items-center gap-2">
                <label className="text-xs flex-1">How many videos to download?</label>
                <Input type="number" min={1} max={100} value={count}
                  onChange={(e) => saveCount(Number(e.target.value))}
                  className="w-24" />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs flex-1">Cache size limit (MB)</label>
                <Input type="number" min={10} max={20000} value={limitMB}
                  onChange={(e) => { const v = Number(e.target.value); setLimitMB(v); setCacheLimitMB(v); }}
                  className="w-24" />
              </div>
              <Button onClick={syncNow} disabled={busy} className="w-full gold-gradient text-primary-foreground">
                {busy ? <><RefreshCw className="size-4 mr-2 animate-spin" /> Downloading…</> : <><Download className="size-4 mr-2" /> Download now</>}
              </Button>
            </>
          )}
        </section>

        <section className="rounded-2xl bg-surface border border-border/30 p-4 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="uppercase tracking-widest text-gold font-bold">Storage</span>
            <span className="text-muted-foreground">
              {fmtMB(totalOfflineBytes())} of {limitMB} MB used
            </span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full gold-gradient transition-all"
              style={{ width: `${Math.min(100, (totalOfflineBytes() / (limitMB * 1024 * 1024)) * 100)}%` }}
            />
          </div>
          {device && (
            <p className="text-[10px] text-muted-foreground">
              Device: {fmtMB(device.usage)} used of {fmtMB(device.quota)} available
            </p>
          )}
          <Button
            variant="outline"
            className="w-full mt-1"
            onClick={async () => { const n = await evictUntilFits(0); toast.success(n ? `Freed ${n} old video${n === 1 ? "" : "s"}` : "Already within limit"); }}
          >
            Evict oldest to fit limit
          </Button>
        </section>

        <section className="rounded-2xl bg-surface border border-border/30 p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold uppercase tracking-widest text-gold">Saved ({items.length})</h2>
            <span className="text-[11px] text-muted-foreground">{fmtMB(totalOfflineBytes())}</span>
          </div>
          {items.length === 0 && <p className="text-xs text-muted-foreground text-center py-6">No downloads yet.</p>}
          <ul className="divide-y divide-border/20">
            {items.map((m) => (
              <li key={m.id} className="flex items-center gap-3 py-2.5">
                <button onClick={() => playOffline(m.id)} className="size-10 rounded-lg gold-gradient flex items-center justify-center text-primary-foreground">
                  <Play className="size-4 fill-current" />
                </button>
                <div className="flex-1 min-w-0">
                  <p className="text-sm line-clamp-1">{m.title || "Video"}</p>
                  <p className="text-[11px] text-muted-foreground">@{m.username || "user"} · {fmtMB(m.size)}</p>
                </div>
                <button onClick={() => removeOffline(m.id)} className="text-muted-foreground"><Trash2 className="size-4" /></button>
              </li>
            ))}
          </ul>
          {items.length > 0 && (
            <Button onClick={async () => { await clearOffline(); toast.success("Cleared"); }} variant="outline" className="w-full mt-3">
              Clear all
            </Button>
          )}
        </section>
      </div>

      {playing && (
        <div className="fixed inset-0 z-50 bg-black flex items-center justify-center" onClick={() => { URL.revokeObjectURL(playing); setPlaying(null); }}>
          <video src={playing} controls autoPlay className="max-w-full max-h-full" playsInline />
        </div>
      )}
    </div>
  );
};

export default OfflineVideosPage;
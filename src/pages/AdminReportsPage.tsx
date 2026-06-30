import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Trash2, Eye, X, FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

type Tab = "open" | "actioned" | "dismissed" | "audit";

const AdminReportsPage = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [tab, setTab] = useState<Tab>("open");
  const [reports, setReports] = useState<any[]>([]);
  const [previews, setPreviews] = useState<Record<string, any>>({});
  const [audit, setAudit] = useState<any[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    supabase.from("user_roles").select("role").eq("user_id", user.id).then(({ data }) => {
      setIsAdmin(!!data?.some(r => r.role === "admin"));
    });
  }, [user]);

  const loadReports = async () => {
    const { data } = await (supabase as any).from("reports").select("*")
      .eq("status", tab === "open" ? "open" : tab === "actioned" ? "actioned" : "dismissed")
      .order("created_at", { ascending: false }).limit(100);
    setReports(data || []);
    // fetch previews
    const postIds = (data || []).filter((r: any) => r.target_type === "post").map((r: any) => r.target_id);
    const commentIds = (data || []).filter((r: any) => r.target_type === "comment").map((r: any) => r.target_id);
    const pv: Record<string, any> = {};
    if (postIds.length) {
      const { data: ps } = await supabase.from("posts").select("id, content, media_url, removed_at").in("id", postIds);
      ps?.forEach((p: any) => { pv["post:" + p.id] = p; });
    }
    if (commentIds.length) {
      const { data: cs } = await supabase.from("comments").select("id, content, removed_at").in("id", commentIds);
      cs?.forEach((c: any) => { pv["comment:" + c.id] = c; });
    }
    setPreviews(pv);
  };

  const loadAudit = async () => {
    const { data } = await (supabase as any).from("moderation_audit_log")
      .select("*").order("created_at", { ascending: false }).limit(200);
    setAudit(data || []);
  };

  useEffect(() => {
    if (!isAdmin) return;
    if (tab === "audit") loadAudit(); else loadReports();
    const ch = supabase.channel("admin-reports")
      .on("postgres_changes", { event: "*", schema: "public", table: "reports" }, () => { if (tab !== "audit") loadReports(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line
  }, [isAdmin, tab]);

  const writeAudit = async (report: any, action: string, prev: string, next: string, notes?: string) => {
    await (supabase as any).from("moderation_audit_log").insert({
      report_id: report.id, admin_id: user!.id, action,
      target_type: report.target_type, target_id: report.target_id,
      previous_status: prev, new_status: next, notes,
    });
  };

  const removeContent = async (r: any) => {
    setBusy(r.id);
    const table = r.target_type === "post" ? "posts" : "comments";
    const { error: e1 } = await (supabase as any).from(table)
      .update({ removed_at: new Date().toISOString(), removed_by: user!.id }).eq("id", r.target_id);
    if (e1) { toast.error(e1.message); setBusy(null); return; }
    await (supabase as any).from("reports").update({ status: "actioned" }).eq("id", r.id);
    await writeAudit(r, r.target_type === "post" ? "removed_post" : "removed_comment", r.status, "actioned");
    setBusy(null);
    toast.success("Content removed");
    loadReports();
  };

  const dismiss = async (r: any) => {
    setBusy(r.id);
    await (supabase as any).from("reports").update({ status: "dismissed" }).eq("id", r.id);
    await writeAudit(r, "dismissed", r.status, "dismissed");
    setBusy(null);
    loadReports();
  };

  const review = async (r: any) => {
    await (supabase as any).from("reports").update({ status: "reviewed" }).eq("id", r.id);
    await writeAudit(r, "reviewed", r.status, "reviewed");
    loadReports();
  };

  if (!isAdmin) return <div className="p-8 text-center text-muted-foreground">Admin only.</div>;

  return (
    <div className="min-h-screen pb-24">
      <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-xl border-b border-border/30">
        <div className="flex items-center gap-3 px-4 h-14">
          <button onClick={() => navigate(-1)}><ArrowLeft className="size-5" /></button>
          <h1 className="font-display italic text-xl text-gold">Moderation</h1>
        </div>
        <div className="flex border-t border-border/20">
          {(["open","actioned","dismissed","audit"] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex-1 py-2 text-xs uppercase tracking-wider ${tab===t ? "text-gold border-b-2 border-primary" : "text-muted-foreground"}`}>{t}</button>
          ))}
        </div>
      </header>

      <div className="p-4 space-y-3">
        {tab === "audit" ? (
          audit.length === 0 ? <p className="text-center text-sm text-muted-foreground py-12">No audit entries.</p> :
          audit.map(a => (
            <div key={a.id} className="p-3 rounded-lg glass text-xs">
              <p className="text-champagne"><FileText className="size-3 inline mr-1" /><b>{a.action}</b> · {a.target_type} {a.target_id?.slice(0,8)}</p>
              <p className="text-muted-foreground">{a.previous_status} → {a.new_status} · {new Date(a.created_at).toLocaleString()}</p>
              {a.notes && <p className="text-muted-foreground italic">{a.notes}</p>}
            </div>
          ))
        ) : (
          <>
            {reports.length === 0 && <p className="text-center text-sm text-muted-foreground py-12">No {tab} reports.</p>}
            {reports.map(r => {
              const prev = previews[`${r.target_type}:${r.target_id}`];
              return (
                <div key={r.id} className="p-4 rounded-xl glass space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs uppercase tracking-wider text-gold font-bold">{r.target_type} report</span>
                    <span className="text-[10px] text-muted-foreground">{new Date(r.created_at).toLocaleString()}</span>
                  </div>
                  <p className="text-sm text-champagne"><b>Reason:</b> {r.reason}</p>
                  {r.details && <p className="text-xs text-muted-foreground">{r.details}</p>}
                  {prev ? (
                    <div className="p-2 rounded bg-background border border-border/40 text-xs">
                      {prev.removed_at && <p className="text-red-400 mb-1">[ already removed ]</p>}
                      <p className="text-muted-foreground line-clamp-3">{prev.content || "(no text)"}</p>
                      {prev.media_url && <img src={prev.media_url} alt="" className="mt-1 max-h-32 rounded" />}
                    </div>
                  ) : <p className="text-[10px] text-muted-foreground">[ target not found ]</p>}
                  {tab === "open" && (
                    <div className="flex gap-2 pt-1">
                      <button disabled={busy===r.id} onClick={() => removeContent(r)}
                        className="flex-1 py-2 rounded-lg bg-red-500/20 text-red-300 text-xs font-bold flex items-center justify-center gap-1">
                        <Trash2 className="size-4" /> Remove
                      </button>
                      <button disabled={busy===r.id} onClick={() => review(r)}
                        className="flex-1 py-2 rounded-lg bg-surface text-xs font-bold flex items-center justify-center gap-1">
                        <Eye className="size-4" /> Reviewed
                      </button>
                      <button disabled={busy===r.id} onClick={() => dismiss(r)}
                        className="flex-1 py-2 rounded-lg bg-surface text-xs font-bold flex items-center justify-center gap-1">
                        <X className="size-4" /> Dismiss
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
};
export default AdminReportsPage;
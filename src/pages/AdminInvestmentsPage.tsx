import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, CheckCircle, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

const AdminInvestmentsPage = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [apps, setApps] = useState<any[]>([]);
  const [usernames, setUsernames] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<"pending" | "approved" | "rejected">("pending");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    supabase.from("user_roles").select("role").eq("user_id", user.id).then(({ data }) => {
      setIsAdmin(!!data?.some(r => r.role === "admin"));
    });
  }, [user]);

  const load = async () => {
    const { data } = await (supabase as any)
      .from("investment_applications")
      .select("*, investment_projects(name, slug)")
      .eq("status", tab).order("created_at", { ascending: false });
    setApps(data || []);
    const uids = [...new Set((data || []).map((a: any) => a.user_id))];
    if (uids.length) {
      const { data: ps } = await supabase.from("profiles").select("user_id, username").in("user_id", uids);
      const m: Record<string, string> = {};
      ps?.forEach(p => { m[p.user_id] = p.username || p.user_id; });
      setUsernames(m);
    }
  };

  useEffect(() => {
    if (!isAdmin) return;
    load();
    const ch = supabase.channel("admin-invest")
      .on("postgres_changes", { event: "*", schema: "public", table: "investment_applications" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line
  }, [isAdmin, tab]);

  const approve = async (app: any) => {
    setBusy(app.id);
    try {
      const { data: cert, error: cErr } = await supabase.functions.invoke("issue-investment-certificate", {
        body: { application_id: app.id },
      });
      if (cErr) throw cErr;
      const { error } = await (supabase as any).rpc("approve_investment_application", {
        _app_id: app.id, _certificate_url: cert.url, _note: "Approved by admin",
      });
      if (error) throw error;
      toast.success("Approved and certificate issued");
      load();
    } catch (e: any) { toast.error(e.message || "Failed"); }
    finally { setBusy(null); }
  };

  const reject = async (app: any) => {
    const reason = prompt("Reason for rejection?") || "Not approved";
    setBusy(app.id);
    const { error } = await (supabase as any).rpc("reject_investment_application", { _app_id: app.id, _reason: reason });
    setBusy(null);
    if (error) return toast.error(error.message);
    toast.success("Rejected and refunded");
    load();
  };

  if (!isAdmin) return <div className="p-8 text-center text-muted-foreground">Admin only.</div>;

  return (
    <div className="min-h-screen pb-24">
      <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-xl border-b border-border/30">
        <div className="flex items-center gap-3 px-4 h-14">
          <button onClick={() => navigate(-1)}><ArrowLeft className="size-5" /></button>
          <h1 className="font-display italic text-xl text-gold">Investment Review</h1>
        </div>
        <div className="flex border-t border-border/20">
          {(["pending","approved","rejected"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex-1 py-2 text-xs uppercase tracking-wider ${tab===t ? "text-gold border-b-2 border-primary" : "text-muted-foreground"}`}>{t}</button>
          ))}
        </div>
      </header>
      <div className="p-4 space-y-3">
        {apps.length === 0 && <p className="text-center text-sm text-muted-foreground py-12">No {tab} applications.</p>}
        {apps.map(a => (
          <div key={a.id} className="p-4 rounded-xl glass space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-champagne">{a.investment_projects?.name}</h2>
              <span className="text-xs text-gold font-bold">{a.shares} sh · {Number(a.equity_pct).toFixed(4)}%</span>
            </div>
            <div className="text-xs text-muted-foreground grid grid-cols-2 gap-1">
              <div><b>Name:</b> {a.full_name}</div>
              <div><b>Country:</b> {a.country}</div>
              <div><b>Email:</b> {a.email}</div>
              <div><b>Phone:</b> <a href={`tel:${a.phone}`} className="text-gold">{a.phone}</a></div>
              <div className="col-span-2"><b>Address:</b> {a.address}</div>
              <div className="col-span-2"><b>Gov ID:</b> {a.gov_id}</div>
              <div className="col-span-2"><b>Paid:</b> {a.amount_jagx} JagX (@{usernames[a.user_id] || "user"})</div>
            </div>
            {a.signature_data_url && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Signature</p>
                <img src={a.signature_data_url} alt="signature" className="h-20 bg-white/90 rounded" />
              </div>
            )}
            {a.certificate_url && (
              <a href={a.certificate_url} target="_blank" rel="noopener" className="text-xs text-gold underline">View certificate PDF</a>
            )}
            {tab === "pending" && (
              <div className="flex gap-2 pt-2">
                <button disabled={busy===a.id} onClick={() => approve(a)}
                  className="flex-1 py-2 rounded-lg gold-gradient text-primary-foreground text-xs font-bold flex items-center justify-center gap-1">
                  <CheckCircle className="size-4" /> {busy===a.id ? "Working…" : "Approve & issue cert"}
                </button>
                <button disabled={busy===a.id} onClick={() => reject(a)}
                  className="flex-1 py-2 rounded-lg bg-red-500/20 text-red-300 text-xs font-bold flex items-center justify-center gap-1">
                  <XCircle className="size-4" /> Reject
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
export default AdminInvestmentsPage;
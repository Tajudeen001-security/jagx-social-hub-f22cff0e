import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, CheckCircle, XCircle, Coins } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

const ReceiptThumb = ({ path }: { path: string }) => {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!path) return;
    if (path.startsWith("http")) { setUrl(path); return; }
    supabase.storage.from("receipts").createSignedUrl(path, 3600).then(({ data }) => setUrl(data?.signedUrl || null));
  }, [path]);
  if (!url) return null;
  return <a href={url} target="_blank" rel="noopener"><img src={url} alt="receipt" className="w-full max-h-40 object-cover rounded" /></a>;
};

const AdminCoinPurchasesPage = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [rows, setRows] = useState<any[]>([]);
  const [tab, setTab] = useState<"pending" | "approved" | "rejected">("pending");
  const [busy, setBusy] = useState<string | null>(null);
  const [usernames, setUsernames] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!user) return;
    supabase.from("user_roles").select("role").eq("user_id", user.id).then(({ data }) => {
      setIsAdmin(!!data?.some(r => r.role === "admin"));
    });
  }, [user]);

  const load = async () => {
    const { data } = await supabase.from("coin_transactions").select("*")
      .eq("transaction_type", "purchase").eq("status", tab)
      .order("created_at", { ascending: false });
    setRows(data || []);
    const uids = [...new Set((data || []).map(r => r.user_id))];
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
    const ch = supabase.channel("admin-coinbuys-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "coin_transactions" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line
  }, [isAdmin, tab]);

  const approve = async (id: string) => {
    setBusy(id);
    const { error } = await (supabase as any).rpc("approve_coin_purchase", { _tx_id: id, _note: null });
    setBusy(null);
    if (error) return toast.error(error.message);
    toast.success("Credited"); load();
  };
  const reject = async (id: string) => {
    const reason = prompt("Reason?") || "Rejected";
    setBusy(id);
    const { error } = await (supabase as any).rpc("reject_coin_purchase", { _tx_id: id, _reason: reason });
    setBusy(null);
    if (error) return toast.error(error.message);
    toast.success("Rejected"); load();
  };

  if (!isAdmin) return <div className="p-8 text-center text-muted-foreground">Admin only.</div>;

  return (
    <div className="min-h-screen pb-24">
      <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-xl border-b border-border/30">
        <div className="flex items-center gap-3 px-4 h-14">
          <button onClick={() => navigate(-1)}><ArrowLeft className="size-5" /></button>
          <h1 className="font-display italic text-xl text-gold">Coin Purchases</h1>
        </div>
        <div className="flex border-t border-border/20">
          {(["pending","approved","rejected"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex-1 py-2 text-xs uppercase tracking-wider ${tab===t ? "text-gold border-b-2 border-primary" : "text-muted-foreground"}`}>{t}</button>
          ))}
        </div>
      </header>
      <div className="p-4 space-y-3">
        {rows.length === 0 && <p className="text-center text-sm text-muted-foreground py-12">No {tab} purchases.</p>}
        {rows.map(r => (
          <div key={r.id} className="p-4 rounded-xl glass space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-champagne">@{usernames[r.user_id] || "user"}</span>
              <span className="flex items-center gap-1 text-gold font-bold text-sm"><Coins className="size-4" /> {r.amount}</span>
            </div>
            <p className="text-[10px] text-muted-foreground">{new Date(r.created_at).toLocaleString()} · Ref {r.opay_reference || "—"}</p>
            {r.receipt_url && <ReceiptThumb path={r.receipt_url} />}
            {tab === "pending" && (
              <div className="flex gap-2">
                <button disabled={busy===r.id} onClick={() => approve(r.id)}
                  className="flex-1 py-2 rounded-lg gold-gradient text-primary-foreground text-xs font-bold flex items-center justify-center gap-1">
                  <CheckCircle className="size-4" /> Approve & credit
                </button>
                <button disabled={busy===r.id} onClick={() => reject(r.id)}
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
export default AdminCoinPurchasesPage;
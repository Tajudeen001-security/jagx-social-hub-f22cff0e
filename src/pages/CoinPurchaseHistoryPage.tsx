import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Coins, Clock, CheckCircle2, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import BottomNav from "@/components/BottomNav";

type Tx = {
  id: string;
  amount: number;
  status: "pending" | "approved" | "rejected";
  transaction_type: string;
  opay_reference: string | null;
  receipt_url: string | null;
  created_at: string;
};

const statusStyle = (s: string) =>
  s === "approved"
    ? "bg-green-500/15 text-green-300 border-green-500/30"
    : s === "rejected"
    ? "bg-red-500/15 text-red-300 border-red-500/30"
    : "bg-yellow-500/15 text-yellow-300 border-yellow-500/30";

const StatusIcon = ({ s }: { s: string }) =>
  s === "approved" ? <CheckCircle2 className="size-3.5" /> :
  s === "rejected" ? <XCircle className="size-3.5" /> :
  <Clock className="size-3.5" />;

const CoinPurchaseHistoryPage = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [tx, setTx] = useState<Tx[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from("coin_transactions")
      .select("id, amount, status, transaction_type, opay_reference, receipt_url, created_at")
      .eq("user_id", user.id)
      .in("transaction_type", ["purchase", "verification_purchase"])
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    setTx((data as Tx[]) || []);
    setLoading(false);
  };

  useEffect(() => {
    if (!user) return;
    load();
    const ch = supabase
      .channel(`coin-tx-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "coin_transactions", filter: `user_id=eq.${user.id}` },
        (payload: any) => {
          setTx(prev => {
            const next = [...prev];
            const idx = next.findIndex(t => t.id === (payload.new?.id || payload.old?.id));
            if (payload.eventType === "INSERT") {
              if (idx === -1) next.unshift(payload.new);
            } else if (payload.eventType === "UPDATE") {
              if (idx !== -1) {
                const prevStatus = next[idx].status;
                next[idx] = payload.new;
                if (prevStatus !== payload.new.status) {
                  if (payload.new.status === "approved") {
                    toast.success(`Purchase of ${payload.new.amount} JagX approved and credited!`);
                  } else if (payload.new.status === "rejected") {
                    toast.error(`Purchase of ${payload.new.amount} JagX rejected.`);
                  }
                }
              }
            } else if (payload.eventType === "DELETE" && idx !== -1) {
              next.splice(idx, 1);
            }
            return next;
          });
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line
  }, [user]);

  return (
    <div className="min-h-screen pb-24">
      <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-xl border-b border-border/30">
        <div className="flex items-center gap-3 px-4 h-14">
          <button onClick={() => navigate(-1)}><ArrowLeft className="size-5" /></button>
          <h1 className="font-display italic text-xl text-gold">Purchase History</h1>
        </div>
      </header>

      <div className="p-4 space-y-3">
        {loading && <p className="text-center text-sm text-muted-foreground py-8">Loading…</p>}
        {!loading && tx.length === 0 && (
          <div className="text-center py-16 space-y-3">
            <Coins className="size-12 text-gold mx-auto opacity-40" />
            <p className="text-sm text-muted-foreground">No purchases yet.</p>
            <button
              onClick={() => navigate("/coins")}
              className="px-6 py-2 rounded-xl gold-gradient text-primary-foreground text-xs font-bold uppercase tracking-widest"
            >
              Buy JagX
            </button>
          </div>
        )}
        {tx.map(t => (
          <div key={t.id} className="p-4 rounded-2xl glass gold-glow space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Coins className="size-4 text-gold" />
                  <span className="text-base font-bold text-champagne">
                    {t.amount || (t.transaction_type === "verification_purchase" ? "Verification" : 0)}
                    {t.amount ? " JagX" : ""}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {new Date(t.created_at).toLocaleString()}
                </p>
                {t.opay_reference && (
                  <p className="text-[10px] text-muted-foreground mt-0.5 break-all">
                    ref: {t.opay_reference}
                  </p>
                )}
              </div>
              <span className={`text-[10px] uppercase tracking-wider px-2 py-1 rounded-full border flex items-center gap-1 ${statusStyle(t.status)}`}>
                <StatusIcon s={t.status} /> {t.status}
              </span>
            </div>
            {t.status === "pending" && (
              <p className="text-[11px] text-yellow-300/80">
                Waiting for admin approval. You'll get a live notification the moment it's credited.
              </p>
            )}
          </div>
        ))}
      </div>
      <BottomNav />
    </div>
  );
};

export default CoinPurchaseHistoryPage;
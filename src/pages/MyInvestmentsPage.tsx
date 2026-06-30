import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import BottomNav from "@/components/BottomNav";

const STATUS_COLOR: Record<string, string> = {
  pending: "bg-yellow-500/20 text-yellow-300",
  approved: "bg-green-500/20 text-green-300",
  rejected: "bg-red-500/20 text-red-300",
};

const MyInvestmentsPage = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    if (!user) return;
    const load = async () => {
      const { data } = await (supabase as any)
        .from("investment_applications")
        .select("*, investment_projects(name)")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      setRows(data || []);
    };
    load();
    const ch = supabase.channel("my-investments")
      .on("postgres_changes", { event: "*", schema: "public", table: "investment_applications", filter: `user_id=eq.${user.id}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user]);
  return (
    <div className="min-h-screen pb-24">
      <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-xl border-b border-border/30">
        <div className="flex items-center gap-3 px-4 h-14">
          <button onClick={() => navigate(-1)}><ArrowLeft className="size-5" /></button>
          <h1 className="font-display italic text-xl text-gold">My Investments</h1>
        </div>
      </header>
      <div className="p-4 space-y-3">
        {rows.length === 0 && <p className="text-center text-sm text-muted-foreground py-12">No applications yet.</p>}
        {rows.map(r => (
          <div key={r.id} className="p-4 rounded-xl glass space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-champagne">{r.investment_projects?.name}</h2>
              <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full ${STATUS_COLOR[r.status]}`}>{r.status}</span>
            </div>
            <p className="text-xs text-muted-foreground">{r.shares} shares · {Number(r.equity_pct).toFixed(5)}% · {r.amount_jagx} JagX</p>
            {r.admin_note && <p className="text-xs text-muted-foreground italic">Note: {r.admin_note}</p>}
            {r.certificate_url && (
              <a href={r.certificate_url} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-xs text-gold font-bold">
                <FileText className="size-3.5" /> Download JRILICENSE certificate
              </a>
            )}
          </div>
        ))}
      </div>
      <BottomNav />
    </div>
  );
};
export default MyInvestmentsPage;
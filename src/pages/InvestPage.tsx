import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, TrendingUp, Coins } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import BottomNav from "@/components/BottomNav";

const InvestPage = () => {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<any[]>([]);
  useEffect(() => {
    (async () => {
      const { data } = await (supabase as any).from("investment_projects").select("*").order("created_at");
      setProjects(data || []);
    })();
  }, []);
  return (
    <div className="min-h-screen pb-24">
      <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-xl border-b border-border/30">
        <div className="flex items-center gap-3 px-4 h-14">
          <button onClick={() => navigate(-1)}><ArrowLeft className="size-5" /></button>
          <h1 className="font-display italic text-xl text-gold">Invest in JRI</h1>
        </div>
      </header>
      <div className="p-4 space-y-3">
        <button onClick={() => navigate("/invest/mine")}
          className="w-full p-3 rounded-xl glass text-sm font-semibold text-gold flex items-center gap-2">
          <TrendingUp className="size-4" /> My investments
        </button>
        {projects.map(p => {
          const pct = (p.available_shares / p.total_shares) * 100;
          return (
            <button key={p.id} onClick={() => navigate(`/invest/${p.slug}`)}
              className="w-full text-left p-4 rounded-xl glass gold-glow space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="font-display italic text-lg text-champagne">{p.name}</h2>
                <span className="text-xs text-gold font-bold">{p.equity_available_pct}% open</span>
              </div>
              <p className="text-xs text-muted-foreground">{p.description}</p>
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1 text-gold font-semibold">
                  <Coins className="size-3.5" /> {p.price_per_share_jagx} / share
                </span>
                <span className="text-muted-foreground">{p.available_shares.toLocaleString()} of {p.total_shares.toLocaleString()} left</span>
              </div>
              <div className="h-1.5 rounded-full bg-surface overflow-hidden">
                <div className="h-full gold-gradient" style={{ width: `${pct}%` }} />
              </div>
            </button>
          );
        })}
      </div>
      <BottomNav />
    </div>
  );
};
export default InvestPage;
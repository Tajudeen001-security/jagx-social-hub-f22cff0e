import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { motion } from "framer-motion";
import { Check, X as CloseIcon } from "lucide-react";

interface PollOption { id: string; text: string }

interface GroupPoll {
  id: string;
  group_id: string;
  creator_id: string;
  question: string;
  options: PollOption[];
  multi_choice: boolean;
  closes_at: string | null;
  closed_at: string | null;
}

interface GroupPollBlockProps {
  pollId: string;
  isMine: boolean;
  canModerate: boolean;
}

const GroupPollBlock = ({ pollId, isMine, canModerate }: GroupPollBlockProps) => {
  const { user } = useAuth();
  const [poll, setPoll] = useState<GroupPoll | null>(null);
  const [votes, setVotes] = useState<Record<string, number>>({});
  const [myVotes, setMyVotes] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data: pData } = await supabase
      .from("group_polls" as any)
      .select("*")
      .eq("id", pollId)
      .maybeSingle();
    if (pData) setPoll(pData as any);

    const { data: vData } = await supabase
      .from("group_poll_votes" as any)
      .select("option_id, user_id")
      .eq("poll_id", pollId);

    const counts: Record<string, number> = {};
    const mine = new Set<string>();
    (vData || []).forEach((v: any) => {
      counts[v.option_id] = (counts[v.option_id] || 0) + 1;
      if (user && v.user_id === user.id) mine.add(v.option_id);
    });
    setVotes(counts);
    setMyVotes(mine);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel(`gpoll-${pollId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "group_poll_votes", filter: `poll_id=eq.${pollId}` }, () => load())
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "group_polls", filter: `id=eq.${pollId}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollId, user?.id]);

  const closed = !!poll && (poll.closed_at !== null || (poll.closes_at !== null && new Date(poll.closes_at) < new Date()));
  const total = Object.values(votes).reduce((a, b) => a + b, 0);

  const vote = async (optionId: string) => {
    if (!user || !poll || busy || closed) return;
    setBusy(true);
    try {
      const already = myVotes.has(optionId);
      if (already) {
        await supabase.from("group_poll_votes" as any).delete().eq("poll_id", pollId).eq("user_id", user.id).eq("option_id", optionId);
      } else {
        if (!poll.multi_choice && myVotes.size > 0) {
          await supabase.from("group_poll_votes" as any).delete().eq("poll_id", pollId).eq("user_id", user.id);
        }
        await supabase.from("group_poll_votes" as any).insert({ poll_id: pollId, user_id: user.id, option_id: optionId });
      }
      load();
    } finally {
      setBusy(false);
    }
  };

  const closePoll = async () => {
    if (!poll) return;
    await supabase.from("group_polls" as any).update({ closed_at: new Date().toISOString() }).eq("id", pollId);
    load();
  };

  if (!poll) {
    return <div className="px-4 py-3 text-xs text-muted-foreground">Loading poll…</div>;
  }

  return (
    <div className={`px-4 py-3 space-y-2 ${isMine ? "" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <p className={`text-sm font-semibold ${isMine ? "text-primary-foreground" : "text-champagne"}`}>📊 {poll.question}</p>
        {canModerate && !closed && (
          <button onClick={closePoll} className={`text-[10px] uppercase tracking-wider ${isMine ? "text-primary-foreground/80" : "text-gold"}`}>
            Close
          </button>
        )}
      </div>
      {poll.options.map((opt) => {
        const count = votes[opt.id] || 0;
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        const selected = myVotes.has(opt.id);
        return (
          <button
            key={opt.id}
            onClick={() => vote(opt.id)}
            disabled={!user || closed || busy}
            className={`relative w-full text-left rounded-xl border overflow-hidden transition-colors ${
              selected ? "border-gold bg-gold/10" : isMine ? "border-primary-foreground/20 bg-black/10" : "border-border bg-surface"
            } ${closed ? "opacity-70" : ""}`}
          >
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.5 }}
              className="absolute inset-y-0 left-0 bg-gold/20"
            />
            <div className="relative flex items-center justify-between px-3 py-2">
              <span className={`flex items-center gap-2 text-sm ${isMine ? "text-primary-foreground" : "text-foreground"}`}>
                {selected && <Check className="size-3.5 text-gold" />}
                {opt.text}
              </span>
              <span className={`text-xs font-semibold ${isMine ? "text-primary-foreground" : "text-champagne"}`}>{pct}% · {count}</span>
            </div>
          </button>
        );
      })}
      <p className={`text-[10px] ${isMine ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
        {total} {total === 1 ? "vote" : "votes"}
        {poll.multi_choice && " · multi-choice"}
        {closed && " · closed"}
        {!closed && poll.closes_at && ` · closes ${new Date(poll.closes_at).toLocaleString()}`}
      </p>
    </div>
  );
};

export default GroupPollBlock;

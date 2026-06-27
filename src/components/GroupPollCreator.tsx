import { useState } from "react";
import { X, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

interface Props {
  groupId: string;
  onClose: () => void;
  onCreated: (pollId: string, question: string) => void;
}

const DURATIONS = [
  { label: "1 hour", hours: 1 },
  { label: "1 day", hours: 24 },
  { label: "1 week", hours: 24 * 7 },
  { label: "Never", hours: 0 },
];

const GroupPollCreator = ({ groupId, onClose, onCreated }: Props) => {
  const { user } = useAuth();
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState<string[]>(["", ""]);
  const [multi, setMulti] = useState(false);
  const [durationHours, setDurationHours] = useState(24);
  const [busy, setBusy] = useState(false);

  const setOpt = (i: number, v: string) => setOptions(o => o.map((x, idx) => idx === i ? v : x));
  const addOpt = () => options.length < 6 && setOptions(o => [...o, ""]);
  const removeOpt = (i: number) => options.length > 2 && setOptions(o => o.filter((_, idx) => idx !== i));

  const canSubmit = question.trim().length > 0 && options.filter(o => o.trim()).length >= 2;

  const submit = async () => {
    if (!canSubmit || !user || busy) return;
    setBusy(true);
    try {
      const cleanOpts = options
        .map(o => o.trim())
        .filter(Boolean)
        .map((text, i) => ({ id: `o${i}_${Math.random().toString(36).slice(2, 7)}`, text }));

      const closesAt = durationHours > 0 ? new Date(Date.now() + durationHours * 3600_000).toISOString() : null;

      const { data: poll, error: pErr } = await supabase
        .from("group_polls" as any)
        .insert({
          group_id: groupId,
          creator_id: user.id,
          question: question.trim(),
          options: cleanOpts,
          multi_choice: multi,
          closes_at: closesAt,
        })
        .select()
        .single();

      if (pErr || !poll) throw pErr || new Error("Failed");

      onCreated((poll as any).id, question.trim());
      onClose();
    } catch (e: any) {
      toast.error(e?.message || "Failed to create poll");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      <div className="flex items-center justify-between px-4 h-14 border-b border-border/30">
        <span className="font-semibold text-champagne">Create poll</span>
        <button onClick={onClose}><X className="size-5 text-foreground" /></button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div>
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Question</label>
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask the group…"
            maxLength={200}
            className="mt-2 w-full px-4 py-3 rounded-xl bg-surface border border-border text-sm text-foreground placeholder:text-muted-foreground outline-none"
          />
        </div>

        <div>
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Options ({options.length}/6)</label>
          <div className="mt-2 space-y-2">
            {options.map((opt, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  value={opt}
                  onChange={(e) => setOpt(i, e.target.value)}
                  placeholder={`Option ${i + 1}`}
                  maxLength={80}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-surface border border-border text-sm text-foreground placeholder:text-muted-foreground outline-none"
                />
                {options.length > 2 && (
                  <button onClick={() => removeOpt(i)} className="text-muted-foreground hover:text-destructive">
                    <Trash2 className="size-4" />
                  </button>
                )}
              </div>
            ))}
            {options.length < 6 && (
              <button onClick={addOpt} className="flex items-center gap-1 text-xs text-gold mt-1">
                <Plus className="size-3.5" /> Add option
              </button>
            )}
          </div>
        </div>

        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={multi}
            onChange={(e) => setMulti(e.target.checked)}
            className="w-4 h-4 rounded accent-yellow-500"
          />
          <span className="text-sm text-foreground">Allow multiple choices</span>
        </label>

        <div>
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Duration</label>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {DURATIONS.map(d => (
              <button
                key={d.label}
                onClick={() => setDurationHours(d.hours)}
                className={`px-3 py-2 rounded-xl text-sm border transition-colors ${
                  durationHours === d.hours ? "border-gold bg-gold/10 text-gold" : "border-border bg-surface text-foreground"
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="p-4 border-t border-border/30">
        <button
          onClick={submit}
          disabled={!canSubmit || busy}
          className="w-full py-3 rounded-xl gold-gradient text-primary-foreground font-semibold disabled:opacity-50"
        >
          {busy ? "Creating…" : "Post poll"}
        </button>
      </div>
    </div>
  );
};

export default GroupPollCreator;

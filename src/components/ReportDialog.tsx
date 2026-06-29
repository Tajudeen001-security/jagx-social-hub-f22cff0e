import { useState } from "react";
import { Flag, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

type Props = {
  open: boolean;
  onClose: () => void;
  targetType: "post" | "comment";
  targetId: string;
};

const REASONS = [
  "Spam or misleading",
  "Harassment or bullying",
  "Hate speech",
  "Nudity or sexual content",
  "Violence or dangerous acts",
  "Misinformation",
  "Scam or fraud",
  "Other",
];

export default function ReportDialog({ open, onClose, targetType, targetId }: Props) {
  const { user } = useAuth();
  const [reason, setReason] = useState<string | null>(null);
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  if (!open) return null;

  const submit = async () => {
    if (!user) { toast.error("Sign in to report"); return; }
    if (!reason) { toast.error("Pick a reason"); return; }
    setBusy(true);
    const { error } = await (supabase as any).from("reports").insert({
      reporter_id: user.id, target_type: targetType, target_id: targetId,
      reason, details: details.trim() || null,
    });
    setBusy(false);
    if (error) { toast.error("Failed to report", { description: error.message }); return; }
    toast.success("Thanks — we'll review this");
    onClose();
    setReason(null); setDetails("");
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black/70 flex items-end sm:items-center justify-center p-2" onClick={onClose}>
      <div className="bg-background border border-border/30 rounded-2xl w-full max-w-md p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold flex items-center gap-2">
            <Flag className="size-4 text-red-400" /> Report {targetType}
          </h3>
          <button onClick={onClose}><X className="size-5" /></button>
        </div>
        <p className="text-xs text-muted-foreground mb-2">Why are you reporting this?</p>
        <div className="grid gap-1 mb-3">
          {REASONS.map((r) => (
            <button key={r} onClick={() => setReason(r)}
              className={`text-left text-sm px-3 py-2 rounded-lg border ${reason === r ? "border-gold bg-surface-elevated" : "border-border/30 hover:bg-surface"}`}>
              {r}
            </button>
          ))}
        </div>
        <textarea value={details} onChange={(e) => setDetails(e.target.value)}
          placeholder="Add details (optional)"
          className="w-full text-sm bg-surface border border-border/30 rounded-lg px-3 py-2 mb-3 outline-none" rows={3} />
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-3 py-2 text-sm rounded-lg border border-border/30">Cancel</button>
          <button onClick={submit} disabled={busy || !reason}
            className="px-4 py-2 text-sm rounded-lg bg-red-500 text-white disabled:opacity-50">
            {busy ? "Reporting…" : "Submit report"}
          </button>
        </div>
      </div>
    </div>
  );
}
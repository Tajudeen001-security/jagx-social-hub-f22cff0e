import { useEffect, useRef, useState } from "react";
import { Phone, PhoneOff, Video } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface IncomingCall {
  callerId: string;
  callerName: string;
  callerAvatar?: string | null;
  callType: "video" | "audio";
}

interface IncomingCallModalProps {
  onAccept: (call: IncomingCall) => void;
  onReject: (callerId: string) => void;
}

const AUTO_DECLINE_MS = 30_000;

const IncomingCallModal = ({ onAccept, onReject }: IncomingCallModalProps) => {
  const { user } = useAuth();
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const vibrateTimerRef = useRef<number | null>(null);
  const autoDeclineTimerRef = useRef<number | null>(null);

  // Start/stop ringtone + vibration when the modal shows/hides
  useEffect(() => {
    if (!incomingCall) return;

    // Audio
    const audio = new Audio("/sounds/ringtone.mp3");
    audio.loop = true;
    audio.volume = 0.9;
    audio.play().catch(() => {
      // Autoplay blocked — silent fallback; still show modal + vibration
    });
    audioRef.current = audio;

    // Vibration (mobile)
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      const pattern = [800, 400, 800, 400, 800];
      navigator.vibrate(pattern);
      vibrateTimerRef.current = window.setInterval(() => {
        navigator.vibrate(pattern);
      }, 3000);
    }

    // Auto-decline after 30s
    autoDeclineTimerRef.current = window.setTimeout(() => {
      handleReject();
    }, AUTO_DECLINE_MS);

    return () => {
      audio.pause();
      audio.currentTime = 0;
      audioRef.current = null;
      if (vibrateTimerRef.current) {
        clearInterval(vibrateTimerRef.current);
        vibrateTimerRef.current = null;
      }
      if (autoDeclineTimerRef.current) {
        clearTimeout(autoDeclineTimerRef.current);
        autoDeclineTimerRef.current = null;
      }
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        navigator.vibrate(0);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingCall?.callerId]);

  useEffect(() => {
    if (!user) return;

    const channel = supabase.channel(`incoming-calls-${user.id}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "call_signals",
        filter: `callee_id=eq.${user.id}`,
      }, async (payload: any) => {
        const signal = payload.new;
        if (signal.signal_type !== "call-request") return;

        // Fetch caller profile
        const { data: profile } = await supabase
          .from("profiles")
          .select("username, display_name, avatar_url")
          .eq("user_id", signal.caller_id)
          .single();

        setIncomingCall({
          callerId: signal.caller_id,
          callerName: profile?.display_name || profile?.username || "Unknown",
          callerAvatar: profile?.avatar_url,
          callType: signal.call_type as "video" | "audio",
        });
      })
      .subscribe();

    // Also listen for call-ended to dismiss
    const endChannel = supabase.channel(`call-end-${user.id}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "call_signals",
        filter: `callee_id=eq.${user.id}`,
      }, (payload: any) => {
        if (["call-ended", "call-rejected"].includes(payload.new.signal_type)) {
          setIncomingCall(null);
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      supabase.removeChannel(endChannel);
    };
  }, [user]);

  const handleReject = () => {
    if (!incomingCall) return;
    onReject(incomingCall.callerId);
    // Emit call-rejected so caller stops ringing
    if (user) {
      supabase.from("call_signals").insert({
        caller_id: user.id,
        callee_id: incomingCall.callerId,
        signal_type: "call-rejected",
        signal_data: {},
        call_type: incomingCall.callType,
      });
    }
    setIncomingCall(null);
  };

  const handleAccept = () => {
    if (!incomingCall) return;
    onAccept(incomingCall);
    setIncomingCall(null);
  };

  if (!incomingCall) return null;

  return (
    <div className="fixed inset-0 z-[99] bg-black/80 backdrop-blur-sm flex items-center justify-center">
      <div className="bg-card border border-border rounded-2xl p-8 flex flex-col items-center gap-5 max-w-xs w-full mx-4 animate-in fade-in slide-in-from-bottom-4">
        <div className="relative">
          <div className="absolute inset-0 rounded-full bg-amber-500/30 animate-ping" />
          <div className="relative w-20 h-20 rounded-full bg-gradient-to-br from-amber-500 to-yellow-600 flex items-center justify-center text-3xl font-bold text-black overflow-hidden">
            {incomingCall.callerAvatar ? (
              <img src={incomingCall.callerAvatar} alt="" className="w-full h-full object-cover" />
            ) : (
              incomingCall.callerName.charAt(0).toUpperCase()
            )}
          </div>
        </div>
        <div className="text-center">
          <h3 className="text-foreground text-lg font-semibold">{incomingCall.callerName}</h3>
          <p className="text-muted-foreground text-sm flex items-center gap-1 justify-center mt-1">
            {incomingCall.callType === "video" ? <Video className="w-4 h-4" /> : <Phone className="w-4 h-4" />}
            Incoming {incomingCall.callType} call…
          </p>
        </div>
        <div className="flex gap-8 mt-2">
          <button
            onClick={handleReject}
            aria-label="Decline call"
            className="w-14 h-14 rounded-full bg-red-500 flex items-center justify-center shadow-lg"
          >
            <PhoneOff className="w-6 h-6 text-white" />
          </button>
          <button
            onClick={handleAccept}
            aria-label="Accept call"
            className="w-14 h-14 rounded-full bg-green-500 flex items-center justify-center shadow-lg animate-pulse"
          >
            <Phone className="w-6 h-6 text-white" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default IncomingCallModal;

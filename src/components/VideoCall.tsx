import { useState, useRef, useEffect, useCallback } from "react";
import { Phone, PhoneOff, Video, VideoOff, Mic, MicOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

interface VideoCallProps {
  remoteUserId: string;
  remoteUserName: string;
  remoteUserAvatar?: string | null;
  callType: "video" | "audio";
  isIncoming?: boolean;
  autoAccept?: boolean;
  onEnd: () => void;
}

const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

const VideoCall = ({ remoteUserId, remoteUserName, remoteUserAvatar, callType, isIncoming = false, autoAccept = false, onEnd }: VideoCallProps) => {
  const { user } = useAuth();
  const [callState, setCallState] = useState<"ringing" | "connecting" | "connected" | "ended">(isIncoming && !autoAccept ? "ringing" : "connecting");
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(callType === "audio");
  const [duration, setDuration] = useState(0);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ringbackRef = useRef<HTMLAudioElement | null>(null);
  const ringTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopRingback = useCallback(() => {
    if (ringbackRef.current) {
      ringbackRef.current.pause();
      ringbackRef.current.currentTime = 0;
      ringbackRef.current = null;
    }
    if (ringTimeoutRef.current) {
      clearTimeout(ringTimeoutRef.current);
      ringTimeoutRef.current = null;
    }
  }, []);

  const cleanup = useCallback(() => {
    stopRingback();
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    pcRef.current?.close();
    pcRef.current = null;
    if (channelRef.current) supabase.removeChannel(channelRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    // Clean up signals
    if (user) {
      supabase.from("call_signals").delete().or(`caller_id.eq.${user.id},callee_id.eq.${user.id}`);
    }
  }, [user, stopRingback]);

  const sendSignal = useCallback(async (signalType: string, signalData: any) => {
    if (!user) return;
    await supabase.from("call_signals").insert({
      caller_id: user.id,
      callee_id: remoteUserId,
      signal_type: signalType,
      signal_data: signalData,
      call_type: callType,
    });
  }, [user, remoteUserId, callType]);

  const setupPeerConnection = useCallback(async () => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pcRef.current = pc;

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        sendSignal("ice-candidate", { candidate: e.candidate.toJSON() });
      }
    };

    pc.ontrack = (e) => {
      if (remoteVideoRef.current && e.streams[0]) {
        remoteVideoRef.current.srcObject = e.streams[0];
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        stopRingback();
        setCallState("connected");
        timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
      } else if (["disconnected", "failed", "closed"].includes(pc.connectionState)) {
        endCall();
      }
    };

    try {
      const wantVideo = callType === "video";
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: wantVideo });
      } catch (videoErr) {
        if (wantVideo) {
          // Fallback to audio only if camera is unavailable
          toast.message("Camera unavailable — continuing with audio only");
          stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
          setIsVideoOff(true);
        } else {
          throw videoErr;
        }
      }
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      stream.getTracks().forEach(t => pc.addTrack(t, stream));
    } catch (err: any) {
      console.error("Failed to get media:", err);
      toast.error(err?.name === "NotAllowedError" ? "Microphone/camera permission denied" : "Could not access microphone or camera");
      endCall();
      return null;
    }

    return pc;
  }, [callType, sendSignal, stopRingback]);

  const startCall = useCallback(async () => {
    const pc = await setupPeerConnection();
    if (!pc) return;

    // Start ringback for caller
    try {
      const audio = new Audio("/sounds/ringback.mp3");
      audio.loop = true;
      audio.volume = 0.7;
      await audio.play().catch(() => {});
      ringbackRef.current = audio;
    } catch {}
    setCallState("ringing");

    // Send call request first
    await sendSignal("call-request", { callType });

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await sendSignal("offer", { sdp: offer });

    // Auto-cancel after 30s if no answer
    ringTimeoutRef.current = setTimeout(() => {
      toast.message("No answer");
      endCall();
    }, 30_000);
  }, [setupPeerConnection, sendSignal, callType]);

  const acceptCall = useCallback(async () => {
    setCallState("connecting");
    const pc = await setupPeerConnection();
    if (!pc || !user) return;

    // Get the pending offer
    const { data: offers } = await supabase
      .from("call_signals")
      .select("*")
      .eq("callee_id", user.id)
      .eq("caller_id", remoteUserId)
      .eq("signal_type", "offer")
      .order("created_at", { ascending: false })
      .limit(1);

    if (offers?.[0]) {
      const offerData = offers[0].signal_data as any;
      await pc.setRemoteDescription(new RTCSessionDescription(offerData.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await sendSignal("call-accepted", { sdp: answer });
    }

    // Apply any pending ICE candidates
    const { data: candidates } = await supabase
      .from("call_signals")
      .select("*")
      .eq("callee_id", user.id)
      .eq("caller_id", remoteUserId)
      .eq("signal_type", "ice-candidate");

    for (const c of candidates || []) {
      const data = c.signal_data as any;
      if (data?.candidate) {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      }
    }
  }, [setupPeerConnection, user, remoteUserId, sendSignal]);

  const endCall = useCallback(() => {
    sendSignal("call-ended", {});
    cleanup();
    setCallState("ended");
    setTimeout(onEnd, 500);
  }, [sendSignal, cleanup, onEnd]);

  const rejectCall = useCallback(() => {
    sendSignal("call-rejected", {});
    cleanup();
    onEnd();
  }, [sendSignal, cleanup, onEnd]);

  // Listen for signals from remote user
  useEffect(() => {
    if (!user) return;

    const channel = supabase.channel(`call-${user.id}-${remoteUserId}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "call_signals",
        filter: `callee_id=eq.${user.id}`,
      }, async (payload: any) => {
        const signal = payload.new;
        if (signal.caller_id !== remoteUserId) return;
        const data = signal.signal_data as any;
        const pc = pcRef.current;

        switch (signal.signal_type) {
          case "call-accepted":
            stopRingback();
            setCallState("connecting");
            if (pc && data?.sdp) {
              await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
            }
            break;
          case "ice-candidate":
            if (pc && data?.candidate) {
              try { await pc.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch {}
            }
            break;
          case "call-ended":
          case "call-rejected":
            cleanup();
            setCallState("ended");
            setTimeout(onEnd, 500);
            break;
        }
      })
      .subscribe();

    channelRef.current = channel;
    return () => { supabase.removeChannel(channel); };
  }, [user, remoteUserId, cleanup, onEnd, stopRingback]);

  // Cleanup on unmount
  useEffect(() => () => { stopRingback(); }, [stopRingback]);

  // Start or wait based on role
  useEffect(() => {
    if (!isIncoming) {
      startCall();
    } else if (autoAccept) {
      acceptCall();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isIncoming, autoAccept]);

  const toggleMute = () => {
    localStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = !t.enabled; });
    setIsMuted(!isMuted);
  };

  const toggleVideo = () => {
    localStreamRef.current?.getVideoTracks().forEach(t => { t.enabled = !t.enabled; });
    setIsVideoOff(!isVideoOff);
  };

  const formatTime = (s: number) => `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;

  return (
    <div className="fixed inset-0 z-[100] bg-black flex flex-col">
      {/* Remote video / avatar */}
      <div className="flex-1 relative flex items-center justify-center">
        {callType === "video" && callState === "connected" ? (
          <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
        ) : (
          <div className="flex flex-col items-center gap-4">
            <div className="w-28 h-28 rounded-full bg-gradient-to-br from-amber-500 to-yellow-600 flex items-center justify-center text-4xl font-bold text-black overflow-hidden">
              {remoteUserAvatar ? (
                <img src={remoteUserAvatar} alt="" className="w-full h-full object-cover" />
              ) : (
                remoteUserName.charAt(0).toUpperCase()
              )}
            </div>
            <h2 className="text-white text-2xl font-semibold">{remoteUserName}</h2>
            <p className="text-white/60 text-sm">
              {callState === "ringing" && "Incoming call..."}
              {callState === "connecting" && "Connecting..."}
              {callState === "connected" && formatTime(duration)}
              {callState === "ended" && "Call ended"}
            </p>
          </div>
        )}

        {/* Local video pip */}
        {callType === "video" && callState === "connected" && (
          <div className="absolute top-4 right-4 w-28 h-40 rounded-xl overflow-hidden border-2 border-white/20">
            <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="p-8 flex justify-center gap-6">
        {callState === "ringing" ? (
          <>
            <button onClick={rejectCall} className="w-16 h-16 rounded-full bg-red-500 flex items-center justify-center">
              <PhoneOff className="w-7 h-7 text-white" />
            </button>
            <button onClick={acceptCall} className="w-16 h-16 rounded-full bg-green-500 flex items-center justify-center animate-pulse">
              <Phone className="w-7 h-7 text-white" />
            </button>
          </>
        ) : (
          <>
            <button onClick={toggleMute} className={`w-14 h-14 rounded-full flex items-center justify-center ${isMuted ? "bg-red-500" : "bg-white/20"}`}>
              {isMuted ? <MicOff className="w-6 h-6 text-white" /> : <Mic className="w-6 h-6 text-white" />}
            </button>
            {callType === "video" && (
              <button onClick={toggleVideo} className={`w-14 h-14 rounded-full flex items-center justify-center ${isVideoOff ? "bg-red-500" : "bg-white/20"}`}>
                {isVideoOff ? <VideoOff className="w-6 h-6 text-white" /> : <Video className="w-6 h-6 text-white" />}
              </button>
            )}
            <button onClick={endCall} className="w-16 h-16 rounded-full bg-red-500 flex items-center justify-center">
              <PhoneOff className="w-7 h-7 text-white" />
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default VideoCall;

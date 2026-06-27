import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Heart, MessageCircle, Music2, Share2, Volume2, VolumeX } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";

type Video = {
  id: string;
  user_id: string;
  content: string | null;
  video_url: string;
  created_at: string;
  view_count: number;
  like_count: number;
  comment_count: number;
  liked_by_me: boolean;
};

type Profile = {
  user_id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
};

const ProfileVideosFeedPage = () => {
  const { userId, postId } = useParams<{ userId: string; postId?: string }>();
  const navigate = useNavigate();
  const { user: me } = useAuth();
  const [videos, setVideos] = useState<Video[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [muted, setMuted] = useState(true);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!userId) return;
    (async () => {
      const [{ data: prof }, { data: posts }] = await Promise.all([
        supabase
          .from("profiles")
          .select("user_id, username, display_name, avatar_url")
          .eq("user_id", userId)
          .maybeSingle(),
        supabase
          .from("posts")
          .select("id, user_id, content, video_url, created_at, view_count")
          .eq("user_id", userId)
          .not("video_url", "is", null)
          .order("created_at", { ascending: false })
          .limit(50),
      ]);
      setProfile(prof as Profile | null);
      const list = (posts || []).filter((p: any) => !!p.video_url) as any[];
      if (list.length === 0) {
        setVideos([]);
        return;
      }
      const ids = list.map((p) => p.id);
      const [{ data: likeRows }, { data: cmtRows }, { data: myLikes }] = await Promise.all([
        supabase.from("likes").select("post_id").in("post_id", ids),
        supabase.from("comments").select("post_id").in("post_id", ids),
        me
          ? supabase.from("likes").select("post_id").in("post_id", ids).eq("user_id", me.id)
          : Promise.resolve({ data: [] as any[] }),
      ]);
      const likeMap: Record<string, number> = {};
      (likeRows || []).forEach((r: any) => (likeMap[r.post_id] = (likeMap[r.post_id] || 0) + 1));
      const cmtMap: Record<string, number> = {};
      (cmtRows || []).forEach((r: any) => (cmtMap[r.post_id] = (cmtMap[r.post_id] || 0) + 1));
      const mineSet = new Set((myLikes || []).map((r: any) => r.post_id));

      const enriched: Video[] = list.map((p: any) => ({
        id: p.id,
        user_id: p.user_id,
        content: p.content,
        video_url: p.video_url,
        created_at: p.created_at,
        view_count: p.view_count || 0,
        like_count: likeMap[p.id] || 0,
        comment_count: cmtMap[p.id] || 0,
        liked_by_me: mineSet.has(p.id),
      }));

      // If a starting postId is provided, reorder so it appears first.
      if (postId) {
        const idx = enriched.findIndex((v) => v.id === postId);
        if (idx > 0) {
          const [v] = enriched.splice(idx, 1);
          enriched.unshift(v);
        }
      }
      setVideos(enriched);
    })();
  }, [userId, postId, me]);

  const toggleLike = async (v: Video) => {
    if (!me) return;
    const liked = v.liked_by_me;
    setVideos((arr) =>
      arr.map((x) =>
        x.id === v.id
          ? { ...x, liked_by_me: !liked, like_count: x.like_count + (liked ? -1 : 1) }
          : x,
      ),
    );
    if (liked) {
      await supabase.from("likes").delete().eq("post_id", v.id).eq("user_id", me.id);
    } else {
      await supabase.from("likes").insert({ post_id: v.id, user_id: me.id });
    }
  };

  const share = async (v: Video) => {
    const url = `${window.location.origin}/post/${v.id}`;
    try {
      if (navigator.share) await navigator.share({ url, title: "Check this out" });
      else {
        await navigator.clipboard.writeText(url);
        toast({ title: "Link copied" });
      }
    } catch {/* user cancelled */}
  };

  // Auto-play the video that's most visible
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const vids = root.querySelectorAll("video");
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const el = entry.target as HTMLVideoElement;
          if (entry.intersectionRatio > 0.7) {
            el.play().catch(() => undefined);
          } else {
            el.pause();
          }
        });
      },
      { threshold: [0, 0.7, 1] },
    );
    vids.forEach((v) => obs.observe(v));
    return () => obs.disconnect();
  }, [videos]);

  const headerName = useMemo(
    () => profile?.username || profile?.display_name || "profile",
    [profile],
  );

  return (
    <div className="h-screen w-screen bg-black overflow-hidden relative">
      <header className="absolute top-0 inset-x-0 z-30 flex items-center justify-between p-3 bg-gradient-to-b from-black/70 to-transparent">
        <button onClick={() => navigate(-1)} className="text-white">
          <ArrowLeft className="size-6" />
        </button>
        <p className="text-white text-sm font-semibold">@{headerName}</p>
        <button onClick={() => setMuted((m) => !m)} className="text-white">
          {muted ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
        </button>
      </header>

      <div
        ref={containerRef}
        className="h-full w-full overflow-y-scroll snap-y snap-mandatory"
        style={{ scrollbarWidth: "none" }}
      >
        {videos.length === 0 && (
          <div className="h-full w-full flex items-center justify-center text-white/70 text-sm">
            No videos yet.
          </div>
        )}
        {videos.map((v) => (
          <section
            key={v.id}
            data-video-id={v.id}
            className="snap-start h-screen w-full relative flex items-center justify-center bg-black"
          >
            <video
              src={v.video_url}
              className="h-full w-full object-contain"
              playsInline
              loop
              muted={muted}
              preload="metadata"
            />

            {/* right-side action rail */}
            <div className="absolute right-3 bottom-24 flex flex-col items-center gap-5 text-white">
              <button
                onClick={() => navigate(`/user/${v.user_id}`)}
                className="size-12 rounded-full overflow-hidden border-2 border-white"
              >
                {profile?.avatar_url ? (
                  <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-muted" />
                )}
              </button>
              <button onClick={() => toggleLike(v)} className="flex flex-col items-center">
                <Heart
                  className={`size-8 ${v.liked_by_me ? "fill-red-500 text-red-500" : ""}`}
                />
                <span className="text-xs font-semibold mt-1">{v.like_count}</span>
              </button>
              <button
                onClick={() => navigate(`/post/${v.id}`)}
                className="flex flex-col items-center"
              >
                <MessageCircle className="size-8" />
                <span className="text-xs font-semibold mt-1">{v.comment_count}</span>
              </button>
              <button onClick={() => share(v)} className="flex flex-col items-center">
                <Share2 className="size-8" />
                <span className="text-xs font-semibold mt-1">Share</span>
              </button>
            </div>

            {/* bottom caption */}
            <div className="absolute left-0 bottom-6 right-20 px-4 text-white">
              <p className="text-sm font-semibold">@{headerName}</p>
              {v.content && (
                <p className="text-sm line-clamp-3 mt-1">{v.content}</p>
              )}
              <p className="text-xs mt-2 flex items-center gap-1 opacity-80">
                <Music2 className="size-3" /> Original sound · @{headerName}
              </p>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
};

export default ProfileVideosFeedPage;
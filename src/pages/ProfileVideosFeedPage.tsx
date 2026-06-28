import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Heart, MessageCircle, Music2, Send, Share2, Volume2, VolumeX, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { getOfflineUrl } from "@/lib/offlineDownloads";

type Item = {
  id: string;
  user_id: string;
  content: string | null;
  video_url: string | null;
  image_url: string | null;
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

type Comment = {
  id: string;
  post_id: string;
  user_id: string;
  content: string;
  created_at: string;
  author?: { username: string | null; avatar_url: string | null } | null;
};

const ProfileVideosFeedPage = () => {
  const { userId, postId } = useParams<{ userId: string; postId?: string }>();
  const navigate = useNavigate();
  const { user: me } = useAuth();
  const [items, setItems] = useState<Item[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [muted, setMuted] = useState(true);
  const [commentsFor, setCommentsFor] = useState<Item | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [draft, setDraft] = useState("");
  const [offlineUrls, setOfflineUrls] = useState<Record<string, string>>({});
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
          .select("id, user_id, content, video_url, image_url, created_at, view_count")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(100),
      ]);
      setProfile(prof as Profile | null);
      const list = (posts || []) as any[];
      if (list.length === 0) {
        setItems([]);
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

      const enriched: Item[] = list.map((p: any) => ({
        id: p.id,
        user_id: p.user_id,
        content: p.content,
        video_url: p.video_url,
        image_url: p.image_url,
        created_at: p.created_at,
        view_count: p.view_count || 0,
        like_count: likeMap[p.id] || 0,
        comment_count: cmtMap[p.id] || 0,
        liked_by_me: mineSet.has(p.id),
      }));

      if (postId) {
        const idx = enriched.findIndex((v) => v.id === postId);
        if (idx > 0) {
          const [v] = enriched.splice(idx, 1);
          enriched.unshift(v);
        }
      }
      setItems(enriched);

      // Resolve any offline-cached video blobs so saved items play with no data.
      const map: Record<string, string> = {};
      await Promise.all(
        enriched
          .filter((x) => x.video_url)
          .map(async (x) => {
            const u = await getOfflineUrl(x.id);
            if (u) map[x.id] = u;
          }),
      );
      if (Object.keys(map).length) setOfflineUrls(map);
    })();
  }, [userId, postId, me]);

  const toggleLike = async (v: Item) => {
    if (!me) return;
    const liked = v.liked_by_me;
    setItems((arr) =>
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

  const share = async (v: Item) => {
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
  }, [items, offlineUrls]);

  // Comments: load + realtime
  useEffect(() => {
    if (!commentsFor) return;
    let cancelled = false;
    const load = async () => {
      const { data } = await supabase
        .from("comments")
        .select("id, post_id, user_id, content, created_at")
        .eq("post_id", commentsFor.id)
        .order("created_at", { ascending: true });
      const list = (data || []) as Comment[];
      const ids = Array.from(new Set(list.map((c) => c.user_id)));
      if (ids.length) {
        const { data: profs } = await supabase
          .from("profiles").select("user_id, username, avatar_url").in("user_id", ids);
        const map = new Map((profs || []).map((p: any) => [p.user_id, p]));
        list.forEach((c) => (c.author = map.get(c.user_id) || null));
      }
      if (!cancelled) setComments(list);
    };
    load();
    const ch = supabase
      .channel(`comments-${commentsFor.id}`)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "comments",
        filter: `post_id=eq.${commentsFor.id}`,
      }, () => load())
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(ch); };
  }, [commentsFor]);

  const sendComment = async () => {
    if (!me || !commentsFor) return;
    const txt = draft.trim();
    if (!txt) return;
    setDraft("");
    const { error } = await supabase.from("comments").insert({
      post_id: commentsFor.id, user_id: me.id, content: txt,
    } as any);
    if (error) { toast({ title: "Failed", description: error.message, variant: "destructive" }); return; }
    setItems((arr) => arr.map((x) => x.id === commentsFor.id ? { ...x, comment_count: x.comment_count + 1 } : x));
    // Notify post owner
    if (commentsFor.user_id !== me.id) {
      await supabase.from("notifications").insert({
        user_id: commentsFor.user_id, from_user_id: me.id, type: "comment", content: "commented on your post",
      } as any);
    }
  };

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
        {items.length === 0 && (
          <div className="h-full w-full flex items-center justify-center text-white/70 text-sm">
            Nothing here yet.
          </div>
        )}
        {items.map((v) => (
          <section
            key={v.id}
            data-video-id={v.id}
            className="snap-start h-screen w-full relative flex items-center justify-center bg-black"
          >
            {v.video_url ? (
              <video
                src={offlineUrls[v.id] || v.video_url}
                className="h-full w-full object-contain"
                playsInline
                loop
                muted={muted}
                preload="metadata"
              />
            ) : v.image_url ? (
              <img src={v.image_url} alt="" className="h-full w-full object-contain" />
            ) : (
              <div className="px-8 text-white text-center text-xl font-medium leading-relaxed">
                {v.content}
              </div>
            )}

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
                onClick={() => setCommentsFor(v)}
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
              {v.content && (v.video_url || v.image_url) && (
                <p className="text-sm line-clamp-3 mt-1">{v.content}</p>
              )}
              {v.video_url && (
                <p className="text-xs mt-2 flex items-center gap-1 opacity-80">
                  <Music2 className="size-3" /> Original sound · @{headerName}
                </p>
              )}
            </div>
          </section>
        ))}
      </div>

      {commentsFor && (
        <div className="absolute inset-0 z-40 flex flex-col bg-black/60" onClick={() => setCommentsFor(null)}>
          <div className="mt-auto bg-background rounded-t-2xl max-h-[70vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
              <p className="text-sm font-semibold">{comments.length} comments</p>
              <button onClick={() => setCommentsFor(null)}><X className="size-5" /></button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-2 space-y-3">
              {comments.length === 0 && <p className="text-center text-xs text-muted-foreground py-8">Be the first to comment</p>}
              {comments.map((c) => (
                <div key={c.id} className="flex gap-2">
                  <div className="size-8 rounded-full bg-muted overflow-hidden shrink-0">
                    {c.author?.avatar_url && <img src={c.author.avatar_url} className="w-full h-full object-cover" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold">@{c.author?.username || "user"}</p>
                    <p className="text-sm break-words">{c.content}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="p-3 border-t border-border/30 flex gap-2">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") sendComment(); }}
                placeholder="Add a comment…"
                className="flex-1 bg-surface border border-border/30 rounded-full px-4 py-2 text-sm outline-none"
              />
              <button onClick={sendComment} className="size-9 rounded-full gold-gradient text-primary-foreground flex items-center justify-center">
                <Send className="size-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProfileVideosFeedPage;
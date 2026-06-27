
# Phase 3 + Phase 4 Implementation Plan

Your uploaded project is now imported. It already has groups, members, a `call_signals` signaling table, `IncomingCallModal`, `VideoCall`, and a `PollBlock` component. This plan fills the missing pieces.

---

## Phase 3 — Group polls / files / remove member

### 3.1 Database (one migration)
New tables + columns:

- `group_polls` — id, group_id, creator_id, question, options (jsonb array of {id,text}), multi_choice (bool), closes_at, created_at
- `group_poll_votes` — id, poll_id, user_id, option_id, created_at (unique on poll_id+user_id when not multi)
- `group_messages.attachment_url` (text), `attachment_name` (text), `attachment_size` (int), `attachment_mime` (text) — for arbitrary file attachments; message_type adds `'file'` and `'poll'`
- Add `poll_id` column to `group_messages` so a poll appears inline in chat
- RLS: members of the group can read/vote on polls; only creator or admin can close; only creator or group admin can delete polls
- GRANTs: SELECT/INSERT/UPDATE/DELETE to authenticated, ALL to service_role
- Storage bucket `group-files` (private) + policies: group members can read, members can upload to their own user-id prefix

### 3.2 UI in `GroupChatPage.tsx`
- Plus menu next to the image button: **Photo/Video**, **File**, **Poll**
- **File send**: any mime type, uploads to `group-files`, renders as a file card (name, size, download icon) using existing message bubble
- **Poll creator modal**: question + 2–6 options + toggle multi-choice + optional duration (1h / 1d / never). Submits creates `group_polls` row, then inserts a `group_messages` row with `message_type='poll'` and `poll_id`
- **Poll rendering**: reuse/extend `PollBlock` — show options with vote counts + % bars, current user's selection highlighted, close button (creator/admin), live vote count via realtime subscription on `group_poll_votes`
- **Remove member**: in the existing Members panel, if current user `isAdmin` AND target is not self, show a small "Remove" button → confirm → `DELETE FROM group_members WHERE group_id=… AND user_id=…`; refresh list. Add an inline system message `"<admin> removed <user>"` (message_type='system')

### 3.3 Edge cases
- Cannot remove the group creator
- Polls auto-close visually when `closes_at < now()`; voting buttons disabled
- File size cap 25 MB client-side check
- Removed member should be redirected away if they're viewing the group (RLS will block their re-fetch)

---

## Phase 4 — 1:1 calling with ringtone

You already have signaling. Adding the missing ring + call lifecycle polish.

### 4.1 Ringtones
- Add two short audio files to `public/sounds/`:
  - `ringtone.mp3` (loops, plays on callee side when `IncomingCallModal` appears)
  - `ringback.mp3` (loops, plays on caller side until callee accepts/rejects/times out)
- Use generated tones (royalty-free) — I'll create them with ffmpeg (sine + envelope) so we ship a real file, not a placeholder

### 4.2 `IncomingCallModal.tsx` updates
- On show: `new Audio('/sounds/ringtone.mp3')` with `loop=true`, `.play()` (catch autoplay rejection silently)
- On hide / accept / reject / call-ended: pause + reset
- Add a **30-second auto-decline** timer that emits a `call-ended` signal and dismisses
- Vibration: `navigator.vibrate?.([800, 400, 800, 400, 800])` repeated while ringing
- Show call type badge (audio vs video) more prominently

### 4.3 `VideoCall.tsx` / caller side
- When user starts a call, play `ringback.mp3` until the first `call-answered` signal arrives or 30s timeout
- Show "Calling…" / "Ringing…" / "Connected" states with the callee's avatar
- Stop ringback on answer/timeout/cancel
- "End call" inserts a `call-ended` signal for both parties; on receipt, both sides tear down peerConnection and close the modal

### 4.4 Mount globally
- Verify `IncomingCallModal` is mounted in `App.tsx` so it works on any page (mount inside an authenticated wrapper if not already). If not mounted, add it.

### 4.5 Permissions / fallback
- If `getUserMedia` rejects (no camera/mic), show a toast and abort the call gracefully
- Audio-only fallback for video calls if no camera

---

## Out of scope this turn
- Marketplace, JagX checkout, distance-based delivery → next turn (Phase 5)
- TikTok-style profile feed → next turn (Phase 8)

## Technical notes
- All new DB writes go through a single migration with proper GRANTs + RLS
- Storage policies use `(storage.foldername(name))[1] = auth.uid()::text` so members upload under their own prefix
- Realtime: add `group_polls`, `group_poll_votes` to `supabase_realtime` publication
- Ringtone files are ~15-30 KB each, generated locally with ffmpeg

Approve and I'll implement.

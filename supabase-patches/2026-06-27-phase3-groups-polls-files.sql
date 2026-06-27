-- ============================================================
-- JagX Connect — Phase 3 patch: Group polls, file attachments, remove member
-- Apply via Supabase SQL Editor. Idempotent.
-- ============================================================

-- 1. Extend group_messages for file attachments and poll references
ALTER TABLE public.group_messages
  ADD COLUMN IF NOT EXISTS attachment_url   text,
  ADD COLUMN IF NOT EXISTS attachment_name  text,
  ADD COLUMN IF NOT EXISTS attachment_size  bigint,
  ADD COLUMN IF NOT EXISTS attachment_mime  text,
  ADD COLUMN IF NOT EXISTS poll_id          uuid;

-- 2. Polls
CREATE TABLE IF NOT EXISTS public.group_polls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.group_chats(id) ON DELETE CASCADE,
  creator_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  question text NOT NULL,
  options jsonb NOT NULL,                  -- [{id, text}, ...]
  multi_choice boolean NOT NULL DEFAULT false,
  closes_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.group_polls TO authenticated;
GRANT ALL ON public.group_polls TO service_role;

ALTER TABLE public.group_polls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Group members can view polls" ON public.group_polls;
CREATE POLICY "Group members can view polls" ON public.group_polls FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.group_members gm
                 WHERE gm.group_id = group_polls.group_id AND gm.user_id = auth.uid()));

DROP POLICY IF EXISTS "Group members can create polls" ON public.group_polls;
CREATE POLICY "Group members can create polls" ON public.group_polls FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = creator_id AND
    EXISTS (SELECT 1 FROM public.group_members gm
            WHERE gm.group_id = group_polls.group_id AND gm.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Creator or admin can update polls" ON public.group_polls;
CREATE POLICY "Creator or admin can update polls" ON public.group_polls FOR UPDATE TO authenticated
  USING (
    auth.uid() = creator_id OR
    EXISTS (SELECT 1 FROM public.group_members gm
            WHERE gm.group_id = group_polls.group_id AND gm.user_id = auth.uid() AND gm.role = 'admin')
  );

DROP POLICY IF EXISTS "Creator or admin can delete polls" ON public.group_polls;
CREATE POLICY "Creator or admin can delete polls" ON public.group_polls FOR DELETE TO authenticated
  USING (
    auth.uid() = creator_id OR
    EXISTS (SELECT 1 FROM public.group_members gm
            WHERE gm.group_id = group_polls.group_id AND gm.user_id = auth.uid() AND gm.role = 'admin')
  );

-- 3. Votes
CREATE TABLE IF NOT EXISTS public.group_poll_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id uuid NOT NULL REFERENCES public.group_polls(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  option_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (poll_id, user_id, option_id)
);

CREATE INDEX IF NOT EXISTS idx_group_poll_votes_poll ON public.group_poll_votes(poll_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.group_poll_votes TO authenticated;
GRANT ALL ON public.group_poll_votes TO service_role;

ALTER TABLE public.group_poll_votes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Group members can view poll votes" ON public.group_poll_votes;
CREATE POLICY "Group members can view poll votes" ON public.group_poll_votes FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.group_polls gp
    JOIN public.group_members gm ON gm.group_id = gp.group_id
    WHERE gp.id = group_poll_votes.poll_id AND gm.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "Group members can vote" ON public.group_poll_votes;
CREATE POLICY "Group members can vote" ON public.group_poll_votes FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id AND
    EXISTS (
      SELECT 1 FROM public.group_polls gp
      JOIN public.group_members gm ON gm.group_id = gp.group_id
      WHERE gp.id = group_poll_votes.poll_id
        AND gm.user_id = auth.uid()
        AND (gp.closes_at IS NULL OR gp.closes_at > now())
        AND gp.closed_at IS NULL
    )
  );

DROP POLICY IF EXISTS "Users can remove own vote" ON public.group_poll_votes;
CREATE POLICY "Users can remove own vote" ON public.group_poll_votes FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- 4. Admin remove member: ensure DELETE policy exists on group_members
DROP POLICY IF EXISTS "Admins or self can remove members" ON public.group_members;
CREATE POLICY "Admins or self can remove members" ON public.group_members FOR DELETE TO authenticated
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.group_members gm2
      WHERE gm2.group_id = group_members.group_id
        AND gm2.user_id = auth.uid()
        AND gm2.role = 'admin'
    )
  );

-- 5. Realtime
DO $$ BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.group_polls;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.group_poll_votes;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

-- 6. Storage bucket for arbitrary group file attachments (private; access via signed URL or via public read policy below)
INSERT INTO storage.buckets (id, name, public)
VALUES ('group-files', 'group-files', false)
ON CONFLICT (id) DO NOTHING;

-- Any authenticated user can read (group membership is enforced at the message level via RLS on group_messages).
DROP POLICY IF EXISTS "Authenticated can read group files" ON storage.objects;
CREATE POLICY "Authenticated can read group files" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'group-files');

-- Users can upload only under their own user-id prefix:  <uid>/<group>/<filename>
DROP POLICY IF EXISTS "Users can upload group files under own folder" ON storage.objects;
CREATE POLICY "Users can upload group files under own folder" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'group-files' AND
    (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Users can delete own group files" ON storage.objects;
CREATE POLICY "Users can delete own group files" ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'group-files' AND
    (storage.foldername(name))[1] = auth.uid()::text
  );

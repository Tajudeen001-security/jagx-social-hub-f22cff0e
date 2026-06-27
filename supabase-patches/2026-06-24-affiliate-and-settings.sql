-- Phase 1 + 6 + 7 schema: invite codes + referrals + affiliate program
-- RUN THIS in Supabase Dashboard → SQL Editor for project fwjxhozxlucaywpavznu
-- Safe to re-run.

-- ============ INVITE CODE on profiles ============
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS invite_code text UNIQUE,
  ADD COLUMN IF NOT EXISTS referred_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_private boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS show_active_status boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_deleted boolean DEFAULT false;

UPDATE public.profiles
SET invite_code = upper(substr(md5(random()::text || user_id::text), 1, 8))
WHERE invite_code IS NULL;

CREATE OR REPLACE FUNCTION public.profiles_set_invite_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.invite_code IS NULL THEN
    NEW.invite_code := upper(substr(md5(random()::text || NEW.user_id::text || clock_timestamp()::text), 1, 8));
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_profiles_set_invite_code ON public.profiles;
CREATE TRIGGER trg_profiles_set_invite_code
BEFORE INSERT ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.profiles_set_invite_code();

-- ============ REFERRALS table ============
CREATE TABLE IF NOT EXISTS public.referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  referred_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  bonus_jagx integer NOT NULL DEFAULT 50,
  status text NOT NULL DEFAULT 'locked' CHECK (status IN ('locked','withdrawable','claimed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  unlocked_at timestamptz,
  claimed_at timestamptz
);

GRANT SELECT, INSERT, UPDATE ON public.referrals TO authenticated;
GRANT ALL ON public.referrals TO service_role;

ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "referrals_select_own" ON public.referrals;
CREATE POLICY "referrals_select_own" ON public.referrals
  FOR SELECT TO authenticated
  USING (auth.uid() = referrer_id OR auth.uid() = referred_id);

DROP POLICY IF EXISTS "referrals_insert_self" ON public.referrals;
CREATE POLICY "referrals_insert_self" ON public.referrals
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = referred_id);

CREATE INDEX IF NOT EXISTS referrals_referrer_idx ON public.referrals(referrer_id);

-- ============ FUNCTION: redeem invite code on signup ============
CREATE OR REPLACE FUNCTION public.redeem_invite_code(_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_referrer uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not authenticated');
  END IF;

  SELECT user_id INTO v_referrer
  FROM public.profiles
  WHERE upper(invite_code) = upper(trim(_code))
  LIMIT 1;

  IF v_referrer IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid code');
  END IF;

  IF v_referrer = v_uid THEN
    RETURN jsonb_build_object('ok', false, 'error', 'cannot redeem your own code');
  END IF;

  IF EXISTS (SELECT 1 FROM public.referrals WHERE referred_id = v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already redeemed');
  END IF;

  INSERT INTO public.referrals (referrer_id, referred_id, bonus_jagx, status)
  VALUES (v_referrer, v_uid, 50, 'locked');

  UPDATE public.profiles SET referred_by = v_referrer WHERE user_id = v_uid;

  INSERT INTO public.notifications (user_id, type, content)
  VALUES (v_referrer, 'referral_signup', 'Someone joined with your invite code! 50 JagX coins are locked until you make your first coin purchase.');

  RETURN jsonb_build_object('ok', true, 'referrer', v_referrer);
END $$;

GRANT EXECUTE ON FUNCTION public.redeem_invite_code(text) TO authenticated;

-- ============ FUNCTION: unlock affiliate balances after a coin purchase ============
CREATE OR REPLACE FUNCTION public.unlock_referrals_on_purchase()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.transaction_type = 'purchase' AND NEW.status = 'approved'
     AND (OLD.status IS DISTINCT FROM 'approved') THEN
    UPDATE public.referrals
       SET status = 'withdrawable', unlocked_at = now()
     WHERE referrer_id = NEW.user_id AND status = 'locked';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_unlock_referrals_on_purchase ON public.coin_transactions;
CREATE TRIGGER trg_unlock_referrals_on_purchase
AFTER UPDATE ON public.coin_transactions
FOR EACH ROW EXECUTE FUNCTION public.unlock_referrals_on_purchase();

-- ============ FUNCTION: claim withdrawable balance to wallet ============
CREATE OR REPLACE FUNCTION public.claim_affiliate_balance()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_total int := 0;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not authenticated');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.coin_transactions
    WHERE user_id = v_uid AND transaction_type = 'purchase' AND status = 'approved'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'You must buy JagX coins at least once before claiming affiliate earnings.');
  END IF;

  SELECT COALESCE(SUM(bonus_jagx), 0) INTO v_total
  FROM public.referrals
  WHERE referrer_id = v_uid AND status = 'withdrawable';

  IF v_total <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nothing to claim yet.');
  END IF;

  UPDATE public.referrals
     SET status = 'claimed', claimed_at = now()
   WHERE referrer_id = v_uid AND status = 'withdrawable';

  UPDATE public.profiles
     SET jagx_coins = COALESCE(jagx_coins, 0) + v_total
   WHERE user_id = v_uid;

  RETURN jsonb_build_object('ok', true, 'credited', v_total);
END $$;

GRANT EXECUTE ON FUNCTION public.claim_affiliate_balance() TO authenticated;

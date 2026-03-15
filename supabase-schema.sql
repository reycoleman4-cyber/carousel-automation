-- Carousel Automation: Full multi-user schema
-- Run this in Supabase Dashboard → SQL Editor to reset from scratch.
-- Migrations are applied via MCP in practice.

-- ============================================================
-- 1. Profiles (extends auth.users)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username   TEXT UNIQUE NOT NULL,
  full_name  TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can look up other profiles (needed for team/campaign member search)
CREATE POLICY "Authenticated users can view any profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- ============================================================
-- 2. Auto-create profile on signup (captures full_name from metadata)
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  base_username TEXT;
  final_username TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = NEW.id) THEN RETURN NEW; END IF;
  base_username := LOWER(REGEXP_REPLACE(SPLIT_PART(COALESCE(NEW.email, ''), '@', 1), '[^a-z0-9]', '', 'g'));
  IF base_username = '' OR base_username IS NULL THEN base_username := 'user'; END IF;
  final_username := base_username || '_' || SUBSTRING(REPLACE(NEW.id::TEXT, '-', ''), 1, 8);
  INSERT INTO public.profiles (id, username, full_name)
  VALUES (NEW.id, final_username, COALESCE(NEW.raw_user_meta_data->>'full_name', ''))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN unique_violation THEN RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- 3. Account-level team members (owner grants full account access)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.team_members (
  owner_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (owner_id, member_id),
  CHECK (owner_id != member_id)
);

ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own team"
  ON public.team_members FOR SELECT
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can add team members"
  ON public.team_members FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can remove team members"
  ON public.team_members FOR DELETE
  USING (auth.uid() = owner_id);

-- ============================================================
-- 4. Campaign-level sharing (owner grants access to one campaign)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.campaign_members (
  owner_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  campaign_id INT  NOT NULL,
  member_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL DEFAULT 'editor',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (campaign_id, member_id),
  CHECK (owner_id != member_id)
);

ALTER TABLE public.campaign_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner manages campaign members"
  ON public.campaign_members FOR ALL
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Member can view own memberships"
  ON public.campaign_members FOR SELECT
  USING (auth.uid() = member_id);

-- ============================================================
-- 5. Team invitations (pending friend/team requests)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.team_invitations (
  id         BIGSERIAL PRIMARY KEY,
  from_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  to_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status     TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (from_id, to_id),
  CHECK (from_id != to_id)
);

ALTER TABLE public.team_invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Sender can view sent invitations"
  ON public.team_invitations FOR SELECT
  USING (auth.uid() = from_id);

CREATE POLICY "Recipient can view received invitations"
  ON public.team_invitations FOR SELECT
  USING (auth.uid() = to_id);

CREATE POLICY "Sender can send invitations"
  ON public.team_invitations FOR INSERT
  WITH CHECK (auth.uid() = from_id);

CREATE POLICY "Parties can delete invitations"
  ON public.team_invitations FOR DELETE
  USING (auth.uid() = from_id OR auth.uid() = to_id);

-- ============================================================
-- 6. Per-user settings (replaces global config.json for multi-user)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.user_settings (
  user_id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  blotato_api_key TEXT DEFAULT '',
  timezone        TEXT DEFAULT 'America/New_York',
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own settings"
  ON public.user_settings FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

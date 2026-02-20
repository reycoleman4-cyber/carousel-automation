-- Carousel Automation: Initial schema for auth + multi-tenancy
-- Run this in Supabase Dashboard → SQL Editor

-- 1. Profiles table (extends auth.users with username)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Users can read/update their own profile
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

-- Allow insert so the signup trigger can create a profile (trigger runs in auth context)
CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- 2. Trigger: auto-create profile on signup (username from email or random)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  base_username TEXT;
  final_username TEXT;
BEGIN
  -- Idempotent: skip if profile already exists (e.g. retry or duplicate)
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = NEW.id) THEN
    RETURN NEW;
  END IF;
  base_username := LOWER(REGEXP_REPLACE(SPLIT_PART(COALESCE(NEW.email, ''), '@', 1), '[^a-z0-9]', '', 'g'));
  IF base_username = '' OR base_username IS NULL THEN
    base_username := 'user';
  END IF;
  final_username := base_username || '_' || SUBSTRING(REPLACE(NEW.id::TEXT, '-', ''), 1, 8);
  INSERT INTO public.profiles (id, username)
  VALUES (NEW.id, final_username);
  RETURN NEW;
EXCEPTION
  WHEN unique_violation THEN
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 3. Team members (account-level: owner invites by username)
CREATE TABLE IF NOT EXISTS public.team_members (
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
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

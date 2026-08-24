/*
# Tighten trigger function security

## Overview
The security advisor flagged two issues with the `handle_new_user` and `update_updated_at` functions:
1. Both functions have a mutable `search_path`, which is a security risk.
2. `handle_new_user` is a SECURITY DEFINER function callable by anon and authenticated roles via the REST API.

## Changes
1. Recreate `update_updated_at` with an explicit `search_path` set to `pg_catalog, public`.
2. Recreate `handle_new_user` with an explicit `search_path` set to `pg_catalog, public`.
3. Revoke EXECUTE on `handle_new_user` from `anon` and `authenticated` so only the database trigger can invoke it.

## Security
- Both functions now have `search_path = pg_catalog, public` (immutable).
- `handle_new_user` is no longer callable via the REST API by any frontend role.
- The trigger on `auth.users` still fires correctly.
*/

-- Recreate update_updated_at with fixed search_path
DROP TRIGGER IF EXISTS plans_updated_at ON plans;
DROP FUNCTION IF EXISTS update_updated_at();

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS plans_updated_at ON plans;
CREATE TRIGGER plans_updated_at BEFORE UPDATE ON plans
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Recreate handle_new_user with fixed search_path and revoke direct access
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS handle_new_user();

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (NEW.id, NEW.email);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Revoke direct execution from anon and authenticated
REVOKE EXECUTE ON FUNCTION handle_new_user() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION update_updated_at() FROM anon, authenticated;
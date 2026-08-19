/*
# Revoke PUBLIC execute on trigger function

## Overview
PostgreSQL grants EXECUTE on functions to PUBLIC by default. The previous migration
revoked from anon and authenticated explicitly, but PUBLIC still grants access.
This revokes EXECUTE from PUBLIC on both trigger functions so no frontend role
can call them via the REST API.

## Security
- `handle_new_user()` and `update_updated_at()` are now not callable by any role
  except the database owner / trigger invoker.
*/

REVOKE EXECUTE ON FUNCTION handle_new_user() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION update_updated_at() FROM PUBLIC;
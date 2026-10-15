#!/usr/bin/env bash
# Regenerates src/lib/database.types.ts from supabase/migrations.
#
# Default: builds a throwaway database on a plain local PostgreSQL (no Docker
# needed) from tests/db/supabase-stub.sql + all migrations, then introspects it.
#   TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres npm run db:types
#
# Against your hosted project instead (after `npx supabase link`):
#   npx supabase gen types typescript --linked --schema public > src/lib/database.types.ts
set -euo pipefail
cd "$(dirname "$0")/.."

ADMIN_URL="${TEST_DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/postgres}"
DB="ar_types_$$"
BASE="${ADMIN_URL%/*}"

psql -q "$ADMIN_URL" -c "create database $DB" >/dev/null
trap 'psql -q "$ADMIN_URL" -c "drop database if exists $DB with (force)" >/dev/null' EXIT

psql -q -v ON_ERROR_STOP=1 "$BASE/$DB" -f tests/db/supabase-stub.sql >/dev/null
for f in $(ls supabase/migrations/*.sql | sort); do
  psql -q -v ON_ERROR_STOP=1 -c "set client_min_messages = warning" -f "$f" "$BASE/$DB" >/dev/null
done

npx supabase gen types typescript --db-url "$BASE/$DB" --schema public 2>/dev/null > src/lib/database.types.ts
npx prettier --log-level warn --write src/lib/database.types.ts 2>/dev/null || true
echo "Wrote src/lib/database.types.ts"

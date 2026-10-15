#!/bin/bash
# Fresh local mini-Supabase: Postgres 16 db "supa" + GoTrue + PostgREST + gateway.
# Used by the full end-to-end test in this container (no Docker images needed).
# Needs: local PostgreSQL 16 (password "postgres"), and the PostgREST + Supabase Auth
# (GoTrue) release binaries in /opt/supa. Not needed by end users.
set -e
cd "$(dirname "$0")"
SECRET=super-secret-jwt-token-with-at-least-32-characters-long
REPO="$(cd ../.. && pwd)"
pkill -x postgrest 2>/dev/null || true; pkill -x auth 2>/dev/null || true
[ -f proxy.pid ] && kill $(cat proxy.pid) 2>/dev/null || true
sleep 1
export PGPASSWORD=postgres
P="psql -h localhost -U postgres -v ON_ERROR_STOP=1 -q"
$P -d postgres -c "drop database if exists supa with (force)" -c "create database supa"
$P -d supa <<SQL
do \$\$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname='authenticator') then create role authenticator login noinherit password 'postgres'; end if;
  if not exists (select 1 from pg_roles where rolname='supabase_auth_admin') then create role supabase_auth_admin login createrole password 'postgres'; end if;
end \$\$;
grant anon, authenticated, service_role to authenticator;
create schema auth authorization supabase_auth_admin;
grant create on database supa to supabase_auth_admin;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
SQL
export GOTRUE_DB_DRIVER=postgres
export DATABASE_URL="postgres://supabase_auth_admin:postgres@localhost:5432/supa?search_path=auth"
export GOTRUE_DB_NAMESPACE=auth API_EXTERNAL_URL=http://localhost:54321/auth/v1 GOTRUE_SITE_URL=http://localhost:3100
export GOTRUE_API_HOST=127.0.0.1 PORT=54331 GOTRUE_JWT_SECRET=$SECRET GOTRUE_JWT_EXP=3600 GOTRUE_JWT_AUD=authenticated
export GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated GOTRUE_JWT_ADMIN_ROLES=service_role GOTRUE_DISABLE_SIGNUP=true
export GOTRUE_MAILER_AUTOCONFIRM=true GOTRUE_EXTERNAL_EMAIL_ENABLED=true GOTRUE_LOG_LEVEL=warn
/opt/supa/auth migrate >gotrue-migrate.log 2>&1
$P -d supa -c "grant usage on schema auth to anon, authenticated, service_role" -c "grant execute on all functions in schema auth to anon, authenticated, service_role"
$P -d supa -f $REPO/supabase/setup.sql > setup.log 2>&1
nohup /opt/supa/auth serve > gotrue.log 2>&1 &
cat > postgrest.conf <<CONF
db-uri = "postgres://authenticator:postgres@localhost:5432/supa"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "$SECRET"
server-port = 54330
server-host = "127.0.0.1"
CONF
nohup /opt/supa/postgrest postgrest.conf > postgrest.log 2>&1 &
nohup node proxy.mjs > proxy.log 2>&1 & echo $! > proxy.pid
sleep 2
echo "ANON=$(node jwt.mjs $SECRET anon)" > keys.env
echo "SERVICE=$(node jwt.mjs $SECRET service_role)" >> keys.env
curl -s localhost:54321/auth/v1/health; echo
curl -s -o /dev/null -w "rest %{http_code}\n" localhost:54321/rest/v1/ -H "Authorization: Bearer $(node jwt.mjs $SECRET anon)"

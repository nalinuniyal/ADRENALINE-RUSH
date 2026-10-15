#!/bin/bash
# Start GoTrue, PostgREST and the gateway against the existing "supa" database (no reset).
cd "$(dirname "$0")"
SECRET=super-secret-jwt-token-with-at-least-32-characters-long
export GOTRUE_DB_DRIVER=postgres DATABASE_URL="postgres://supabase_auth_admin:postgres@localhost:5432/supa?search_path=auth"
export GOTRUE_DB_NAMESPACE=auth API_EXTERNAL_URL=http://localhost:54321/auth/v1 GOTRUE_SITE_URL=http://localhost:3100
export GOTRUE_API_HOST=127.0.0.1 PORT=54331 GOTRUE_JWT_SECRET=$SECRET GOTRUE_JWT_EXP=3600 GOTRUE_JWT_AUD=authenticated
export GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated GOTRUE_JWT_ADMIN_ROLES=service_role GOTRUE_DISABLE_SIGNUP=true
export GOTRUE_MAILER_AUTOCONFIRM=true GOTRUE_EXTERNAL_EMAIL_ENABLED=true GOTRUE_LOG_LEVEL=warn
nohup /opt/supa/auth serve > gotrue.log 2>&1 &
nohup /opt/supa/postgrest postgrest.conf > postgrest.log 2>&1 &
nohup node proxy.mjs > proxy.log 2>&1 & echo $! > proxy.pid
sleep 2
curl -s localhost:54321/auth/v1/health; echo

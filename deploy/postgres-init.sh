#!/bin/sh
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres --set=app_password="$BROKER_APP_PASSWORD" <<'SQL'
CREATE ROLE broker_test LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'app_password';
CREATE DATABASE broker_blog_test OWNER broker_test;
SQL

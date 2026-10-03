#!/usr/bin/env bash
# Cria um banco limpo, aplica a imitação do Supabase e todas as migrações e roda os testes de segurança.
# Uso: PGHOST=... PGPORT=... PGUSER=postgres supabase/tests/run.sh   (precisa de um Postgres 15+ acessível)
set -euo pipefail
cd "$(dirname "$0")/.."
DB="routemap_test_$$"
psql -v ON_ERROR_STOP=1 -q -d postgres -c "create database $DB"
trap 'psql -q -d postgres -c "drop database if exists $DB" >/dev/null' EXIT
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f tests/supabase-shim.sql
for f in migrations/*.sql; do
  echo "migração: $(basename "$f")"
  psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$f" 2>&1 | grep -v NOTICE || true
  test "${PIPESTATUS[0]}" -eq 0
done
psql -v ON_ERROR_STOP=1 -q -At -d "$DB" -f tests/seguranca.sql

#!/usr/bin/env bash
set -euo pipefail

DB_VECTOR_NAME="${DB_VECTOR_NAME:-vectordb}"

# Create vector DB if missing
if ! psql -U "$POSTGRES_USER" -tAc \
  "SELECT 1 FROM pg_database WHERE datname='${DB_VECTOR_NAME}'" |
  grep -q 1; then
  echo "Creating database ${DB_VECTOR_NAME}"
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    -c "CREATE DATABASE \"${DB_VECTOR_NAME}\""
fi

# Enable pgvector in both databases
for db in "$POSTGRES_DB" "$DB_VECTOR_NAME"; do
  echo "Ensuring pgvector in ${db}"
  psql -U "$POSTGRES_USER" -d "$db" \
    -c "CREATE EXTENSION IF NOT EXISTS vector;"
done
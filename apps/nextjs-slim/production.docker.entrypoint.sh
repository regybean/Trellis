#!/usr/bin/env bash
set -euo pipefail

export_json_env() {
    local json="$1"
    [ -z "$json" ] && return 0
    while IFS='=' read -r key value; do
        export "$key"="$value"
    done < <(echo "$json" | jq -r 'to_entries[] | "\(.key)=\(.value)"')
}

export_json_env "${APP_SECRETS:-}"
export_json_env "${SECRETS:-}"

# Extract and export database credentials

export DB_USER=$(jq -r .username <<<"$DATABASE_SECRET")
export DB_PASSWORD=$(jq -r .password <<<"$DATABASE_SECRET")

# this is to remove the postgresql:// prefix for psql 
export DB_HOST=$(echo "$DB_HOST" | sed 's|postgresql://||')



export PGPASSWORD="$DB_PASSWORD"

# Create vector DB if missing
if ! psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "postgres" -tAc \
  "SELECT 1 FROM pg_database WHERE datname='${DB_VECTOR_NAME}'" |
  grep -q 1; then
  echo "Creating database ${DB_VECTOR_NAME}"
  psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "postgres" \
    -c "CREATE DATABASE \"${DB_VECTOR_NAME}\""
fi

# Enable pgvector in both databases
for db in "$DB_NAME" "$DB_VECTOR_NAME"; do
  echo "Ensuring pgvector in ${db}"
  psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$db" \
    -c "CREATE EXTENSION IF NOT EXISTS vector;"
done

pnpm db:migrate

cd apps/nextjs

# start application
npm run start:ecs
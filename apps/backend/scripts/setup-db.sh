#!/bin/bash
# ============================================================
# Jehydro Meet — Database Setup Script
# ============================================================
# Run this script once to set up the PostgreSQL database and
# apply Prisma migrations.
#
# Prerequisites:
#   1. PostgreSQL must be running (locally or via Docker)
#   2. DATABASE_URL must be set in .env or environment
#
# Usage:
#   chmod +x apps/backend/scripts/setup-db.sh
#   ./apps/backend/scripts/setup-db.sh
# ============================================================

set -euo pipefail

echo "========================================"
echo "  Jehydro Meet — Database Setup"
echo "========================================"

# Check if .env exists
if [ -f .env ]; then
  echo "[1/3] Loading environment from .env"
  set -a
  source .env
  set +a
elif [ -f .env.example ]; then
  echo "[1/3] Loading environment from .env.example (copy to .env first for production)"
  set -a
  source .env.example
  set +a
fi

# Check DATABASE_URL
if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL is not set."
  echo ""
  echo "Set it in your .env file or export it:"
  echo '  export DATABASE_URL="postgresql://jehydro:changeme@localhost:5432/jehydro_meet"'
  exit 1
fi

echo "  DATABASE_URL: $DATABASE_URL"
echo ""

# Step 1: Install dependencies
echo "[2/3] Installing dependencies..."
cd "$(dirname "$0")/.."
pnpm install

# Step 2: Run Prisma migration
echo "[3/3] Applying Prisma migrations..."
echo "  Generating Prisma client..."
npx prisma generate

echo "  Running migrations..."
npx prisma migrate deploy

echo ""
echo "========================================"
echo "  Database setup complete!"
echo "========================================"
echo ""
echo "Next steps:"
echo "  1. Start the backend:  pnpm dev"
echo "  2. Verify:             curl http://localhost:4000/health"
echo "========================================"

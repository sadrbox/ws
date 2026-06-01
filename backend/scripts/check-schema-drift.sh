#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────────
# CI-проверка дрейфа: сравнивает фактическую схему БД с schema.prisma.
# Падает (exit 1), если есть расхождения, КРОМЕ единственного осознанного —
# partial unique index `chart_of_accounts_global_code_key` (Prisma не умеет
# выражать WHERE-индексы в schema.prisma, он живёт в миграции 0_init).
#
# Запуск: sh scripts/check-schema-drift.sh   (или npm run check:drift)
# ─────────────────────────────────────────────────────────────────────────────
set -e
cd "$(dirname "$0")/.."

DIFF=$(npx prisma migrate diff \
  --from-config-datasource prisma.config.js \
  --to-schema prisma/schema.prisma \
  --script 2>/dev/null)

# Убираем комментарии, пустые строки и строку ожидаемого partial-индекса.
# `|| true` — grep без совпадений возвращает 1, что под `set -e` уронило бы скрипт.
REST=$(printf '%s\n' "$DIFF" \
  | grep -vE '^[[:space:]]*(--.*)?$' \
  | grep -v 'chart_of_accounts_global_code_key' || true)

if [ -n "$REST" ]; then
  echo "❌ Непредвиденный дрейф схемы БД ↔ schema.prisma:"
  printf '%s\n' "$DIFF"
  exit 1
fi

echo "✅ Схема БД соответствует schema.prisma (ожидаемый дрейф — только partial-индекс chart_of_accounts_global_code_key)."

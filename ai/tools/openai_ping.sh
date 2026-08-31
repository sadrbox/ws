#!/usr/bin/env bash
# Прямая проверка ключей LLM из .env (минуя сервис; берутся и закомментированные строки):
# валидность ключа и минимальный платный вызов — показывает, есть ли средства на аккаунте.
# Запуск на сервере: bash /mnt/ws/app/ai/tools/openai_ping.sh
set -u
cd "$(dirname "$0")/.."
val() { grep -E "^#?$1=" .env | head -1 | cut -d= -f2- | tr -d '\r"'; }

OK=$(val OPENAI_API_KEY); OM=$(val LLM_MODEL); [[ "$OM" == gpt* || "$OM" == o* ]] || OM=gpt-5
AK=$(val ANTHROPIC_API_KEY)

echo "== OpenAI: ключ ${OK:0:7}…(${#OK}), модель $OM"
if [[ -n "$OK" ]]; then
  echo -n "  GET /models: "; curl -s -o /dev/null -w "%{http_code}\n" https://api.openai.com/v1/models -H "Authorization: Bearer $OK"
  echo -n "  chat: "; curl -s https://api.openai.com/v1/chat/completions -H "Authorization: Bearer $OK" -H "Content-Type: application/json" \
    -d "{\"model\":\"$OM\",\"messages\":[{\"role\":\"user\",\"content\":\"Ответь одним словом: ок\"}],\"max_completion_tokens\":16}" | tr -d '\n' | head -c 400; echo
fi

echo "== Anthropic: ключ ${AK:0:10}…(${#AK})"
if [[ -n "$AK" ]]; then
  echo -n "  messages: "; curl -s https://api.anthropic.com/v1/messages -H "x-api-key: $AK" -H "anthropic-version: 2023-06-01" -H "content-type: application/json" \
    -d '{"model":"claude-sonnet-5","max_tokens":16,"messages":[{"role":"user","content":"Ответь одним словом: ок"}]}' | tr -d '\n' | head -c 400; echo
fi

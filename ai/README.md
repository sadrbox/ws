# BuhProf AI Service

Диалоговый интерфейс к 1С: пользователь ERP пишет задачу обычным языком, сервис через Claude
определяет намерение, находит объекты в 1С инструментами, спрашивает подтверждение и исполняет
операцию штатными средствами 1С через `bpapi-agent` и расширение `buhprof_api`.

```
ERP (aleppo.kz) ──JWT──► ai-service :3100 (https://ai.buhprof.kz)
                              │  Claude (AnthropicProvider) — намерение, tools
                              │  PostgreSQL buhprof_ai — очередь, диалоги, аудит
                              ▼
                     bpapi-agent (Windows, исходящий long-poll) ──► buhprof_api (1С)
```

## Запуск

Node ≥ 22.6 (TypeScript исполняется без сборки, синтаксис только «стираемый»).

    npm install
    cp .env.example .env         # заполнить
    npm run dev                  # локально, .env + .env.local
    npm start                    # production (pm2: ecosystem.config.js → ai-service)

Миграции (`migrations/*.sql`) применяются при старте автоматически.

## Конфигурация (`.env`)

| Переменная | Назначение |
|---|---|
| `DATABASE_URL` | своя база `buhprof_ai` |
| `ERP_DATABASE_URL` | база ERP, только чтение `users`/`access_rights` |
| `JWT_SECRET` | тот же, что у бэкенда ERP — принимаем его JWT |
| `ANTHROPIC_API_KEY`, `LLM_MODEL`, `LLM_EFFORT` | Claude (`claude-opus-5`, effort `medium`) |
| `LLM_PROVIDER=openai`, `OPENAI_API_KEY`, `OPENAI_BASE_URL` | OpenAI (`LLM_MODEL=gpt-5`, `BANK_EXTRACT_MODEL=gpt-5`); ключ платформы, не подписка ChatGPT; BASE_URL — для OpenAI-совместимых API |
| `AGENT_ADMIN_KEY` | заголовок `X-Admin-Key` для admin API |
| `EXTRACT_INPUT`, `EXTRACT_RETRY_FILE` | чтение документов: `auto` — модели текст, извлечённый кодом, `file` — PDF целиком (откат); автоповтор из PDF, если суммы не сошлись |
| `CONFIRM_WRITE` | `true` — карточка подтверждения перед созданием документа (§17) |
| `ALLOWED_ORIGINS` | origins браузерных клиентов для CORS (`/v1/*`) |
| `PUBLIC_URL` | адрес сервиса для агентов |
| `ERP_API_URL`, `ERP_API_KEY` | служебный канал ERP (`/bpai`): задачи и заметки чата 1С, результаты ночных проверок учёта |
| `ACCOUNTING_CHECKS_*` | ночной прогон проверок учёта по базам клиентов (E17): включение расписания, время, базы одновременно, пределы — см. `.env.example` |
| `RATE_LIMIT_QUALITY_REVIEW_PER_MIN`, `QUALITY_REVIEW_TIMEOUT_SECS` | проверка ответа клиенту моделью (E17): проверок в минуту на пользователя (10) и срок ожидания модели (90 с) |

## API

Все ответы — конверт `{success, data}` / `{success:false, error:{code,message}}`.

**Пользователи ERP** (`Authorization: Bearer <JWT ERP>`):

| Метод | Путь | Описание |
|---|---|---|
| GET | `/v1/me` | uuid, активная организация |
| GET | `/v1/agents` | агенты организации: online, доступность 1С |
| POST | `/v1/chat` | `{text, conversationId?, organizationUuid?}` → `{conversationId, state, text, confirmation?, attachments?}` |
| GET | `/v1/conversations/:id` | история диалога |

Состояния диалога (§16): `UNDERSTANDING → EXECUTING → WAITING_CLARIFICATION | WAITING_CONFIRMATION → COMPLETED | FAILED`.
На `WAITING_CONFIRMATION` клиент показывает карточку и отправляет «да»/«нет» тем же `POST /v1/chat`.

**Чат внутри 1С** (`X-Base-Token` + `X-1C-User-Id`, контракт — `docs/CONTRACT_1C_CHAT_2026-09-19.md`):
`GET /v1/onec-chat/ping`, `POST /v1/onec-chat/turn`, `GET /v1/onec-chat/conversations[/:id]`. Инструменты выполняет
форма 1С: ход отвечает `TOOL_CALLS` с `calls` (те же `commandType`/`payload`, что ушли бы агенту; `requestId` —
только у изменяющих), форма присылает `toolResults`. Подтверждение — `decision: {accepted}`. Токены баз —
`npm run base-token -- issue --base <ключ базы>` (показывается один раз), `revoke --id …`, `list`.

**Проверки учёта в базах клиентов** (JWT ERP, право «Администрирование 1С»; E17): `GET /v1/onec/accounting-checks/runs` —
журнал прогонов и идущий; `POST /v1/onec/accounting-checks/run` `{baseKey?}` → 202 `{runId}` — запуск сейчас (нужен
полный доступ). Результаты прогона уходят в ERP: `POST /bpai/checks/results`, посылка на организацию. Проверяются
организации, которые обслуживает фирма (клиенты групп сотрудников и действующих связей обслуживания), а пока их нет —
все, известные ERP. База без каталога проверок или агент без команд проверок — посылка «база не проверена»
(`catalog: null`, одна строка `_catalog` с причиной).

**Проверка ответа клиенту** (JWT ERP, любой пользователь; E17, пп. 24–25 стандарта): `POST /v1/quality/review-answer`
`{text, question?, date?}` → `{verdict, score, checks, suggestions, rewrite, model, date}` — модель чата оценивает
вывод, рекомендацию, ссылку на НПА, актуальность, краткость и уверенность; верна ли сама норма, модель не решает.
Текст не хранится; отказы — `400`, `429`, `503 LLM_DISABLED`, `502 LLM_ERROR`/`LLM_BAD_OUTPUT`, `422`, `504`.

**Агенты** (`Authorization: Bearer <agent token>` + `X-Agent-Id`): `POST /agent/v1/register`,
`POST /agent/v1/heartbeat`, `GET /agent/v1/commands?wait=N`, `POST /agent/v1/commands/:id/result`.

**Администратор** (`X-Admin-Key`): `POST/GET /admin/v1/agents`, `POST /admin/v1/agents/:id/rotate-token|disable|enable`,
`POST /admin/v1/commands`, `GET /admin/v1/commands/:id?wait=N`. CLI: `tools/admin.ts`.

## Инструменты LLM (whitelist, §13)

`search_counterparties`, `search_products`, `get_organizations`, `get_warehouses` — READ;
`create_sale` — WRITE (подтверждение при `CONFIRM_WRITE`); `post_sale`, `unpost_sale` — CRITICAL
(подтверждение всегда); `get_sale`, `get_print_forms`, `print_sale` — READ.

Идентификаторы объектов модель может использовать только те, что пришли из результатов
инструментов в этом же диалоге (`tools/registry.ts`, «виденные id»). Суммы и НДС считает 1С.

## Тесты

    npm test                                     # unit
    npm run e2e -- --customer … --product …      # сервис → агент → 1С (без LLM), 20 шагов
    npm run chat-e2e -- --customer … --product … # диалог с Claude → 1С (ТЕСТ №2 ТЗ), ~$0.1
    npm run onec-chat-e2e -- [--executor stub] [--pdf …] # чат внутри 1С от имени формы, ~$0.1

Оба e2e поднимают сервис локально против серверной базы (`.env.local`), создают временного
агента и запускают `bpapi-agent.exe` с временным конфигом; в конце убирают за собой.

## Развёртывание

Сервер: `/mnt/ws/app/ai` (= `w:\app\ai`), pm2 `ai-service`, cloudflared `ai.buhprof.kz → :3100`.
Деплой = файлы на месте + `pm2 restart ai-service`.

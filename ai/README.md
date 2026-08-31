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
| `CONFIRM_WRITE` | `true` — карточка подтверждения перед созданием документа (§17) |
| `ALLOWED_ORIGINS` | origins браузерных клиентов для CORS (`/v1/*`) |
| `PUBLIC_URL` | адрес сервиса для агентов |

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

Оба e2e поднимают сервис локально против серверной базы (`.env.local`), создают временного
агента и запускают `bpapi-agent.exe` с временным конфигом; в конце убирают за собой.

## Развёртывание

Сервер: `/mnt/ws/app/ai` (= `w:\app\ai`), pm2 `ai-service`, cloudflared `ai.buhprof.kz → :3100`.
Деплой = файлы на месте + `pm2 restart ai-service`.

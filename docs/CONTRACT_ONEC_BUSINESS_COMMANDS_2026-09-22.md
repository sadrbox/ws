# Контракт бизнес-команд: сервис → агент → расширение buhprof_api

22.09.2026, по итогам аудита согласованности. Парные документы:
[ONEC_AGENT_CLUSTER_CONTRACT.md](ONEC_AGENT_CLUSTER_CONTRACT.md) — АДМИНИСТРАТИВНЫЕ команды (кластер и базы
через `rac`/COM), [CONTRACT_1C_CHAT_2026-09-19.md](CONTRACT_1C_CHAT_2026-09-19.md) — канал «форма 1С ↔ сервис».

## Зачем этот документ

Бизнес-команды не были описаны нигде. Административные имеют контракт на полторы сотни страниц, канал чата —
свой, а тридцать четыре команды, которыми помощник создаёт реализации, читает долги и печатает формы, жили
только в коде реестра инструментов (`ai/src/tools/registry.ts`) и в памяти тех, кто его писал. Из-за этого
белый список агента (`bpapi_agent`) и обработчики расширения делаются «по образцу соседней команды»: имя
можно опечатать, поле — назвать иначе, и узнается это на живой базе.

Здесь — ровно то, что сервис КЛАДЁТ В КОМАНДУ. Что делает с этим 1С, описывает сторона расширения.

## Два пути одной команды

Команда одна, путей два, и оба обязаны понимать один и тот же payload:

1. **Веб-чат ERP** — сервис ставит команду в очередь (`commands`), её забирает бизнес-агент (`role = business`)
   и выполняет в базе через шлюз расширения. Здесь действуют очередь, `requestId`, сроки и отмена.
2. **Чат внутри 1С** — сервис возвращает форме `state: "TOOL_CALLS"` со списком вызовов, форма выполняет их
   в сеансе пользователя и приносит результаты следующим ходом. Агент не участвует вовсе.

Из этого следует правило: **payload не зависит от пути**. Единственное, что добавляется на первом пути, —
`baseKey` (агент снимает его и в 1С не передаёт) и `requestId` у изменяющих команд.

## Адресация базы и организации

- `baseKey` — ставит сервис, когда у агента несколько баз. Выбор: явная организация вызова (`organizationId`
  из `get_organizations`), затем БИН организации ERP, затем единственная база агента.
- `organizationBin` — БИН организации внутри базы: у многофирменной базы он говорит, от чьего имени работать.
  В канале 1С сервис подставляет БИН, выбранный в форме, ПОВЕРХ выбора модели.
- `organizationId` — служебное поле маршрутизации для инструментов БЕЗ `organizationBin`: сервис по нему
  выбирает базу и в 1С не отправляет.

## Идентификаторы объектов

Всякий `*Id` в payload — GUID объекта 1С, который ранее пришёл В ЭТОТ ЖЕ диалог из результата поиска или
чтения. Сервис проверяет это до постановки команды и отклоняет выдуманные (`ToolInputError`). Расширению
перепроверять происхождение не нужно; ненайденный объект — обычный отказ `NOT_FOUND`.

## Требования к сборке агента

Агент перечисляет типы команд, которые знает, в `capabilities` при регистрации. Сервис с 22.09 не ставит
команду, которой в перечне нет: отвечает `409 CAPABILITY_MISSING` («обновите агента») сразу, а не через
минуту ожидания и `UNKNOWN_COMMAND` по сети. Перечня нет вовсе (старая сборка) — сервис не мешает.

## Команды

Обязательные поля выделены **жирным**. Класс: `READ` — выполняется сразу; `WRITE` — карточка подтверждения
пользователю; `CRITICAL` — подтверждение всегда. «Меняет» — нужен `requestId` (повтор с тем же `requestId`
не должен создать второй документ).

| Команда | Инструмент модели | Класс | Меняет | Поля payload |
|---|---|---|---|---|
| `SEARCH_COUNTERPARTIES` | `search_counterparties` | READ | — | **q**, limit |
| `SEARCH_PRODUCTS` | `search_products` | READ | — | **q**, limit, kind |
| `GET_ORGANIZATIONS` | `get_organizations` | READ | — | — |
| `GET_WAREHOUSES` | `get_warehouses` | READ | — | — |
| `CREATE_SALE` | `create_sale` | WRITE | да | **customerId**, warehouseId, organizationId, contractId, priceIncludesVat, date, comment, **items** |
| `GET_SALE` | `get_sale` | READ | — | **documentId** |
| `POST_SALE` | `post_sale` | CRITICAL | да | **documentId** |
| `UNPOST_SALE` | `unpost_sale` | CRITICAL | да | **documentId** |
| `GET_PRINT_FORMS` | `get_print_forms` | READ | — | **documentId** |
| `IMPORT_BANK_STATEMENT` | `import_bank_statement` | WRITE | да | **statementId**, **account**, **period**, **lines**, organizationBin, openingBalance, closingBalance, totalIn, totalOut (см. ниже) |
| `POST_BANK_DOCUMENTS` | `post_bank_documents` | CRITICAL | да | statementIds, documents |
| `CREATE_INVOICE` | `create_invoice` | WRITE | да | **customerId**, organizationId, organizationBin, contractId, warehouseId, priceIncludesVat, date, comment, **items** |
| `GET_INVOICE` | `get_invoice` | READ | — | **documentId** |
| `CREATE_PURCHASE` | `create_purchase` | WRITE | да | **supplierId**, warehouseId, organizationId, organizationBin, contractId, priceIncludesVat, date, incomingNumber, incomingDate, comment, **items** |
| `GET_PURCHASE` | `get_purchase` | READ | — | **documentId** |
| `POST_PURCHASE` | `post_purchase` | CRITICAL | да | **documentId** |
| `UNPOST_PURCHASE` | `unpost_purchase` | CRITICAL | да | **documentId** |
| `CREATE_RECONCILIATION_ACT` | `create_reconciliation_act` | WRITE | да | **counterpartyId**, **from**, **to**, organizationBin, contractId, post, comment |
| `RECONCILE_STATEMENT` | `reconcile_statement` | READ | — | **statementId**, **account**, **period**, **lines**, organizationBin, openingBalance, closingBalance, totalIn, totalOut (см. ниже) |
| `LIST_PRINT_FORMS` | `list_print_forms` | READ | — | **documentType**, **documentId** |
| `PRINT_DOCUMENT` | `print_document` | READ | — | **documentType**, **documentId**, **form**, format |
| `RUN_REPORT` | `run_report` | READ | — | **report**, **from**, **to**, account, organizationBin, bySubaccounts, counterpartyId, subconto, format |
| `PRINT_SALE` | `print_sale` | READ | — | **documentId**, **form** |
| `LIST_DOCUMENT_TYPES` | `list_document_types` | READ | — | — |
| `LIST_DOCUMENTS` | `list_documents` | READ | — | **documentType**, **from**, **to**, counterpartyId, organizationBin, posted, minAmount, maxAmount, limit |
| `CREATE_COUNTERPARTY` | `create_counterparty` | WRITE | да | **name**, **bin**, kind, fullName, comment |
| `CREATE_PRODUCT` | `create_product` | WRITE | да | **name**, **kind**, unit, vatRate, article, comment |
| `GET_DEBTS` | `get_debts` | READ | — | **onDate**, kind, counterpartyId, organizationBin, overdueOnly, limit |
| `GET_BALANCES` | `get_balances` | READ | — | **onDate**, accounts, organizationBin |
| `GET_TURNOVERS` | `get_turnovers` | READ | — | **account**, **from**, **to**, by, organizationBin, limit |
| `CREATE_CASH_ORDER` | `create_cash_order` | WRITE | да | **direction**, **counterpartyId**, **amount**, purpose, date, contractId, organizationBin, comment |
| `GET_CASH_ORDER` | `get_cash_order` | READ | — | **documentId** |
| `POST_CASH_ORDER` | `post_cash_order` | CRITICAL | да | **documentId** |
| `UNPOST_CASH_ORDER` | `unpost_cash_order` | CRITICAL | да | **documentId** |

### Выписка разворачивается до постановки

`statementId` — не единственное, что уходит в 1С. Разобранную выписку сервис держит у себя и перед постановкой
команды разворачивает её в payload целиком (`workflow.preparePayload` → `statementPayload`): счёт
(`account`: `iik`, `bik`, `bankName`), период, обороты и остатки, а главное — строки `lines`
(`number`, `date`, `direction`, `amount`, `knp`, `purpose`, `counterparty`). Иначе расширению пришлось бы
читать хранилище сервиса, то есть заводить ещё один канал ради одной команды. Сам `statementId` остаётся
пометкой: по нему сервис сопоставляет ответ с загруженным файлом и не даёт провести выписку дважды.
Сверка (`RECONCILE_STATEMENT`) получает ровно тот же payload, но ничего не пишет.

## Что сервис ждёт в ответе

- **Успех** — `{ "success": true, "data": … }`. Для созданных документов в `data` — `id` и `number`
  (или `document: { id, number }`): по ним панель и форма строят ссылку на документ. Для кассового ордера
  обязательно `direction` (`in`/`out`) — вид документа по команде не угадывается.
- **Списки** (`LIST_DOCUMENTS`, `GET_DEBTS`, `GET_TURNOVERS`) — строки в `rows`/`items` плюс `total`, когда
  строк больше присланного предела: по нему модель говорит «показаны 20 из 320» вместо молча обрезанного
  списка.
- **Печать** (`PRINT_DOCUMENT`, `PRINT_SALE`, `RUN_REPORT`) — файл в `data.content` (base64) для веб-чата;
  в канале 1С форма оставляет файл у себя и присылает `{ "contentOmitted": true, "bytes": N }`.
- **Отказ** — `{ "success": false, "error": { "code", "message" } }`. Коды, которые сервис понимает особо:
  `REQUEST_IN_PROGRESS` (та же операция ещё идёт — переждать), `BASE_REQUIRED`, `MIXED_BASES`,
  `CONTRACT_AMBIGUOUS` (вернуть кандидатов договоров), `EXTENSION_MISSING`, `LICENSE_LIMIT`. Остальные
  показываются человеку текстом как есть — поэтому текст пишется для человека, а не для журнала.

## Чего здесь нет

- **Изменения и удаления документов.** Есть создание, чтение, проведение и отмена проведения. Правка
  проведённого документа из чата — отдельное решение об ответственности, не техническая задача.
- **Задачи и заметки организации** (`TASKS_*`, `NOTES_*`) — их исполняет САМ сервис в ERP, в 1С они не идут.
- **Форматы ответов по полям.** Их задаёт расширение; сверка — при первом прогоне на живой базе (РБ11
  в [PLAN_ONEC_EXTENSION_2026-09-22.md](PLAN_ONEC_EXTENSION_2026-09-22.md)). Если сторона 1С назовёт поля
  иначе, меняется этот документ и `buildPayload` в реестре инструментов — пока расширение не установлено ни
  у кого, это дёшево.

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
  В канале 1С сервис подставляет БИН, выбранный в форме, ПОВЕРХ выбора модели. В веб-чате (канал агента) —
  БИН АКТИВНОЙ ОРГАНИЗАЦИИ ERP, и с 23.09 не только когда по нему искали базу, но и когда базу назвали объекты
  вызова: кассовый ордер приходит с `counterpartyId` из нужной базы и без БИН получал `409
  ORGANIZATION_REQUIRED`, а модель БИН знать не может, пока не спросит `get_organizations`. Два ограничения:
  выбор модели (`organizationBin`/`organizationId` в вызове) не перезаписывается, и БИН подставляется ТОЛЬКО
  если агент сообщил, что такая организация в этой базе есть — иначе в базе одной фирмы, работавшей без БИН,
  начались бы отказы.
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
| `CREATE_COUNTERPARTY` | `create_counterparty` | WRITE | да | **name**, **bin**, fullName, comment |
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

### Два поля, из-за которых уже ломались команды

**`kind` у контрагента — не роль.** До 23.09 сервис слал `kind: buyer|supplier|both` (роль), а расширение
читало тем же именем вид лица (`legal`/`individual`). Роль не доезжала никуда и доехать не может: в типовой
её задаёт вид договора, а не карточка контрагента. Решение владельца 23.09: вид лица зовётся `entityKind`,
а `kind` из схемы `create_counterparty` убирается. **Убран в сервисе 23.09**: в payload его больше нет, в
описании инструмента сказано, что роль определится при первом документе. `entityKind` сервис не шлёт, и в таблице команд его нет:
модели вид лица знать неоткуда — она видит только то, что сказал человек, а по БИН расширение выводит его
надёжнее. Если расширению всё же нужно получать вид лица СНАРУЖИ — скажите, поле добавим в схему; пока в
контракте его быть не должно, иначе сверка полей (`tools/contract_diff.py`) будет вечно показывать
расхождение, которого никто не собирается чинить.

**`direction` у кассового ордера — и в запросе, и в ответе.** В команде направление приходит строкой
(`in` — приходный, `out` — расходный), основание — полем `purpose`. В ОТВЕТЕ расширение обязано вернуть
`direction` рядом с `type`: по `type` строится печать (`documentType=cashIn|cashOut`), а по `direction`
сервис выбирает вид документа для ссылки пользователю. Без него всякий расходный ордер открывался бы как
приходный, то есть как чужой документ. До 23.09 расширение ждало булево `income` и поле `basis` — команда
не выполнялась вовсе.

## Команды, которых нет у модели

Эти команды живут в агенте и в шлюзе расширения, но в перечне инструментов их нет намеренно — их зовут
панель, служебные проверки и ночной прогон, а не разговор:

| Команда | Кто зовёт | Зачем |
|---|---|---|
| `HEALTH` | агент | проверка доступности расширения в базе, версия в срезе агента |
| `LIST_REPORTS` | панель, отладка | какие штатные отчёты база умеет формировать |
| `SELF_CHECK` | панель, `POST /v1/onec/bases/:key/self-check` | самопроверка базы: что настроено, а что нет |
| `LIST_ACCOUNTING_CHECKS` | ночной прогон проверок учёта (E17, `ai/src/onec/accountingChecksRunner.ts`) | каталог проверок и снимков этой базы: коды, область, вид периода, параметры с умолчаниями |
| `RUN_ACCOUNTING_CHECK` | ночной прогон, `POST /v1/onec/accounting-checks/run` | одна проверка учёта: `{check, organizationBin?, from?, to?, onDate?, limit}` → находки с устойчивым `fingerprint` |
| `GET_ACCOUNTING_SNAPSHOT` | ночной прогон | снимок данных для сравнения вне 1С: `{snapshot, organizationBin, from, to}` (`taxes`, `documents`) |

**Проверки учёта (E17) — волна 1 сдана 25.09: расширение 1.7.3, агент `2026-09-25 21:58`.** Формат
ответа, `fingerprint`, области (`scope: base` — без `organizationBin`), виды периода и правила чтения — в
[TASK_EXTENSION_ACCOUNTING_CHECKS_2026-09-25.md](TASK_EXTENSION_ACCOUNTING_CHECKS_2026-09-25.md)
(раздел «Дополнение 25.09» — как именно сервис зовёт команды); что 1С сделала фактически — поля `details`
каждой проверки, замеры, отступления — в
[TASK_SERVICE_ACCOUNTING_CHECKS_2026-09-25.md](TASK_SERVICE_ACCOUNTING_CHECKS_2026-09-25.md).

| Команда | Операция шлюза | HTTP расширения |
|---|---|---|
| `LIST_ACCOUNTING_CHECKS` | `checks.list` | `GET /v1/checks` |
| `RUN_ACCOUNTING_CHECK` | `checks.run` | `POST /v1/checks/run` |
| `GET_ACCOUNTING_SNAPSHOT` | `snapshots.get` | `POST /v1/snapshots` |

- Все три — READ, без `requestId` (агент держит это тестом). Прогон и снимок идут `POST` только потому, что
  вложенный `params` не выразить в строке запроса.
- `params` сервис пока не шлёт — действуют умолчания каталога.
- Волна 1 — одиннадцать проверок, снимков в каталоге ещё нет: `GET_ACCOUNTING_SNAPSHOT` существует и
  отвечает `CHECK_UNKNOWN`. Ночной прогон зовёт только то, что перечислил каталог.
- Отказы: `CHECK_UNKNOWN` (404), `BAD_PARAMS` (400, допустимые — в `details.allowed`), `PERIOD_REQUIRED`
  (400), `ORGANIZATION_REQUIRED` (409), `ACCESS_DENIED` (403, в `details` — объект, на который нет прав;
  панель главбуха показывает его как «Нет прав в 1С», а не как сбой).
- **«Не умеет».** С агентом `2026-09-25 21:58` и новее база со старым расширением отвечает `UNKNOWN_COMMAND`.
  Агенты 25.09 11:56–21:58 при расширении старше 1.7.0 отвечают `ONEC_BAD_RESPONSE` с `onecHttpStatus: 404`
  (HTTP) или `NOT_FOUND` «…нет среди бизнес-операций» (COM). Сервис считает «не умеет» все три
  (`isCapabilityMissing` в `ai/src/onec/accountingChecks.ts`), и ERP получает `CAPABILITY_MISSING`.

Итоги уходят в ERP одной посылкой на организацию: `POST /bpai/checks/results`
(`backend/services/quality/checks.js`). Инструментов модели для них нет; в форме чата 1С есть своя кнопка
«Проверка учёта» — те же проверки в сеансе пользователя, мимо сервиса.

## Что сервис ждёт в ответе

- **Успех** — `{ "success": true, "data": … }`. Для созданных документов в `data` — `id` и `number`
  (или `document: { id, number }`): по ним панель и форма строят ссылку на документ. Для кассового ордера
  обязательно `direction` (`in`/`out`) — вид документа по команде не угадывается (сделано в расширении
  23.09; там же основание возвращается полем `purpose`, как и приходит).
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

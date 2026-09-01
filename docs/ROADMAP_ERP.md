# Промпт-задачи развития ERP (РК) — на фактическом стеке проекта

> Документ = исполняемый промпт для реализации по эпикам. Каждая задача **обязана**
> следовать конвенциям ниже. Стек из «идеального» описания (Tailwind / React Hook Form /
> Zod) **НЕ применяется** — фактический стек другой; смешение = техдолг и нарушение стиля.

## 0. Конвенции проекта (ОБЯЗАТЕЛЬНО для каждой задачи)

**Frontend:** React + TS + Vite. **Формы** — `useFormStore` (не RHF), **валидация** — в
`buildPayload`/сервисах (не Zod). **Стили** — SCSS-модули (`*.module.scss`, `styles.X`),
**без inline-стилей и без Tailwind**. **Списки** — `<ModelList>`/`<Table>`; статичные/
read-only — `buildStaticTableProps`. **Таблицы позиций** — `SubTable`/`TradeDocumentItemsTable`.
**Лукапы** — `LookupField`/`FormLookup`/`ClassifierLookup` (единое ядро). Компоненты
**component-only** для HMR (не добавлять не-компонентные экспорты в модули-компоненты).
i18n — `translate()` + ключи в `translations.json` + `translations.kk.json` (RU+KK).
Данные — `@tanstack/react-query`. Реестр — `modelRegistry`.

**Backend:** Node + Express + Prisma(PostgreSQL). Роутеры-фабрики
(`_documentItemsFactory`, `_documentHeaderFactory`, `_cashOrderFactory`). **Миграции —
ТОЛЬКО вручную** (`migrate diff` → `psql` → `migrate resolve --applied` → `generate`);
`migrate dev` ЗАПРЕЩЁН (сбрасывает данные). Тесты — `node --test` в `__tests__/`.
Изоляция арендатора — `tenantFilter(req)`; блокировка периодов — `assertPeriodOpen`;
права — `UserAccessRight`/`useUserAccessRight`. Секреты не коммитить; `pm2 restart
backend-node` — только по команде пользователя.

**Процесс на каждую задачу:** проанализировать существующее → не ломать стиль → минимум
техдолга → миграции+сервис+API+валидация+компоненты+типы+i18n+тесты+запись в журнал.
Проверки перед сдачей: `tsc -b`=0, прод-сборка, `npm test`, ручной прогон затронутого флоу.

---

## 1. Текущее состояние (уже реализовано — НЕ строить заново)

Организации, Пользователи/права (`UserAccessRight`), Контрагенты, Номенклатура
(бренды, штрихкоды, ед.изм, ТН ВЭД/КПВЭД, изображения, цены/типы цен), Склады,
Документы (Реализация, Закупка, Возвраты, Перемещение, Счета вход./исх., Счёт на
оплату, Заказы, КП, Резерв, Заявки), Касса/Банк/Платежи, План счетов + проводки +
ОСВ + закрытие месяца + блокировка периодов, ФИФО/средняя себестоимость, Терминал
продаж, Фискальный чек (каркас), Отчёты (продажи/остатки/касса), Мультиязычность RU/KK.
**Гос-РК:** ЭСФ (полный маппинг InvoiceV2 + категории/грузо-/госзакуп/корректировочные/
валидация), СНТ/ЭАВР (исх. подпись+upload+статус; вх. = опрос `queryUpdate`/список +
приём CONFIRM/DECLINE — но БЕЗ импорта тела в локальный документ; спец-категории СНТ и
корр-цепочки СНТ/ЭАВР не покрыты — см. E7 T7.7–T7.14), ЭДО, Классификаторы (страны/ТН ВЭД/
КАТО/ГС ВС + импорт XML), eGov-автозаполнение (каркас). Не проверено на живом ЭЦП (T7.1).

---

## 2. Эпики и задачи (пробелы vs описание + hardening)

### E1 — Безопасность
- **T1.1 2FA** (TOTP): модель `UserTwoFactor` (secret, enabled, backupCodes), эндпоинты
  enroll/verify/disable, шаг ввода кода в auth-флоу; UI в `Users`/профиле. Придерживаться
  текущего JWT+refresh.
- **T1.2 Аудит действий**: расширить `ActivityHistory` до сквозного журнала (кто/что/когда/
  diff) на всех документах через общий middleware/сервис; UI-просмотр в `ActivityHistories`.
- **T1.3 Резервное копирование** — ⏳ ГОТОВО ручное (2026-08-30): `services/backup.js` (`runBackup`:
  pg_dump→gzip в `backups/` + ротация `BACKUP_RETENTION_COUNT`=14; `listBackups`), роутер
  `/admin/backup`(POST)+`/admin/backups`(GET) суперадмину, секция `BackupSection` в SyncDashboard
  (кнопка + список). Требует бинарь pg_dump на сервере; `backups/` в .gitignore. ✅ АВТОЗАПУСК
  (2026-08-31): единый планировщик `services/scheduler.js` (`registerTask`/`startScheduler` —
  дедуп, не-чаще-интервала, ошибки изолированы, `.unref()`; тест `scheduler.test.js` 5); в server.js
  зарегистрированы задачи `backup` (opt-in `BACKUP_INTERVAL_HOURS`) и `audit-prune` (раз в сутки при
  `AUDIT_RETENTION_DAYS>0`). Разрозненные `setInterval` убраны. Планировщик закрывает и T7.4/ретенцию.
- **T1.4 Ревизия RBAC**: покрыть новые эндпоинты `useUserAccessRight`/серверной проверкой;
  тест-матрица прав.

### E2 — API-платформа (API First)
- **T2.1 OpenAPI/Swagger** — ✅ (2026-08-31): `services/openapi.js` (`buildOpenApiSpec` — интроспекция
  стека Express `app._router.stack`, восстановление метод+полный путь, теги по ресурсу, `:id`→`{id}`),
  роутер `openapi.js` → `GET /api/v1/openapi.json` + `GET /api/docs` (Swagger UI с cdnjs, свой CSP);
  смонтирован ДО authMiddleware (публичная дока). Тест `openapi.test.js` (5, headless на mock-app).
  Схемы тел — задел; ответы generic. Валидацию на Zod НЕ меняли.
- **T2.2 Webhooks**: модель `Webhook`(orgUuid,event,url,secret,enabled) + доставка (очередь/
  ретраи) на ключевые события (создан/проведён/отправлен ЭСФ); UI управления.
- **T2.3 Унификация REST**: свести GET-списки к единому контракту (cursor/limit/filter/sort/
  search) — многие уже так; выявить расхождения, привести к фабрике `_documentHeaderFactory`.
- **T2.4 Импорт/экспорт** — ⏳ ЯДРО ВЫНЕСЕНО (2026-08-31): `frontend/src/utils/sheetIO.ts`
  (`mapRowsByHeader` — колонки по синонимам; `recordsToAoa`; `readWorkbookAoa`/`downloadAoa` —
  XLSX-обёртки), `ProductImportExport` переведён на него (доказано переиспользование). Тест
  `sheetIO.test.ts` (5). ОСТАЁТСЯ: UI импорта/экспорта для контрагентов/остатков на этом ядре.

### E3 — Производительность (1M товаров / 100 польз.)
- **T3.1 Виртуализация таблиц** — ✅ по факту кода (сверка 2026-08-28): `@tanstack/react-virtual`
  в `Table` (VirtualPaddingRow/startIndexVirtual в TableBody.tsx). Замер на 100k+ — при желании.
- **T3.2 Redis-кэш**: подключить Redis для справочников/классификаторов/прав (инвалидация
  по write); фича-флаг, чтобы работать и без Redis. ⛔ нужна инфраструктура Redis.
- **T3.3 Индексы БД** — ⏳ аудит проведён (2026-08-28): схема зрелая (437 @@index, композиты
  горячих путей на месте — напр. `ProductRegister[productUuid,warehouseUuid,date]`,
  `AccountingEntry[organizationUuid,date]`). Реальный пробел закрыт: `AccountingEntry[documentUuid]`
  (миграция `20260828160000_idx_entry_document`) — отчёты «продажи по товару»/ABC/прибыль фильтруют
  проводки по documentUuid БЕЗ типа, составной [documentType,documentUuid] не применялся.
- **T3.4 Загрузка больших списков**: пагинации в UI НЕТ намеренно (виртуализация/полная
  загрузка) — оптимизировать через виртуальный скролл (T3.1) + индексы (T3.3) + кэш (T3.2),
  а НЕ вводить постраничную навигацию.

### E4 — Realtime (SSE, не WS)
- **T4.1 Realtime-сервер** — ✅ по факту кода (сверка 2026-08-30). Не WS, а **SSE**: `GET /chat/stream?token=JWT`
  (`chatStream.js`, смонтирован ДО authMiddleware — EventSource не шлёт заголовки) + шина
  `services/chatBus.js` (`publish(orgUuid, {type,...})` / `subscribe(orgs, onEvent)`, каналы по орг,
  суперадмин — все орг). Фронт `services/liveEvents.ts` (`onLiveEvent(type, handler)`), heartbeat за
  cloudflared. Масштаб на 1 инстанс (pm2 fork); для многих — Postgres LISTEN/NOTIFY (без Redis).
- **T4.2 Live-уведомления** — ⏳ ЧАСТИЧНО. Работает: чат (`type:"chat"` → бейдж `useChatUnread`),
  назначение задачи (`type:"task"` → тост исполнителю, `app/index.tsx`), статусы ЭСФ/СНТ/ЭАВР при
  смене (`type:"govdoc"` → refetch outbox, `GovDocs/index.tsx`, 2026-08-30) и кросс-панельное
  «Основание» → № при присвоении номера (`type:"docnumber"` из `ensureDocumentNumber` при переходе
  «б/н → №» → `BasisDocumentField` перерезолвит подпись, 2026-08-30). ОСТАЁТСЯ: общий
  Notification-поток (централизованного createNotification нет).
- **T4.3 Совместное редактирование-lock**: мягкая блокировка документа при открытии другим.

### E5 — UI/UX (Mobile First, темы)
- **T5.1 Тёмная/светлая тема** — ⏳ ВКЛЮЧЕНА opt-in (2026-08-28). Инфраструктура+dark-палитра были
  готовы (index.html `--sv-*`/`--c-*`/`--n-*` для light+dark; `variables.scss` `$x:var(--sv-x,light)`).
  Проведена миграция хардкод-цветов на токены `var(--token, #hex)` — СВЕТОИНВАРИАНТНО (fallback=исходный
  hex, токен подобран по ТОЧНОМУ совпадению светлого значения): 34 в .scss (осталось 3 декоративных —
  золотой градиент/outline) + 41 инлайн-цвет в .tsx (осталось 8 one-off). `ThemeSwitcher` раскрыт в
  Navbar; политика OPT-IN: по умолчанию светлая, системный dark НЕ авто-включаем (`theme.ts` всегда ставит
  явный data-theme), тёмная — только явным выбором. tsc/ratchet40/build/417 тестов ✅.
  ФИКС (2026-08-28): миграция ошибочно обернула hex внутри `rgba(#hex,α)` SCSS-функций → невалидный CSS →
  «невидимые элементы» в ядре UI (27 мест: Table/Toolbar/IconButton/HeaderTogglePosted/main/…); откачено
  к `rgba(#hex,α)`. Правило: НЕ оборачивать hex в var() внутри rgba/darken/lighten/mix (см. память E5).
  ОСТАЁТСЯ (нужна ВИЗУАЛЬНАЯ выверка в браузере): переключить в тёмную и проверить патчи — 8 tsx one-off
  (#b00020/#bb0000/#ef6c00/#1976d2/светлые тинты), rgba-оверлеи (не мигрированы, обычно нейтральны), и
  подстройка dark-значений палитры (никогда не выверялись визуально). Переключатель в GeneralSettings
  (сейчас в Navbar) — опц. Светлой теме миграция не вредит (инвариант).
- **T5.2 Адаптивность**: планшет/мобайл для ключевых списков и форм (терминал продаж уже
  «лёгкий»); брейкпоинты в SCSS.
- **T5.3 Единый дизайн-язык**: заменить оставшиеся raw `select/button/input` на
  `FieldSelect/Button/Field` (частично сделано — Classifiers); линт-правило против raw.

### E6 — Склад: расширения
- **T6.1 Партии и серийные номера**: модели `ProductBatch`/`SerialNumber` + связь с позициями
  и регистром `ProductRegister`; учёт при списании/приёмке; ФИФО по партиям.
- **T6.2 Документы склада**: `WriteOff`(списание), `GoodsReceipt`(оприходование),
  `StockCount`(инвентаризация) — по паттерну существующих (шапка+позиции фабриками, проводки,
  блокировка периодов, номерация).
- **T6.3 Резерв/остатки**: доработать регистр резервирования под заказы/партии.

### E7 — Гос-РК (приоритет)
- **T7.1 Сквозной тест ЭСФ/СНТ/ЭАВР с реальным ЭЦП** на контуре (test3): выверить
  upload/changeStatus/queryUpdate/тело action; закрыть приём вх. СНТ/ЭАВР.
- **T7.2 Виртуальный склад (ВС)**: TaxpayerStoreWebService — движение по ВС, привязка СНТ/
  остатков (SDK «Документация ВС SDK»). Отдельный трек.
- **T7.3 Онлайн-ККМ**: интеграция ОФД (реальный провайдер вместо stub в `services/fiscal`).
- **T7.4 Авто-обновление классификаторов**: cron `queryUpdate`/импорт ТН ВЭД/КАТО/ГС ВС
  (дельта по changeId), запись версии; кнопка ручного обновления есть.
- **T7.5 eGov активация**: подключить `EGOV_DATASET`/`EGOV_API_KEY`; заполнение ЮЛ по БИН.
- **T7.6 catalogTruId (G18)**: подтвердить формат (код ГС ВС vs числовой id) на живом ИС ЭСФ;
  при необходимости импортировать числовые id ВС в `Classifier.extra`.

#### Сверка с эталоном ConfDB_1C (2026-08-11) — статус по факту кода
Легенда: ✅ есть · ⚠️ частично · ❌ нет. В app это НЕ чистый лист: общий SOAP-клиент
(`services/esf/soapClient.js`, namespace параметризован esf/snt/awp), общая сессия ЭСФ
(`sessionId` создаётся в `createSessionSigned`, приходит от клиента во все три потока —
см. `api/router/govdocs.js`), классификация фолтов (`classifyFault`, 8 категорий) вшита в
`soapCall` → работает для всех трёх. NCALayer подключён и для СНТ/ЭАВР (исх. и вх. действия,
`useNcaLayerSign` в `models/GovDocs`). Prisma-поля: `snt*`/`awp*` на Sale+InventoryTransfer,
`catalogTruId`/`truOriginCode` на Product, `esfRelatedInvoiceUuid` на OutgoingInvoice.

- **T7.1 (E) Сквозной тест с реальным ЭЦП** — ❌ блокер доверия. Код полон пометок «точная
  схема тела action / статусы проверяются на живой сессии». Прогнать upload+приём+статус на
  тест-контуре: T7.1a ЭСФ, T7.1b СНТ, T7.1c ЭАВР. До этого тела действий СНТ/ЭАВР — гипотеза.
- **T7.2 (D) Виртуальный склад** — ❌ 0% (grep TaxpayerStore/Vstore = 0). Отдельный клиент
  `TaxpayerStoreWebService`/`VstoreSessionService` (ДРУГОЙ хост/порт/сессия — не смешивать с
  `esf/index.js`). Референс — расширение `esf_exchange` (`ИнтеграцияВС.ПротоколВС`, без привязки
  к вендору). T7.2b — `FnoMatchingWebService` (трансграничная сверка, см. T7.10).
- **T7.4 (F2) Авто-обновление классификаторов** — ❌ крона в проекте нет (см.
  `services/auditLog.js`: «планировщика нет»). Либо завести планировщик, либо TTL-обновление;
  ТН ВЭД/КАТО/ГС ВС/страны (сейчас только ручной импорт).
- **T7.6 (F1) catalogTruId placeholder** — ⚠️ в `services/esf/invoiceMapper.js` `truOriginCode`
  ЗАЩИЩЁН guard'ом (`/^[1-6]$/`, иначе дефолт), а `catalogTruId` эмитится вслепую
  (`product.catalogTruId || "1"`). Задача: (а) на исходящем не подставлять «1» молча, а
  помечать отсутствие реального ТРУ; (б) при появлении импорта (T7.13) ЗАПРЕТИТЬ матчинг
  номенклатуры по `catalogTruId="1"` (прямой урок 1C — случайные совпадения между товарами).

- **T7.7 (A2) Единая таксономия ошибок для трёх сервисов** — ⚠️. `classifyFault` (уровень
  SOAP-фолта) общий. НО обогащение по каталогу кодов (`errorCatalog.enrichErrors`: офиц. текст +
  категория) применяется ТОЛЬКО в ЭСФ `syncInvoice`. Вынести в общий слой и применить в
  `uploadSnt`/`uploadAwp`/`changeStatus`. Плюс регресс-тест инварианта «один sessionId на
  ЭСФ+СНТ+ЭАВР» (A1 — уже выполняется, зафиксировать тестом). ✅ enrichErrors-часть ЗАКРЫТА (2026-08-30):
  `enrichErrors(parseUploadErrors(xml))` в `uploadSnt`/`uploadAwp` (T7.8) И в `changeSntStatus`/
  `changeAwpStatus` — поле `errors[]` в ответе + отдаётся из `govdocs.js` change-status эндпоинтов.
  Остаётся только регресс-тест инварианта «один sessionId» (A1 — работает, зафиксировать тестом).
- **T7.8 (B3) Построчные ошибки СНТ/ЭАВР** — ⏳ BACKEND ГОТОВ (2026-08-28). Общий парсер
  `services/esf/parseUploadErrors.js` (`parseUploadErrors` — все блоки `<error>` c
  errorCode/text|description|errorText/property + фолбэк на верхнеуровневую ошибку; `joinErrorText`).
  `uploadSnt`/`uploadAwp` теперь `enrichErrors(parseUploadErrors(xml))` → поле `errors[]` в ответе;
  роутер `govdocs.js` upload пишет свод в `sntErrorText`/`awpErrorText` и отдаёт `errors[]` форме.
  Юнит-тест `__tests__/parseUploadErrors.test.js` (7, headless — чистый парсер). Формат ответа СНТ/
  ЭАВР — гипотеза до живого контура (T7.1); парсер устойчив к вариантам имён. Также частично закрывает
  T7.7 (enrichErrors теперь и в СНТ/ЭАВР). UI ГОТОВ (2026-08-28): `errors[]` в `AwpResult`/`SntResult`
  (services/govdocs/api.ts) → тост со списком построчных ошибок после выписки на формах Реализации и
  Перемещения. ✅ ПОСТОЯННАЯ панель ошибок (2026-08-31): компонент `components/GovDocErrors`
  (рендерит свод `sntErrorText`/`awpErrorText`/`esfErrorText`, сохраняемый бэкендом — виден и после
  переоткрытия, в отличие от тоста), подключён на формах Реализации (ЭАВР+СНТ) и Перемещения (СНТ).
  i18 `govDocErrorsTitle`. T7.8 полностью ✅.
- **T7.9 (B1) 17 табличных частей СНТ** — ❌. `services/snt/mapper.js` заполняет только базовый
  `productSet` (в комментарии: «наборы алкоголь/нефть/маркировка/транспорт не заполняются»). По
  `Documents\СНТ.xml` расписать под-задачами: этил.спирт, виноматериал, пиво, алкоголь,
  нефтепродукты, биотопливо, табак, маркированные товары, экспортный контроль, сведения о грузе,
  погруз/разгруз, таксировка. Сейчас НЕ маппится ни одна спец-категория. Включать инкрементально.
- **T7.10 (B2) СопоставлениеСНТиФНО (fnoMatching)** — ❌ не найдено. Решить, нужен ли поток
  сверки с таможенной декларацией (документ + `FnoMatchingWebService`, см. T7.2b).
- **T7.11 (C1) Корректировочные цепочки СНТ/ЭАВР** — ✅ (backend 2026-08-28, UI 2026-08-30). Поля
  `Sale.awpRelatedUuid`, `Sale.sntRelatedUuid`, `InventoryTransfer.sntRelatedUuid` (миграция
  `20260828150000_gov_correction_chain`, РУКОПИСНАЯ — только ADD COLUMN). Персист в `sales.js`/
  `inventorytransfers.js`. Резолв в `govdocs.js` (build-xml ЭАВР + СНТ): связанный документ →
  `{date,number,registrationNumber}` → `opts.related` → мапперы эмитят `<relatedAwp>`/`<relatedSnt>`
  (SNT только для RETURNED_SNT/FIXED_SNT), как ЭСФ `relatedInvoice`. ИМЯ/ПОРЯДОК тега — гипотеза
  до сверки на живом контуре (T7.1). UI (2026-08-30): FormLookup «Основной ЭАВР/СНТ (для корректировки)»
  на форме Реализации (2 поля, endpoint sales) и Перемещения (1 поле, endpoint inventory-transfers),
  видны у СОХРАНЁННОГО документа; GET/:id обоих роутеров резолвит `*RelatedName` (№/б/н) для отображения.
  i18n govAwpRelated/govSntRelated (RU+KK).
- **T7.13 (H1) Импорт входящего ЭСФ → Поступление с find-or-create** — ⏳ BACKEND ГОТОВ
  (ОС Трек B, 2026-08-15): модели `EsfInbound`/`EsfInboundLine`, роутер `esf-inbounds` (список/
  деталь/ручное создание + `POST /:id/to-purchase`), сервис `services/esf/inboundToPurchase.js`
  (`buildPurchaseFromInbound`: разнос строк ТМЗ/ОС → Purchase + purchaseItems +
  purchaseFixedAssetItems; суммы ОС уже на 2410). ОСТАЛОСЬ: живой pull строк из ИС ЭСФ
  (`queryInvoiceById` даёт только статусы — нужен парсер полного тела + сессия, под T7.1);
  UI-мастер разнесения (пока через API/overrides). Импорт СНТ/ЭАВР — по этому же паттерну.
- **T7.14 (H2) Общий резолвер справочников** — ✅ (2026-08-30): резолверы вынесены в
  `services/esf/resolver.js` + `createResolverContext(client,{organizationUuid})` — контекст с
  ОБЩИМ кэшем на сделку (`counterpartyByBin`/`product`/`fixedAsset`, ключ = БИН / ТН ВЭД+имя / имя;
  адресный маппинг мимо кэша; кэшируется in-flight промис → дедуп при параллели). Один БИН/товар/ОС
  резолвится раз за сделку — ЭСФ+СНТ+ЭАВР переиспользуют его без дублей. `inboundToPurchase.js`
  переведён на контекст (чистые функции реэкспортированы для совместимости). Тест `esfResolver.test.js`
  (6). Память маппинга `EsfLineMapping` — прежняя.
- **ОС Трек A — классификация номенклатуры** — ✅ (2026-08-15): `Product.assetKind`
  (goods|material|fixed_asset) + селектор в карточке; `EsfLineMapping` (память) +
  `suggestAssetKind` (эвристика по цене) в `services/esf/classification.js`. D1 разрешён: overrides
  → строка → память → подсказка. Тесты esfClassification(5)+esfInboundToPurchase(4).
- **T7.G1 (G) NCALayer в СНТ/ЭАВР** — ✅ подключён (исх. подпись + вх. CONFIRM/DECLINE). Остаётся
  подтвердить приём подписи контуром в рамках T7.1b/T7.1c.

**Порядок E7:** T7.1 (живой контур) → T7.7+T7.8 (диагностируемость, дёшево) → T7.11
(корр-цепочки) → T7.13+T7.14 (импорт+резолвер) → T7.9 (17 ТЧ, инкрементально) → T7.2+T7.4
(ВС, крон — отдельные эпики).

### E8 — Банки и платежи
- **T8.1 Импорт банк-выписок** — ⏳ ГОТОВО (2026-08-30): парсер `services/bank/parseStatement.js`
  (формат `1CClientBankExchange` — де-факто стандарт РК/РФ, + CSV с шапкой-синонимами; ЧИСТЫЙ,
  headless-тесты) + сервис `importBankStatements.js` (направление по IBAN счёта организации /
  owner-счёту файла / явной колонке; контрагент = другая сторона, find-or-create по БИН через общий
  [[resolver]]; дедуп по {number,date,amount,direction} в рамках орг+счёт; строки создаются
  НЕпроведёнными). Эндпоинт `POST /bank-statements/import` (текст в body, без multer). UI:
  `models/BankStatements/ImportButton.tsx` (модалка: организация+счёт+файл) в тулбаре списка —
  через новый opt-in проп `ModelList.extraButtons` (проброс в `Table.extraButtons`). Тест
  `__tests__/bankImport.test.js` (11, HEADLESS). i18 bankImport* (RU+KK). Форматы: 1C, CSV и
  **MT940** (SWIFT, 2026-08-30: теги :25:/:61:/:86:, направление из D/C-признака, контрагент из :86:).
  ОСТАЁТСЯ (nice-to-have): автопривязка платежа к счёту-фактуре/договору (сейчас только контрагент).
- **T8.2 Банковские API**: Kaspi/Halyk/Freedom — реестр провайдеров (как fiscal), выписки/
  платёжные ссылки; секреты через AppSetting/ENV, не в коде.

### E9 — CRM
- **T9.1 Сделки/воронка** — ✅ (2026-08-28). Модель `Deal` (stage/status/amount/probability/
  expectedCloseDate + FK контрагент/организация/ответственный), миграция `20260828140000_crm_deals`
  (РУКОПИСНАЯ — полный дифф тянул дрейф: DROP INDEX штрихкодов/trigram). Backend `deals.js` (CRUD,
  flatten имён связей, stage won/lost → status). Front: форма+список (`models/Deals`) + канбан
  `DealsKanban` (колонки-стадии, перенос через select→PUT). Меню CRM → «Сделки», гейт `can("Deal")`.
- **T9.2 Взаимодействия**: комментарии/задачи/история по контрагенту (переиспользовать `Todos`/
  `Contacts`). Задел: заметки/задачи «из записи» уже есть ([[project_notes_feature]]).

### E10 — Отчёты — ✅ в основном готово
Каркас `Reports` содержит 15 отчётов. По факту кода (сверка 2026-08-28):
- **T10.1 ABC/XYZ** — ✅ `ABCReport` (вклад в выручку) + `XYZReport` (2026-08-28, совмещённый
  ABC-XYZ: XYZ по коэффициенту вариации помесячного нетто-спроса, месяцы без продаж=0; матрица 3×3).
  Backend `reports/sales-by-product` (ABC) + `reports/sales-by-product-xyz` (помесячные количества).
- **T10.2 Прибыль** — ✅ в `SalesReport`/`sales-by-product` (выручка−себестоимость из проводок 7010,
  акциз исключён; сходится с ОСВ при ФИФО/средней) + `ManagerReport`.
- **T10.3 Движение товаров** — ✅ `reports/product-movements` + `InventoryTurnoverReport`/
  `MaterialStatement` (приход/расход/остаток, себестоимость единым движком `costingReplay`).

### E11 — Модульность и данные
- **T11.1 Вкл/выкл модулей** — ✅ (2026-08-28). Флаги в `AppSetting` (ключ `modules.disabled.<orgUuid>`
  = JSON-массив, без миграции), 7 модулей: sales/purchase/warehouse/cash/hr/govdocs/edo. Backend
  `services/moduleAccess.js` (кэш + `moduleGuardMiddleware`: 403 MODULE_DISABLED на POST создания
  документа отключённого модуля) + роутер `module-settings` GET/PUT (PUT — суперадмин). Front:
  `config/modules.ts` + `useDisabledModules` (скрытие групп в NavList) + админ-пейн `ModuleSettings`.
  Гард покрывает create-POST sales/purchase/склад(4)/касса(3)/ЗП(2); govdocs/edo скрыты в UI (их POST —
  интеграционные действия, не create-коллекции). Читать/править историю отключённого модуля можно.
- **T11.2 Журнал изменений на всех сущностях** (см. T1.2) как сквозная возможность модуля.

### E12 — Качество
- **T12.1 TS strict-аудит**: добить оставшиеся `source-any` помодульно (мерить `tsc` после каждой).
- **T12.2 Покрытие тестами** — ⏳ прирастает (2026-08-28). Frontend 391→**417**: чистая логика
  ABC-XYZ вынесена в `models/Reports/_shared/xyz.ts` + тесты (`xyzAnalysis` 20, `asText` 6,
  `dealStages` 4). Backend +2 HEADLESS-файла (без БД): `parseUploadErrors.test.js` (7, T7.8),
  `govMappers.test.js` (6 — buildSntV1Xml/buildAwpV1Xml вкл. relatedSnt/relatedAwp T7.11).
  Прирост 2026-08-30: `esfResolver.test.js` (6, T7.14), `bankImport.test.js` (11, T8.1 — парсер
  1C/CSV/MT940 + сервис импорта), `listUtils.test.js` (9 — idSearchCondition/buildOrderBy);
  фронт `datetime.test.ts` (13). Остаётся: `documentChain`, `recomputeCosting`, интеграционные (БД).
- **T12.3 Рефактор по SOLID/DRY**: вынести повторы (фабрики уже частично); убрать мёртвый код.

### E13 — Технический долг / качество (по аудиту 2026-08-15)
Замеры на момент аудита: backend-тесты 275/275 ✅, frontend-тесты 390/390 (~14% файлов) ✅,
`tsc` strict ✅, **ESLint frontend 1668 ошибок** (не в CI), 281 источник `any`, CI гонял только
Windows-бандл. Статус: ✅ сделано · ⏳ в работе · ❌ бэклог.
- **Q1 ✅ Ворота CI** (`.github/workflows/ci.yml`, 2026-08-15): frontend `tsc -b`+`vitest` (блок.) +
  `eslint` (non-blocking baseline); backend `prisma migrate deploy`+`seed-accounting`+`node --test`
  на сервисе Postgres. Первый прогон на GitHub проверить (окружение не воспроизводилось локально).
  УСИЛЕНО (2026-08-31): + backend `lint:ratchet` в CI (линтер появился позже) + новый job `ai`
  (`tsc --noEmit`). Плюс ЛОКАЛЬНЫЙ pre-commit хук `.githooks/pre-commit` (через `core.hooksPath`):
  гоняет `npm run verify` только затронутых пакетов (frontend tsc+ратчет+vitest; backend ратчет+
  headless-тесты `scripts/test-headless.mjs`; ai tsc) — красный отменяет коммит (важно при auto-commit
  в main). Скрипт `verify` добавлен в 3 пакета; `test:headless`/`test:full` — в backend.
- **Q4 ✅ `no-floating-promises`** (16 мест, 2026-08-15): `void`/`.catch` в app/index, BasisDocumentField,
  Table (Delete), Contacts (dynamic import), DocumentNumberSettings, OrganizationAccountingSettings,
  Files/FileView*Pane, SyncDashboard, UserDefaults. Убирает тихие необработанные отклонения.
- **Q12 ✅ Устойчивость ленивой загрузки** (`registry/viewRegistry.ts`, 2026-08-15): `retryImport` в
  `lazyView` — при «Failed to fetch dynamically imported module» (перезапуск Vite-dev / устаревший
  чанк после деплоя) повтор import + однократный reload (флаг в sessionStorage). Лечит наблюдаемые
  на aleppo.kz сбои `/src/models/*.tsx`.
- **Q2 ✅ Тип-безопасность (каскад any)** (2026-08-28): baseline ESLint 1668→**40**. Ключевое —
  типизация параметра печати `items: any[]`→`InvoicePrintRow[]` в `createInvoiceLikeForm` (сняла весь
  каскад unsafe-* по 8 моделям), `LookupRow` вместо `Record<string,any>`, `asText` для base-to-string,
  синглтоны (`liveEvents`,`UI/index`). Трещотка `frontend/.eslint-baseline`=40 + `scripts/eslint-ratchet.mjs`
  + шаг CI `lint:ratchet`. Остаток 40 — намеренный: моки в тестах, дженерик-контракты
  (`useFormStore` колбэки, `FormLookup<F extends Record<string,any>>`, `TComponentNode`), Node-скрипты `require()`.
- **Q3 ⚠️ `react-hooks/exhaustive-deps` — 105**: безопасное подмножество разобрано. Остаток: ~65 —
  намеренный ложноположительный паттерн (колбэки зависят от стабильных под-ссылок `form.setFields`/
  `form.store`, а не от нестабильного объекта `form`; добавить `form` = пересоздавать колбэки каждый
  рендер без выигрыша); ~40 — требуют пер-хук рантайм-разбора (риск циклов/устаревших замыканий).
- **Q5 ✅ `no-base-to-string`** (2026-08-28): 96→0. Утилита `asText(v: unknown): string` (примитивы→
  строка, Date→ISO, null/объект→"") в построителях подписей и лукапах (`ClassifierLookup`, `usePrimaryChild`).
- **Q6 ✅ Мёртвый код** (2026-08-15): удалён `backend/api/v1_old.js` (0 ссылок). Заодно вычищен
  мёртвый проп `parentLabel` (объявлен в `TradeDocumentItemsTable`, не рендерился) + 8 call-site и
  осиротевший конфиг `parentLabelListKey` (3 конфига + интерфейс фабрики).
- **Q7 ✅ Строгость неиспользуемого** (2026-08-28): 33→0 `no-unused-vars` (в т.ч. `ThemeSwitcher`
  экспортирован как feature-in-waiting под тёмную тему E5). Возврат `noUnusedLocals/noUnusedParameters:true`
  в tsconfig — остаётся отдельным шагом.
- **Q8 ✅ Хардкод конфига** (2026-08-15): `LOCAL_API_URL` в `services/api/client.ts` теперь
  `import.meta.env.VITE_LOCAL_API_URL || <прежний фолбэк>`.
- **Q9 ✅ Декомпозиция мега-модулей** (2026-08-28): мега-хабы разобраны (~14 срезов) —
  `hooks/useFormStore.ts` 2262→1832 (paneNotifications/paneFormState/formSession/formStore.types),
  `components/UI/index.tsx` 1463→394 (NavList/Navbar/PanesTabs), `components/Field/index.tsx` 1148→290
  (fieldBase/FieldNumber/FieldPeriod/FieldFile/FieldDate/FieldTextarea), `LookupField` (lookupHelpers).
  Внешние импорты через ре-экспорт. Оставшиеся крупные файлы (SubTable 988, Sales 912,
  createInvoiceLikeForm 907) — цельные единицы одной ответственности, дальше не дробим.
- **Q10 ✅ ESLint для backend (2026-08-30)**: flat-config `backend/eslint.config.js` (@eslint/js
  recommended, Node globals, ESM; `no-empty` allowEmptyCatch, `no-unused-vars` с `^_`), скрипты
  `lint`/`lint:ratchet` + `scripts/eslint-ratchet.mjs` + `.eslint-baseline` (зеркало фронта).
  Первый прогон 105 ошибок → **22** после чистки. ⚠ ПОЙМАН РЕАЛЬНЫЙ БАГ: `no-undef idNum` в 11
  роутерах (contactpersons/accesspermissions/organizations/bankaccounts/activityhistories/
  counterparties/todos/contracts/warehouses/contacts/users) — недоделанный рефактор оставил
  `const num = Number(word); if (idNum) …` → поиск по числовому ID был мёртв (always false). Фикс:
  импорт `idSearchCondition` (int4-overflow-safe) + `const idNum = idSearchCondition(word)`. Также
  удалены мёртвые импорты (FiscalError, releaseIssuedSerials×3, removeReceiptSerials×2, querySchema×2,
  success, crypto, prisma). baseline 22→**10** (2026-08-31): убран мёртвый dateRange-скаффолдинг в 5
  роутерах (bankaccounts/contacts/counterparties/organizations/users) + 2 мёртвых импорта в v1.js;
  остаток 10 — dead-локали seed/dev-скриптов + заявленные API-параметры. Frontend baseline 40→**26**
  (типизирован `applyEditMarker.test.ts`, −14 any).
- **Q11 ⚠️ Покрытие тестами** (пересекается с T12.2): frontend 391→417; backend +13 HEADLESS
  (parseUploadErrors 7, govMappers 6 — snt/awp мапперы вкл. relatedSnt/relatedAwp), 2026-08-28.
  Остаётся: `esf` маппер, `documentChain`, `recomputeCosting`, `useFormStore` (интеграционные — нужен тест-Postgres).

### E14 — Коммуникации: WhatsApp API (ТЗ: `docs/TZ_WHATSAPP_COMMUNICATIONS.md`, v1.0)
Входящее WhatsApp → резолвинг номера по `Contact` (whatsapp→telephone→ContactPerson→
Counterparty→ручная привязка) → диалог `WaConversation` (история сохраняется по построению:
@@unique(канал, номер)). Панель «Коммуникации»: внутренний чат (существующий ChatMessage) +
список диалогов + окно чата + правая панель-сводка (контактное лицо, контрагенты, документы,
задачи). Вложения → `AttachedFile(ownerType:"WaMessage")` + uploads/files (медиа скачивать СРАЗУ
в вебхуке — URL Meta временные). Провайдер-слой как fiscal; **выбран Meta Cloud API**.
- **W0 Вебхук-скелет** — ✅ (2026-08-31): `services/wa/webhookVerify.js` (checkVerifyRequest /
  checkSignature timing-safe по СЫРОМУ телу / extractEvents) + роутер `waWebhook.js`
  (GET подтверждение, POST события; свой `express.raw`, смонтирован ДО express.json, префикс
  /api1). Env: `WA_VERIFY_TOKEN` (задан), `WA_APP_SECRET` (⚠ пуст — заполнить из Meta до прода).
  Публичный URL: `https://api.aleppo.kz/api1/wa/webhook` (⚠ хост `api.` — aleppo.kz ведёт на
  фронт/Vite, первая проверка Meta падала именно из-за этого). Тест `waWebhook.test.js` (5).
- **W1 (P0-2) Данные** — ✅ (2026-09-01): миграция `20260901090000_wa_communications`
  (schema↔schema diff со старой схемой из git — только CREATE, дрейфа нет): enum
  `WaDirection`/`WaMsgStatus` + `WaChannel`/`WaConversation`(@@unique channelUuid+phone)/`WaMessage`
  (@unique providerMessageId — идемпотентность). Резолвинг: `services/wa/phone.js`
  (normalizePhone: 8XXX→7XXX, 10 цифр→+7) + `services/wa/resolveContact.js` (whatsapp→telephone,
  владелец ContactPerson→лицо+его контрагент / Counterparty→контрагент; сравнение в памяти —
  в БД телефоны хранятся «как введены»). Тест `waResolve.test.js` (7, headless).
- **W2 (P1) Панель** — ✅ (2026-09-01): роутер `api/router/wa.js` (список диалогов с подписями
  лица/контрагента без N+1, сообщения, отправка, read, link + авто-создание Contact(whatsapp),
  contact-summary, simulate-incoming для суперадмина), пейн `models/Communications`
  (вкладки «Внутренний чат» (существующий ChatList) / WhatsApp, список диалогов с unread-бейджами,
  окно чата с пузырями и статусами, правая панель-сводка), пункт NavList + viewRegistry
  (восстановление после F5), i18 RU+KK. **Отправка наружу НЕ подключена** (провайдер не настроен):
  исходящие сохраняются со статусом `queued` — уйдут при подключении (W4).
- **W3 (P2) Файлы+сводка** — ❌: вложения in/out, панель-сводка контактного лица, привязка
  незнакомых номеров, окно 24ч + шаблоны.
- **W4 (P3) Зрелость** — ❌: статусы доставки, исходящий диалог, ретраи (services/scheduler),
  аудит, право `WaChat` + модуль `communications`, i18 RU+KK.
- **W5 (P4) Опции** — ❌: второй провайдер, авто-лид/задача из первого сообщения, рассылки.
- ОТКРЫТЫЕ ВОПРОСЫ (§12 ТЗ): число каналов на орг; видимость диалогов (все с правом vs менеджер
  диалога); ретенция переписки/вложений.

---

## 3. Порядок (рекомендация)
1) E7 (гос-РК — ключевое отличие продукта) + E1 (безопасность).
2) E3/E4 (производительность+realtime) и E5 (темы/адаптив) — качество для продаж.
3) E6 (склад-партии) и E8 (банки) — расширение учёта.
4) E2 (OpenAPI/Webhooks), E9/E10 (CRM/отчёты), E11/E12 — платформенность и зрелость.
5) E14 (WhatsApp-коммуникации) — параллельный трек: W0 ✅, W1-W2 не блокированы внешним
   (провайдер мокается), W3+ — после подтверждения приёма живых событий Meta.

**Каждая задача = отдельный PR/итерация** с проверками (tsc/build/тесты/ручной прогон) и
записью в `MEMORY.md`/журнал. Реальные ключи/сертификаты — от пользователя; прод ЭСФ не
для отладки (боевые данные).

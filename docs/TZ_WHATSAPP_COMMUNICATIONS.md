# ТЗ: «Коммуникации» — WhatsApp-диалоги с контактными лицами

Версия 1.0 · 2026-08-31 · статус: на согласование

## 1. Цель

Встроить в aleppo.kz механизм диалогов WhatsApp: входящее сообщение по номеру
отправителя автоматически связывается с контактным лицом (`ContactPerson`) и его
контрагентом; менеджер ведёт переписку из ERP, видит историю коммуникации и
сводку по контактному лицу; вложения сохраняются. Внутренний чат пользователей
и внешние диалоги объединяются в единую **панель «Коммуникации»**.

## 2. Термины

| Термин | Значение |
|---|---|
| Канал (WaChannel) | Подключённый WhatsApp-номер организации (номер, провайдер, ключи) |
| Диалог (WaConversation) | Переписка одного канала с одним внешним номером |
| Внешний номер | Телефон собеседника в E.164 (`+7702…`) |
| Окно 24ч | Правило WhatsApp: свободные ответы — только 24 ч после последнего входящего; далее — только утверждённые шаблоны |
| Резолвинг | Определение ContactPerson/Counterparty по внешнему номеру |

## 3. Существующая база (переиспользуем, не строим заново)

| Что | Где | Как используем |
|---|---|---|
| Контакты с типами `whatsapp`/`telephone` | `Contact` (value, contactType, ownerType/ownerUuid, isPrimary) | источник резолвинга номера → владелец |
| Контактные лица | `ContactPerson` (owner = Counterparty/Organization) | целевая сущность диалога; связь с контрагентом уже есть через ownerType/ownerUuid |
| Внутренний чат | `ChatMessage` + роутер `chat`, SSE `chatBus` (`type:"chat"`), бейдж `useChatUnread` | зона «Внутренний чат» панели — как есть |
| Realtime | `services/chatBus.js` + `/chat/stream` (SSE), фронт `onLiveEvent` | новые события `type:"wa"` |
| Файлы | `AttachedFile` + `uploads/files` (multer diskStorage), `FilesPanel` | вложения сообщений: `ownerType:"WaMessage"` |
| Права | accessPermission (гейт по модели) | новое право `WaChat`; настройка канала — суперадмин |
| Тогглы модулей | `modules.disabled.<orgUuid>` | новый модуль `communications` |
| Заметки/задачи из записи | NotesButton / CreateTaskButton | кнопка «Создать задачу» из диалога |

## 4. Архитектура

### 4.1 Провайдер WhatsApp

Слой `services/wa/provider.js` — интерфейс провайдера (как `services/fiscal`):

```
sendText(channel, toPhone, text) → { providerMessageId }
sendMedia(channel, toPhone, file) → { providerMessageId }
sendTemplate(channel, toPhone, template, params) → { providerMessageId }
downloadMedia(channel, mediaId) → { buffer, mimeType, fileName? }
parseWebhook(req) → { events: [IncomingMessage | StatusUpdate] }
verifyWebhook(req) → boolean   // подпись/verify-token
```

Реализации:
- **P0: `cloud`** — Meta WhatsApp Business Cloud API (официальный; требуется
  Meta Business + верификация номера; вебхук `GET` hub.challenge + `POST` c
  подписью `X-Hub-Signature-256`).
- **альтернатива**: 360dialog/Twilio (тот же интерфейс), выбор — env
  `WA_PROVIDER`. Неофициальные шлюзы (Green API и т.п.) — только как отдельная
  реализация под ответственность заказчика (риск блокировки номера).

Секреты — в env (`WA_VERIFY_TOKEN`, `WA_APP_SECRET`) и в `WaChannel`
(accessToken на канал), в код не зашиваются, в ответах API не отдаются.

### 4.2 Поток входящего сообщения

```
WhatsApp → POST /api1/wa/webhook (без auth, проверка подписи)
  → parseWebhook → для каждого события:
     1) идемпотентность: providerMessageId (wamid) уже есть → пропустить
     2) find-or-create WaConversation (channelUuid + phone E.164)
     3) резолвинг контакта (см. §5) → conversation.contactPersonUuid/counterpartyUuid
     4) если media → downloadMedia НЕМЕДЛЕННО (ссылки Meta временные)
        → сохранить в uploads/files + AttachedFile(ownerType:"WaMessage")
     5) INSERT WaMessage(direction:"in", …)
     6) publish(orgUuid, { type:"wa", kind:"message", conversationUuid, … })
  → 200 OK (всегда быстро; обработка ошибок — внутри, ретраи Meta не плодим)
```

### 4.3 Исходящее

`POST /wa/conversations/:uuid/messages` → проверка окна 24ч (последний входящий
< 24 ч назад → свободный текст; иначе — только `sendTemplate`, UI предупреждает)
→ provider.sendText/Media → WaMessage(direction:"out", status:"sent") → статусы
доставки (sent/delivered/read/failed) прилетают вебхуком и обновляют сообщение
(+SSE `kind:"status"`).

## 5. Резолвинг номера → контактное лицо

Нормализация: все сравнения по E.164 без `+` (казахстанские `8xxx` → `7xxx`);
у `Contact.value` при поиске срезаются пробелы/скобки/дефисы (SQL `regexp_replace`
или денормализованное поле `valueNormalized` — решение за реализацией, P0 —
поиск с нормализацией на лету, объём контактов мал).

Порядок (первое совпадение выигрывает):
1. `Contact` с `contactType='whatsapp'` и совпавшим номером → владелец;
2. `Contact` с `contactType='telephone'` → владелец;
3. владелец `ContactPerson` → диалог привязан к нему; его контрагент =
   `ownerUuid` контактного лица (если ownerType='Counterparty');
4. владелец `Counterparty` (номер указан у самого контрагента) → диалог привязан
   к контрагенту, contactPerson пуст;
5. ничего не найдено → диалог «Неизвестный номер»: в шапке чата кнопки
   **«Связать с контактным лицом»** (лукап + создание нового с автозаполнением
   телефона) — привязка запоминается в диалоге и создаёт `Contact(whatsapp)`
   владельцу, чтобы следующий резолвинг был автоматическим.

Перепривязка доступна всегда (номер мог сменить владельца); история сообщений
остаётся в диалоге. Один и тот же внешний номер = один диалог на канал —
**история коммуникации сохраняется между сессиями** (требование «если уже был
диалог — показывать историю» выполняется конструкцией: сообщения живут в
WaConversation по номеру, а не по сессии).

## 6. Модель данных (Prisma; миграция РУКОПИСНАЯ — schema↔schema diff)

```prisma
model WaChannel {                     // подключённый номер организации
  id Int @id @default(autoincrement())
  uuid String @unique @default(uuid())
  organizationUuid String
  name String                        // «Отдел продаж»
  phone String                       // номер канала E.164
  provider String @default("cloud")
  providerAccountId String?          // phone_number_id (Cloud API)
  accessToken String?                // не отдаётся в API
  isActive Boolean @default(true)
  updatedAt DateTime @default(now()) @updatedAt
  deletedAt DateTime?
  @@index([organizationUuid])
  @@map("wa_channels")
}

model WaConversation {
  id Int @id @default(autoincrement())
  uuid String @unique @default(uuid())
  channelUuid String
  organizationUuid String
  phone String                       // внешний номер E.164
  displayName String?                // имя из профиля WhatsApp
  contactPersonUuid String?          // резолвинг/ручная привязка
  counterpartyUuid String?
  lastMessageAt DateTime?
  lastIncomingAt DateTime?           // для окна 24ч
  unreadCount Int @default(0)        // входящие, не прочитанные пользователями
  updatedAt DateTime @default(now()) @updatedAt
  deletedAt DateTime?
  @@unique([channelUuid, phone])
  @@index([organizationUuid, lastMessageAt])
  @@index([contactPersonUuid])
  @@index([counterpartyUuid])
  @@map("wa_conversations")
}

model WaMessage {
  id Int @id @default(autoincrement())
  uuid String @unique @default(uuid())
  conversationUuid String
  organizationUuid String
  direction WaDirection              // in | out
  body String?                       // текст (или подпись к медиа)
  mediaFileUuid String?              // → AttachedFile.uuid (вложение)
  mediaType String?                  // image|document|audio|video|sticker
  authorUuid String?                 // пользователь ERP (для out)
  providerMessageId String? @unique  // wamid — идемпотентность вебхука
  status WaMsgStatus @default(received) // received|queued|sent|delivered|read|failed
  errorText String?
  createdAt DateTime @default(now())
  deletedAt DateTime?
  @@index([conversationUuid, createdAt])
  @@map("wa_messages")
}
```

Вложения: файл на диске `uploads/files`, метаданные —
`AttachedFile(ownerType:"WaMessage", ownerUuid: message.uuid)`; выдача через
существующий files-роутер (орг-изоляция обязателна). Лимит 50 МБ (как в files),
для исходящих — лимиты провайдера (Cloud API: изображения 5 МБ, документы 100 МБ
— валидация в сервисе).

## 7. Backend API

| Метод | Путь | Назначение |
|---|---|---|
| GET/POST | `/api1/wa/webhook` | вебхук провайдера (БЕЗ auth; verify-token + подпись; префикс `/api1` вне authMiddleware — как esf-license). Публичный URL: `https://api.aleppo.kz/api1/wa/webhook` (⚠ хост `api.` — домен aleppo.kz ведёт на фронтенд) |
| GET | `/wa/conversations` | список диалогов орг (сорт. lastMessageAt, фильтр по каналу/поиск по имени/номеру/контрагенту) |
| GET | `/wa/conversations/:uuid/messages` | сообщения (cursor, старые ↑) |
| POST | `/wa/conversations/:uuid/messages` | отправить текст/файл (multipart) |
| POST | `/wa/conversations/:uuid/read` | сбросить unreadCount |
| POST | `/wa/conversations/:uuid/link` | привязать contactPerson/counterparty (+создать Contact whatsapp) |
| GET | `/wa/contact-summary/:conversationUuid` | сводка для правой панели (см. §8.3) |
| CRUD | `/wa/channels` | каналы (суперадмин) |
| POST | `/wa/conversations/start` | новый исходящий диалог по номеру (только шаблон — вне окна 24ч) |

SSE-события (chatBus): `{type:"wa", kind:"message"|"status"|"conversation", conversationUuid, …}` —
подписка фронта через существующий `onLiveEvent("wa", …)`.
Гейты: authMiddleware + tenantFilter (все запросы в рамках организаций
пользователя) + право `WaChat`; модуль `communications` в module-toggles.

## 8. Frontend UI

### 8.1 Панель «Коммуникации» (новый пейн, пункт NavList)

Каркас по референсу pane-toolbar (`usePaneToolbar`, `.PaneFill`), три зоны:

```
┌ Тулбар: [канал ▾] [поиск] … [⟳]────────────────────────────────┐
│ ЛЕВАЯ КОЛОНКА          │ ЦЕНТР — ОКНО ДИАЛОГА  │ ПРАВАЯ ПАНЕЛЬ │
│ вкладки:               │ история сообщений      │ сводка        │
│ • Внутренний чат       │ (пузыри in/out, дата,  │ контактного   │
│ • WhatsApp             │ статусы ✓/✓✓, файлы)   │ лица (§8.3)   │
│ список диалогов:       │ ─────────────────────  │               │
│ имя/номер, последнее   │ [поле ввода] [📎] [➤]  │               │
│ сообщение, время,      │ предупреждение окна24ч │               │
│ бейдж непрочитанных    │                        │               │
└────────────────────────┴────────────────────────┴───────────────┘
```

- **Внутренний чат** — существующий чат пользователей организации (ChatMessage)
  встраивается первой вкладкой левой колонки; его логика не меняется.
- Список диалогов обновляется по SSE; сортировка по последнему сообщению;
  бейдж суммарных непрочитанных — на пункте NavList (аналог useChatUnread).

### 8.2 Окно диалога

- Пузыри: входящие слева, исходящие справа (+имя пользователя-автора и статус
  доставки ✓ отправлено / ✓✓ доставлено / ✓✓синие прочитано / ⚠ ошибка c textом);
- вложения: изображения — превью (клик → просмотр), документы — имя+размер+скачать
  (через files-роутер); отправка файла — кнопка 📎 (multipart);
- подгрузка истории вверх (cursor);
- вне окна 24ч поле ввода заменяется выбором шаблона с подстановкой параметров;
- кнопки шапки: «Открыть контактное лицо», «Связать/перепривязать»,
  «Создать задачу» (CreateTaskButton c sourceType=WaConversation), NotesButton.

### 8.3 Сводка по контактному лицу (правая панель)

Один запрос `/wa/contact-summary/:uuid` собирает:
- **Контактное лицо**: ФИО, должность/комментарий, все контакты (Contact по
  owner), аватар;
- **Контрагент(ы)**: владелец контактного лица + все контрагенты, где этот
  номер встречается в контактах; по каждому: наименование, БИН, основной
  договор, менеджер;
- **Активность**: последние 5 документов по контрагенту (продажи/счета/оплаты —
  из существующих списков, клик → открыть документ через openDocumentByType),
  открытые задачи (Todo) по связке;
- **Незнакомый номер**: панель показывает «Номер не привязан» + кнопку привязки.

Все ссылки открываются стандартными панелями (addPane), сводка read-only.

## 9. Права и изоляция

- Право `WaChat` (чтение/письмо) — раздаётся ролям; каналы — суперадмин.
- Орг-изоляция: диалог принадлежит организации канала; tenantFilter во всех
  выборках; файлы — через существующую проверку files.
- Аудит: `wa.link`, `wa.send`, `wa.channel.*` в ActivityHistory (auditMiddleware
  покрывает POST автоматически).

## 10. Нефункциональные требования

- **Идемпотентность**: уникальный `providerMessageId`; повторная доставка
  вебхука не создаёт дублей; ответ вебхука ≤ 2с (обработка асинхронно допустима).
- **Надёжность отправки**: `failed` со внятным `errorText` в пузыре; повторная
  отправка кнопкой. Очередь/ретраи — P2 (через services/scheduler).
- **Медиа**: скачивание в момент вебхука (URL Meta живут минуты); при ошибке —
  сообщение сохраняется с пометкой «вложение недоступно».
- **Секреты** — env/WaChannel; вебхук проверяет подпись; тело логируется без
  контента сообщений (только ids) — переписка = персональные данные.
- **Тесты**: headless — нормализация номера, резолвинг (мок-клиент), парсер
  вебхука Cloud API (фикстуры JSON), окно 24ч; интеграционные — CI Postgres.

## 11. Этапы

| Этап | Состав | Критерий приёмки |
|---|---|---|
| **P0. Фундамент** | миграция (3 модели), provider-интерфейс + cloud-реализация, вебхук с идемпотентностью, резолвинг, SSE | входящее сообщение появляется в БД, привязано к контактному лицу, событие уходит в SSE; тесты резолвинга/парсера зелёные |
| **P1. Панель** | пейн «Коммуникации»: список диалогов + окно чата (текст), внутренний чат первой вкладкой, отправка текста, unread-бейджи | менеджер читает и отвечает из ERP; история сохраняется; непрочитанные видны |
| **P2. Файлы + сводка** | входящие/исходящие вложения (AttachedFile), правая панель-сводка, привязка незнакомых номеров, окно 24ч + шаблоны | файл из WhatsApp скачивается из ERP; сводка показывает контрагентов и документы |
| **P3. Зрелость** | статусы доставки, `/wa/conversations/start`, очередь ретраев, аудит, права/тогглы, i18 RU+KK | полный цикл во «взрослом» виде, verify зелёный |
| **P4. Опции** | второй провайдер, авто-создание лида/задачи из первого сообщения, шаблоны-рассылки | по отдельному согласованию |

## 12. Открытые вопросы (нужно решение заказчика)

1. **Провайдер**: официальный Meta Cloud API (нужны Meta Business аккаунт,
   верификация, отдельный номер — займёт время) или коммерческий шлюз?
   Архитектура готова к обоим, но P0 пишется под конкретного.
2. Один WhatsApp-номер на организацию или несколько каналов сразу (модель
   поддерживает несколько; UI P1 — селектор канала)?
3. Видимость диалогов: все пользователи с правом WaChat видят все диалоги
   организации, или нужно закрепление «менеджер диалога»? (P0 — все с правом.)
4. Ретенция переписки и вложений: хранить бессрочно или чистить по сроку
   (реализуемо задачей в services/scheduler)?

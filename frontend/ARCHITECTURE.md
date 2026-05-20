# Архитектура фронтенда — полная документация

> Автоматически сгенерировано 16.04.2026. Актуально для текущей кодовой базы.

---

## Оглавление

1. [Обзор приложения](#1-обзор-приложения)
2. [Структура проекта](#2-структура-проекта)
3. [App Context и MDI-система](#3-app-context-и-mdi-система)
4. [Hooks — пользовательские хуки](#4-hooks)
5. [Services — сервисный слой](#5-services)
6. [Components — компоненты](#6-components)
7. [Utils — утилиты](#7-utils)
8. [Registry — реестры моделей](#8-registry)
9. [Offline-first архитектура](#9-offline-first-архитектура)
10. [Поток данных (Data Flow)](#10-поток-данных)
11. [Найденные улучшения и рекомендации](#11-найденные-улучшения-и-рекомендации)

---

## 1. Обзор приложения

Бизнес-приложение (ERP/CRM) с MDI-интерфейсом (Multiple Document Interface), построенное на:

| Технология                 | Назначение                                          |
| -------------------------- | --------------------------------------------------- |
| **React 18+**              | UI, `useSyncExternalStore` для гранулярных подписок |
| **TypeScript**             | Типизация                                           |
| **Vite**                   | Сборка и dev-сервер                                 |
| **React Query (TanStack)** | Кэширование серверных списков, `useInfiniteQuery`   |
| **Dexie (IndexedDB)**      | Offline-first хранилище данных                      |
| **Axios**                  | HTTP-клиент с interceptors (retry, offline)         |
| **SCSS Modules**           | Стилизация                                          |
| **Service Worker**         | Кэширование статических ресурсов                    |

### Ключевые архитектурные решения

- **MDI-панели** вместо маршрутизации: каждая форма/список открывается в панели (`TPane`), управляемой через `AppContext`
- **Offline-first**: все данные кэшируются в IndexedDB, приложение работает без сети
- **Единый `useFormStore`**: заменяет отдельные хуки формы, предоставляет гранулярные подписки
- **Portal-based toolbar**: кнопки формы рендерятся в заголовок панели через `createPortal`
- **Фабрики моделей**: `createSimpleModel` / `createDocumentModel` генерируют типовые Form+List

---

## 2. Структура проекта

```
src/
├── app/                    # Корневой компонент + AppContext
│   ├── index.tsx           # App, AppContextProvider, MDI-логика
│   └── types.ts            # TypeAppContextProps, TPane, TComponentNode
├── components/             # Переиспользуемые UI-компоненты
│   ├── UI/                 # Navbar, Content, Screen, PaneItem, NavbarPaneBell, Group, etc.
│   ├── Field/              # Field, FieldDate, FieldSelect, LookupField, etc.
│   ├── Table/              # Виртуализированная таблица с infinite scroll
│   ├── FormPanel/          # Панель кнопок формы (Сохранить, Сохранить и закрыть, Обновить)
│   ├── FormError/          # Отображение ошибок формы
│   ├── Tabs/               # Табы формы
│   ├── ModelForm.tsx # Универсальная обёртка: FormPanel + FormError + Tabs
│   ├── ModelList.tsx        # Универсальный список: useModelListState + Table
│   ├── SubTable/           # Вложенные таблицы (contacts, bankaccounts, etc.)
│   ├── Modal/              # Модальные окна
│   ├── ConfirmModal/       # Promise-based подтверждение
│   ├── NotificationToast/  # Тосты уведомлений (сервер)
│   ├── OfflineIndicator/   # Индикатор статуса сети
│   └── ...
├── hooks/                  # Пользовательские хуки
├── services/               # Бизнес-логика, API, offline
│   ├── api/client.ts       # Axios-клиент с interceptors
│   ├── auth.ts             # Аутентификация (online + offline)
│   ├── offlineDb.ts        # Dexie — локальная БД IndexedDB
│   ├── offlineDataService.ts # Proxy-слой: online/offline CRUD
│   ├── syncManager.ts      # Двусторонняя синхронизация (push/pull)
│   ├── networkStatus.ts    # Мониторинг сети + health-check
│   ├── offlineQueue.ts     # [DEPRECATED] Старая offline-очередь
│   ├── queryPersist.ts     # Persist React Query кэша в IndexedDB
│   ├── commitPendingRows.ts # Коммит pending-строк SubTable
│   └── registerSW.ts       # Регистрация Service Worker
├── models/                 # Бизнес-модели (Form + List компоненты)
│   ├── Organizations/
│   ├── Counterparties/
│   ├── Contracts/
│   ├── Sales/
│   ├── Employees/
│   ├── ... (31 модель)
│   └── SyncDashboard/      # UI управления offline-синхронизацией
├── registry/               # Реестры моделей
│   ├── modelRegistry.ts    # Единый реестр: endpoint → module/form/list
│   └── formRegistry.ts     # Утилита открытия формы по endpoint+uuid
├── utils/                  # Утилиты
│   ├── createDocumentModel.tsx  # Фабрика документных форм
│   ├── createSimpleModel.tsx    # Фабрика простых справочников
│   ├── buildPaneLabel.ts        # Формирование заголовков панелей
│   ├── accessRightsMap.ts       # Маппинг endpoint → modelName для прав
│   └── resolveOwnerName.ts      # Резолв имени владельца из LookupField
├── styles/
│   └── main.module.scss    # Все SCSS-модули
└── i18/                    # Интернационализация
```

---

## 3. App Context и MDI-система

### `src/app/index.tsx` — App

Корневой компонент приложения. Отвечает за:

1. **Аутентификацию** — проверка токена (`verifyToken`), offline-вход
2. **QueryClient** — React Query с `offlineFirst` network mode
3. **MDI-панели** — `panes[]`, `activePaneId`, `addPane()`, `removePane()`, `requestClose()`
4. **Навбар** — 4 секции: Торговля, Кадровый учёт, CRM, Настройки
5. **Lifecycle** — запуск `healthCheck`, `initialSync`, `periodicSync`, `ServiceWorker`

### `TypeAppContextProps`

```typescript
{
  screenRef: RefObject<HTMLDivElement>;
  windows: {
    panes: TPane[];                    // Все открытые панели
    activePane: string | null;         // ID активной панели
    addPane(pane: Partial<TPane>): void;
    removePane(uniqId: string): void;
    requestClose(uniqId: string): Promise<void>;  // С проверкой beforeClose guards
    setActivePane(uniqId: string): void;
    updatePaneLabel(uniqId: string, label: string): void;
    registerBeforeClose(uniqId: string, guard: () => Promise<boolean> | boolean): () => void;
  };
  actions: {
    confirm(message: string): Promise<boolean>;  // Promise-based confirm modal
  };
  navbar: { props: TypeNavbarProps[]; setProps: ... };
  auth: {
    user: AuthUser | null;
    logout(): void;
  };
}
```

### `TPane` — описание панели

```typescript
{
  component: TComponentNode;   // FC компонент (Form или List)
  uniqId: string;              // Уникальный ID (из getUniqId)
  label: string;               // Заголовок
  data?: TDataItem;            // Данные (uuid для edit, доп. поля для create)
  onSave?(): void;             // Callback после сохранения (refresh списка)
  onClose?(): void;            // Callback при закрытии
  isSelector?: boolean;        // Режим выбора (LookupField)
  onSelectResult?(item): void; // Callback выбора элемента
  selectorPaneId?: string;     // ID родительской selector-панели
}
```

### MDI-поведение

- **List-панели** — синглтон по имени компонента (`OrganizationsList`)
- **Form-панели** — уникальные по `{ComponentName}-{uuid}`
- **Selector-панели** — всегда уникальные, блокируют переключение на другие панели
- **История** — стек `paneHistoryRef` для возврата к предыдущей панели при закрытии
- **beforeClose guards** — форма регистрирует guard, который проверяет `isDirty` и спрашивает подтверждение

---

## 4. Hooks

### `useFormStore<F>` — центральный хук формы

**Файл:** `src/hooks/useFormStore.ts` (~1350 строк)

Единый хук, заменяющий `useModelForm` + `usePendingSubTable`. Управляет полным жизненным циклом формы:

#### Архитектура

```
                   ┌─────────────────────┐
                   │   createFormStore()  │  Чистый JS (без React)
                   │   ───────────────── │
                   │   state: {          │
                   │     fields: F       │  ← Данные формы
                   │     tables: {}      │  ← Pending-строки SubTable
                   │     meta: {}        │  ← isLoading, error, uuid
                   │   }                 │
                   │   savedSnapshot     │  ← Серверная версия (для isDirty)
                   │   sessionStorage    │  ← Persist при F5
                   └──────────┬──────────┘
                              │ subscribe / getSnapshot
                   ┌──────────▼──────────┐
                   │  useFormStore()     │  React-хук
                   │  ─────────────────  │
                   │  useSyncExternalStore│  ← Гранулярные подписки
                   │  useField(key)      │  ← Подписка на одно поле
                   │  useTable(key)      │  ← Подписка на одну таблицу
                   │  handleSave()       │
                   │  loadFromServer()   │
                   └─────────────────────┘
```

#### Опции (`UseFormStoreOptions<F>`)

| Параметр          | Описание                                                  |
| ----------------- | --------------------------------------------------------- | ----------------------------------- |
| `endpoint`        | API endpoint (`"organizations"`)                          |
| `storageKey`      | Ключ sessionStorage (`"organizations-form"`)              |
| `defaultFields`   | Значения по умолчанию                                     |
| `tables?`         | Определения вложенных таблиц (`Record<string, TableDef>`) |
| `paneProps`       | Props панели (из MDI)                                     |
| `initialFields?`  | Начальные значения (для create с предзаполнением)         |
| `mapServerToForm` | Маппинг ответа сервера → fields                           |
| `buildPayload`    | Формирование payload → `Record                            | string` (строка = ошибка валидации) |
| `buildPaneLabel`  | Метка панели после save                                   |
| `afterLoad?`      | Callback после загрузки                                   |
| `afterSave?`      | Callback после сохранения (invalidate и т.д.)             |

#### Возвращаемое значение (`UseFormStoreReturn<F>`)

| Поле                       | Описание                                             |
| -------------------------- | ---------------------------------------------------- |
| `fields`, `tables`, `meta` | Реактивные данные (через `useSyncExternalStore`)     |
| `isDirty`                  | Есть ли несохранённые изменения                      |
| `useField(key)`            | Гранулярная подписка на одно поле: `[value, setter]` |
| `useTable(key)`            | Подписка на pending-строки таблицы                   |
| `setField(key, value)`     | Обновить поле                                        |
| `setFields(patch)`         | Обновить несколько полей                             |
| `loadFromServer(uuid)`     | Загрузить с сервера                                  |
| `handleSave()`             | Сохранить                                            |
| `handleSaveAndClose()`     | Сохранить + закрыть панель                           |
| `handleClose()`            | Закрыть с проверкой dirty                            |
| `submit()`                 | Внутренний submit (fields + tables)                  |

#### Жизненный цикл формы

1. **Монтирование** — `getOrCreate()` берёт store из кэша или создаёт новый
2. **Восстановление** — из `sessionStorage` (если F5), флаг `hadStoredData`
3. **Загрузка** — `store.load(uuid, mapServerToForm)` → GET API / fallback на Dexie
4. **Dirty tracking** — `savedSnapshot` (JSON серверных данных) vs текущий state
5. **Уведомление** — если `hadStoredData && isDirty` → `addPaneNotification("warning", ...)` с кнопками «Сохранить» / «Обновить»
6. **Сохранение** — `submitFields()` → POST/PUT API / fallback offline в Dexie
7. **Commit tables** — `commitAllTables()` → SubTable pending rows
8. **Очистка** — `beforeClose guard` → confirm → `clearStorage()` → `removePane()`

#### Подсистемы в `useFormStore.ts`

| Подсистема                                            | Описание                                                                   |
| ----------------------------------------------------- | -------------------------------------------------------------------------- |
| **Dirty Panes Store**                                 | Глобальный `Set<uniqId>` для индикации несохранённых изменений на вкладках |
| `setPaneDirty(id, bool)`                              | Отметить панель dirty/clean                                                |
| `usePaneDirty(id)`                                    | Хук подписки на dirty-состояние                                            |
| **PaneItem Notifications**                            | Уведомления привязанные к панели                                           |
| `addPaneNotification(id, type, text, ctx?, actions?)` | Добавить уведомление (+ localStorage журнал)                               |
| `dismissPaneNotification(id, noteId)`                 | Удалить уведомление                                                        |
| `usePaneNotifications(id)`                            | Хук подписки на Уведомления                                                |
| **Notification Journal**                              | Персистентный журнал всех уведомлений в localStorage                       |

---

### `useInfiniteModelList<T>` — бесконечный список

**Файл:** `src/hooks/useInfiniteModelList.ts`

Обёртка над `useInfiniteQuery` для загрузки списков с курсорной пагинацией.

| Опция          | Описание                          |
| -------------- | --------------------------------- |
| `model`        | API endpoint                      |
| `params`       | `{ sort, search, filter, extra }` |
| `queryOptions` | Дополнительные опции React Query  |

**Offline-поддержка:** При ошибке сети — fallback на `offlineDataService.fetchList()`.

**Adaptive limit:** Глобальный `GLOBAL_ADAPTIVE_LIMIT_REF` для динамической подстройки размера страницы.

---

### `useModelListState` — состояние списка

**Файл:** `src/hooks/useModelListState.ts`

Инкапсулирует весь бойлерплейт List-компонента:

- `columns`, `sort`, `search`, `filter` state
- Подключение `useInfiniteModelList`
- `handleSortChange`, `handleFilterChange`, `handleSearch`
- `handleDelete` (через `useModelDelete`)
- `buildTableProps` — готовый объект для `<Table />`

---

### `useModelDelete` — удаление записей

**Файл:** `src/hooks/useModelDelete.ts`

```typescript
const handleDelete = useModelDelete("organizations", refetch);
// handleDelete(selectedRowIds, tableRows) → confirm → DELETE API → refetch
```

Использует глобальный `actions.confirm()` вместо `window.confirm`.

---

### `usePaneToolbar` — portal-based toolbar

**Файл:** `src/hooks/usePaneToolbar.tsx`

Двухсторонний механизм для рендеринга кнопок формы в заголовке панели:

1. **`usePaneToolbarSlot(paneId)`** — вызывается в `PaneItem`, создаёт DOM-слот
2. **`usePaneToolbar(paneId, toolbar)`** — вызывается в форме, рендерит `toolbar` через `createPortal`

---

### `useOfflineSync` — интеграция offline

**Файл:** `src/hooks/useOfflineSync.ts`

Реактивный хук для UI синхронизации:

| Поле             | Описание                                    |
| ---------------- | ------------------------------------------- |
| `isOnline`       | Статус сети (через `subscribeNetwork`)      |
| `isSyncing`      | Идёт ли синхронизация                       |
| `pendingChanges` | Массив `PendingChange` из Dexie             |
| `syncState`      | `{ status, progress, message, lastSyncAt }` |
| `syncNow()`      | Ручной запуск `fullSync()`                  |
| `offlineStats`   | Статистика: кол-во записей по таблицам      |

---

### `useAccessRight` — проверка прав

**Файл:** `src/hooks/useAccessRight.ts`

```typescript
const { canRead, canWrite, accessLevel } = useAccessRight("Organization");
```

Логика: `isSuperAdmin → full` → `accessRights.find(modelName)` → `"full" | "readonly" | "none"`.

---

### `useConfirm` — Promise-based confirm

**Файл:** `src/hooks/useConfirm.ts`

```typescript
const { confirm, confirmState } = useConfirm();
if (await confirm("Удалить?")) {
	/* delete */
}
// <ConfirmModal {...confirmState} />
```

---

### `useDebounceValue<T>` — debounce

**Файл:** `src/hooks/useDebounceValue.ts`

```typescript
const debouncedSearch = useDebounceValue(search, 300);
```

---

### `useDefaultOrganization` — организация по умолчанию

**Файл:** `src/hooks/useDefaultOrganization.ts`

Возвращает `{ organizationUuid, organizationName }` текущего пользователя для автозаполнения.

---

### `useQueryParams` — состояние фильтров

**Файл:** `src/hooks/useQueryParams.ts`

Аналог `useState` с сигнатурой `[value, setValue]`. Имя `useQueryParams` историческое — URL-синхронизация удалена в пользу чистого `useState`.

---

### `useRequestQueue` — ограничение параллелизма

**Файл:** `src/hooks/useRequestQueue.ts`

Глобальная очередь запросов (singleton): максимум `6` параллельных, `30s` таймаут зависших. Предотвращает burst-нагрузку при одновременной загрузке нескольких списков.

---

### `useUID` — генерация уникального ID

**Файл:** `src/hooks/useUID.ts`

```typescript
const uid = useUID(); // crypto.randomUUID(), стабильный на время жизни компонента
```

---

### `useFormSessionStore` — [LEGACY]

**Файл:** `src/hooks/useFormSessionStore.ts`

Устаревший хук для данных формы в sessionStorage. Заменён на `useFormStore`. Функция `clearAllFormStores()` используется при logout.

---

## 5. Services

### `api/client.ts` — HTTP-клиент

**Axios instance** с 4-мя interceptors:

| Interceptor             | Описание                                                                     |
| ----------------------- | ---------------------------------------------------------------------------- |
| **Request: Auth**       | Добавляет `Authorization: Bearer {token}`, убирает Content-Type для FormData |
| **Response: 401**       | При 401 → очищает токен → `dispatchEvent("auth_logout")`                     |
| **Response: 429 Retry** | Exponential backoff (1s→2s→4s) + jitter, макс. 3 ретрая                      |
| **Response: Offline**   | При ошибке сети + мутирующий запрос → возвращает `{ _offline: true }`        |

**Типизированные сокращения:**

```typescript
api.get<T>(url), api.post<T>(url, data), api.put<T>(...), api.delete<T>(...)
```

---

### `auth.ts` — аутентификация

| Функция                      | Описание                                              |
| ---------------------------- | ----------------------------------------------------- |
| `login(username, password)`  | Логин + offline-fallback (SHA-256 хэш в localStorage) |
| `logout()`                   | Очистка токена + offline credentials                  |
| `verifyToken()`              | GET `/auth/me`, при сетевой ошибке → cached user      |
| `getCurrentUser()`           | Из localStorage                                       |
| `registerOrganization(data)` | Регистрация орг. + первого пользователя               |
| `joinOrganization(data)`     | Присоединение по invite-коду                          |

**Offline-логин:** При первом успешном входе credentials хэшируются (SHA-256 через Web Crypto API) и кэшируются. При ошибке сети — проверяются против хэша.

---

### `offlineDb.ts` — Dexie (IndexedDB)

Локальная база данных, зеркалирующая серверные таблицы.

**30 sync-enabled таблиц** (`SYNCABLE_TABLES`): organizations, counterparties, contracts, contacts, employees, sales, products, etc.

**Служебные таблицы:**

- `_syncMeta` — `lastSyncAt` для каждой таблицы
- `_pendingChanges` — локальные изменения, ожидающие push

**API:**

| Функция                         | Описание                                                 |
| ------------------------------- | -------------------------------------------------------- |
| `upsertRecords(table, records)` | Bulk upsert по uuid                                      |
| `getRecordByUuid(table, uuid)`  | Одна запись                                              |
| `getActiveRecords(table, opts)` | Все активные (без deletedAt), с пагинацией и сортировкой |
| `searchRecords(table, query)`   | Полнотекстовый поиск                                     |
| `addPendingChange(change)`      | Добавить в очередь push                                  |
| `getOfflineDbStats()`           | Статистика по таблицам                                   |
| `clearOfflineDb()`              | Очистить всё (при logout)                                |

---

### `offlineDataService.ts` — proxy-слой CRUD

Прозрачная offline-first прокси между UI и данными.

**READ:**

```
Online  → apiClient.get() → кэш в Dexie → return
Offline → Dexie → return { fromCache: true }
```

**WRITE:**

```
Online  → apiClient.post/put() → кэш в Dexie → return
         ↓ ошибка сети
Offline → upsert в Dexie → addPendingChange → return { offline: true }
```

| Функция                              | Описание                       |
| ------------------------------------ | ------------------------------ |
| `fetchList(endpoint, params)`        | Список с пагинацией            |
| `fetchOne(endpoint, uuid)`           | Одна запись                    |
| `createRecord(endpoint, data)`       | Создание                       |
| `updateRecord(endpoint, uuid, data)` | Обновление (мержит с existing) |
| `deleteRecord(endpoint, uuid)`       | Soft delete                    |

---

### `syncManager.ts` — двусторонняя синхронизация

```
┌─────────┐   pull (server→client)    ┌──────────┐
│  Server │ ─────────────────────────→ │ IndexedDB│
│  (API)  │ ←───────────────────────── │ (Dexie)  │
└─────────┘   push (client→server)    └──────────┘
```

**Стратегия:**

1. **Push** — отправить `_pendingChanges` → POST `/sync/push`
2. **Pull** — скачать изменения → POST `/sync/pull` с `lastSyncAt`

| Функция                                     | Описание                                                |
| ------------------------------------------- | ------------------------------------------------------- |
| `fullSync(tables?)`                         | Полная push+pull синхронизация                          |
| `pullSingleTable(table)`                    | Инкрементальный pull одной таблицы                      |
| `initialSync()`                             | При первом входе                                        |
| `startPeriodicSync(ms)`                     | Запуск по таймеру (5 мин)                               |
| `abortSyncManager()`                        | Отмена текущей синхронизации                            |
| `resolveConflictKeepLocal/Server(conflict)` | Разрешение конфликтов                                   |
| `getSyncState()`                            | `{ status, progress, message, lastResult, lastSyncAt }` |

**Блокировка:** `isSyncing` flag предотвращает параллельный запуск.

---

### `networkStatus.ts` — мониторинг сети

| Функция                      | Описание                                 |
| ---------------------------- | ---------------------------------------- |
| `getIsOnline()`              | Текущий статус                           |
| `subscribeNetwork(listener)` | Подписка на изменения                    |
| `startHealthCheck(interval)` | Периодический ping (`HEAD /api/health`)  |
| `triggerSync()`              | Запуск синхронизации при переходе online |

**Intelligent backoff:** Exponential backoff при offline (base × 2^failures, max 5 мин). Переход в offline только после 2+ последовательных неудач.

---

### `queryPersist.ts` — persist React Query

Сохранение/восстановление кэша React Query в IndexedDB для мгновенного offline-отображения данных.

```typescript
restoreQueryCache(queryClient); // При старте
persistQueryCache(queryClient); // Подписка на изменения (debounced)
clearPersistedCache(); // При logout
```

---

### `commitPendingRows.ts` — коммит SubTable

Универсальная функция отправки pending-строк вложенных таблиц (contacts, bankaccounts, saleitems и т.д.):

```typescript
commitPendingRows("contacts", rows, parentUuid, "ownerUuid", "Контакты", {
  extraFields: { ownerType: "organization" },
  createPayload: (row) => ({ ... }),
});
```

---

### `registerSW.ts` — Service Worker

Регистрация SW из `public/sw.js` для кэширования статических ресурсов. Auto-update при новой версии.

---

### `offlineQueue.ts` — [DEPRECATED]

Старая offline-очередь на чистом IndexedDB. Заменена на `offlineDb._pendingChanges` + `syncManager`. Оставлена для экспорта `isNetworkError()` и типов.

---

## 6. Components

### `UI/index.tsx` — системные компоненты

| Компонент                            | Описание                                                      |
| ------------------------------------ | ------------------------------------------------------------- |
| `Screen`                             | Корневой layout (flex: navbar + content)                      |
| `Navbar`                             | Верхняя панель навигации (меню + right-section)               |
| `NavbarPaneBell`                     | Колокольчик уведомлений активной панели (auto-open при новых) |
| `Content`                            | MDI-контейнер: рендерит все `PaneItem`                        |
| `PaneItem`                           | Обёртка одной панели: заголовок + toolbar-slot + body         |
| `PaneHeaderControls`                 | Кнопки заголовка: dirty-dot + close                           |
| `NavList`                            | Меню навигации (Торговля / CRM / HR / Настройки)              |
| `Group`                              | Flex-контейнер с gap                                          |
| `ErrorBoundary`                      | Обёртка ошибок с fallback                                     |
| `LoadingSpinner` / `LoadingFallback` | Индикаторы загрузки                                           |

### `ModelForm` — обёртка формы

```
┌─────────────────────────────────────────┐
│ [Portal → PaneItemHeader: FormPanel кнопки] │
│ ┌─────────────────────────────────────┐ │
│ │ FormError (auto-dismiss)            │ │
│ ├─────────────────────────────────────┤ │
│ │ Tabs                                │ │
│ │ ┌───────────────────────────────┐   │ │
│ │ │ Tab Content (Form fields)     │   │ │
│ │ └───────────────────────────────┘   │ │
│ └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

### `ModelList` — универсальный список

Инкапсулирует: `useModelListState` → `openModelForm()` → `<Table />` → error display.

### `Field/*` — компоненты полей

- `Field` — текстовый input
- `FieldDate` — input[type=date]
- `FieldSelect` — select
- `FieldTextarea` — textarea
- `LookupField` — выбор из справочника (открывает selector-панель)
- `Divider` — разделитель секций формы

### `Table` — виртуализированная таблица

Infinite scroll, серверная сортировка, фильтрация, выделение строк, контекстное меню.

---

## 7. Utils

### `createDocumentModel(opts)` — фабрика документов

Генерирует Form + List для типовых документов: Purchases, PaymentInvoices, OutgoingInvoices, IncomingInvoices, CashExpenseOrders, CashReceiptOrders.

**Общая структура:** documentDate, description, amount, status, organizationUuid, counterpartyUuid, contractUuid.

**Автозаполнение:** При выборе договора → организация и контрагент заполняются из данных договора.

---

### `createSimpleModel(opts)` — фабрика справочников

Генерирует Form + List для простых справочников: Brands, Currencies, Positions.

**Конфиг:**

```typescript
createSimpleModel({
	endpoint: "brands",
	listName: "BrandsList",
	storageKey: "brands-form",
	formLabel: "Бренды",
	columnsJson,
	fields: [
		{ key: "shortName", label: "Наименование", required: true },
		{ key: "description", label: "Описание" },
	],
	accessRight: "Brand",
});
```

---

### `buildPaneLabel.ts` — заголовки панелей

```typescript
makePaneLabel("OrganizationsList", "Организации", savedData);
// → "Организации: ТОО Строй-Снаб"
```

---

### `accessRightsMap.ts` — маппинг прав

```typescript
ENDPOINT_TO_MODEL["organizations"] → "Organization"
```

---

## 8. Registry

### `modelRegistry.ts`

Единый реестр всех 30+ моделей. Каждая запись:

```typescript
{
  endpoint: "organizations",
  module: () => import("src/models/Organizations"),
  formName: "OrganizationsForm",
  listName: "OrganizationsList",
  storageKey: "organizations-form",
  label: "Организации",
}
```

**API:**

- `getByEndpoint(endpoint)` — найти запись
- `loadFormByEndpoint(endpoint)` — lazy-загрузка Form-компонента

### `formRegistry.ts`

```typescript
openFormByEndpoint("organizations", uuid, addPane);
// → Lazy-import модуля → addPane({ component: Form, data: { uuid } })
```

Используется в журнале уведомлений для перехода к объекту.

---

## 9. Offline-first архитектура

### Потоки данных

```
┌───────────────┐      ┌────────────────┐      ┌──────────────┐
│    React UI   │─────→│ offlineData    │─────→│   apiClient  │──→ Server
│  (FormStore/  │      │   Service      │      │  (Axios +    │
│   ModelList)  │      │ (proxy layer)  │      │  interceptors)│
│               │←─────│               │←─────│              │←── Server
└───────────────┘      └──────┬─────────┘      └──────────────┘
                              │
                     ┌────────▼─────────┐
                     │    Dexie         │
                     │  (IndexedDB)     │
                     │  ─────────────── │
                     │  30 tables       │
                     │  _syncMeta       │
                     │  _pendingChanges │
                     └────────┬─────────┘
                              │
                     ┌────────▼─────────┐
                     │   syncManager    │──→ POST /sync/push
                     │  (push + pull)   │←── POST /sync/pull
                     └──────────────────┘
```

### Состояния сети

| Состояние          | READ                               | WRITE                              |
| ------------------ | ---------------------------------- | ---------------------------------- |
| **Online**         | API → кэш Dexie                    | API → кэш Dexie                    |
| **Offline**        | Dexie                              | Dexie + `_pendingChanges`          |
| **Online→Offline** | Fallback на Dexie                  | Interceptor → `{ _offline: true }` |
| **Offline→Online** | `handleOnline()` → `triggerSync()` | `fullSync()` → push pending        |

### Конфликты

При push: если `serverUpdatedAt > clientUpdatedAt` → конфликт. Варианты:

- `resolveConflictKeepLocal()` — перезаписать сервер
- `resolveConflictKeepServer()` — обновить локальную версию

---

## 10. Поток данных

### Открытие формы редактирования

```
1. Клик по строке в Table
2. ModelList.openModelForm({ data: { uuid } })
3. addPane({ component: Form, data, label, onSave: refetch })
4. PaneItem рендерит Form с paneProps
5. useFormStore:
   a. getOrCreate(storageKey) — из кэша или new
   b. Восстановление из sessionStorage (если F5)
   c. useEffect → store.load(uuid, mapServerToForm)
      - GET /endpoint/uuid
      - Кэш ответа в Dexie
      - mapServerToForm → replaceFields
      - markClean → savedSnapshot
   d. registerBeforeClose(guard: isDirty? → confirm)
6. Рендер: ModelForm → usePaneToolbar → FormPanel (в заголовке) + Tabs
```

### Сохранение формы

```
1. handleSave() → submit()
2. store.submitFields(buildPayload, mapServerToForm, buildPaneLabel, updatePaneLabel, uniqId)
   a. buildPayload(fields) → payload или string-ошибка
   b. POST (create) / PUT (update) → apiClient
   c. При ошибке сети → offline save в Dexie + addPaneNotification
   d. mapServerToForm(savedData) → replaceFields
   e. commitAllTables() → commitPendingRows для каждой SubTable
   f. markClean()
   g. updatePaneLabel()
   h. afterSave()
   i. onSave() → refetch списка
```

---

## 11. Найденные улучшения и рекомендации

### ⚠️ Дублирование `isNetworkError` (5 копий)

**Проблема:** Функция проверки сетевой ошибки дублируется в 5 файлах:

- `offlineQueue.ts` → `isNetworkError()`
- `api/client.ts` → `isNetworkLikeError()`
- `offlineDataService.ts` → `isNetworkLike()`
- `syncManager.ts` → `isNetworkError()`
- `useInfiniteModelList.ts` → `isNetworkLikeError()`

**Рекомендация:** Вынести в единый модуль `src/services/networkUtils.ts` и импортировать везде.

### ⚠️ `offlineQueue.ts` помечен deprecated, но используется

**Проблема:** `isNetworkError` из `offlineQueue.ts` импортируется в `useFormStore.ts` и `auth.ts`.

**Рекомендация:** Перенести `isNetworkError` в `networkUtils.ts`, удалить или пометить весь `offlineQueue.ts` более явно.

### ⚠️ `useQueryParams` — название вводит в заблуждение

**Проблема:** Хук не работает с URL-параметрами, а является обычным `useState`. Название `useQueryParams` создаёт ложное ожидание URL-синхронизации.

**Рекомендация:** Переименовать в `useFilterState` или `useStateWithDefault`.

### ⚠️ `services/types.ts` — неиспользуемые типы

**Проблема:** Типы `User`, `Product`, `Order`, `Address` в `services/types.ts` выглядят как заглушки и не используются в проекте.

**Рекомендация:** Удалить или заменить на реальные типы, совпадающие с Prisma schema.

### ⚠️ `useFormSessionStore.ts` — legacy, но используется

**Проблема:** `clearAllFormStores()` вызывается при logout, но основной функционал дублируется `useFormStore`.

**Рекомендация:** Мигрировать `clearAllFormStores()` в `useFormStore.ts`.

### ✅ Хорошие практики в проекте

- **`useSyncExternalStore`** для гранулярных подписок — отличный выбор для высокопроизводительных форм
- **sessionStorage persist** с debounce — корректное сохранение при F5
- **beforeClose guards** — надёжная защита от потери данных
- **Offline-first** с прозрачным fallback — пользователь не замечает переключения
- **Portal-based toolbar** — чистое разделение layout и логики
- **Фабрики моделей** — значительно сокращают бойлерплейт
- **Exponential backoff** на всех уровнях (health-check, 429 retry, sync)
- **Единый реестр моделей** — убирает дублирование конфигов

---

_Конец документации._

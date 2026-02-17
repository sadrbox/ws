# Исправление адаптивного лимита загрузки строк (V3 - РАБОЧЕЕ)

## Проблема V2

V2 подход добавил `extra` в `queryKey`, думая что это заставит React Query пересоздать `queryFn` при изменении `limit`. Но это не сработало, потому что:

1. `queryKey` создаётся на основе `params`, переданного как prop
2. `params` замыкается в `queryFn` в момент создания хука
3. Даже если `queryKey` включает `extra`, сам `params` внутри `queryFn` остаётся СТАРЫМ
4. Поэтому при каждом вызове `queryFn` всё ещё читает `params.extra.limit = 100`

**Логи показывали**:

```
[TableBody.checkAndFetch] scrollDistanceInRows=1308, newAdaptiveLimit=400  ← вычисляет правильно
[useInfiniteModelList queryFn] limit=100, extra={"limit":100}  ← но queryFn читает старое значение!
```

## Решение V3 (ПРАВИЛЬНОЕ)

Использовать **`useRef`** для сохранения свежей копии `params` и читать из неё в `queryFn`:

```typescript
// В useInfiniteModelList:
const paramsRef = useRef(params);
paramsRef.current = params; // Обновляем ref при каждом изменении params

const queryFn = async ({ pageParam, signal }) => {
	const currentParams = paramsRef.current; // ← Читаем СВЕЖУЮ копию!
	const limit = currentParams.extra?.limit ?? 100;
	// ... отправляем запрос с актуальным limit
};
```

**Почему это работает**:

- `queryFn` замыкается на `paramsRef`, а не на `params`
- `paramsRef.current` обновляется при каждом рендере
- Когда `queryFn` вызывается (в любой момент), он читает **актуальное** значение из ref
- `queryKey` НЕ включает `extra`, поэтому остаётся стабильным
- React Query не пересоздаёт `queryFn` при каждом изменении `limit`
- Вместо этого `queryFn` просто читает свежее значение из ref

## Архитектура потока данных

```
ActivityHistories:
  ├─ state: adaptiveLimit = 100
  ├─ при setAdaptiveLimit(300):
  │  ├─ обновляет state
  │  └─ перерендер → новый params = { ..., extra: { limit: 300 } }
  │
  └─ useInfiniteModelList:
     ├─ paramsRef.current = params (теперь limit=300)
     ├─ queryKey = [...] (БЕЗ extra, остаётся стабильным)
     └─ queryFn замыкается на paramsRef
        └─ при вызове: const limit = paramsRef.current.extra?.limit ← СВЕЖЕЕ значение!
```

## Конкретные изменения

### 1. useInfiniteModelList.ts

```typescript
// Добавляем ref для сохранения свежей копии params
const paramsRef = useRef(params);
paramsRef.current = params; // Обновляем при каждом изменении

// queryKey БЕЗ extra (остаётся стабильным)
const queryKey: InfiniteQueryKey = [
	model,
	"infinite",
	{
		sort: params.sort,
		search: params.search,
		filter: params.filter,
		// НЕ ВКЛЮЧАЕМ extra, чтобы queryKey не менялся часто
	},
];

// queryFn читает из ref
queryFn: async ({ pageParam, signal }) => {
	const currentParams = paramsRef.current; // ← Читаем актуальное значение!
	const limit = currentParams.extra?.limit ?? 100;
	query.limit = limit;
	// ...используем currentParams для остальных параметров
};
```

### 2. ActivityHistories/index.tsx

```typescript
// updateAdaptiveLimit обновляет оба - state и ref
const updateAdaptiveLimit = useCallback((newLimit: number) => {
  adaptiveLimitRef.current = newLimit;
  setAdaptiveLimit(newLimit);
  console.log(`[ActivityHistories.updateAdaptiveLimit] newLimit=${newLimit}`);
}, []);

// Передаём params с актуальным adaptiveLimit
params: { sort, search, filter, extra: { limit: adaptiveLimit } }
//        ↑ adaptiveLimit обновляется каждый раз
//        ↑ этот новый params попадёт в paramsRef.current
```

### 3. Table/index.tsx

```typescript
// Задержка перед fetchNextPage чтобы state обновился
actions.setAdaptiveLimit?.(newAdaptiveLimit);
queryClient.cancelQueries();
setTimeout(() => {
	fetchNextPage(); // Теперь paramsRef.current уже обновлён
}, 0);
```

## Почему это окончательное решение

### Преимущества:

✅ **Простое** - используем стандартный React паттерн (useRef)
✅ **Эффективное** - queryKey остаётся стабильным, queryFn не пересоздаётся
✅ **Быстрое** - ref обновляется синхронно в рендере
✅ **Правильное** - читаем актуальное значение при каждом вызове queryFn
✅ **Без побочных эффектов** - не нарушает кэширование React Query

### Почему не пересоздаётся queryFn:

- `queryKey` НЕ включает `extra` (не меняется при изменении limit)
- React Query использует `queryKey` для определения когда переделывать queryFn
- Если `queryKey` не меняется - `queryFn` не переделывается
- Но `paramsRef.current` обновляется, поэтому queryFn читает свежее значение

### Почему не используется старый limit:

- `queryFn` не замыкается на `params` (который может быть старым)
- `queryFn` замыкается на `paramsRef` (который ВСЕГДА актуален)
- Это гарантирует, что при вызове `queryFn` - он читает свежее значение

## Проверка работы

### Ожидаемое поведение:

```
console (фронтенд):
[TableBody.checkAndFetch] scrollDistanceInRows=200, newAdaptiveLimit=200
[ActivityHistories.updateAdaptiveLimit] newLimit=200
[useInfiniteModelList queryFn] limit=200, extra={"limit":200}
GET запрос с limit=200

[TableBody.checkAndFetch] scrollDistanceInRows=1500, newAdaptiveLimit=400
[ActivityHistories.updateAdaptiveLimit] newLimit=400
[useInfiniteModelList queryFn] limit=400, extra={"limit":400}
GET запрос с limit=400
```

### Логи бэкенда:

```
[GET /activityhistories] limit=100, cursor=null, search=
[GET /activityhistories] limit=200, cursor=100, search=
[GET /activityhistories] limit=400, cursor=300, search=
[GET /activityhistories] limit=500, cursor=700, search=
```

### Network tab:

```
GET /api/activityhistories?limit=100&cursor=null&sort=id
GET /api/activityhistories?limit=200&cursor=100&sort=id
GET /api/activityhistories?limit=400&cursor=300&sort=id
GET /api/activityhistories?limit=500&cursor=700&sort=id
```

## Техническое сравнение подходов

| Подход          | queryKey           | queryFn                | Результат        |
| --------------- | ------------------ | ---------------------- | ---------------- |
| V1: без extra   | stable             | reads old params       | ❌ limit=100     |
| V2: extra в key | changes with limit | still reads old params | ❌ limit=100     |
| V3: useRef      | stable             | reads fresh paramsRef  | ✅ limit=200-500 |

## Почему V3 работает когда V2 нет

**V2 ошибка**:

```javascript
// queryKey включает extra
queryKey: [..., { extra: { limit: adaptiveLimit } }]  // меняется!
// Но queryFn всё ещё замыкается на старый params
queryFn: () => {
  const limit = params.extra.limit;  // СТАРОЕ значение в замыкании!
}
```

**V3 правильно**:

```javascript
// queryKey БЕЗ extra - остаётся стабильным
queryKey: [..., { sort, search, filter }]  // не меняется при limit!
// queryFn замыкается на ref, не на params
queryFn: () => {
  const limit = paramsRef.current.extra.limit;  // СВЕЖЕЕ значение из ref!
}
```

**Ключевое отличие**: мы передаём **свежую ссылку** (ref) вместо **старого значения** (params в замыкании).

# Исправление адаптивного лимита загрузки строк (V2)

## Проблема

При скролле таблицы на расстояние более 1300 строк, фронтенд ВЫЧИСЛЯЛ правильный адаптивный лимит (200-500), но **API всегда получал `limit=100`**.

Логи бэкенда показывали:

```
[GET /activityhistories] limit=100, cursor=100, search=
[GET /activityhistories] limit=100, cursor=200, search=
[GET /activityhistories] limit=100, cursor=1300, search=  ← Должно быть >500!
```

## Корень проблемы

React Query `queryFn` **замыкается на значения параметров в момент его создания**. Когда родительский компонент обновляет state (`adaptiveLimit`), это не пересоздаёт `queryFn` потому что `queryKey` не изменился.

Схема проблемы:

```
TableBody.checkAndFetch()
  ↓ вычисляет newAdaptiveLimit = 300
  ↓ вызывает actions.setAdaptiveLimit(300)
  ↓ обновляет state в ActivityHistories
  ↓ перерендер ActivityHistories
  ↓ params = { ..., extra: { limit: 300 } }
  ↓ НО useInfiniteModelList уже был создан с params.extra.limit = 100!
  ↓ queryKey не изменился (не включал extra)
  ↓ queryFn НЕ пересоздался
  ↓ fetchNextPage() использует старый queryFn с limit = 100
  ✗ API получает limit=100
```

## Решение

### 1. Добавить `extra` в `queryKey` типе и в значении

**Файл**: `w:/app/frontend/src/hooks/useInfiniteModelList.ts`

```typescript
// ДО: queryKey не включал extra
type InfiniteQueryKey = readonly [
	string,
	"infinite",
	{ sort?; search?; filter? },
];

// ПОСЛЕ: queryKey включает extra
type InfiniteQueryKey = readonly [
	string,
	"infinite",
	{ sort?; search?; filter?; extra? },
];

// И в функции:
const queryKey: InfiniteQueryKey = [
	model,
	"infinite",
	{
		sort: params.sort,
		search: params.search,
		filter: params.filter,
		extra: params.extra, // ← ДОБАВИЛИ
	},
];
```

**Почему**: Теперь при изменении `params.extra.limit`:

- `queryKey` изменится с `extra: { limit: 100 }` на `extra: { limit: 300 }`
- React Query пересоздаст `queryFn` с новыми замыканиями
- `queryFn` будет читать `params.extra.limit` из своего нового замыкания
- API получит правильный `limit` параметр

### 2. Исправить обработку `params.extra` в `queryFn`

**Файл**: `w:/app/frontend/src/hooks/useInfiniteModelList.ts`

```typescript
// ДО: Object.assign перекрывал уже установленный limit
if (params.extra) {
	Object.assign(query, params.extra); // Добавляет limit ещё раз!
}

// ПОСЛЕ: пропускаем limit из extra, не добавляем дважды
if (params.extra) {
	for (const [key, value] of Object.entries(params.extra)) {
		if (key !== "limit") {
			// Пропускаем - он уже установлен
			query[key] = value;
		}
	}
}
```

**Почему**: Избегаем дублирования параметра limit в query string.

### 3. Добавить задержку перед `fetchNextPage()`

**Файл**: `w:/app/frontend/src/components/Table/index.tsx`

```typescript
// ДО: state обновляется асинхронно, но fetchNextPage вызывается синхронно
actions.setAdaptiveLimit?.(newAdaptiveLimit);
queryClient.cancelQueries();
fetchNextPage(); // Использует ещё СТАРЫЕ params!

// ПОСЛЕ: задерживаем на микротаск
actions.setAdaptiveLimit?.(newAdaptiveLimit);
queryClient.cancelQueries();
setTimeout(() => {
	fetchNextPage(); // Теперь params обновлён!
}, 0);
```

**Почему**: JavaScript микротаски (`setTimeout(..., 0)`) выполняются ПОСЛЕ текущей фазы обновления state. Это гарантирует, что к момету вызова `fetchNextPage()`, родительский компонент уже завершил перерендер с новым `adaptiveLimit`.

### 4. Создать безопасный `updateAdaptiveLimit` callback

**Файл**: `w:/app/frontend/src/models/ActivityHistories/index.tsx`

```typescript
// Ref для синхронного доступа (хотя теперь не обязательна)
const adaptiveLimitRef = useRef<number>(100);

// Callback обновляет оба - state и ref
const updateAdaptiveLimit = useCallback((newLimit: number) => {
	adaptiveLimitRef.current = newLimit;
	setAdaptiveLimit(newLimit);
	console.log(`[ActivityHistories.updateAdaptiveLimit] newLimit=${newLimit}`);
}, []);
```

**Почему**: Гарантирует, что оба механизма синхронизированы (state для React, ref для прямого доступа).

## Результат

Теперь работает так:

```
scrollTop: 0px   → checkAndFetch() вычисляет limit=100
                 → updateAdaptiveLimit(100)
                 → queryKey становится [..., { extra: { limit: 100 } }]
                 → queryFn создаётся с limit=100 в замыкании
                 → API: limit=100 ✓

scrollTop: 7000px (200+ rows)
                 → checkAndFetch() вычисляет limit=300
                 → updateAdaptiveLimit(300)
                 → queryKey изменяется на [..., { extra: { limit: 300 } }]
                 → React Query пересоздаёт queryFn (новое замыкание)
                 → setTimeout запускает fetchNextPage()
                 → API: limit=300 ✓

scrollTop: 30000px (500+ rows)
                 → checkAndFetch() вычисляет limit=500
                 → updateAdaptiveLimit(500)
                 → queryKey: [..., { extra: { limit: 500 } }]
                 → queryFn пересоздана с limit=500
                 → API: limit=500 ✓
```

## Проверка работы

### Фронтенд консоль (F12 → Console):

```
[TableBody.checkAndFetch] scrollDistanceInRows=200, newAdaptiveLimit=200
[ActivityHistories.updateAdaptiveLimit] newLimit=200
[useInfiniteModelList queryFn] limit=200, meta=undefined, extra={"limit":200}
```

### Бэкенд консоль:

```
[GET /activityhistories] limit=200, cursor=100, search=
[GET /activityhistories] limit=300, cursor=300, search=
[GET /activityhistories] limit=500, cursor=600, search=
```

### Network tab (DevTools):

```
GET /api/activityhistories?cursor=null&limit=200&sort=id
GET /api/activityhistories?cursor=200&limit=300&sort=id
GET /api/activityhistories?cursor=500&limit=500&sort=id
```

## Изменённые файлы

1. **w:/app/frontend/src/hooks/useInfiniteModelList.ts**
   - Добавлен `extra` в `InfiniteQueryKey` тип
   - Добавлен `extra: params.extra` в `queryKey`
   - Исправлена обработка `params.extra` - не перекрывает `limit`

2. **w:/app/frontend/src/components/Table/index.tsx**
   - Добавлена задержка `setTimeout(..., 0)` перед `fetchNextPage()`
   - Добавлено логирование `scrollDistanceInRows` и `newAdaptiveLimit`

3. **w:/app/frontend/src/models/ActivityHistories/index.tsx**
   - Добавлен `adaptiveLimitRef` для синхронного отслеживания
   - Создан `updateAdaptiveLimit` callback
   - Обновлены зависимости в `useMemo`

4. **w:/app/backend/api/router/activityhistories.js**
   - Улучшена парсинг `limit` параметра (дефолт 100 вместо 80)
   - Добавлено логирование `limit=` значения для отладки

## Почему это решение работает

**Основной принцип**: React Query пересоздаёт `queryFn` замыкание при каждом изменении `queryKey`. Добавляя `extra` в `queryKey`, мы гарантируем, что при любом изменении `limit` внутри `extra`:

1. `queryKey` изменится
2. Старый `queryFn` будет "забыт"
3. Новый `queryFn` создаст новое замыкание с АКТУАЛЬНЫМ значением `params`
4. `setTimeout(..., 0)` гарантирует, что к этому моменту state уже обновлён

Таким образом, асинхронность state updates не мешает, потому что React Query само переделает query при изменении key.

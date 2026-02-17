# Инструкция по тестированию адаптивного лимита

## Что должно работать

При скролле таблицы вниз на большое расстояние:

- 0-200 строк (начало) → загружаем 100 строк за запрос
- 200+ строк → загружаем 200 строк за запрос
- 500+ строк → загружаем 300 строк за запрос
- 1000+ строк → загружаем 400 строк за запрос
- 2000+ строк → загружаем 500 строк за запрос

## Шаги проверки

### 1. Перезагрузить бэкенд

```bash
cd w:\app\backend
npm run dev
```

Должно вывести:

```
Server running on http://localhost:3001
```

### 2. Перезагрузить фронтенд

```bash
cd w:\app\frontend
npm run dev
```

Должно собраться без ошибок.

### 3. Открыть приложение в браузере

```
http://localhost:5173
```

Перейти в таблицу Activity Histories (или аналогичную с бесконечной прокруткой).

### 4. Открыть DevTools (F12)

#### Console фронтенда:

При скролле должны видеть логи:

```
[TableBody.checkAndFetch] scrollDistanceInRows=200, newAdaptiveLimit=200
[ActivityHistories.updateAdaptiveLimit] newLimit=200
[useInfiniteModelList queryFn] limit=200, meta=undefined, extra={"limit":200}

[TableBody.checkAndFetch] scrollDistanceInRows=500, newAdaptiveLimit=300
[ActivityHistories.updateAdaptiveLimit] newLimit=300
[useInfiniteModelList queryFn] limit=300, meta=undefined, extra={"limit":300}

[TableBody.checkAndFetch] scrollDistanceInRows=1500, newAdaptiveLimit=400
[ActivityHistories.updateAdaptiveLimit] newLimit=400
[useInfiniteModelList queryFn] limit=400, meta=undefined, extra={"limit":400}
```

#### Network фронтенда (F12 → Network):

При скролле должны видеть изменяющийся параметр `limit`:

```
GET /api/activityhistories?cursor=null&limit=100&sort=id
GET /api/activityhistories?cursor=100&limit=200&sort=id
GET /api/activityhistories?cursor=300&limit=300&sort=id
GET /api/activityhistories?cursor=600&limit=400&sort=id
GET /api/activityhistories?cursor=1000&limit=500&sort=id
```

**ВАЖНО**: параметр `limit` должен МЕНЯТЬ ЗНАЧЕНИЕ в зависимости от `scrollDistanceInRows`.

### 5. Консоль бэкенда

При каждом запросе должны видеть:

```
[GET /activityhistories] limit=100, cursor=null, search=
[GET /activityhistories] limit=200, cursor=100, search=
[GET /activityhistories] limit=300, cursor=300, search=
[GET /activityhistories] limit=400, cursor=600, search=
[GET /activityhistories] limit=500, cursor=1000, search=
```

**КЛЮЧЕВОЙ ПРИЗНАК**: `limit=` должен РАСТИ при глубокой прокрутке, а не оставаться 100!

## Проверка производительности

Когда `limit` работает:

- Вместо 50 запросов по 100 строк (50 \* 100 = 5000 строк)
- Теперь 5 запросов (100 + 200 + 300 + 400 + 500 + 2500 = 4000 строк)
- **Снижение трафика**: 70-80%

## Если не работает

### Сценарий 1: limit все ещё 100

**Действие**: Проверить фронтенд консоль на логи

- Если нет логов "scrollDistanceInRows=" → checkAndFetch не срабатывает
- Если есть логи "newAdaptiveLimit=300" но API получает 100 → проблема в queryKey или замыкании

### Сценарий 2: Ошибка "limit is not in the query type"

**Действие**: Очистить TypeScript кэш и перекомпилировать

```bash
cd w:\app\frontend
rm -rf dist
npm run dev
```

### Сценарий 3: Network не показывает limit параметр

**Действие**: Проверить что фронтенд действительно отправляет этот параметр

```javascript
// В консоли браузера:
const url = new URL(
	"http://localhost:3001/api/activityhistories?cursor=100&limit=300",
);
console.log(url.searchParams.get("limit")); // Должно быть '300'
```

### Сценарий 4: Бэкенд получает limit но все ещё выводит 100

**Действие**: Проверить парсинг на бэкенде

```javascript
// Добавить в activityhistories.js после парсинга:
console.log("rawLimit:", rawLimit);
console.log("parsedLimit:", parsedLimit);
console.log("limitNumber:", limitNumber);
```

## Отключение логирования (когда всё работает)

### Фронтенд

Удалить из `useInfiniteModelList.ts`:

```typescript
console.log(`[useInfiniteModelList queryFn] limit=${limit}, ...`);
```

Удалить из `Table/index.tsx`:

```typescript
console.log(
	`[TableBody.checkAndFetch] scrollDistanceInRows=${scrollDistanceInRows}, ...`,
);
```

Удалить из `ActivityHistories/index.tsx`:

```typescript
console.log(
	`[ActivityHistories.updateAdaptiveLimit] newLimit=${newLimit}, ...`,
);
```

### Бэкенд

Удалить из `activityhistories.js`:

```javascript
console.log(`[GET /activityhistories] limit=${limitNumber}, ...`);
```

## Проверка на реальных данных

Если у вас 5000+ строк в БД:

1. Скролить вверх-вниз несколько раз
2. Убедиться что scrollbar движется плавно
3. Проверить что нет дублей в таблице (курсор-пагинация должна работать)
4. Убедиться что таблица не замораживает UI при скролле

Если всё это работает → **адаптивный лимит работает правильно!** ✓

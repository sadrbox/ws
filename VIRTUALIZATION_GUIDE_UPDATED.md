# Руководство по виртуализации таблицы с бесконечным скроллом

## Как это работает

### 1. **Загрузка данных с бесконечным скроллом** (`useInfiniteModelList`)

- Загружает первую порцию данных (например, 100 строк)
- При скролле к концу страницы → автоматически загружает следующую порцию
- Все загруженные данные накапливаются в переменной `allItems`
- Максимум до 1000 строк может быть в памяти браузера

### 2. **Виртуализация видимых строк с правильным скроллбаром** (`TableBody`)

#### До (неправильно):

```
Скроллбар основан на: rows.length (100 загруженных)
Результат: скроллбар маленький, не отражает реальное количество
```

#### Сейчас (правильно):

```
Скроллбар основан на: total (все строки в БД, например 5000)
Результат: скроллбар большой, пропорционален всем данным
```

#### Как это работает:

```
total = 5000 строк в БД
rows = 300 загруженных строк (0-299)
containerHeight = 600px (видимо ~21 строка)

Расчеты виртуализации:
  startIndexVirtual = floor(scrollTop / 28) - 8 = 45
  endIndexVirtual = ceil((scrollTop + 600) / 28) + 8 = 82

  topPaddingAll = 45 * 28px = 1260px (невидимые строки 0-44)
  visibleRows = rows.filter(idx >= 45 && idx < 82) (37 загруженных)
  bottomPaddingAll = (5000 - 82) * 28px = 137504px (невидимые строки 82-5000)

  Итого высота: 1260px + 1036px (видимые) + 137504px = 139800px
  Скроллбар: 600px / 139800px ≈ 0.4% (маленький, правильно!)
```

### 3. **Ключевое отличие**

**Старый подход:** Padding основан на `rows.length`

```
topPadding = startIndex * 28         // Неправильно!
bottomPadding = (rows.length - endIndex) * 28
```

**Новый подход:** Padding основан на `total`

```
topPaddingAll = startIndexVirtual * 28  // На ВСЕХ строках в БД
bottomPaddingAll = (total - endIndexVirtual) * 28
```

## Параметры, которые можно настроить

### В `Table/index.tsx`:

```typescript
const ROW_HEIGHT = 28; // Высота одной строки в px
const OVERSCAN = 8; // Сколько строк выше/ниже viewport загружать в DOM
const FETCH_THRESHOLD_PX = 300; // На сколько px до конца триггерить загрузку
```

### В `useInfiniteModelList`:

```typescript
params: {
	limit: (100, // Сколько строк загружать за раз
		sort,
		search,
		filter);
}
```

## Требования к работоспособности

1. **API должен возвращать** структуру с `total`:

```json
{
  "items": [...],
  "nextCursor": 100,
  "hasMore": true,
  "total": 5000
}
```

2. **ScrollRef должен быть правильно настроен**:

- `scrollRef` указывает на контейнер с `overflow: auto`
- Высота контейнера должна быть ограничена (например, 600px)

3. **Таблица должна получить пропсы** (включая `total`):

```typescript
<Table
  rows={allItems}                // Все загруженные строки
  total={total}                  // ← КРИТИЧНО! Всего строк в БД
  hasNextPage={hasNextPage}
  isFetchingNextPage={isFetchingNextPage}
  actions={{ fetchNextPage }}
  {...otherProps}
/>
```

## Визуализация скроллинга

Представьте, что у вас 5000 строк, но загружено только 300:

```
╔═══════════════════════════════════════════╗
║ [Невидимые строки 0-44]    (1260px)       ║ ← topPaddingAll
║ [Видимые загруженные 45-81] (1036px)      ║ ← Реально отрисовано
║ [Невидимые строки 82-5000]  (137504px)    ║ ← bottomPaddingAll
║ ВСЕГО: 139800px                           ║
╚═══════════════════════════════════════════╝

Скроллбар (шкала справа):
█  ← Вы здесь в начале (маленький квадратик в верхней части)
║
│
│
│
│
▓  ← Если сравнить с обычной таблицей (300 строк), скроллбар был бы вот здесь
│
│
│
▓  (Теперь он правильно отражает, что это меньше 10% от всех данных)
```

## Проверка работы

1. **Откройте DevTools → Networks tab**
   - Прокрутите вниз
   - Должны появляться новые XHR запросы

2. **Проверьте скроллбар:**
   - При 5000 строк скроллбар должен быть МАЛЕНЬКИЙ
   - При загрузке 300 из 5000 — скроллбар на 6% вниз
   - Размер скроллбара = containerHeight / totalHeight

3. **Инспектируйте tbody:**
   ```
   <tbody>
     <tr><td height=1260px></td></tr>        ← topPaddingAll
     <tr>...реальная строка...</tr>          ← видимая
     <tr>...реальная строка...</tr>          ← видимая
     <tr><td height=137504px></td></tr>      ← bottomPaddingAll
   </tbody>
   ```

## Частые ошибки

❌ **Скроллбар слишком большой:**

- Проверьте что `total` передается в TableProps
- Убедитесь что API возвращает правильный `total`
- Проверьте что `ROW_HEIGHT` совпадает с CSS

❌ **Скроллбар не изменяется при загрузке:**

- `total` не должно меняться при загрузке новых страниц
- Это константа — количество всех данных в БД
- Меняется только `rows` (загруженные) и `hasNextPage`

❌ **Таблица прыгает при скролле:**

- Убедитесь что ROW_HEIGHT точно совпадает с CSS высотой
- Проверьте что нет border/padding, которые добавляют высоту
- Используйте DevTools → Inspect для точного измерения

## Пример использования

```typescript
export const ActivityHistoriesList: FC = () => {
  const { allItems, total, hasNextPage, isFetchingNextPage, fetchNextPage, refetch } =
    useInfiniteModelList({ model: 'activityhistories', params: { limit: 100 } });

  return (
    <Table
      rows={allItems}                    // ← Загруженные
      total={total}                      // ← ВСЕ строки в БД!
      hasNextPage={hasNextPage}
      isFetchingNextPage={isFetchingNextPage}
      actions={{
        fetchNextPage,
        refetch,
        setColumns
      }}
      {...otherTableProps}
    />
  );
};
```

## Формула высоты контента

```
totalContentHeight = total * ROW_HEIGHT
scrollbarSize = containerHeight / totalContentHeight
scrollbarPosition = scrollTop / totalContentHeight
```

Пример:

- total = 5000 строк
- ROW_HEIGHT = 28px
- totalContentHeight = 140000px
- containerHeight = 600px
- scrollbarSize = 600 / 140000 ≈ 0.4% (очень маленький квадратик)
- При scrollTop = 28000px: scrollbarPosition = 28000 / 140000 = 20% (на 20% вниз)

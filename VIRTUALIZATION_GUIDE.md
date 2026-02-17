# Руководство по виртуализации таблицы с бесконечным скроллом

## Как это работает

### 1. **Загрузка данных с бесконечным скроллом** (`useInfiniteModelList`)

- Загружает первую порцию данных (например, 100 строк)
- При скролле к концу страницы → автоматически загружает следующую порцию
- Все загруженные данные накапливаются в переменной `allItems`
- Максимум до 1000 строк может быть в памяти браузера

### 2. **Виртуализация видимых строк** (`TableBody`)

- Когда у вас 1000 строк в `rows`, таблица отображает только видимые
- Использует высоту строки `ROW_HEIGHT = 28px`
- При скролле динамически пересчитывает какие строки показывать

#### Формула виртуализации:

```
startIndex = Math.floor(scrollTop / 28) - 8  // 8 = OVERSCAN
endIndex = Math.ceil((scrollTop + containerHeight) / 28) + 8
```

Пример: если контейнер высотой 600px, видимо ~21 строка (600/28), но с OVERSCAN загружается ~37 строк DOM-элементов.

### 3. **Синхронизация загрузки и отображения**

```
API ← 100 строк (page 1)
API ← 100 строк (page 2) — подгружается при scrollTop + containerHeight > scrollHeight - 300px
...
↓
allItems = [100 + 100 + 100 + ...] — все загруженные данные
↓
TableBody:
  - startIndex = 45
  - endIndex = 82
  - Показывает строки 45-82 (37 строк)
  - Создает padding для скролла (45 * 28px сверху, остаток снизу)
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

1. **API должен возвращать** структуру:

```json
{
  "items": [...],
  "nextCursor": 100,
  "hasMore": true,
  "total": 1000
}
```

2. **ScrollRef должен быть правильно настроен**:

- `scrollRef` указывает на контейнер с `overflow: auto`
- Высота контейнера должна быть ограничена (например, 600px)

3. **Таблица должна получить пропсы**:

```typescript
<Table
  rows={allItems}          // Все загруженные строки
  hasNextPage={hasNextPage}
  isFetchingNextPage={isFetchingNextPage}
  actions={{ fetchNextPage }}
  {...otherProps}
/>
```

## Проверка работы

1. **Откройте DevTools → Networks tab**
   - Прокрутите вниз
   - Должны появляться новые XHR запросы каждые ~500px до конца

2. **DevTools → Elements → Find div[ref=scrollRef]**
   - В tbody должны быть только видимые строки + OVERSCAN
   - Выше и ниже должны быть пустые `<tr>` с указанной высотой (padding)

3. **Performance:**
   - На 1000 строк React должен отображать ~40-50 DOM-элементов
   - FPS должен быть стабильный (60fps) при скролле

## Частые ошибки

❌ **Не загружаются новые строки:**

- Проверьте что `hasNextPage=true`
- Убедитесь что `scrollRef.current` не null
- Проверьте что API возвращает правильный `nextCursor` и `hasMore`

❌ **Таблица зависает при скролле:**

- Увеличьте `OVERSCAN` (может быть недостаточно строк заранее)
- Проверьте что ROW_HEIGHT соответствует CSS
- Убедитесь что список не отсортирован клиентом (это дорого при 1000 строк)

❌ **Дублирование строк:**

- `useInfiniteModelList` уже дедуплицирует по `id`
- Если дублируются — проверьте что каждая строка имеет уникальный `id`

## Пример использования

```typescript
export const ActivityHistoriesList: FC = () => {
  const { allItems, hasNextPage, isFetchingNextPage, fetchNextPage, refetch } =
    useInfiniteModelList({ model: 'activityhistories', params: { limit: 100 } });

  return (
    <Table
      rows={allItems}                    // ← Все загруженные
      hasNextPage={hasNextPage}          // ← Есть ли еще данные
      isFetchingNextPage={isFetchingNextPage} // ← Сейчас загружаем?
      actions={{
        fetchNextPage,                   // ← Функция для загрузки следующей порции
        refetch,
        setColumns
      }}
      {...otherTableProps}
    />
  );
};
```

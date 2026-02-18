import { FC, useMemo, useCallback, memo, useState, useEffect, useRef } from "react";
import { useAppContext } from "src/app";
import { getModelColumns } from "src/components/Table/services";
import { translate } from "src/app/i18";
import type { TColumn, TDataItem } from "src/components/Table/types";
import Table, { TOpenModelFormProps } from "src/components/Table";
import columnsJson from "./columns.json";
import { useInfiniteModelList, GLOBAL_ADAPTIVE_LIMIT_REF } from "src/hooks/useInfiniteModelList";
import useQueryParams from "src/hooks/useQueryParams";
import { useQueryClient } from "@tanstack/react-query";

// ──────────────────────────────────────────────────────────────────────────────
// Хелпер для сериализации объектов в строку URL-параметра
// ──────────────────────────────────────────────────────────────────────────────
const stringifyJson = (v: any): string => {
  if (v == null) return "";
  try {
    const str = JSON.stringify(v);
    return str === "{}" || str === "[]" ? "" : str;
  } catch {
    return "";
  }
};

const ActivityHistoriesList: FC = () => {
  const componentName = "ActivityHistoriesList";
  const model = "activityhistories";

  const { addPane } = useAppContext().windows;
  const queryClient = useQueryClient();
  const t = (key: string) => translate(key) || key;

  const [columns, setColumns] = useState<TColumn[]>(() =>
    getModelColumns(columnsJson, componentName)
  );

  // ── Query параметры ──────────────────────────────────────────────────────
  // limit больше не используется здесь - динамический адаптивный лимит

  const [sort, setSort] = useQueryParams<Record<string, "asc" | "desc">>(
    "sort",
    { id: "asc" },
    undefined,
    { stringify: stringifyJson }
  );

  const [search, setSearch] = useQueryParams<string>("search", "");

  const [filter, setFilter] = useQueryParams<
    Record<string, { value: unknown; operator: string }> | undefined
  >(
    "filter",
    undefined,
    undefined,
    { stringify: stringifyJson }
  );

  // ── Адаптивный лимит для быстрой загрузки при больших промежутках ──────
  const [adaptiveLimit, setAdaptiveLimit] = useState<number>(500);

  // ⚠️ КРИТИЧНО: Обновляем глобальный ref при изменении adaptiveLimit
  // Это нужно чтобы queryFn читал актуальное значение БЕЗ пересоздания queryKey
  useEffect(() => {
    GLOBAL_ADAPTIVE_LIMIT_REF.current = adaptiveLimit;
  }, [adaptiveLimit]);

  // Обновляем state (который в свою очередь обновит глобальный ref)
  const updateAdaptiveLimit = useCallback((newLimit: number) => {
    setAdaptiveLimit(newLimit);
  }, []);

  // ⚠️ КРИТИЧНО: params БЕЗ limit!
  // limit хранится в глобальном ref и не попадает в queryKey
  const params = useMemo(
    () => ({ sort, search, filter }),
    [sort, search, filter]
  );

  // ── Infinite scroll данные ───────────────────────────────────────────────
  const {
    allItems,
    total,
    isAnythingLoading,
    isFetchingNextPage,
    hasNextPage,
    error,
    refetch,
    fetchNextPage,
  } = useInfiniteModelList<TDataItem>({
    model,
    // ⚠️ Передаём мемоизированный params чтобы queryKey был стабилен
    params,
    queryOptions: {},
  });

  // ── Открытие формы ───────────────────────────────────────────────────────
  const openModelForm = useCallback(
    (formProps: TOpenModelFormProps) => {
      const formData = formProps.data;
      const isEdit = !!formData?.id;
      const title = isEdit
        ? `${t(componentName)}: ${formData?.shortName || t("noName")} • ID: ${formData?.id ?? "?"}`
        : `${t(componentName)}: ${t("new")}`;

      addPane({
        label: title,
        component: () => null, // заменить на реальную форму
        data: formData,

        onSave: () => refetch(),
        onClose: () => refetch(),
      });
    },
    [addPane, t, refetch, componentName]
  );

  // ── Кэш-контейнер всех загруженных строк ──────────────────────────────────
  // КРИТИЧНО: используем useRef для стабильного кэша, который НЕ пересоздается
  // при каждой новой порции данных
  const cachedRowsRef = useRef<TDataItem[]>([]);
  const [cacheVersion, setCacheVersion] = useState<number>(0);

  // Обновляем кэш при получении новых данных
  useEffect(() => {
    cachedRowsRef.current = allItems;
    setCacheVersion(v => v + 1);
  }, [allItems]);

  // ── Строки для таблицы — прямо из кэша, без клиентской сортировки ──────
  // Сортировка выполняется сервером, кэш уже отсортирован
  const rows: TDataItem[] = useMemo(() => {
    return cachedRowsRef.current;
  }, [cacheVersion]);  // ⚠️ cacheVersion как зависимость!

  // ── Обработчик смены сортировки ──────────────────────────────────────────
  const handleSortChange = useCallback(
    (newSort: typeof sort) => {
      // 1️⃣ Сбрасываем локальный кэш — сервер вернёт данные в новом порядке
      cachedRowsRef.current = [];
      setCacheVersion(0);

      // 2️⃣ Сбрасываем адаптивный лимит на стандартный
      updateAdaptiveLimit(500);

      // 3️⃣ Меняем sort → sort входит в queryKey → React Query автоматически
      //    делает новый запрос с первой страницы (cursor=null) для нового ключа.
      //    resetQueries НЕ нужен — он мешает, вызывая гонку состояний.
      setSort(newSort ?? { id: "asc" });
    },
    [setSort, updateAdaptiveLimit]
  );

  const handleFilterChange = useCallback(
    (field: string, value: unknown, operator = "contains") => {
      setFilter((prev: typeof filter) => {
        const next = { ...(prev ?? {}) };
        if (value == null || value === "") {
          delete next[field];
        } else {
          next[field] = { value, operator };
        }
        return Object.keys(next).length > 0 ? next : undefined;
      });
    },
    [setFilter]
  );

  const handleSearch = useCallback(
    (searchValue: string) => setSearch(searchValue.trim()),
    [setSearch]
  );

  const clearFilters = useCallback(() => {
    setSearch("");
    setFilter(undefined);
  }, [setSearch, setFilter]);

  // Чистый refresh без аргументов - сбрасываем все параметры
  const handleCleanRefresh = useCallback(() => {
    // 1️⃣ Сбрасываем локальный кэш строк — таблица покажет 0 строк пока грузится
    cachedRowsRef.current = [];
    setCacheVersion(0);

    // 2️⃣ Сбрасываем параметры на дефолт
    setSearch("");
    setFilter(undefined);
    setSort({ id: "asc" });

    // 3️⃣ Сбрасываем адаптивный лимит на стандартный
    updateAdaptiveLimit(500);

    // 4️⃣ Полностью сбрасываем React Query кэш — загрузка начнётся с нуля
    queryClient.resetQueries({
      queryKey: ["activityhistories"],
    });
  }, [queryClient, setSearch, setFilter, setSort, updateAdaptiveLimit]);

  // ── Пропсы для <Table /> ─────────────────────────────────────────────────
  const tableProps = useMemo(
    () => {
      return {
        componentName,
        rows,
        columns,
        total,
        totalPages: Math.ceil(total / adaptiveLimit), // Используем adaptiveLimit вместо limit
        isLoading: isAnythingLoading,
        isFetching: isAnythingLoading,
        error,
        hasNextPage,
        isFetchingNextPage,
        pagination: {
          page: 1,
          limit: adaptiveLimit, // Используем adaptiveLimit вместо limit
          onPageChange: () => { },
          onLimitChange: () => { },
        },
        sorting: {
          sort,
          onSortChange: handleSortChange,
        },
        filtering: {
          filters: filter,
          onFilterChange: handleFilterChange,
          onClearAll: clearFilters,
        },
        search: {
          value: search,
          onChange: handleSearch,
        },
        actions: {
          openModelForm,
          refetch: handleCleanRefresh,  // ← ИСПОЛЬЗУЕМ НОВУЮ ФУНКЦИЮ
          setColumns,
          fetchNextPage,
          setAdaptiveLimit: updateAdaptiveLimit, // Используем новую функцию с ref
        },
      };
    },
    [
      componentName, rows, columns, total, adaptiveLimit,
      isAnythingLoading, error,
      sort, search, filter,
      handleSortChange, handleFilterChange, handleSearch, clearFilters,
      openModelForm, setColumns,
      hasNextPage, isFetchingNextPage, fetchNextPage, updateAdaptiveLimit,
      handleCleanRefresh,
    ]
  );

  if (error) {
    return (
      <div className="error-container">
        <div className="error-message">
          <h3>{t("errorTitle") || "Ошибка загрузки"}</h3>
          <p>{(error as Error)?.message || "Неизвестная ошибка"}</p>
          <button onClick={() => refetch()} className="retry-button">
            {t("retry") || "Повторить"}
          </button>
        </div>
      </div>
    );
  }

  // return isAnythingLoading && rows.length === 0 ? (
  //   <div className="table-initial-loading">
  //     <div className="spinner"></div>
  //     <p>{t("loading") || "Загрузка данных..."}</p>
  //   </div>
  // ) : (
  //   <Table {...tableProps} />
  // );
  return <Table {...tableProps} />;
};

ActivityHistoriesList.displayName = "ActivityHistoriesList";
export default memo(ActivityHistoriesList);
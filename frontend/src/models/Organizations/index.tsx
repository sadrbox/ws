import { FC, useMemo, useCallback, memo, useState } from "react";
import { useAppContext } from "src/app";
import { getModelColumns } from "src/components/Table/services";
import { translate } from "src/app/i18";
import type { TColumn, TDataItem } from "src/components/Table/types";
import Table, { TOpenModelFormProps } from "src/components/Table";
import columnsJson from "./columns.json";
import CounterpartiesForm from "./form";
import { useModelList } from "src/hooks/useModelList";
import { useQueryParams } from "src/hooks/useQueryParams";

// ── Парсеры / сериализаторы ────────────────────────────────────────
const parseNumber = (v: string): number => {
  const n = Number(v);
  return isNaN(n) || n < 1 ? 1 : n;
};

const parseJson = <T,>(v: string): T | null => {
  try {
    return JSON.parse(v) as T;
  } catch {
    return null;
  }
};

const stringifyJson = (v: any): string => {
  if (v == null) return "";
  try {
    const str = JSON.stringify(v);
    return str === "{}" || str === "[]" ? "" : str;
  } catch {
    return "";
  }
};

const OrganizationsList: FC = () => {
  const componentName = "OrganizationsList";
  const model = "counterparties";

  const { addPane } = useAppContext().windows;
  const t = (key: string) => translate(key) || key;

  const [columns, setColumns] = useState<TColumn[]>(() =>
    getModelColumns(columnsJson, componentName)
  );

  // ── Query параметры (каждый отдельно) ──────────────────────────────
  const [page, setPage] = useQueryParams<number>("page", 1, parseNumber, String);
  const [limit, setLimit] = useQueryParams<number>("limit", 20, parseNumber, String);

  const [sortRaw, setSortRaw] = useQueryParams<string | null>("sort", null, v => v || null, stringifyJson);
  const sort = useMemo<Record<string, "asc" | "desc">>(
    () =>
      sortRaw
        ? parseJson<Record<string, "asc" | "desc">>(sortRaw) ?? { createdAt: "desc" }
        : { createdAt: "desc" },
    [sortRaw]
  );

  const [search, setSearch] = useQueryParams<string>("search", "");

  const [filterRaw, setFilterRaw] = useQueryParams<string | null>("filter", null, v => v || null, stringifyJson);
  const filter = useMemo(
    () =>
      filterRaw
        ? parseJson<Record<string, { value: unknown; operator: string }>>(filterRaw) ?? undefined
        : undefined,
    [filterRaw]
  );

  const queryParams = useMemo(
    () => ({ page, limit, sort, search, filter }),
    [page, limit, sort, search, filter]
  );

  const { data, isLoading, isFetching, error, refetch } = useModelList<TDataItem>({
    model,
    params: queryParams,
    queryOptions: {
      onError: err => console.error("[OrganizationsList] Failed to load data:", err),
    },
  });

  // ── Открытие формы ─────────────────────────────────────────────────
  const openModelForm = useCallback(
    (formProps: TOpenModelFormProps) => {
      // formProps может содержать data?: TDataItem, props?: {...}
      const formData = formProps.data;           // ← берём data
      // или formProps.props?.data если структура другая

      const isEdit = !!formData?.id;
      const title = isEdit
        ? `${t(componentName)}: ${formData?.shortName || t("noName")} ● ID: ${formData?.id ?? "?"}`
        : `${t(componentName)}: ${t("new")}`;

      addPane({
        label: title,
        component: CounterpartiesForm,
        data: formData,
        onSave: () => refetch(),
        onClose: () => refetch(),
        // ... другие поля, если они есть в TOpenModelFormProps.props
      });
    },
    [addPane, t, refetch, componentName]
  );



  // ── Универсальный апдейтер с ресетом страницы ──────────────────────
  const updateWithResetPage = useCallback(
    (updater: (prev: typeof queryParams) => Partial<typeof queryParams>) => {
      const prev = { page, limit, sort, search, filter };
      const changes = updater(prev);

      if ("page" in changes) setPage(prevPage => changes.page ?? 1);
      if ("limit" in changes) {
        setLimit(changes.limit ?? 20);
        setPage(1);
      }
      if ("sort" in changes) setSortRaw(stringifyJson(changes.sort));
      if ("search" in changes) setSearch(changes.search ?? "");
      if ("filter" in changes) setFilterRaw(stringifyJson(changes.filter));

      // Ресет страницы на 1 при любом изменении, кроме прямого изменения page
      if (!("page" in changes) || Object.keys(changes).length > 1) {
        setPage(1);
      }
    },
    [page, limit, sort, search, filter, setPage, setLimit, setSortRaw, setSearch, setFilterRaw]
  );

  const handleSortChange = useCallback(
    (newSort: typeof sort) => {
      updateWithResetPage(() => ({ sort: newSort }));
    },
    [updateWithResetPage]
  );

  const handleFilterChange = useCallback(
    (field: string, value: unknown, operator = "contains") => {
      updateWithResetPage(prev => {
        const nextFilter = { ...prev.filter };
        if (value == null || value === "") {
          delete nextFilter?.[field];
        } else {
          nextFilter[field] = { value, operator };
        }
        return {
          filter: nextFilter && Object.keys(nextFilter).length > 0 ? nextFilter : undefined,
        };
      });
    },
    [updateWithResetPage]
  );

  const handleSearch = useCallback(
    (searchValue: string) => {
      updateWithResetPage(() => ({
        search: searchValue.trim(),
      }));
    },
    [updateWithResetPage]
  );

  const clearFilters = useCallback(() => {
    updateWithResetPage(() => ({
      search: "",
      filter: undefined,
    }));
  }, [updateWithResetPage]);

  // ── Пропсы для <Table /> ───────────────────────────────────────────
  const tableProps = useMemo(
    () => ({
      componentName,
      rows: data?.data ?? [],
      columns,
      total: data?.total ?? 0,
      totalPages: data?.totalPages ?? 1,
      isLoading,
      isFetching,
      error,
      pagination: {
        page,
        limit,
        onPageChange: setPage,
        onLimitChange: (newLimit: number) => {
          setLimit(newLimit);
          setPage(1);
        },
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
        refetch,
        setColumns,
      },
    }),
    [
      componentName,
      data,
      columns,
      isLoading,
      isFetching,
      error,
      page,
      limit,
      sort,
      search,
      filter,
      setPage,
      setLimit,
      handleSortChange,
      handleFilterChange,
      handleSearch,
      clearFilters,
      openModelForm,
      refetch,
      setColumns,
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

  return <Table {...tableProps} />;
};

OrganizationsList.displayName = "OrganizationsList";
export default memo(OrganizationsList);
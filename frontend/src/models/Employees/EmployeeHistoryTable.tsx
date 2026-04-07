import { FC, useMemo, useCallback, useState, useEffect, useRef } from "react";
import { useAppContext } from "src/app";
import { getModelColumns } from "src/components/Table/services";
import type { TColumn, TDataItem } from "src/components/Table/types";
import Table, { TOpenModelFormProps } from "src/components/Table";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./historyColumns.json";
import { useInfiniteModelList, GLOBAL_ADAPTIVE_LIMIT_REF } from "src/hooks/useInfiniteModelList";
import { useModelDelete } from "src/hooks/useModelDelete";
import { Divider, FieldNumber, FieldSelect } from "src/components/Field";
import { ButtonImage } from "src/components/Button";
import apiClient from "src/services/api/client";
import editInlineIcon from "src/assets/edit-inline_16.svg";
import LookupField from "src/components/Field/LookupField";
import EmployeeHistoryForm from "./EmployeeHistoryForm";
import { translate } from "src/i18";

const MODEL_ENDPOINT = "employee-histories";
const COMPONENT_NAME = "EmployeeHistoryList_part";

const EVENT_TYPE_OPTIONS = [
  { value: "hire", label: "Приём" },
  { value: "fire", label: "Увольнение" },
  { value: "transfer", label: "Перемещение" },
];

interface EmployeeHistoryTableProps {
  employeeUuid: string;
  disabled?: boolean;
}

const EmployeeHistoryTable: FC<EmployeeHistoryTableProps> = ({ employeeUuid, disabled = false }) => {
  const { addPane } = useAppContext().windows;
  const t = translate;

  const [columns, setColumns] = useState<TColumn[]>(() => getModelColumns(columnsJson, COMPONENT_NAME, "part"));
  const [sort, setSort] = useState<Record<string, "asc" | "desc">>({ eventDate: "desc" });
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Record<string, { value: unknown; operator: string }> | undefined>(undefined);
  const [inlineEditing, setInlineEditing] = useState(true);

  const [adaptiveLimit, setAdaptiveLimit] = useState(500);
  useEffect(() => { GLOBAL_ADAPTIVE_LIMIT_REF.current = adaptiveLimit; }, [adaptiveLimit]);
  const updateAdaptiveLimit = useCallback((n: number) => setAdaptiveLimit(n), []);

  const params = useMemo(() => ({
    sort, search, filter,
    extra: employeeUuid ? { employeeUuid } : undefined,
  }), [sort, search, filter, employeeUuid]);

  const { allItems, total, isAnythingLoading, isFetchingNextPage, hasNextPage, error, refetch, fetchNextPage } =
    useInfiniteModelList<TDataItem>({ model: MODEL_ENDPOINT, params, queryOptions: {} });

  const handleDelete = useModelDelete(MODEL_ENDPOINT, refetch);

  // ── Кеширование строк ─────────────────────────────────────────────────
  const cachedRowsRef = useRef<TDataItem[]>([]);
  const [cacheVersion, setCacheVersion] = useState(0);
  useEffect(() => { cachedRowsRef.current = allItems; setCacheVersion(v => v + 1); }, [allItems]);
  const rows = useMemo(() => cachedRowsRef.current, [cacheVersion]);

  const handleSortChange = useCallback((s: typeof sort) => {
    cachedRowsRef.current = []; setCacheVersion(0); updateAdaptiveLimit(500); setSort(s ?? { eventDate: "desc" });
  }, [updateAdaptiveLimit]);

  const handleFilterChange = useCallback((field: string, value: unknown, operator = "contains") => {
    setFilter((prev) => {
      const next = { ...(prev ?? {}) };
      if (value == null || value === "") delete next[field];
      else next[field] = { value, operator };
      return Object.keys(next).length > 0 ? next : undefined;
    });
  }, []);

  const handleSearch = useCallback((v: string) => setSearch(v.trim()), []);
  const clearFilters = useCallback(() => { setSearch(""); setFilter(undefined); }, []);

  const handleCleanRefresh = useCallback(() => {
    cachedRowsRef.current = []; setCacheVersion(0);
    setSearch(""); setFilter(undefined); setSort({ eventDate: "desc" }); updateAdaptiveLimit(500);
    refetch();
  }, [refetch, updateAdaptiveLimit]);

  // ── Inline-редактирование ──────────────────────────────────────────────

  const handleInlineChange = useCallback(async (row: TDataItem, field: string, value: string) => {
    if (!row.uuid) return;
    try {
      await apiClient.put(`/${MODEL_ENDPOINT}/${row.uuid}`, { [field]: value });
      refetch();
    } catch (err: any) {
      alert(err.response?.data?.message || "Ошибка сохранения");
    }
  }, [refetch]);

  const handleLookupSelect = useCallback(async (row: TDataItem, field: string, uuid: string) => {
    if (!row.uuid) return;
    try {
      await apiClient.put(`/${MODEL_ENDPOINT}/${row.uuid}`, { [field]: uuid });
      refetch();
    } catch (err: any) {
      alert(err.response?.data?.message || "Ошибка сохранения");
    }
  }, [refetch]);

  const handleLookupClear = useCallback(async (row: TDataItem, field: string) => {
    if (!row.uuid) return;
    try {
      await apiClient.put(`/${MODEL_ENDPOINT}/${row.uuid}`, { [field]: null });
      refetch();
    } catch (err: any) {
      alert(err.response?.data?.message || "Ошибка сохранения");
    }
  }, [refetch]);

  const handleInlineAdd = useCallback(async () => {
    if (!employeeUuid) return;
    try {
      await apiClient.post(`/${MODEL_ENDPOINT}`, {
        employeeUuid,
        eventDate: new Date().toISOString().slice(0, 10),
        eventType: "hire",
        salary: null,
        positionUuid: null,
        organizationUuid: null,
      });
      refetch();
    } catch (err: any) {
      alert(err.response?.data?.message || "Ошибка создания записи");
    }
  }, [employeeUuid, refetch]);

  const eventTypeMap = useMemo(() => Object.fromEntries(EVENT_TYPE_OPTIONS.map(o => [o.value, o.label])), []);

  const renderCell = useCallback((row: TDataItem, col: TColumn): React.ReactNode | undefined => {
    if (col.identifier === "eventDate") {
      if (inlineEditing) {
        const val = typeof row.eventDate === "string" ? row.eventDate.slice(0, 10) : "";
        return (
          <input
            type="date"
            value={val}
            onChange={e => handleInlineChange(row, "eventDate", e.target.value)}
            disabled={disabled}
            style={{ border: "none", background: "transparent", padding: "2px 4px", width: "100%", fontSize: 13 }}
          />
        );
      }
      const val = typeof row.eventDate === "string" ? row.eventDate.slice(0, 10) : "";
      return <span>{val}</span>;
    }
    if (col.identifier === "eventType") {
      if (inlineEditing) {
        return (
          <FieldSelect
            name={`hist_event_${row.id}`}
            options={EVENT_TYPE_OPTIONS}
            value={(row.eventType as string) ?? ""}
            onChange={e => handleInlineChange(row, "eventType", e.target.value)}
            disabled={disabled}
            variant="table"
          />
        );
      }
      return <span>{eventTypeMap[row.eventType as string] ?? row.eventType}</span>;
    }
    if (col.identifier === "organization.shortName") {
      if (inlineEditing) {
        return (
          <LookupField
            label=""
            name={`hist_org_${row.id}`}
            value={(row.organizationUuid as string) ?? ""}
            displayValue={(row.organization as any)?.shortName ?? ""}
            endpoint="organizations"
            displayField="shortName"
            onSelect={(uuid) => handleLookupSelect(row, "organizationUuid", uuid)}
            onClear={() => handleLookupClear(row, "organizationUuid")}
            disabled={disabled}
            width="100%"
            variant="table"
          />
        );
      }
      return undefined; // стандартный рендер
    }
    if (col.identifier === "position.shortName") {
      if (inlineEditing) {
        return (
          <LookupField
            label=""
            name={`hist_pos_${row.id}`}
            value={(row.positionUuid as string) ?? ""}
            displayValue={(row.position as any)?.shortName ?? ""}
            endpoint="positions"
            displayField="shortName"
            onSelect={(uuid) => handleLookupSelect(row, "positionUuid", uuid)}
            onClear={() => handleLookupClear(row, "positionUuid")}
            disabled={disabled}
            width="100%"
            variant="table"
          />
        );
      }
      return undefined; // стандартный рендер
    }
    if (col.identifier === "salary") {
      if (inlineEditing) {
        return (
          <FieldNumber
            name={`hist_salary_${row.id}`}
            value={row.salary != null ? String(Number(row.salary)) : ""}
            onChange={e => handleInlineChange(row, "salary", e.target.value)}
            disabled={disabled}
            step="0.01"
            textAlign="right"
            width="100%"
            actions={[]}
            variant="table"
          />
        );
      }
      return undefined; // стандартный рендер
    }
    return undefined;
  }, [handleInlineChange, handleLookupSelect, handleLookupClear, disabled, inlineEditing, eventTypeMap]);

  const toggleInlineEditing = useCallback(() => setInlineEditing(prev => !prev), []);

  const openModelForm = useCallback((formProps: TOpenModelFormProps) => {
    const d = formProps.data;
    const isEdit = !!d?.uuid;
    addPane({
      label: isEdit
        ? `${t("EmployeeHistoriesList")}: ${eventTypeMap[(d as any)?.eventType] || t("noName")} • ${d?.id ?? "?"}`
        : `${t("EmployeeHistoriesList")}: ${t("new")}`,
      component: EmployeeHistoryForm,
      data: { ...(d ?? {}), employeeUuid } as any,
      onSave: () => refetch(),
      onClose: () => refetch(),
    });
  }, [addPane, t, refetch, employeeUuid, eventTypeMap]);

  const extraButtons = useMemo(() => (
    <>
      <Divider />
      <ButtonImage onClick={toggleInlineEditing} active={inlineEditing} title={inlineEditing ? "Редактирование через форму" : "Редактирование в таблице"}>
        <img src={editInlineIcon} alt="Inline edit" height={16} width={16} />
      </ButtonImage>
    </>
  ), [toggleInlineEditing, inlineEditing]);

  const tableProps = useMemo(() => ({
    variant: "embedded" as TTableVariant,
    enableDateRange: false,
    componentName: COMPONENT_NAME,
    rows,
    columns,
    total,
    totalPages: Math.ceil(total / adaptiveLimit),
    isLoading: isAnythingLoading,
    isFetching: isAnythingLoading,
    error,
    hasNextPage,
    isFetchingNextPage,
    pagination: { page: 1, limit: adaptiveLimit, onPageChange: () => { }, onLimitChange: () => { } },
    sorting: { sort, onSortChange: handleSortChange },
    filtering: { filters: filter, onFilterChange: handleFilterChange, onClearAll: clearFilters },
    search: { value: search, onChange: handleSearch },
    actions: { openModelForm, refetch: handleCleanRefresh, setColumns, fetchNextPage, setAdaptiveLimit: updateAdaptiveLimit },
    onDelete: handleDelete,
    extraButtons,
    inlineEditing,
    renderCell,
    onInlineAdd: inlineEditing ? handleInlineAdd : undefined,
  }), [rows, columns, total, adaptiveLimit, isAnythingLoading, error,
    sort, search, filter, handleSortChange, handleFilterChange, handleSearch, clearFilters,
    openModelForm, setColumns, hasNextPage, isFetchingNextPage, fetchNextPage, updateAdaptiveLimit, handleCleanRefresh, handleDelete,
    extraButtons, inlineEditing, renderCell, handleInlineAdd]);

  if (!employeeUuid) {
    return (
      <div style={{ padding: "24px", color: "#999", textAlign: "center" }}>
        Сохраните сотрудника для управления кадровой историей.
      </div>
    );
  }

  if (error) {
    return (
      <div className="error-container"><div className="error-message">
        <h3>Ошибка загрузки</h3>
        <p>{(error as Error)?.message || "Неизвестная ошибка"}</p>
        <button onClick={() => refetch()} className="retry-button">Повторить</button>
      </div></div>
    );
  }

  return <Table {...tableProps} />;
};

EmployeeHistoryTable.displayName = "EmployeeHistoryTable";
export default EmployeeHistoryTable;

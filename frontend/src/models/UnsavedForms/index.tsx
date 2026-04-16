import { FC, useMemo, useCallback, useState, useRef, useEffect } from "react";
import { useAppContext } from "src/app";
import { getModelColumns } from "src/components/Table/services";
import { translate } from "src/i18";
import type { TColumn, TDataItem } from "src/components/Table/types";
import Table from "src/components/Table";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { Button } from "src/components/Button";
import Toolbar from "src/components/Toolbar";
import {
  getAllFormStoreEntries,
  removeFormStoreEntry,
  type FormStoreEntry,
} from "src/hooks/useFormSessionStore";

// Единый реестр моделей (заменяет 26 статических импортов + FORM_REGISTRY)
import { getByStorageKey } from "src/registry/modelRegistry";

// ═══════════════════════════════════════════════════════════════════════════
// Хелперы
// ═══════════════════════════════════════════════════════════════════════════

/** Маппинг tableKey → человекочитаемые имена (новый формат useFormStore) */
const TABLE_LABELS: Record<string, string> = {
  contacts: "Контакты",
  bankAccounts: "Банковские счета",
  contracts: "Договора",
  saleItems: "Позиции реализации",
  history: "Кадровая история",
  purchaseItems: "Позиции поступления",
  outgoingItems: "Позиции СФ исходящей",
  incomingItems: "Позиции СФ входящей",
  paymentItems: "Позиции счёта на оплату",
};

/** Извлечь сводку по pending-строкам SubTable из данных формы (новый формат) */
function getPendingSummary(data: Record<string, unknown>): string {
  // Новый формат: { fields: {...}, tables: { contacts: { pending: [...] }, ... } }
  const tables = data.tables as Record<string, { pending?: unknown[] }> | undefined;
  if (!tables || typeof tables !== "object") return "";

  const parts: string[] = [];
  for (const [tableKey, tableState] of Object.entries(tables)) {
    const pending = tableState?.pending;
    if (!Array.isArray(pending) || pending.length === 0) continue;
    const label = TABLE_LABELS[tableKey] ?? tableKey;
    const created = pending.filter((r: any) => r._pendingAction === "create").length;
    const updated = pending.filter((r: any) => r._pendingAction === "update").length;
    const deleted = pending.filter((r: any) => r._pendingAction === "delete").length;
    const actionParts: string[] = [];
    if (created > 0) actionParts.push(`+${created}`);
    if (updated > 0) actionParts.push(`~${updated}`);
    if (deleted > 0) actionParts.push(`−${deleted}`);
    parts.push(`${label}: ${actionParts.length > 0 ? actionParts.join(" ") : pending.length + " шт."}`);
  }
  return parts.join("; ");
}

/** Попытка получить краткое описание из данных формы */
function getDescription(data: Record<string, unknown>): string {
  // Новый формат: { fields: {...}, tables: {...} }
  const fields = (data.fields && typeof data.fields === "object" ? data.fields : data) as Record<string, unknown>;

  // Пробуем стандартные поля
  const candidates = [
    "shortName", "displayName", "username", "fullName", "bin",
    "modelName", "documentNumber", "name", "title",
  ];
  const parts: string[] = [];
  for (const field of candidates) {
    const val = fields[field];
    if (typeof val === "string" && val.trim()) {
      parts.push(val.trim());
      if (parts.length >= 2) break;
    }
  }
  if (parts.length > 0) return parts.join(" · ");
  // Fallback — количество заполненных полей
  const filled = Object.entries(fields).filter(
    ([k, v]) => v !== "" && v !== null && v !== undefined && k !== "id" && k !== "uuid"
  ).length;
  return filled > 0 ? `${filled} полей заполнено` : "Пустая форма";
}

// ═══════════════════════════════════════════════════════════════════════════
// Строка таблицы (виртуальная TDataItem)
// ═══════════════════════════════════════════════════════════════════════════

interface UnsavedRow extends TDataItem {
  id: number;
  uuid: string;
  storageKey: string;
  formName: string;
  formLabel: string;
  entityId: string;
  description: string;
  pendingSummary: string;
  _entry: FormStoreEntry;
}

function isUuid(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

function entriesToRows(entries: FormStoreEntry[]): UnsavedRow[] {
  return entries.map((entry, idx) => {
    const regEntry = getByStorageKey(entry.formName);
    return {
      id: idx + 1,
      uuid: entry.storageKey, // используем storageKey как uuid
      storageKey: entry.storageKey,
      formName: entry.formName,
      formLabel: regEntry?.label ?? entry.formName,
      entityId: isUuid(entry.entityId) ? entry.entityId : "Новый",
      description: getDescription(entry.data),
      pendingSummary: getPendingSummary(entry.data),
      _entry: entry,
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// LIST
// ═══════════════════════════════════════════════════════════════════════════

const componentName = "UnsavedFormsList";

const UnsavedFormsList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void }> = ({
  variant = "default",
  onSelectItem,
}) => {
  const appCtx = useAppContext();
  const { addPane } = appCtx.windows;
  const { confirm } = appCtx.actions;
  const t = (key: string) => translate(key) || key;

  const [columns, setColumns] = useState<TColumn[]>(() => getModelColumns(columnsJson, componentName));
  const [version, setVersion] = useState(0);

  const rowsRef = useRef<UnsavedRow[]>([]);

  // Загрузка записей из sessionStorage
  const loadEntries = useCallback(() => {
    const entries = getAllFormStoreEntries();
    rowsRef.current = entriesToRows(entries);
    setVersion(v => v + 1);
  }, []);

  useEffect(() => { loadEntries(); }, [loadEntries]);

  const rows = useMemo(() => rowsRef.current, [version]);
  const total = rows.length;

  // Открыть форму с данными из sessionStorage
  const openUnsavedForm = useCallback((row: UnsavedRow) => {
    const regEntry = getByStorageKey(row.formName);
    if (!regEntry) {
      alert(`Неизвестный тип формы: ${row.formName}`);
      return;
    }

    const { label } = regEntry;
    const entryData = row._entry.data;

    // Новый формат: { fields: {...}, tables: {...} }
    const fields = (entryData.fields && typeof entryData.fields === "object"
      ? entryData.fields
      : entryData) as Record<string, unknown>;

    // Передаём uuid если это существующая запись (не "new")
    const originalEntityId = row._entry.entityId;
    const isNew = !isUuid(originalEntityId);
    const paneData = isNew
      ? { ...fields, _formStorageKey: row.storageKey } as unknown as TDataItem
      : { ...fields, uuid: originalEntityId, _formStorageKey: row.storageKey } as unknown as TDataItem;

    // Ленивая загрузка Form-компонента
    regEntry.module().then((mod) => {
      const FormComponent = mod[regEntry.formName] || mod.default;
      if (!FormComponent) {
        alert(`Компонент ${regEntry.formName} не найден в модуле`);
        return;
      }
      addPane({
        label: `${label}: ${row.description || (isNew ? t("new") : originalEntityId)}`,
        component: FormComponent,
        data: paneData,
        onSave: () => loadEntries(),
        onClose: () => loadEntries(),
      });
    }).catch((err) => {
      alert(`Ошибка загрузки формы: ${err?.message || "неизвестная ошибка"}`);
    });
  }, [addPane, t, loadEntries]);

  // Удалить запись из sessionStorage
  const handleDeleteEntries = useCallback((selectedRows: Set<number>, allRows: TDataItem[]) => {
    const rowsToDelete = allRows.filter((_, idx) => selectedRows.has(idx)) as UnsavedRow[];
    if (rowsToDelete.length === 0) return;
    rowsToDelete.forEach(row => {
      if (row.storageKey) removeFormStoreEntry(row.storageKey);
    });
    loadEntries();
  }, [loadEntries]);

  // Очистить всё
  const handleClearAll = useCallback(async () => {
    if (!(await confirm("Удалить все несохранённые данные форм?"))) return;
    const entries = getAllFormStoreEntries();
    entries.forEach(e => removeFormStoreEntry(e.storageKey));
    loadEntries();
  }, [loadEntries, confirm]);

  // Рендер ячейки "Тип объекта" — как кликабельную ссылку
  const renderCell = useCallback((row: TDataItem, col: TColumn): React.ReactNode | undefined => {
    const unsavedRow = row as UnsavedRow;
    if (col.identifier === "formLabel") {
      return (
        <span
          style={{ color: "var(--color-link, #1976d2)", cursor: "pointer", textDecoration: "underline" }}
          onClick={(e) => { e.stopPropagation(); openUnsavedForm(unsavedRow); }}
          title="Открыть форму с несохранёнными данными"
        >
          {unsavedRow.formLabel}
        </span>
      );
    }
    if (col.identifier === "description") {
      return (
        <span
          style={{ color: "var(--color-link, #1976d2)", cursor: "pointer", textDecoration: "underline" }}
          onClick={(e) => { e.stopPropagation(); openUnsavedForm(unsavedRow); }}
          title="Открыть форму с несохранёнными данными"
        >
          {unsavedRow.description}
        </span>
      );
    }
    if (col.identifier === "pendingSummary") {
      if (!unsavedRow.pendingSummary) return <span style={{ color: "#bbb" }}>—</span>;
      return (
        <span style={{ fontSize: "12px", color: "#e65100" }} title={unsavedRow.pendingSummary}>
          {unsavedRow.pendingSummary}
        </span>
      );
    }
    return undefined;
  }, [openUnsavedForm]);

  const tableProps = useMemo(() => ({
    variant,
    onSelectItem,
    enableDateRange: false,
    componentName,
    rows,
    columns,
    total,
    totalPages: 1,
    isLoading: false,
    isFetching: false,
    error: null as Error | null,
    hasNextPage: false,
    isFetchingNextPage: false,
    pagination: { page: 1, limit: 500, onPageChange: () => {}, onLimitChange: () => {} },
    sorting: { sort: { id: "asc" as const }, onSortChange: () => {} },
    filtering: { filters: undefined, onFilterChange: () => {}, onClearAll: () => {} },
    search: { value: "", onChange: () => {} },
    actions: {
      openModelForm: ({ data }: { data?: TDataItem }) => {
        if (data) openUnsavedForm(data as UnsavedRow);
      },
      refetch: loadEntries,
      setColumns,
      fetchNextPage: () => {},
      setAdaptiveLimit: () => {},
    },
    onDelete: handleDeleteEntries,
    renderCell,
  }), [variant, onSelectItem, rows, columns, total, openUnsavedForm, loadEntries, renderCell, handleDeleteEntries]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Доп. панель */}
      <Toolbar>
        <Toolbar.ReloadButton onClick={loadEntries} />
        <Toolbar.Divider />
        {total > 0 && (
          <Button variant="danger" onClick={handleClearAll}>
            <span>Очистить всё ({total})</span>
          </Button>
        )}
      </Toolbar>

      {total === 0 ? (
        <div style={{ padding: "48px 24px", textAlign: "center", color: "#999", fontSize: "14px" }}>
          <div style={{ fontSize: "32px", marginBottom: "12px" }}>✓</div>
          <div>Нет несохранённых данных форм</div>
          <div style={{ marginTop: "8px", fontSize: "12px", color: "#bbb" }}>
            Здесь появятся формы, данные которых не были сохранены (например, после обновления страницы)
          </div>
        </div>
      ) : (
        <Table {...tableProps} />
      )}
    </div>
  );
};

UnsavedFormsList.displayName = "UnsavedFormsList";
export { UnsavedFormsList };

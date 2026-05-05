import { FC, useCallback, useEffect, useRef, useState, useMemo } from "react";
import { getModelColumns } from "src/components/Table/services";
import type { TColumn, TDataItem } from "src/components/Table/types";
import Table from "src/components/Table";
import columnsJson from "./columns.json";
import apiClient from "src/services/api/client";
import { showToast } from "src/components/UIToast";

const MODEL_ENDPOINT = "files";
const COMPONENT_NAME = "FilesList_part";

// ═══════════════════════════════════════════════════════════════════════════
// FILES PANEL  (встраиваемая таблица файлов — единый компонент для всех форм)
// ═══════════════════════════════════════════════════════════════════════════

/** Форматирование размера файла: КБ если < 1 МБ, иначе МБ */
function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return (bytes / 1024).toFixed(1) + " КБ";
  }
  return (bytes / (1024 * 1024)).toFixed(2) + " МБ";
}

interface FilesPanelProps {
  ownerType: string;
  ownerUuid: string;
  /** Вызывается после загрузки/удаления файлов (для обновления смежных компонентов) */
  onFilesChange?: () => void;
}

const FilesPanel: FC<FilesPanelProps> = ({ ownerType, ownerUuid, onFilesChange }) => {
  const [rows, setRows] = useState<TDataItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const [sortState, setSortState] = useState<Record<string, "asc" | "desc">>({ uploadedAt: "desc" });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [columns, setColumns] = useState<TColumn[]>(() =>
    getModelColumns(columnsJson, COMPONENT_NAME, "part"),
  );

  // ── Загрузка списка файлов ──────────────────────────────────────────────
  const loadFiles = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await apiClient.get(
        `/${MODEL_ENDPOINT}?ownerType=${encodeURIComponent(ownerType)}&ownerUuid=${encodeURIComponent(ownerUuid)}`,
      );
      setRows(res.data?.items ?? []);
    } catch (_e) {
      showToast("Ошибка загрузки списка файлов", "error");
    } finally {
      setIsLoading(false);
    }
  }, [ownerType, ownerUuid]);

  useEffect(() => {
    if (ownerType && ownerUuid) void loadFiles();
  }, [loadFiles, ownerType, ownerUuid]);

  // ── Конвертация fileSize + клиентская фильтрация по поиску ────────────
  const displayRows = useMemo(() => {
    const mapped = rows.map(row => ({
      ...row,
      fileSize: row.fileSize != null
        ? formatFileSize(Number(row.fileSize))
        : "",
    } as TDataItem));

    // Клиентская фильтрация
    let filtered = mapped;
    if (searchValue.trim()) {
      const words = searchValue.toLowerCase().split(/\s+/).filter(Boolean);
      filtered = mapped.filter(row =>
        words.every(w =>
          ((row.fileName as string | undefined) ?? "").toLowerCase().includes(w),
        ),
      );
    }

    // Клиентская сортировка
    const sortKeys = Object.entries(sortState);
    if (sortKeys.length > 0) {
      const [field, dir] = sortKeys[0];
      filtered = [...filtered].sort((a, b) => {
        const va = a[field] ?? "";
        const vb = b[field] ?? "";
        const cmp = String(va as string | number | null | undefined).localeCompare(String(vb as string | number | null | undefined), undefined, { numeric: true });
        return dir === "desc" ? -cmp : cmp;
      });
    }

    return filtered;
  }, [rows, searchValue, sortState]);

  // ── Загрузка файла ──────────────────────────────────────────────────────
  const handleUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setIsUploading(true);
      try {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("ownerType", ownerType);
        fd.append("ownerUuid", ownerUuid);
        await apiClient.post(`/${MODEL_ENDPOINT}`, fd);
        await loadFiles();
        onFilesChange?.();
      } catch (_err) {
        showToast("Ошибка загрузки файла", "error");
      } finally {
        setIsUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [ownerType, ownerUuid, loadFiles, onFilesChange],
  );

  // ── Скачивание ──────────────────────────────────────────────────────────
  const handleDownload = useCallback(async (fileUuid: string, fileName: string) => {
    try {
      const res = await apiClient.get(`/${MODEL_ENDPOINT}/download/${fileUuid}`, {
        responseType: "blob",
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (_err) {
      showToast("Ошибка скачивания файла", "error");
    }
  }, []);

  // ── Удаление ────────────────────────────────────────────────────────────
  const handleDelete = useCallback(
    async (fileUuid: string) => {
      try {
        await apiClient.delete(`/${MODEL_ENDPOINT}/${fileUuid}`);
      } catch (_err) {
        showToast("Ошибка удаления файла", "error");
      }
    },
    [],
  );

  // ── Удаление выбранных строк из Table ──────────────────────────────────
  const handleTableDelete = useCallback(
    async (selectedRowIds: Set<number>, tableRows: TDataItem[]) => {
      const uuids: string[] = [];
      for (const row of tableRows) {
        if (selectedRowIds.has(Number(row.id))) {
          uuids.push(String(row.uuid));
        }
      }
      if (uuids.length === 0) return;
      for (const uuid of uuids) {
        await handleDelete(uuid);
      }
      await loadFiles();
      onFilesChange?.();
    },
    [handleDelete, loadFiles, onFilesChange],
  );

  // ── Кнопка загрузки файла для панели таблицы ─────────────────────────
  const extraButtons = useMemo(
    () => (
      <input
        ref={fileInputRef}
        type="file"
        style={{ display: "none" }}
        onChange={handleUpload}
      />
    ),
    [handleUpload],
  );

  // ── Кастомный обработчик "Добавить" — открывает диалог выбора файла ──
  const customOpenModelForm = useCallback(
    ({ data }: { data?: TDataItem }) => {
      if (data?.uuid && data?.fileName) {
        // Клик по строке — скачивание
        void handleDownload(data.uuid, data.fileName as string);
      } else {
        // "Добавить" — открыть диалог выбора файла
        fileInputRef.current?.click();
      }
    },
    [handleDownload],
  );

  // ── Table props ─────────────────────────────────────────────────────────
  const tableProps = useMemo(
    () => ({
      variant: "default" as const,
      enableDateRange: false,
      componentName: COMPONENT_NAME,
      rows: displayRows,
      columns,
      total: displayRows.length,
      isLoading: isLoading || isUploading,
      isFetching: isLoading,
      error: undefined,
      pagination: {
        page: 1,
        limit: displayRows.length || 50,
        onPageChange: () => { },
        onLimitChange: () => { },
      },
      sorting: {
        sort: sortState,
        onSortChange: setSortState,
      },
      filtering: {
        filters: undefined,
        onFilterChange: () => { },
        onClearAll: () => { },
      },
      search: { value: searchValue, onChange: setSearchValue },
      actions: {
        openModelForm: customOpenModelForm,
        refetch: loadFiles,
        setColumns,
        fetchNextPage: () => { },
        setAdaptiveLimit: () => { },
      },
      extraButtons,
      onDelete: handleTableDelete,
    }),
    [displayRows, columns, isLoading, isUploading, loadFiles, customOpenModelForm, extraButtons, handleTableDelete, searchValue, sortState],
  );

  return <Table {...(tableProps as any)} />
};

FilesPanel.displayName = "FilesPanel";
export { FilesPanel };
export default FilesPanel;

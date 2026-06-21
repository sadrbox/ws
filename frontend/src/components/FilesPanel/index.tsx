import { FC, useCallback, useEffect, useRef, useState, useMemo } from "react";
import { getModelColumns } from "src/components/Table/services";
import type { TColumn, TDataItem } from "src/components/Table/types";
import Table from "src/components/Table";
import columnsJson from "./columns.json";
import apiClient from "src/services/api/client";
import { showToast } from "src/components/UIToast";
import { useAppContext } from "src/app";
import { FileViewerPane } from "src/models/Files/FileViewerPane";
import UploadProgress, { formatFileSize } from "./UploadProgress";

const MODEL_ENDPOINT = "files";
const COMPONENT_NAME = "FilesList_part";

// Человекочитаемый тип владельца файла (для колонки «Владелец» в общем списке).
const OWNER_TYPE_LABELS: Record<string, string> = {
  contract: "Договор",
  todo: "Задача",
  counterparty: "Контрагент",
  organization: "Организация",
  employee: "Сотрудник",
  global: "Общие",
};

// ═══════════════════════════════════════════════════════════════════════════
// FILES PANEL  (встраиваемая таблица файлов — единый компонент для всех форм)
// ═══════════════════════════════════════════════════════════════════════════

interface FilesPanelProps {
  ownerType?: string;
  ownerUuid?: string;
  /** Общий список ВСЕХ файлов (пункт меню «Файлы»): грузит /files/all, аплоад — в
   *  «global»-владельца. Без флага — обычная панель файлов сущности (как раньше). */
  allFiles?: boolean;
  /** Открыть файл (клик по строке). Если не задан — клик скачивает файл (как раньше). */
  onOpenFile?: (file: TDataItem) => void;
  /** Вызывается после загрузки/удаления файлов (для обновления смежных компонентов) */
  onFilesChange?: () => void;
}

const FilesPanel: FC<FilesPanelProps> = ({ ownerType, ownerUuid, allFiles = false, onOpenFile, onFilesChange }) => {
  const [rows, setRows] = useState<TDataItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  // Прогресс загрузки выбранного файла: имя, размер, процент (инлайн-баннер).
  const [uploadInfo, setUploadInfo] = useState<{ name: string; size: number; percent: number } | null>(null);
  const [searchValue, setSearchValue] = useState("");
  const [sortState, setSortState] = useState<Record<string, "asc" | "desc">>({ uploadedAt: "desc" });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { windows: { addPane }, actions } = useAppContext();

  // Открыть файл в просмотрщике (DocViewport) отдельной панелью.
  const openInViewer = useCallback((file: TDataItem) => {
    // Владелец файла — для списка-переключателя в шапке просмотрщика. В общем
    // списке владелец у каждой строки свой; в панели сущности — из пропсов.
    const ownerT = allFiles ? (file.ownerType as string | undefined) : ownerType;
    const ownerU = allFiles ? (file.ownerUuid as string | undefined) : ownerUuid;
    addPane({
      component: FileViewerPane,
      label: (file.fileName as string) || "Файл",
      data: {
        // uuid на верхнем уровне — чтобы getUniqId дал ОТДЕЛЬНУЮ панель на файл
        // (иначе компонент станет синглтоном и переоткрытие не сменит файл).
        uuid: file.uuid,
        ownerType: ownerT,
        ownerUuid: ownerU,
        file: { uuid: file.uuid, fileName: file.fileName, mimeType: file.mimeType },
      } as Partial<TDataItem>,
      // Рецепт ссылки/восстановления на файл.
      restore: { kind: "file", uuid: String(file.uuid), fileName: file.fileName as string, mimeType: file.mimeType as string | null },
    });
  }, [addPane, allFiles, ownerType, ownerUuid]);

  // Владелец для аплоада: в общем списке файлы складываются в «global».
  const upOwnerType = allFiles ? "global" : (ownerType ?? "");
  const upOwnerUuid = allFiles ? "global" : (ownerUuid ?? "");

  const [columns, setColumns] = useState<TColumn[]>(() => {
    const base = getModelColumns(columnsJson, COMPONENT_NAME, "part");
    // В общем списке показываем колонку «Владелец» (тип сущности, к которой
    // прикреплён файл). Идентификатор "owner" переводится как «Владелец» (i18n),
    // значение — человекочитаемая метка (см. displayRows). Сырой ownerType
    // остаётся в строке для открытия просмотрщика.
    if (allFiles && !base.some((c) => c.identifier === "owner")) {
      base.splice(base.length - 1, 0, {
        identifier: "owner", type: "string", width: "160px", minWidth: "120px",
        alignment: "left", hint: "Владелец", visible: true, inlist: true,
      } as TColumn);
    }
    return base;
  });

  // ── Загрузка списка файлов ──────────────────────────────────────────────
  const loadFiles = useCallback(async () => {
    setIsLoading(true);
    try {
      const url = allFiles
        ? `/${MODEL_ENDPOINT}/all`
        : `/${MODEL_ENDPOINT}?ownerType=${encodeURIComponent(ownerType ?? "")}&ownerUuid=${encodeURIComponent(ownerUuid ?? "")}`;
      const res = await apiClient.get(url);
      setRows(res.data?.items ?? []);
    } catch (_e) {
      showToast("Ошибка загрузки списка файлов", "error");
    } finally {
      setIsLoading(false);
    }
  }, [allFiles, ownerType, ownerUuid]);

  useEffect(() => {
    if (allFiles || (ownerType && ownerUuid)) void loadFiles();
  }, [loadFiles, allFiles, ownerType, ownerUuid]);

  // ── Конвертация fileSize + клиентская фильтрация по поиску ────────────
  const displayRows = useMemo(() => {
    const mapped = rows.map(row => ({
      ...row,
      fileSize: row.fileSize != null
        ? formatFileSize(Number(row.fileSize))
        : "",
      // Метка владельца для колонки (сырой ownerType сохраняется для просмотрщика).
      owner: OWNER_TYPE_LABELS[String(row.ownerType ?? "")] ?? (row.ownerType ?? ""),
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
      setUploadInfo({ name: file.name, size: file.size, percent: 0 });
      try {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("ownerType", upOwnerType);
        fd.append("ownerUuid", upOwnerUuid);
        await apiClient.post(`/${MODEL_ENDPOINT}`, fd, {
          onUploadProgress: (ev) => {
            const total = ev.total ?? file.size;
            const percent = total ? Math.min(100, Math.round((ev.loaded / total) * 100)) : 0;
            setUploadInfo((prev) => (prev ? { ...prev, percent } : prev));
          },
        });
        await loadFiles();
        onFilesChange?.();
        showToast(`Файл «${file.name}» загружен`, "success");
      } catch (_err) {
        showToast("Ошибка загрузки файла", "error");
      } finally {
        setIsUploading(false);
        setUploadInfo(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [upOwnerType, upOwnerUuid, loadFiles, onFilesChange],
  );

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
      // Ясное подтверждение перед безвозвратным удалением файлов.
      const names = tableRows
        .filter((r) => selectedRowIds.has(Number(r.id)))
        .map((r) => String(r.fileName ?? ""))
        .filter(Boolean);
      const msg = uuids.length === 1
        ? `Удалить файл «${names[0] ?? ""}»? \nДействие необратимо.`
        : `Удалить выбранные файлы (${uuids.length} шт.)? Действие необратимо.`;
      if (!(await actions.confirm(msg))) return;
      for (const uuid of uuids) {
        await handleDelete(uuid);
      }
      await loadFiles();
      onFilesChange?.();
    },
    [handleDelete, loadFiles, onFilesChange, actions],
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
        // Клик по строке: открыть просмотр файла (переопределяется onOpenFile).
        if (onOpenFile) onOpenFile(data);
        else openInViewer(data);
      } else {
        // "Добавить" — открыть диалог выбора файла
        fileInputRef.current?.click();
      }
    },
    [onOpenFile, openInViewer],
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

  return (
    <>
      {uploadInfo && (
        <UploadProgress name={uploadInfo.name} size={uploadInfo.size} percent={uploadInfo.percent} />
      )}
      <Table {...(tableProps as any)} />
    </>
  );
};

FilesPanel.displayName = "FilesPanel";
export { FilesPanel };
export default FilesPanel;

import { FC, useCallback, useEffect, useMemo, useState } from "react";
import apiClient from "src/services/api/client";
import { FieldSelect } from "src/components/Field";
import IconButton from "src/components/IconButton/IconButton";
import { usePaneHeaderActions } from "src/hooks/usePaneToolbar";
import { showToast } from "src/components/UIToast";
import { FileViewPane, type FileMeta } from "./FileViewPane";

// ═══════════════════════════════════════════════════════════════════════════
// FileViewerPane — ОТДЕЛЬНАЯ панель «Просмотр файла».
//   • в шапке (PaneItemHeaderToolbar): выпадающий список файлов владельца + «Скачать»;
//   • в теле: универсальный рендерер FileViewPane (pdf/img/xlsx/docx/…).
// Открывается из списка/панели файлов (клик по файлу) и по ссылке (restore).
// paneProps.data: { ownerType?, ownerUuid?, file?: { uuid, fileName, mimeType } }.
// ═══════════════════════════════════════════════════════════════════════════

interface FileRow { uuid: string; fileName: string; mimeType?: string | null }
interface FileViewerData { ownerType?: string; ownerUuid?: string; file?: FileMeta }

const FileViewerPane: FC<Record<string, unknown>> = (props) => {
  const data = (props.data ?? props) as FileViewerData;
  const paneId = props.uniqId as string | undefined;
  const initialUuid = data.file?.uuid ?? "";

  const [files, setFiles] = useState<FileRow[]>(
    () => (data.file?.uuid ? [{ uuid: data.file.uuid, fileName: data.file.fileName ?? "Файл", mimeType: data.file.mimeType }] : []),
  );
  const [selected, setSelected] = useState<string>(initialUuid);

  // Список файлов владельца — для переключения в шапке (если владелец известен).
  useEffect(() => {
    const { ownerType, ownerUuid } = data;
    if (!ownerType || !ownerUuid) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiClient.get(
          `/files?ownerType=${encodeURIComponent(ownerType)}&ownerUuid=${encodeURIComponent(ownerUuid)}`,
        );
        if (cancelled) return;
        const items: FileRow[] = res.data?.items ?? [];
        if (items.length) {
          setFiles(items);
          setSelected((cur) => (cur && items.some((f) => f.uuid === cur) ? cur : items[0].uuid));
        }
      } catch { /* список не критичен — остаётся одиночный файл */ }
    })();
    return () => { cancelled = true; };
  }, [data.ownerType, data.ownerUuid]);

  const selectedFile = useMemo<FileMeta | undefined>(() => {
    const f = files.find((x) => x.uuid === selected);
    return f ? { uuid: f.uuid, fileName: f.fileName, mimeType: f.mimeType } : (data.file ?? undefined);
  }, [files, selected, data.file]);

  const handleDownload = useCallback(async () => {
    if (!selectedFile?.uuid) return;
    try {
      const res = await apiClient.get(`/files/download/${selectedFile.uuid}`, { responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a");
      a.href = url;
      a.download = selectedFile.fileName ?? "file";
      a.click();
      window.URL.revokeObjectURL(url);
    } catch {
      showToast("Ошибка скачивания файла", "error");
    }
  }, [selectedFile]);

  // Шапка панели: список файлов (если их > 1) + кнопка «Скачать».
  const headerActions = usePaneHeaderActions(
    paneId,
    <>
      {files.length > 1 && (
        <FieldSelect
          label=""
          name="file_viewer_file"
          value={selected}
          options={files.map((f) => ({ value: f.uuid, label: f.fileName }))}
          onChange={(e) => setSelected(e.target.value)}
          style={{ width: "280px" }}
        />
      )}
      <IconButton icon="download" title="Скачать" aria-label="Скачать" disabled={!selectedFile?.uuid} onClick={() => void handleDownload()} />
    </>,
  );

  return (
    <>
      {headerActions}
      <FileViewPane file={selectedFile} />
    </>
  );
};
FileViewerPane.displayName = "FileViewerPane";

export { FileViewerPane };
export default FileViewerPane;

/**
 * PrintDocumentPane — единая панель предпросмотра печатной формы документа.
 *
 * Макет (`layout`) рендерится напрямую в DocSheet — без iframe.
 * Печать выполняется через usePrintDocument (скрытый iframe с изолированным CSS),
 * экспорт .doc — через renderToStaticMarkup по требованию.
 */
import { FC, useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as XLSX from "xlsx";
import type { WorkBook } from "xlsx";
import { Toolbar } from "src/components/Toolbar";
import SaveDropdownButton, { type SaveDropdownOption } from "src/components/Toolbar/SaveDropdownButton";
import IconButton from "src/components/IconButton/IconButton";
import { Icon } from "src/components/IconButton/icons";
import { FieldSelect } from "src/components/Field";
import { GroupRow } from "src/components/UI";
import { usePaneHeaderActions } from "src/hooks/usePaneToolbar";
import { usePrintDocument } from "src/components/PrintLayout/usePrintDocument";
import { DocViewport, DocSheet } from "src/components/DocViewport";
import styles from "./PrintPreview.module.scss";
import { translate } from "src/i18";

export type PageOrientation = "portrait" | "landscape";

export interface PrintColumnDef {
  /** Ключ колонки — совпадает с ключом в объекте columns, передаваемом в buildLayout. */
  key: string;
  /** Человекочитаемое название для панели настроек. */
  label: string;
  /** Видимость по умолчанию (true если не задано). */
  defaultVisible?: boolean;
}

export interface PrintDocumentPaneData {
  /** React-узел печатного макета (рендерится напрямую в DocSheet). */
  layout?: ReactNode;
  /**
   * Фабрика макета с управляемыми колонками. Если задана — используется вместо `layout`.
   * Вызывается при каждом изменении настроек колонок.
   */
  buildLayout?: (columns: Record<string, boolean>) => ReactNode;
  /** Описание настраиваемых колонок (отображаются в панели ⚙). */
  columnDefs?: PrintColumnDef[];
  /**
   * Стабильный ключ для хранения настроек колонок в localStorage.
   * Должен быть одинаковым для всех документов одного типа, например "sale_invoice".
   * Если не задан, используется fileBaseName.
   */
  columnsKey?: string;
  /** Базовое имя файла без расширения. */
  fileBaseName: string;
  /** Заголовок для диалога печати. */
  title?: string;
  /** Готовый workbook для xlsx/xls; если не передан — строится из DOM. */
  workbook?: WorkBook;
  /** Начальная ориентация листа (по умолчанию portrait). */
  orientation?: PageOrientation;
}

interface PaneProps {
  data?: PrintDocumentPaneData;
  uniqId?: string;
}

// ─── Утилиты ──────────────────────────────────────────────────────────────

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function extractWorkbookFromDom(el: HTMLElement): WorkBook | null {
  const tables = el.querySelectorAll<HTMLTableElement>("table");
  if (!tables.length) return null;
  const wb = XLSX.utils.book_new();
  tables.forEach((t, i) => {
    const ws = XLSX.utils.table_to_sheet(t);
    XLSX.utils.book_append_sheet(wb, ws, `Sheet${i + 1}`);
  });
  return wb;
}

function buildWordHtml(bodyHtml: string, title: string): string {
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>${escapeXml(title)}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->
<style>@page WordSection1{size:210mm 297mm;margin:12mm 12mm 14mm 16mm}div.WordSection1{page:WordSection1}
body{font-family:'Times New Roman',serif;font-size:10pt;color:#000}
table{border-collapse:collapse;width:100%}td,th{padding:3px 4px;vertical-align:top}
</style></head><body><div class="WordSection1">${bodyHtml}</div></body></html>`;
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, c =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "&" ? "&amp;" : c === "\"" ? "&quot;" : "&apos;");
}

function computePanelStyle(anchor: HTMLElement, panelH: number, panelW: number): CSSProperties {
  const rect = anchor.getBoundingClientRect();
  const s: CSSProperties = { position: "fixed", zIndex: 9999, minWidth: panelW };
  if (window.innerHeight - rect.bottom >= panelH || rect.top < panelH) {
    s.top = rect.bottom + 4;
  } else {
    s.bottom = window.innerHeight - rect.top + 4;
  }
  // выровнять по правому краю кнопки; если не влезает — по левому
  if (rect.right >= panelW) {
    s.right = window.innerWidth - rect.right;
  } else {
    s.left = Math.max(4, rect.left);
  }
  return s;
}

// ─── Компонент ────────────────────────────────────────────────────────────

const PrintDocumentPane: FC<PaneProps> = ({ data, uniqId }) => {
  const layoutRef = useRef<HTMLDivElement>(null);
  const { print: printNode } = usePrintDocument();

  const baseName = data?.fileBaseName || "document";
  const title = data?.title || baseName;
  const columnDefs = data?.columnDefs;
  const hasColumnDefs = !!columnDefs?.length;

  // ── Ориентация ────────────────────────────────────────────────────────
  const lsOrientKey = `print_orientation_${baseName}`;
  const [orientation, setOrientation] = useState<PageOrientation>(() => {
    try {
      const saved = localStorage.getItem(lsOrientKey);
      if (saved === "portrait" || saved === "landscape") return saved;
    } catch { /* ignore */ }
    return data?.orientation ?? "portrait";
  });

  const handleOrientationChange = useCallback((value: PageOrientation) => {
    setOrientation(value);
    try { localStorage.setItem(lsOrientKey, value); } catch { /* ignore */ }
  }, [lsOrientKey]);

  // ── Настройка колонок ─────────────────────────────────────────────────
  const lsColKey = `print_columns_${data?.columnsKey ?? baseName}`;
  const [columns, setColumns] = useState<Record<string, boolean>>(() => {
    if (!columnDefs?.length) return {};
    try {
      const saved = localStorage.getItem(lsColKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === "object") return parsed;
      }
    } catch { /* ignore */ }
    return Object.fromEntries(columnDefs.map(d => [d.key, d.defaultVisible !== false]));
  });

  const setColumn = useCallback((key: string, visible: boolean) => {
    setColumns(prev => {
      const next = { ...prev, [key]: visible };
      try { localStorage.setItem(lsColKey, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, [lsColKey]);

  // ── Панель настроек колонок ───────────────────────────────────────────
  const [colOpen, setColOpen] = useState(false);
  const [colPanelStyle, setColPanelStyle] = useState<CSSProperties>({});
  const colBtnRef = useRef<HTMLButtonElement>(null);
  const colPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!colOpen || !colBtnRef.current) return;
    const el = colBtnRef.current;
    const PANEL_W = 220;
    const PANEL_H = Math.min((columnDefs?.length ?? 0) * 32 + 16, 360);
    const update = () => setColPanelStyle(computePanelStyle(el, PANEL_H, PANEL_W));
    // Только scroll/resize — начальная позиция уже вычислена в toggleColPanel
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [colOpen, columnDefs?.length]);

  useEffect(() => {
    if (!colOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        !colBtnRef.current?.contains(e.target as Node) &&
        !colPanelRef.current?.contains(e.target as Node)
      ) setColOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [colOpen]);

  // ── Активный макет ────────────────────────────────────────────────────
  const activeLayout = data?.buildLayout ? data.buildLayout(columns) : data?.layout;

  // ── Действия ──────────────────────────────────────────────────────────
  const handlePrint = useCallback(() => {
    if (!data) return;
    void printNode(activeLayout, {
      title,
      extraCss: orientation === "landscape"
        ? "@page { size: A4 landscape; } .a4-sheet { width: 297mm; min-height: 210mm; }"
        : "",
    });
  }, [data, printNode, title, orientation, activeLayout]);

  const handleExport = useCallback((format: "xlsx" | "xls") => {
    const wb = data?.workbook ?? (layoutRef.current ? extractWorkbookFromDom(layoutRef.current) : null);
    if (!wb) {
      alert(translate("printDocumentExportError"));
      return;
    }
    const bookType = format === "xls" ? "biff8" : "xlsx";
    const mime = format === "xls"
      ? "application/vnd.ms-excel"
      : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    const ab = XLSX.write(wb, { type: "array", bookType });
    download(new Blob([ab], { type: mime }), `${baseName}.${format}`);
  }, [data, baseName]);

  const exportDoc = useCallback(() => {
    if (!data) return;
    const bodyHtml = renderToStaticMarkup(activeLayout as React.ReactElement);
    const wordHtml = buildWordHtml(bodyHtml, title);
    download(new Blob([wordHtml], { type: "application/msword" }), `${baseName}.doc`);
  }, [data, title, baseName, activeLayout]);

  const onSelectFormat = (id: string) => {
    if (id === "xlsx") handleExport("xlsx");
    else if (id === "xls") handleExport("xls");
    else if (id === "doc") exportDoc();
    else if (id === "pdf") handlePrint();
  };

  const saveOptions: SaveDropdownOption[] = [
    { id: "xlsx", label: translate("excelXlsx"), icon: <Icon name="save" />, disabled: !data },
    { id: "xls",  label: translate("excelXls"),  icon: <Icon name="save" />, disabled: !data },
    { id: "doc",  label: translate("wordDoc"),   icon: <Icon name="save" />, disabled: !data },
    { id: "pdf",  label: translate("pdf"),        icon: <Icon name="print" />,
      hint: translate("printSaveHint"), disabled: !data },
  ];

  const headerActionsPortal = usePaneHeaderActions(
    uniqId,
    data ? (
      <>
        {hasColumnDefs && (
          <>
            <IconButton
              ref={colBtnRef}
              size="md"
              icon="settings"
              title="Настройка колонок печатной формы"
              aria-label="Настройка колонок"
              aria-haspopup="dialog"
              aria-expanded={colOpen}
              onClick={() => {
                if (!colOpen && colBtnRef.current) {
                  const PANEL_W = 220;
                  const PANEL_H = Math.min((columnDefs?.length ?? 0) * 32 + 16, 360);
                  setColPanelStyle(computePanelStyle(colBtnRef.current, PANEL_H, PANEL_W));
                }
                setColOpen(v => !v);
              }}
            />
            {colOpen && (
              <div ref={colPanelRef} className={styles.ColSettingsPanel} style={colPanelStyle}>
                {columnDefs!.map(def => (
                  <label key={def.key} className={styles.ColSettingsItem}>
                    <input
                      type="checkbox"
                      checked={columns[def.key] !== false}
                      onChange={e => setColumn(def.key, e.target.checked)}
                    />
                    {def.label}
                  </label>
                ))}
              </div>
            )}
          </>
        )}
        <SaveDropdownButton
          options={saveOptions}
          onSelect={onSelectFormat}
          title={translate("saveAs")}
          disabled={!data}
        />
        <Toolbar.PrintButton onClick={handlePrint} title={translate("print")} />
      </>
    ) : null,
  );

  if (!data) return <div style={{ padding: 16 }}>{translate("noPrintData")}</div>;

  return (
    <div className={styles.PrintPreview}>
      {headerActionsPortal}
      <div className={styles.PrintParamForm}>
        <GroupRow>
          <FieldSelect
            label={translate("pageOrientation")}
            name="print_orientation"
            value={orientation}
            options={[
              { value: "portrait", label: translate("portrait") },
              { value: "landscape", label: translate("landscape") },
            ]}
            onChange={(e) => handleOrientationChange(e.target.value as PageOrientation)}
            style={{ width: "180px" }}
          />
        </GroupRow>
      </div>
      <DocViewport>
        <DocSheet ref={layoutRef} orientation={orientation}>
          {activeLayout}
        </DocSheet>
      </DocViewport>
    </div>
  );
};

PrintDocumentPane.displayName = "PrintDocumentPane";
export default PrintDocumentPane;

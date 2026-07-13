// 1. React
import { FC, ComponentType, Component, useMemo, useCallback, useState, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { consumePendingHighlight, subscribeHighlight } from "src/utils/listHighlight";
import type { ReactNode } from "react";

// 2. Контекст приложения
import { useAppContext } from "src/app/context";

// 3. Хуки
import { useModelListState } from "src/hooks/useModelListState";

// 4. Компоненты
import Table from "src/components/Table";
import type { TOpenModelFormProps, TTableVariant } from "src/components/Table";
import Tabs from "src/components/Tabs";

// 5. Типы
import type { TColumn, TDataItem } from "src/components/Table/types";

// 6. Utils / i18n
import { translate } from "src/i18";
import { getFormatColumnValue } from "src/components/Table/services";
import { makePaneLabelFromData } from "src/utils/buildPaneLabel";
import { Button } from "src/components/Button";

// 7. Стили
import styles from "./ModelList.module.scss";

// ─── Стабильный хелпер перевода ───────────────────────────────────────────────
// Определён вне компонента, чтобы не пересоздаваться при каждом рендере
const t = (key: string): string => translate(key) || key;

// ─── Типы ─────────────────────────────────────────────────────────────────────

/**
 * Универсальный компонент списка модели.
 *
 * Заменяет одинаковый шаблон List во всех моделях:
 * - useModelListState + openModelForm + buildTableProps + Table + error
 *
 * @example
 * ```tsx
 * <ModelList
 *   endpoint="organizations"
 *   listName="OrganizationsList"
 *   columnsJson={columnsJson}
 *   FormComponent={OrganizationsForm}
 *   getLabel={(d) => d?.name || "?"}
 * />
 * ```
 */
interface ModelListProps {
  /** API-эндпоинт (например `"organizations"`) */
  endpoint: string;
  /** Имя компонента для translate и componentName (например `"OrganizationsList"`) */
  listName: string;
  /** Описание колонок из columns.json */
  columnsJson: unknown;
  /** Компонент формы */
  FormComponent: ComponentType<Record<string, unknown>>;
  /** Извлечение метки для панели из данных строки (по умолчанию `() => ""`) */
  getLabel?: (data: TDataItem | undefined) => string;
  /** Сортировка по умолчанию */
  defaultSort?: Record<string, "asc" | "desc">;
  /** variant таблицы */
  variant?: TTableVariant;
  /** Выбор элемента (lookup-режим) */
  onSelectItem?: (item: TDataItem) => void;
  /** Фильтр по владельцу — uuid */
  ownerUuid?: string;
  /** Фильтр по владельцу — имя FK-поля */
  ownerField?: string;
  /**
   * Дополнительные фильтры (помимо ownerUuid/ownerField).
   * Каждый ключ — имя поля, значение — строка для сравнения `equals`.
   * Используется, например, для LookupField extraParams в ContractsList.
   */
  extraFilter?: Record<string, string>;
  /** Дополнительные query-параметры, отправляемые напрямую (не через filter[...]). Для эндпоинтов, читающих params напрямую (например contacts: ownerType, ownerUuid). */
  extraQueryParams?: Record<string, string>;
  /** Включить фильтр по дате */
  enableDateRange?: boolean;
  /** Кастомный рендер ячеек */
  renderCell?: (row: TDataItem, col: TColumn) => ReactNode | undefined;
  /**
   * Доп. вкладки предпросмотра (split-вид), только для чтения. Модель поставляет
   * read-only таблицы позиций документа по выбранной строке. Вкладка «Основное»
   * (поля) добавляется автоматически. Если не задано — предпросмотр = только поля.
   */
  previewTabs?: (row: TDataItem) => { id: string; label: string; component: ReactNode }[];
  /**
   * Свой рендер значения на вкладке «Основное» предпросмотра. Нужен там, где значение
   * в одну строку не укладывается: JSON-реквизиты 1С плоско превращаются в
   * «ключ: значение; …» и становятся нечитаемыми. undefined → обычный текст.
   */
  renderPreviewValue?: (row: TDataItem, col: TColumn) => ReactNode | undefined;
  /**
   * Скрыть кнопки «Добавить»/«Удалить» — для СПРАВОЧНИКОВ ТОЛЬКО ДЛЯ ЧТЕНИЯ, записи
   * в которых порождаются документами, а не пользователем (например серийные номера:
   * появляются при приёмке, выбывают при продаже/списании). Без этого кнопки бьют в
   * несуществующие роуты (POST /{model}, DELETE /{model}/:id, POST /{model}/batch-delete),
   * а ручное удаление ломало бы инвариант «число серий == количеству в документе».
   */
  hideAddDelete?: boolean;
  /**
   * Скрыть только «Добавить» (удаление остаётся) — для ЖУРНАЛОВ: записи порождает
   * система (аудит-middleware, приём событий 1С), а не пользователь. У журналов нет
   * POST-роута создания из UI, поэтому кнопка просто падала с ошибкой; чистить старые
   * записи админу при этом можно.
   */
  hideAdd?: boolean;
}

// ─── Вспомогательный компонент состояния ошибки ───────────────────────────────

interface ErrorStateProps {
  message: string;
  onRetry: () => void;
}

const ErrorState: FC<ErrorStateProps> = ({ message, onRetry }) => (
  <section
    className={styles.errorContainer}
    role="alert"
    aria-live="assertive"
    data-testid="model-list-error"
  >
    <h3 className={styles.errorTitle}>{t("errorTitle") || "Ошибка загрузки"}</h3>
    <p className={styles.errorDescription}>{message}</p>
    <button
      type="button"
      className={styles.retryButton}
      onClick={onRetry}
      data-testid="model-list-retry"
    >
      {t("retry") || "Повторить"}
    </button>
  </section>
);

ErrorState.displayName = "ErrorState";

// Локальный ErrorBoundary: если содержимое вкладки предпросмотра (таблица позиций)
// упало при рендере — показываем фолбэк вместо падения всего списка.
class PreviewBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e: unknown) { console.error("ListPreview render error:", e); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

// Плоский список «поле: значение» по колонкам — лёгкий предпросмотр / фолбэк.
//
// renderPreviewValue — точка расширения для значений, которые в одну строку не
// укладываются: JSON-реквизиты 1С плоско превращаются в «ключ: значение; …» и
// становятся нечитаемыми. Модель отдаёт свой ReactNode; undefined → обычный текст.
const FlatFields: FC<{
  row: TDataItem;
  columns: TColumn[];
  renderPreviewValue?: (row: TDataItem, col: TColumn) => ReactNode | undefined;
}> = ({ row, columns, renderPreviewValue }) => {
  const fields = columns.filter((c) => c.inlist !== false && c.identifier !== "uuid" && c.identifier !== "id");
  return (
    <div className={styles.previewBody}>
      {fields.map((c) => {
        const custom = renderPreviewValue?.(row, c);
        return (
          <div key={c.identifier} className={styles.previewRow}>
            <span className={styles.previewLabel}>{c.hint || t(c.identifier)}</span>
            {custom !== undefined
              ? <div className={styles.previewValue}>{custom}</div>
              : <span className={styles.previewValue}>{String(getFormatColumnValue(row, c) ?? "")}</span>}
          </div>
        );
      })}
    </div>
  );
};

// ─── Панель предпросмотра (split-вид) ─────────────────────────────────────────
// ТОЛЬКО ДЛЯ ЧТЕНИЯ. Вкладка «Основное» — поля документа (по колонкам списка),
// плюс опциональные вкладки с таблицами позиций (previewTabs, поставляет модель:
// read-only TradeDocumentItemsTable). Редактирование — по кнопке «Открыть»
// (выносит документ в полноценную вкладку). Никакого монтирования редактируемой
// pane-формы: предпросмотр не тянет edit-режим / порталы тулбара / dirty-guard.
export type PreviewTab = { id: string; label: string; component: ReactNode };

const ListPreview: FC<{
  row: TDataItem | null;
  columns: TColumn[];
  previewTabs?: (row: TDataItem) => PreviewTab[];
  renderPreviewValue?: (row: TDataItem, col: TColumn) => ReactNode | undefined;
  onOpen: () => void;
}> = ({ row, columns, previewTabs, renderPreviewValue, onOpen }) => {
  if (!row) return <div className={styles.previewEmpty}>{t("viewer.empty") || "Выберите запись"}</div>;
  const uuid = row.uuid ? String(row.uuid) : "";
  const mainTab: PreviewTab = {
    id: "main",
    label: t("general") || "Основное",
    component: <FlatFields row={row} columns={columns} renderPreviewValue={renderPreviewValue} />,
  };
  const extraTabs = uuid && previewTabs ? previewTabs(row) : [];
  const tabs = [mainTab, ...extraTabs];
  return (
    <div className={styles.preview}>
      <div className={styles.previewHeader}>
        <span className={styles.previewTitle}>{t("preview") || "Предпросмотр"}</span>
        <Button variant="secondary" onClick={onOpen}>{t("open") || "Открыть"}</Button>
      </div>
      <PreviewBoundary key={uuid} fallback={<FlatFields row={row} columns={columns} />}>
        <Tabs tabs={tabs} />
      </PreviewBoundary>
    </div>
  );
};
ListPreview.displayName = "ListPreview";

// ─── Основной компонент ───────────────────────────────────────────────────────

const ModelList: FC<ModelListProps> = ({
  endpoint,
  listName,
  columnsJson,
  FormComponent,
  getLabel = () => "",
  defaultSort = { id: "asc" } as Record<string, "asc" | "desc">,
  variant = "default",
  onSelectItem,
  ownerUuid,
  ownerField,
  extraFilter,
  extraQueryParams,
  enableDateRange = false,
  renderCell,
  previewTabs,
  renderPreviewValue,
  hideAddDelete = false,
  hideAdd = false,
}) => {
  const isPartOf = !!ownerUuid;
  const componentName = isPartOf ? `${listName}_part` : listName;

  const { addPane } = useAppContext().windows;

  // Вид списка: "list" (обычный) | "split" (список + предпросмотр справа).
  // Персист per-list в localStorage; тумблер в тулбаре Table шлёт "listLayoutToggle".
  const layoutKey = `listPaneLayout:${componentName}`;
  const [layout, setLayout] = useState<"list" | "split">(
    () => ((localStorage.getItem(layoutKey) as "list" | "split") || "list"),
  );
  const [previewRow, setPreviewRow] = useState<TDataItem | null>(null);

  // Ширина панели предпросмотра (в % от split-контейнера), перетаскивается
  // разделителем; персист per-list. Кламп 20–70% чтобы обе части оставались видимы.
  const widthKey = `listSplitWidth:${componentName}`;
  const [previewWidth, setPreviewWidth] = useState<number>(() => {
    const v = Number(localStorage.getItem(widthKey));
    return v >= 20 && v <= 70 ? v : 38;
  });
  const splitViewRef = useRef<HTMLDivElement>(null);
  const startResize = useCallback((e: ReactPointerEvent) => {
    e.preventDefault();
    const move = (ev: PointerEvent) => {
      const box = splitViewRef.current?.getBoundingClientRect();
      if (!box || box.width === 0) return;
      const pct = ((box.right - ev.clientX) / box.width) * 100;
      setPreviewWidth(Math.min(70, Math.max(20, pct)));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }, []);
  useEffect(() => {
    localStorage.setItem(widthKey, String(Math.round(previewWidth)));
  }, [widthKey, previewWidth]);

  useEffect(() => {
    const onToggle = (e: Event) => {
      if ((e as CustomEvent).detail !== componentName) return;
      setLayout((localStorage.getItem(layoutKey) as "list" | "split") || "list");
    };
    window.addEventListener("listLayoutToggle", onToggle);
    return () => window.removeEventListener("listLayoutToggle", onToggle);
  }, [componentName, layoutKey]);
  // Split доступен только для самостоятельного списка (не встроенного в форму
  // владельца и не в режиме выбора-селектора, где onSelectItem уже занят).
  const splitActive = layout === "split" && !isPartOf && !onSelectItem;

  // Подсветка строки документа («Показать в списке» / после «Сохранить и закрыть»):
  // при монтировании забираем отложенное значение, а пока список открыт —
  // подписываемся, чтобы переносить activeRow и для УЖЕ открытого Pane.
  const [highlight, setHighlight] = useState<{ uuid?: string; token: number }>(
    () => ({ uuid: isPartOf ? undefined : consumePendingHighlight(endpoint), token: 0 }),
  );
  useEffect(() => {
    if (isPartOf) return;
    return subscribeHighlight(endpoint, (uuid) => {
      // token++ при каждом запросе — повторное «Показать в списке» того же
      // документа снова сработает (центрирование), даже если uuid не изменился.
      setHighlight((h) => ({ uuid, token: h.token + 1 }));
      // Применили вживую — снимаем «страховочное» значение, чтобы будущее
      // повторное открытие списка не «прыгало» на этот документ.
      consumePendingHighlight(endpoint);
    });
  }, [isPartOf, endpoint]);

  const ownerFilter = useMemo(() => {
    const f: Record<string, { value: unknown; operator: string }> = {};

    if (ownerUuid && ownerField) {
      f[ownerField] = { value: ownerUuid, operator: "equals" };
    }

    if (extraFilter) {
      for (const [key, val] of Object.entries(extraFilter)) {
        if (val) f[key] = { value: val, operator: "equals" };
      }
    }

    return Object.keys(f).length > 0 ? f : undefined;
  }, [ownerUuid, ownerField, extraFilter]);

  const { error, refetch, buildTableProps } = useModelListState({
    model: endpoint,
    componentName,
    columnsJson,
    defaultSort,
    columnsVariant: isPartOf ? "part" : undefined,
    ownerFilter,
    extraQueryParams,
  });

  const openModelForm = useCallback(
    (formProps: TOpenModelFormProps) => {
      const d = formProps.data;
      const isEdit = !!d?.uuid;

      // При создании новой записи в контексте владельца — проставляем FK автоматически.
      // Для каждой новой записи добавляем уникальный _paneToken, чтобы повторное
      // «Добавить» открывало НОВЫЙ Pane (*Form), а не активировало уже открытый
      // (getUniqId без uuid/token делает форму синглтоном по имени компонента).
      const newData = isEdit
        ? d
        : ({
            ...(d as object | undefined),
            ...(ownerUuid && ownerField ? { [ownerField]: ownerUuid } : {}),
            _paneToken: `new-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          } as unknown as TDataItem);

      const listTitle = t(componentName) || componentName;
      const label = isEdit
        ? makePaneLabelFromData(componentName, listTitle, d, getLabel(d as TDataItem))
        : makePaneLabelFromData(componentName, listTitle);

      addPane({
        label,
        component: FormComponent,
        data: newData,
        // Рецепт восстановления/ссылки: только для сохранённой записи (есть uuid).
        // Новые формы не линкуются/не восстанавливаются (нечего открывать).
        restore: isEdit && d?.uuid ? { kind: "form", endpoint, uuid: String(d.uuid) } : undefined,
        onSave: async () => { await refetch(); },
        onClose: async () => { await refetch(); },
      });
    },
    [addPane, refetch, componentName, ownerUuid, ownerField, FormComponent, getLabel, endpoint],
  );

  if (error) {
    return (
      <ErrorState
        message={error?.message ?? "Неизвестная ошибка"}
        onRetry={refetch}
      />
    );
  }

  // В split-режиме двойной клик по строке показывает предпросмотр (через
  // onSelectItem), а не открывает вкладку; в обычном — прежнее поведение.
  const table = (
    <Table
      {...buildTableProps({
        variant,
        onSelectItem: splitActive ? (row: TDataItem) => setPreviewRow(row) : onSelectItem,
        openModelForm,
        enableDateRange,
        renderCell,
        highlightUuid: highlight.uuid,
        highlightToken: highlight.token,
      })}
      hideAddDelete={hideAddDelete}
      hideAdd={hideAdd}
    />
  );

  if (!splitActive) return table;

  const previewColumns = (columnsJson as TColumn[] | undefined) ?? [];
  return (
    <div className={styles.splitView} ref={splitViewRef}>
      <div className={styles.splitList}>{table}</div>
      <div
        className={styles.splitResizer}
        role="separator"
        aria-orientation="vertical"
        title={t("resizePanels") || "Потяните, чтобы изменить размер"}
        onPointerDown={startResize}
        onDoubleClick={() => setPreviewWidth(38)}
      />
      <div className={styles.splitPreview} style={{ flexBasis: `${previewWidth}%` }}>
        <ListPreview
          row={previewRow}
          columns={previewColumns}
          previewTabs={previewTabs}
          renderPreviewValue={renderPreviewValue}
          onOpen={() => previewRow && openModelForm({ data: previewRow })}
        />
      </div>
    </div>
  );
};

ModelList.displayName = "ModelList";
export default ModelList;

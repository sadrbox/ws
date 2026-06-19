// 1. React
import { FC, ComponentType, useMemo, useCallback, useState, useEffect } from "react";
import { consumePendingHighlight, subscribeHighlight } from "src/utils/listHighlight";
import type { ReactNode } from "react";

// 2. Контекст приложения
import { useAppContext } from "src/app";

// 3. Хуки
import { useModelListState } from "src/hooks/useModelListState";

// 4. Компоненты
import Table from "src/components/Table";
import type { TOpenModelFormProps, TTableVariant } from "src/components/Table";

// 5. Типы
import type { TColumn, TDataItem } from "src/components/Table/types";

// 6. Utils / i18n
import { translate } from "src/i18";
import { makePaneLabelFromData } from "src/utils/buildPaneLabel";

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
}) => {
  const isPartOf = !!ownerUuid;
  const componentName = isPartOf ? `${listName}_part` : listName;

  const { addPane } = useAppContext().windows;

  // Подсветка строки документа («Показать в списке» / после «Сохранить и закрыть»):
  // при монтировании забираем отложенное значение, а пока список открыт —
  // подписываемся, чтобы переносить activeRow и для УЖЕ открытого Pane.
  const [highlightUuid, setHighlightUuid] = useState<string | undefined>(
    () => (isPartOf ? undefined : consumePendingHighlight(endpoint)),
  );
  useEffect(() => {
    if (isPartOf) return;
    return subscribeHighlight(endpoint, (uuid) => setHighlightUuid(uuid));
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
        onSave: async () => { await refetch(); },
        onClose: async () => { await refetch(); },
      });
    },
    [addPane, refetch, componentName, ownerUuid, ownerField, FormComponent, getLabel],
  );

  if (error) {
    return (
      <ErrorState
        message={error?.message ?? "Неизвестная ошибка"}
        onRetry={refetch}
      />
    );
  }

  return (
    <Table
      {...buildTableProps({ variant, onSelectItem, openModelForm, enableDateRange, renderCell, highlightUuid })}
    />
  );
};

ModelList.displayName = "ModelList";
export default ModelList;

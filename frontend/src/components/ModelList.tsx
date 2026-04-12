import { FC, useMemo, useCallback } from "react";
import { useAppContext } from "src/app";
import { translate } from "src/i18";
import type { TDataItem } from "src/components/Table/types";
import type { TTableVariant } from "src/components/Table";
import Table, { TOpenModelFormProps } from "src/components/Table";
import { useModelListState } from "src/hooks/useModelListState";

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
 *   getLabel={(d) => d?.shortName || "?"}
 * />
 * ```
 */

interface ModelListProps {
  /** API-эндпоинт (например `"organizations"`) */
  endpoint: string;
  /** Имя компонента для translate и componentName (например `"OrganizationsList"`) */
  listName: string;
  /** Описание колонок из columns.json */
  columnsJson: any;
  /** Компонент формы */
  FormComponent: FC<any>;
  /** Извлечение метки для панели из данных строки */
  getLabel: (data: TDataItem | undefined) => string;
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
  /** Включить фильтр по дате */
  enableDateRange?: boolean;
}

const ModelList: FC<ModelListProps> = ({
  endpoint,
  listName,
  columnsJson,
  FormComponent,
  getLabel,
  defaultSort = { id: "asc" } as Record<string, "asc" | "desc">,
  variant = "default",
  onSelectItem,
  ownerUuid,
  ownerField,
  enableDateRange = false,
}) => {
  const isPartOf = !!ownerUuid;
  const componentName = isPartOf ? `${listName}_part` : listName;
  const { addPane } = useAppContext().windows;
  const t = (key: string) => translate(key) || key;

  const ownerFilter = useMemo(() => {
    if (ownerUuid && ownerField) return { [ownerField]: { value: ownerUuid, operator: "equals" } };
    return undefined;
  }, [ownerUuid, ownerField]);

  const { error, refetch, buildTableProps } = useModelListState({
    model: endpoint,
    componentName,
    columnsJson,
    defaultSort,
    columnsVariant: isPartOf ? "part" : undefined,
    ownerFilter,
  });

  const openModelForm = useCallback((formProps: TOpenModelFormProps) => {
    const d = formProps.data;
    const isEdit = !!d?.uuid;
    const newData = !isEdit && ownerUuid && ownerField
      ? { [ownerField]: ownerUuid } as unknown as TDataItem
      : d;
    const label = isEdit
      ? `${t(componentName)}: ${getLabel(d)} • ${d?.id ?? "?"}`
      : `${t(componentName)}: ${t("new")}`;
    addPane({
      label,
      component: FormComponent,
      data: newData,
      onSave: () => refetch(),
      onClose: () => refetch(),
    });
  }, [addPane, t, refetch, componentName, ownerUuid, ownerField, FormComponent, getLabel]);

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

  return <Table {...buildTableProps({ variant, onSelectItem, openModelForm, enableDateRange })} />;
};

ModelList.displayName = "ModelList";
export default ModelList;

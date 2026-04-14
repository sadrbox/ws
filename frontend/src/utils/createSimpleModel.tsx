/**
 * createSimpleModel — фабрика для типовых простых справочников.
 *
 * Используется для: Brands, Currencies, Positions и аналогичных моделей,
 * которые имеют только текстовые поля без связей (LookupField / SubTable).
 *
 * Каждая модель описывается декларативным конфигом:
 * - endpoint, listName, storageKey, formLabel
 * - fields: массив описаний полей
 * - accessRight: ключ для useAccessRight (опционально)
 * - getLabel: формат метки в списке
 *
 * Возвращает { Form, List } — готовые компоненты.
 */

import { FC, useMemo } from "react";
import { translate } from "src/i18";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import { Divider, Field } from "src/components/Field";
import { Group } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import { useFormStore } from "src/hooks/useFormStore";
import { useAccessRight } from "src/hooks/useAccessRight";
import ModelFormWrapper from "src/components/ModelFormWrapper";
import ModelList from "src/components/ModelList";

// ═══════════════════════════════════════════════════════════════════════════
// Типы конфига
// ═══════════════════════════════════════════════════════════════════════════

/** Описание одного поля формы */
export interface SimpleFieldDef {
  /** Ключ в объекте fields (напр. "shortName", "code") */
  key: string;
  /** Русская метка (напр. "Наименование *") */
  label: string;
  /** Обязательное поле — добавится валидация в buildPayload */
  required?: boolean;
  /** Сообщение об ошибке при пустом required-поле */
  requiredMessage?: string;
  /** Минимальная ширина инпута */
  minWidth?: string;
}

export interface CreateSimpleModelOptions {
  /** API-эндпоинт */
  endpoint: string;
  /** Имя списка для translate (напр. "BrandsList") */
  listName: string;
  /** Ключ sessionStorage (напр. "brands-form") */
  storageKey: string;
  /** Русское название для заголовка (fallback) */
  formLabel: string;
  /** Описание колонок таблицы (columns.json) */
  columnsJson: any;
  /** Массив описаний полей формы */
  fields: SimpleFieldDef[];
  /** Ключ AccessRight (напр. "Brand"). Если не указан — readonly не применяется */
  accessRight?: string;
  /** Формирование метки панели из сохранённых данных */
  buildPaneLabel?: (saved: Record<string, any>) => string;
  /** Формирование метки строки в списке */
  getLabel?: (data: TDataItem | undefined) => string;
  /** Сортировка по умолчанию */
  defaultSort?: Record<string, "asc" | "desc">;
}

// ═══════════════════════════════════════════════════════════════════════════
// Фабрика
// ═══════════════════════════════════════════════════════════════════════════

export function createSimpleModel(opts: CreateSimpleModelOptions) {
  const {
    endpoint,
    listName,
    storageKey,
    formLabel,
    columnsJson,
    fields,
    accessRight,
    defaultSort,
  } = opts;

  // Формируем defaultFields и TFields-тип динамически
  type TFields = Record<string, any> & { id?: number; uuid?: string };
  const DEFAULT_FIELDS: TFields = {};
  for (const f of fields) DEFAULT_FIELDS[f.key] = "";

  // buildPaneLabel по умолчанию
  const buildPaneLabel = opts.buildPaneLabel ?? ((saved: Record<string, any>) => {
    const primary = saved[fields[0]?.key] || "?";
    return `${translate(listName) || formLabel}: ${primary} • ${saved.id ?? "?"}`;
  });

  // getLabel по умолчанию
  const getLabel = opts.getLabel ?? ((d: TDataItem | undefined) =>
    d?.[fields[0]?.key] ? String(d[fields[0].key]).slice(0, 50) : "?"
  );

  // requiredKeys + validationMap
  const requiredFields = fields.filter((f) => f.required);

  // ─── FORM ───────────────────────────────────────────────────────────

  const SimpleForm: FC<Partial<TPane>> = (paneProps) => {
    const access = accessRight ? useAccessRight(accessRight) : { canWrite: true };

    const form = useFormStore<TFields>({
      endpoint,
      storageKey,
      defaultFields: DEFAULT_FIELDS,
      paneProps,
      mapServerToForm: (d, prev) => {
        const result: TFields = { ...(prev ?? DEFAULT_FIELDS), ...d };
        for (const f of fields) result[f.key] = d[f.key] ?? "";
        return result;
      },
      buildPayload: (fd) => {
        // Валидация обязательных полей
        for (const rf of requiredFields) {
          if (!fd[rf.key]?.trim()) {
            return rf.requiredMessage || `${rf.label.replace(" *", "")} обязательно`;
          }
        }
        // Собираем payload
        const payload: Record<string, any> = {};
        for (const f of fields) {
          const val = fd[f.key]?.trim();
          payload[f.key] = val || null;
        }
        return payload;
      },
      buildPaneLabel,
    });

    const tabs = useMemo(() => [
      {
        id: "general",
        label: translate("general") || "Общие сведения",
        component: (
          <div className={styles.FormBodyParts}>
            <Group align="row" gap="12px" className={styles.Form}>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px", flex: 1 }}>
                {fields.map((f) => (
                  <Field
                    key={f.key}
                    label={f.label}
                    name={`${form.formUid}_${f.key}`}
                    minWidth={f.minWidth ?? "339px"}
                    value={form.fields[f.key] ?? ""}
                    onChange={(e) => form.setField(f.key, e.target.value)}
                    disabled={form.isLoading}
                  />
                ))}
              </div>
            </Group>
            {form.isEditMode && (
              <>
                <Divider />
                <Group align="row" gap="12px" className={styles.Form}>
                  <div style={{ display: "flex", flexDirection: "row", gap: "12px" }}>
                    <Field label="ID" name={`${form.formUid}_id`} width="100px" value={String(form.fields.id ?? "-")} disabled />
                    <Field label="UUID" name={`${form.formUid}_uuid`} width="300px" value={String(form.fields.uuid ?? "-")} disabled />
                  </div>
                </Group>
              </>
            )}
          </div>
        ),
      },
    ], [form.fields, form.isLoading, form.isEditMode, form.formUid, form.setField]);

    return (
      <ModelFormWrapper
        tabs={tabs}
        onSave={form.handleSave}
        onSaveAndClose={form.handleSaveAndClose}
        onClose={form.handleClose}
        onReload={form.uuid ? () => form.loadFromServer(form.uuid!) : undefined}
        isLoading={form.isLoading}
        showReload={form.isEditMode}
        error={form.error}
        errorRevision={form.errorRevision}
        onErrorDismiss={() => form.setError(null)}
        readonly={!access.canWrite}
        isDirty={form.isDirty}
      />
    );
  };
  SimpleForm.displayName = `${listName.replace("List", "")}Form`;

  // ─── LIST ──────────────────────────────────────────────────────────

  const SimpleList: FC<{
    variant?: TTableVariant;
    onSelectItem?: (item: TDataItem) => void;
    ownerUuid?: string;
    ownerField?: string;
  }> = ({ variant, onSelectItem, ownerUuid, ownerField }) => (
    <ModelList
      endpoint={endpoint}
      listName={listName}
      columnsJson={columnsJson}
      FormComponent={SimpleForm}
      getLabel={getLabel}
      variant={variant}
      onSelectItem={onSelectItem}
      ownerUuid={ownerUuid}
      ownerField={ownerField}
      defaultSort={defaultSort}
    />
  );
  SimpleList.displayName = listName;

  return { Form: SimpleForm, List: SimpleList };
}

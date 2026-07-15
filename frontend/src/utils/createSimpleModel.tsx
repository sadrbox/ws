/**
 * createSimpleModel — фабрика для типовых простых справочников.
 *
 * Используется для: Brands, Currencies, Positions и аналогичных моделей,
 * которые имеют только текстовые поля без связей (LookupField / SubTable).
 *
 * Каждая модель описывается декларативным конфигом:
 * - endpoint, listName, storageKey, formLabel
 * - fields: массив описаний полей
 * - accessPermission: ключ для useAccessPermission (опционально)
 * - getLabel: формат метки в списке
 *
 * Возвращает { Form, List } — готовые компоненты.
 */

import { FC, useMemo } from "react";
import { translate } from "src/i18";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import { Field } from "src/components/Field";
import FieldToggle from "src/components/Field/FieldToggle";
import styles from "src/styles/main.module.scss";
import { useFormStore } from "src/hooks/useFormStore";
import { useAccessPermission } from "src/hooks/useAccessPermission";
import { makePaneLabel } from "src/utils/buildPaneLabel";
import { FormDirtyScope, FormRequiredScope } from "src/hooks/useFormRequired";
import ModelForm from "src/components/ModelForm";
import ModelList from "src/components/ModelList";
import { Group } from "src/components/UI";

// ═══════════════════════════════════════════════════════════════════════════
// Типы конфига
// ═══════════════════════════════════════════════════════════════════════════

/** Описание одного поля формы */
export interface SimpleFieldDef {
  /** Ключ в объекте fields (напр. "name", "code") */
  key: string;
  /** Русская метка (напр. "Наименование") */
  label: string;
  /** Обязательное поле — добавится валидация в buildPayload */
  required?: boolean;
  /** Сообщение об ошибке при пустом required-поле */
  requiredMessage?: string;
  /** Минимальная ширина инпута */
  minWidth?: string;
  /** Тип поля: текст (по умолчанию) или булев тумблер (FieldToggle). */
  type?: "text" | "toggle";
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
  /** Ключ AccessPermission (напр. "Brand"). Если не указан — readonly не применяется */
  accessPermission?: string;
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
    accessPermission,
    defaultSort,
  } = opts;

  // Формируем defaultFields и TFields-тип динамически
  type TFields = Record<string, any> & { id?: number; uuid?: string };
  const DEFAULT_FIELDS: TFields = {};
  for (const f of fields) DEFAULT_FIELDS[f.key] = f.type === "toggle" ? false : "";

  // buildPaneLabel по умолчанию
  const buildPaneLabel = opts.buildPaneLabel ?? ((saved: Record<string, any>) => makePaneLabel(listName, formLabel, saved));

  // getLabel по умолчанию
  const getLabel = opts.getLabel ?? ((d: TDataItem | undefined) =>
    d?.[fields[0]?.key] ? String(d[fields[0].key]).slice(0, 50) : "?"
  );

  // requiredKeys + validationMap
  const requiredFields = fields.filter((f) => f.required);
  const requiredKeys = requiredFields.map((f) => f.key);

  // ─── FORM ───────────────────────────────────────────────────────────

  const SimpleForm: FC<Partial<TPane>> = (paneProps) => {
    // Хук всегда вызывается безусловно; если accessPermission не задан — перекрываем результат
    const _accessRaw = useAccessPermission(accessPermission ?? "");
    const access = accessPermission ? _accessRaw : { canWrite: true };

    const form = useFormStore<TFields>({
      endpoint,
      storageKey,
      defaultFields: DEFAULT_FIELDS,
      paneProps,
      mapServerToForm: (d, prev) => {
        const result: TFields = { ...(prev ?? DEFAULT_FIELDS), ...d };
        for (const f of fields) result[f.key] = d[f.key] ?? (f.type === "toggle" ? false : "");
        return result;
      },
      buildPayload: (fd) => {
        // Валидация обязательных полей (строковые — по trim, прочие — по null).
        for (const rf of requiredFields) {
          const v = fd[rf.key];
          const empty = v == null || (typeof v === "string" && !v.trim());
          if (empty) {
            return rf.requiredMessage || `${rf.label.replace(" *", "")} обязательно`;
          }
        }
        // Собираем payload. Значения с сервера могут быть НЕ строками (boolean
        // isDefault, number sortOrder) — нельзя звать .trim() на них (иначе
        // ошибка при сохранении). Строки тримим, остальное передаём как есть.
        const payload: Record<string, any> = {};
        for (const f of fields) {
          const raw = fd[f.key];
          if (typeof raw === "string") {
            const val = raw.trim();
            payload[f.key] = val || null;
          } else {
            payload[f.key] = raw ?? null;
          }
        }
        return payload;
      },
      buildPaneLabel,
    });

    const tabs = useMemo(() => [
      {
        id: "tab-details",
        label: translate("general"),
        component: (
          <div className={styles.FormWrapper}>
            <div className={styles.Form}>
              <Group>
                {fields.map((f) => (
                  f.type === "toggle" ? (
                    <FieldToggle
                      key={f.key}
                      name={`${form.formUid}_${f.key}`}
                      label={f.label}
                      value={form.fields[f.key] === true}
                      onChange={(checked) => form.setField(f.key, checked)}
                      disabled={form.isLoading}
                    />
                  ) : (
                    <Field
                      key={f.key}
                      label={f.label}
                      name={`${form.formUid}_${f.key}`}
                      minWidth={f.minWidth ?? "339px"}
                      value={form.fields[f.key] ?? ""}
                      onChange={(e) => form.setField(f.key, e.target.value)}
                      disabled={form.isLoading}
                    />
                  )
                ))}
              </Group>
            </div>
          </div>
        ),
      },
    ], [form.fields, form.isLoading, form.isEditMode, form.formUid, form.setField]);

    return (
      <FormRequiredScope requiredKeys={requiredKeys}>
        <FormDirtyScope dirtyKeys={form.unsavedFields}>
          <ModelForm
            paneId={form.paneId} endpoint={endpoint} recordUuid={(form.fields as { uuid?: string }).uuid}
            tabs={tabs}
            onSave={form.handleSave}
            onSaveAndClose={form.handleSaveAndClose}
            onClose={form.handleClose}
            onReload={form.isEditMode ? form.handleReload : undefined}
            isLoading={form.isLoading}
            isInitialLoading={form.isInitialLoading}
            readonly={!access.canWrite}
          />
        </FormDirtyScope>
      </FormRequiredScope>
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

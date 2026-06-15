import LookupField, { type LookupFieldProps } from "./LookupField";

// ═══════════════════════════════════════════════════════════════════════════
// FormLookup — обёртка над LookupField, привязанная к useFormStore.
//
// Снимает повторяющуюся обвязку, которая раньше дублировалась на КАЖДОМ лукапе:
//   value={form.fields.xUuid} displayValue={form.fields.xName}
//   onSelect={(u,d) => form.setFields({ xUuid: u, xName: d })}
//   onClear={() => form.setFields({ xUuid: "", xName: "" })}
//   disabled={form.isLoading} name={`${form.formUid}_xUuid`}
//
// Достаточно указать базовое имя поля:
//   <FormLookup form={form} field="organization" endpoint="organizations" />
//
// Из `field` выводятся ключи `${field}Uuid` / `${field}Name`, имя input
// (`${formUid}_${field}Uuid`), подпись (i18-ключ `field`, переводится внутри
// LookupField) и disabled (form.isLoading). При нестандартной логике выбора —
// передайте свой onSelect (полностью заменяет установку пары uuid/name).
// ═══════════════════════════════════════════════════════════════════════════

/** Минимальный контракт хэндла формы, нужный лукапу (совместим с useFormStore). */
export interface FormLookupHandle<F extends Record<string, any>> {
  fields: F;
  setFields: (patch: Partial<F>) => void;
  formUid: string;
  isLoading: boolean;
}

export interface FormLookupProps<F extends Record<string, any>>
  extends Omit<LookupFieldProps, "name" | "value" | "displayValue" | "onSelect" | "endpoint"> {
  /** Хэндл формы (результат useFormStore). */
  form: FormLookupHandle<F>;
  /** Базовое имя поля. uuid/name выводятся как `${field}Uuid` / `${field}Name`. */
  field: string;
  /** API-endpoint справочника, напр. "organizations". */
  endpoint: string;
  /** Переопределить ключ хранения uuid (по умолчанию `${field}Uuid`). */
  uuidField?: string;
  /** Переопределить ключ отображаемого значения (по умолчанию `${field}Name`). */
  nameField?: string;
  /**
   * Кастомная логика выбора ВМЕСТО стандартной записи пары uuid/name.
   * Если не задана — FormLookup сам пишет { [uuidField]: uuid, [nameField]: display }.
   */
  onSelect?: (uuid: string, display: string, item: Record<string, any>) => void;
}

export function FormLookup<F extends Record<string, any>>({
  form,
  field,
  endpoint,
  uuidField,
  nameField,
  label,
  onSelect,
  onClear,
  disabled,
  ...rest
}: FormLookupProps<F>) {
  const uuidKey = uuidField ?? `${field}Uuid`;
  const nameKey = nameField ?? `${field}Name`;

  // LookupField вызывает onSelect("","",{}) и при очистке, поэтому отдельный
  // onClear для стандартного случая не нужен — пустой выбор уже чистит пару.
  const handleSelect =
    onSelect ??
    ((uuid: string, display: string) =>
      form.setFields({ [uuidKey]: uuid, [nameKey]: display } as Partial<F>));

  return (
    <LookupField
      {...rest}
      name={`${form.formUid}_${uuidKey}`}
      endpoint={endpoint}
      // label по умолчанию — i18-ключ `field`; LookupField сам переводит строки.
      label={label ?? field}
      value={(form.fields[uuidKey] as string) ?? ""}
      displayValue={(form.fields[nameKey] as string) ?? ""}
      onSelect={handleSelect}
      onClear={onClear}
      disabled={disabled ?? form.isLoading}
    />
  );
}

export default FormLookup;

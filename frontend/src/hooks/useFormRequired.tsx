/**
 * useFormRequired / useFormDirty — контексты для подсветки полей формы.
 *
 * FormRequiredScope — обязательные поля:
 *   Принимает docType (из REQUIRED_FIELDS_MAP) или requiredKeys (для справочников).
 *   Field-компоненты читают контекст через useFormRequiredScope() и добавляют
 *   класс FieldRequired, когда tail имени поля совпадает с ключом и значение пустое.
 *
 * FormDirtyScope — несохранённые поля:
 *   Принимает dirtyKeys (form.unsavedFields). Field-компоненты читают контекст
 *   через useFormDirtyScope() и добавляют класс FieldDirty автоматически.
 *
 * Сопоставление работает по tail — части после последнего `_`:
 * поле `${formUid}_organizationUuid` → tail "organizationUuid" → совпадает.
 */
import { createContext, FC, ReactNode, useContext, useMemo } from "react";
import type { DocumentType } from "src/utils/validatePostedDocument";
import { REQUIRED_FIELDS_MAP } from "src/utils/validatePostedDocument";

// ── Required ─────────────────────────────────────────────────────────────────

export interface FormRequiredState {
  requiredKeys: ReadonlySet<string>;
}

const EMPTY_SET = new Set<string>();
const EMPTY: FormRequiredState = { requiredKeys: EMPTY_SET };
const FormRequiredContext = createContext<FormRequiredState>(EMPTY);

export const FormRequiredScope: FC<{
  docType?: DocumentType;
  requiredKeys?: readonly string[];
  /** Активирует подсветку обязательных полей. По умолчанию false — подсветка
   *  не показывается, пока не будет явно включена (например, после неудачного сохранения). */
  active?: boolean;
  children: ReactNode;
}> = ({ docType, requiredKeys, active = false, children }) => {
  const value = useMemo<FormRequiredState>(() => {
    if (!active) return EMPTY;
    if (docType) return { requiredKeys: new Set(REQUIRED_FIELDS_MAP[docType]) };
    if (requiredKeys?.length) return { requiredKeys: new Set(requiredKeys) };
    return EMPTY;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, docType, requiredKeys?.join(",")]);
  return (
    <FormRequiredContext.Provider value={value}>
      {children}
    </FormRequiredContext.Provider>
  );
};

export const useFormRequiredScope = (): FormRequiredState => useContext(FormRequiredContext);

// ── Dirty ─────────────────────────────────────────────────────────────────────

const FormDirtyContext = createContext<ReadonlySet<string>>(EMPTY_SET);

export const FormDirtyScope: FC<{ dirtyKeys: ReadonlySet<string>; children: ReactNode }> = ({ dirtyKeys, children }) => (
  <FormDirtyContext.Provider value={dirtyKeys}>{children}</FormDirtyContext.Provider>
);

export const useFormDirtyScope = (): ReadonlySet<string> => useContext(FormDirtyContext);

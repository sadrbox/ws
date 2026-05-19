/**
 * useFormRequired — контекст для автоматической подсветки обязательных полей.
 *
 * FormRequiredScope оборачивает форму и предоставляет набор ключей обязательных
 * полей из REQUIRED_FIELDS_MAP. Подсветка активна всегда (не только при posted=true).
 * Field-компоненты читают контекст через useFormRequiredScope() и добавляют
 * класс FieldRequired к FieldWrapper, когда tail имени поля совпадает с ключом
 * и значение пустое.
 *
 * Сопоставление имён работает по tail — части после последнего `_`:
 * поле `${formUid}_organizationUuid` → tail "organizationUuid" → совпадает.
 */
import { createContext, FC, ReactNode, useContext, useMemo } from "react";
import type { DocumentType } from "src/utils/validatePostedDocument";
import { REQUIRED_FIELDS_MAP } from "src/utils/validatePostedDocument";

export interface FormRequiredState {
  requiredKeys: ReadonlySet<string>;
}

const EMPTY: FormRequiredState = { requiredKeys: new Set<string>() };

const FormRequiredContext = createContext<FormRequiredState>(EMPTY);

export const FormRequiredScope: FC<{
  docType: DocumentType;
  children: ReactNode;
}> = ({ docType, children }) => {
  const value = useMemo<FormRequiredState>(
    () => ({ requiredKeys: new Set(REQUIRED_FIELDS_MAP[docType]) }),
    [docType],
  );
  return (
    <FormRequiredContext.Provider value={value}>
      {children}
    </FormRequiredContext.Provider>
  );
};

export const useFormRequiredScope = (): FormRequiredState => useContext(FormRequiredContext);

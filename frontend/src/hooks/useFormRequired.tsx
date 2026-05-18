/**
 * useFormRequired — контекст для автоматической подсветки обязательных полей
 * в формах документов.
 *
 * Принцип: FormRequiredScope оборачивает форму и принимает тип документа +
 * флаг posted. При posted=true активирует набор ключей из REQUIRED_FIELDS_MAP.
 * Field-компоненты читают контекст через useFormRequiredScope() и добавляют
 * класс FieldRequired к FieldWrapper, когда tail имени поля совпадает с
 * обязательным ключом и значение пустое.
 *
 * Сопоставление имён работает по tail — части после последнего `_`,
 * аналогично useFieldDirty: поле с name="${formUid}_organizationUuid"
 * → tail "organizationUuid" → совпадает с ключом "organizationUuid".
 *
 * Механизм единый для всех Field* компонентов через useFieldBase (Field/index.tsx)
 * и отдельно в LookupField и FieldTextarea.
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
  isPosted: boolean;
  children: ReactNode;
}> = ({ docType, isPosted, children }) => {
  const value = useMemo<FormRequiredState>(
    () => isPosted ? { requiredKeys: new Set(REQUIRED_FIELDS_MAP[docType]) } : EMPTY,
    [docType, isPosted],
  );
  return (
    <FormRequiredContext.Provider value={value}>
      {children}
    </FormRequiredContext.Provider>
  );
};

export const useFormRequiredScope = (): FormRequiredState => useContext(FormRequiredContext);

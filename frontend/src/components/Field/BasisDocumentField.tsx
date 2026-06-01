import { FC, useCallback, useEffect, useMemo, useState } from "react";
import LookupField from "./LookupField";
import { translate } from "src/i18";
import { getFormatDateOnly } from "src/utils/datetime";
import { docTypeLabel, docTypeToEndpoint } from "src/utils/accountingDocTypes";
import styles from "./Field.module.scss";

export interface BasisTypeConfig {
  type: string;
  endpoint: string;
  /** Необязательно: если не задано — берётся локализованное название по типу (docTypeLabel). */
  label?: string;
}

export interface BasisDocumentFieldProps {
  allowedTypes: BasisTypeConfig[];
  basisDocumentType?: string;
  basisDocumentUuid?: string;
  basisDocumentLabel?: string;
  onSelect: (type: string, uuid: string, label: string) => void;
  onClear: () => void;
  disabled?: boolean;
  formUid: string;
  /** Документ-основание не совпадает с текущим (организация/контрагент/строки). */
  mismatch?: boolean;
  /** Перечень расхождений с основанием (для подсказки). */
  mismatchDetails?: string[];
}

/** Извлекает числовой ID из строки вида "Тип: ID 5 · 25.05.2026", иначе возвращает исходный текст. */
const extractBasisSearch = (input: string): string => {
  // "Тип: ID 5 · дата" → "5" → бэкенд search=5
  const idMatch = input.match(/ID\s+(\d+)/i);
  if (idMatch) return idMatch[1];
  // Всё остальное (частичный лейбл, дата, произвольный текст) →
  // "" → LookupField загрузит все записи и отфильтрует по getSuggestionLabel
  return "";
};

const BasisDocumentField: FC<BasisDocumentFieldProps> = ({
  allowedTypes,
  basisDocumentType,
  basisDocumentUuid,
  basisDocumentLabel,
  onSelect,
  onClear,
  disabled,
  formUid,
}) => {
  const [selectedType, setSelectedType] = useState<string>(
    basisDocumentType || allowedTypes[0]?.type || "",
  );

  useEffect(() => {
    if (basisDocumentType && basisDocumentType !== selectedType) {
      setSelectedType(basisDocumentType);
    }
  }, [basisDocumentType]);

  const activeType = useMemo(
    () => allowedTypes.find((t) => t.type === selectedType) ?? allowedTypes[0],
    [allowedTypes, selectedType],
  );

  const handleTypeChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedType(e.target.value);
  }, []);

  // Локализованное название типа документа: пользовательский label из конфига
  // (если задан) либо единое i18-название по коду типа (docTypeLabel).
  const nameForType = useCallback(
    (type?: string, cfg?: BasisTypeConfig) =>
      (cfg && cfg.type === type && cfg.label) || docTypeLabel(type ?? ""),
    [],
  );

  const handleSelect = useCallback(
    (_uuid: string, _display: string, item: Record<string, any>) => {
      if (!activeType) return;
      const label = `${nameForType(activeType.type, activeType)}: ID ${item.id} · ${getFormatDateOnly(item.date) ?? ""}`;
      onSelect(activeType.type, item.uuid, label);
    },
    [activeType, onSelect, nameForType],
  );

  const hasValue = !!basisDocumentUuid;
  const showTypeSelect = allowedTypes.length > 1 && !hasValue;

  const columns = [
    { key: "id", label: "ID" },
    { key: "name", label: translate("document") },
    { key: "date", label: translate("date") },
  ];

  // Когда значение уже выбрано — отдаём управление LookupField (он сам рисует FieldWrapper + label).
  // Тип документа берём из basisDocumentType (надёжно даже вне allowedTypes).
  if (hasValue) {
    const valueType = basisDocumentType || activeType?.type || "";
    const typeName = nameForType(valueType, activeType);
    return (
      <LookupField
        label={`${translate("basisDocument")} (${typeName})`}
        name={`${formUid}_basisDocument`}
        value={basisDocumentUuid}
        displayValue={basisDocumentLabel}
        endpoint={activeType?.endpoint ?? docTypeToEndpoint(valueType) ?? ""}
        displayField="id"
        getSuggestionLabel={(item) =>
          `${typeName}: ID ${item.id} · ${getFormatDateOnly(item.date) ?? ""}`
        }
        columns={columns}
        onSelect={handleSelect}
        onClear={onClear}
        disabled={disabled || !activeType}
        variant="default"
        searchTransform={extractBasisSearch}
      />
    );
  }

  // Когда значения ещё нет — показываем селектор типа + LookupField
  const newTypeName = nameForType(activeType?.type ?? selectedType, activeType);
  return (
    <LookupField
      label={`${translate("basisDocument")}${newTypeName ? ` (${newTypeName})` : ""}`}
      name={`${formUid}_basisDocument`}
      value={undefined}
      displayValue={undefined}
      endpoint={activeType?.endpoint ?? ""}
      displayField="id"
      getSuggestionLabel={(item) =>
        `${newTypeName}: ID ${item.id} · ${getFormatDateOnly(item.date) ?? ""}`
      }
      columns={columns}
      secondaryFields={["name", "counterparty.name", "documentNumber"]}
      onSelect={handleSelect}
      disabled={disabled || !activeType}
      searchTransform={extractBasisSearch}
    />
  );
};

export default BasisDocumentField;

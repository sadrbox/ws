import { FC, useCallback, useEffect, useMemo, useState } from "react";
import LookupField from "./LookupField";
import { translate } from "src/i18";
import { getFormatDateOnly } from "src/utils/main.module";
import styles from "./Field.module.scss";

export interface BasisTypeConfig {
  type: string;
  endpoint: string;
  label: string;
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

  const handleSelect = useCallback(
    (_uuid: string, _display: string, item: Record<string, any>) => {
      if (!activeType) return;
      const label = `${activeType.label}: ID ${item.id} · ${getFormatDateOnly(item.date) ?? ""}`;
      onSelect(activeType.type, item.uuid, label);
    },
    [activeType, onSelect],
  );

  const hasValue = !!basisDocumentUuid;
  const showTypeSelect = allowedTypes.length > 1 && !hasValue;

  // Когда значение уже выбрано — отдаём управление LookupField (он сам рисует FieldWrapper + label)
  if (hasValue) {
    return (
      <LookupField
        label={`${translate("basisDocument")} (${activeType?.label ?? ""})`}
        name={`${formUid}_basisDocument`}
        value={basisDocumentUuid}
        displayValue={basisDocumentLabel}
        endpoint={activeType?.endpoint ?? ""}
        displayField="id"
        getSuggestionLabel={(item) =>
          `${activeType?.label ?? ""}: ID ${item.id} · ${getFormatDateOnly(item.date) ?? ""}`
        }
        columns={[
          { key: "id", label: "ID" },
          { key: "name", label: "Документ" },
          { key: "date", label: translate("date") },
        ]}
        onSelect={handleSelect}
        onClear={onClear}
        disabled={disabled || !activeType}
        variant="default"
        searchTransform={extractBasisSearch}
      />
    );
  }

  // Когда значения ещё нет — показываем селектор типа + LookupField
  return (
    <LookupField
      label={activeType?.label ? `${translate("basisDocument")} (${activeType.label})` : translate("basisDocument")}
      name={`${formUid}_basisDocument`}
      value={undefined}
      displayValue={undefined}
      endpoint={activeType?.endpoint ?? ""}
      displayField="id"
      getSuggestionLabel={(item) =>
        `${activeType?.label ?? ""}: ID ${item.id} · ${getFormatDateOnly(item.date) ?? ""}`
      }
      columns={[
        { key: "id", label: "ID" },
        { key: "name", label: "Документ" },
        { key: "date", label: translate("date") },
      ]}
      secondaryFields={["name", "counterparty.name", "documentNumber"]}
      onSelect={handleSelect}
      disabled={disabled || !activeType}
      // visibleActions={[]}
      searchTransform={extractBasisSearch}
    />
  );
};

export default BasisDocumentField;

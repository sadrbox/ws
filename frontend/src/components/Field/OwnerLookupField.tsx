import { FC, useCallback, useMemo } from "react";
import LookupField from "./LookupField";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type OwnerType = "organization" | "counterparty" | "contactperson" | "";

export interface OwnerData {
  ownerType: OwnerType;
  ownerUuid: string;
  ownerName: string;
}

export interface OwnerLookupFieldProps {
  /** Текущее значение владельца */
  ownerType: OwnerType;
  ownerUuid: string;
  ownerName: string;
  /** Колбэк при изменении владельца */
  onOwnerChange: (data: OwnerData) => void;
  /** Заблокировано */
  disabled?: boolean;
  /** Имя для id/name полей */
  name: string;
  /** Минимальная ширина */
  minWidth?: string;
  /** Тип зафиксирован (при создании из владельца или при редактировании) */
  typeLocked?: boolean;
  /** Допустимые типы владельца (по умолчанию все) */
  allowedTypes?: OwnerType[];
}

// ═══════════════════════════════════════════════════════════════════════════

const ALL_OWNER_TYPES: { value: OwnerType; label: string }[] = [
  { value: "organization", label: "Организация" },
  { value: "counterparty", label: "Контрагент" },
  { value: "contactperson", label: "Контактное лицо" },
];

const OWNER_ENDPOINT_MAP: Record<string, string> = {
  organization: "organizations",
  counterparty: "counterparties",
  contactperson: "contactpersons",
};

const OWNER_TYPE_LABEL_MAP: Record<string, string> = {
  organization: "Организация",
  counterparty: "Контрагент",
  contactperson: "Контактное лицо",
};

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

const OwnerLookupField: FC<OwnerLookupFieldProps> = ({
  ownerType,
  ownerUuid,
  ownerName,
  onOwnerChange,
  disabled = false,
  name,
  minWidth = "300px",
  typeLocked = false,
  allowedTypes,
}) => {
  const typeOptions = useMemo(() => {
    if (!allowedTypes || allowedTypes.length === 0) return ALL_OWNER_TYPES;
    return ALL_OWNER_TYPES.filter(o => allowedTypes.includes(o.value));
  }, [allowedTypes]);

  const handleTypeChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const newType = e.target.value as OwnerType;
    onOwnerChange({ ownerType: newType, ownerUuid: "", ownerName: "" });
  }, [onOwnerChange]);

  const handleOwnerSelect = useCallback((uuid: string, display: string) => {
    onOwnerChange({ ownerType, ownerUuid: uuid, ownerName: display });
  }, [onOwnerChange, ownerType]);

  const handleClear = useCallback(() => {
    if (typeLocked) {
      onOwnerChange({ ownerType, ownerUuid: "", ownerName: "" });
    } else {
      onOwnerChange({ ownerType: "", ownerUuid: "", ownerName: "" });
    }
  }, [onOwnerChange, ownerType, typeLocked]);

  const currentType = ownerType || (typeOptions.length === 1 ? typeOptions[0].value : "");
  const typeLabel = OWNER_TYPE_LABEL_MAP[currentType] || "Владелец";

  // Определяем label: если тип зафиксирован или выбран — "Владелец (Тип)", иначе select в label
  const labelContent = useMemo(() => {
    if (typeLocked && ownerType) {
      return `Владелец (${typeLabel})`;
    }
    return null; // будет рендериться кастомный label с select
  }, [typeLocked, ownerType, typeLabel]);

  const endpoint = OWNER_ENDPOINT_MAP[currentType] || "organizations";
  const displayField = currentType === "contactperson" ? "fullName" : "shortName";
  const columns = currentType === "contactperson"
    ? [{ key: "fullName", label: "ФИО" }]
    : [{ key: "shortName", label: "Наименование" }, { key: "bin", label: "БИН" }];

  // Если тип зафиксирован — простой LookupField
  if (labelContent) {
    return (
      <LookupField
        label={labelContent}
        name={name}
        minWidth={minWidth}
        value={ownerUuid}
        displayValue={ownerName}
        endpoint={endpoint}
        displayField={displayField}
        columns={columns}
        onSelect={handleOwnerSelect}
        onClear={handleClear}
        disabled={disabled}
      />
    );
  }

  // Иначе — комбинированное поле: select типа в лэйбле + LookupField
  const selectLabel = (
    <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
      <span>Владелец</span>
      {typeOptions.length > 1 && (
        <select
          value={currentType}
          onChange={handleTypeChange}
          disabled={disabled}
          style={{
            border: "none",
            background: "transparent",
            fontSize: "inherit",
            fontFamily: "inherit",
            color: "#555",
            cursor: disabled ? "default" : "pointer",
            padding: "0 2px",
            outline: "none",
          }}
        >
          <option value="">— тип —</option>
          {typeOptions.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      )}
    </span>
  );

  return (
    <LookupField
      label={selectLabel}
      name={name}
      minWidth={minWidth}
      value={currentType ? ownerUuid : ""}
      displayValue={currentType ? ownerName : ""}
      endpoint={currentType ? endpoint : "organizations"}
      displayField={displayField}
      columns={columns}
      onSelect={handleOwnerSelect}
      onClear={handleClear}
      disabled={disabled || !currentType}
      placeholder={currentType ? "Выберите..." : "Выберите тип владельца..."}
    />
  );
};

export default OwnerLookupField;

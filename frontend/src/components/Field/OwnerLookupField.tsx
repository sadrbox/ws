import { FC, useCallback, useMemo } from "react";
import styles from "./Field.module.scss";
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
}

// ═══════════════════════════════════════════════════════════════════════════

const OWNER_TYPE_OPTIONS: { value: OwnerType; label: string }[] = [
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
  minWidth = "339px",
  typeLocked = false,
}) => {
  // Если тип не выбран и не заблокирован — показываем селектор типа
  const showTypeSelector = !ownerType && !typeLocked;

  const handleTypeSelect = useCallback((type: OwnerType) => {
    onOwnerChange({ ownerType: type, ownerUuid: "", ownerName: "" });
  }, [onOwnerChange]);

  const handleOwnerSelect = useCallback((uuid: string, display: string) => {
    onOwnerChange({ ownerType, ownerUuid: uuid, ownerName: display });
  }, [onOwnerChange, ownerType]);

  const handleClear = useCallback(() => {
    if (typeLocked) {
      // При заблокированном типе — только очистить выбранного владельца
      onOwnerChange({ ownerType, ownerUuid: "", ownerName: "" });
    } else {
      // Полная очистка: сбросить и тип, и выбранное значение
      onOwnerChange({ ownerType: "", ownerUuid: "", ownerName: "" });
    }
  }, [onOwnerChange, ownerType, typeLocked]);

  const typeLabel = useMemo(() => OWNER_TYPE_LABEL_MAP[ownerType] || "Владелец", [ownerType]);

  if (showTypeSelector) {
    return (
      <div
        className={styles.FieldWrapper}
        style={{ minWidth }}
      >
        <label className={styles.FieldLabel}>Владелец</label>
        <div style={{ display: "flex", gap: "6px" }}>
          {OWNER_TYPE_OPTIONS.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => handleTypeSelect(opt.value)}
              disabled={disabled}
              style={{
                padding: "4px 12px",
                border: "1px solid #ccc",
                borderRadius: "3px",
                background: "#fff",
                cursor: disabled ? "default" : "pointer",
                fontSize: "13px",
                color: "#333",
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  const endpoint = OWNER_ENDPOINT_MAP[ownerType] || "organizations";
  const displayField = ownerType === "contactperson" ? "fullName" : "shortName";
  const columns = ownerType === "contactperson"
    ? [{ key: "fullName", label: "ФИО" }, { key: "position", label: "Должность" }]
    : [{ key: "shortName", label: "Наименование" }, { key: "bin", label: "БИН" }];

  return (
    <LookupField
      label={`Владелец (${typeLabel})`}
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
};

export default OwnerLookupField;

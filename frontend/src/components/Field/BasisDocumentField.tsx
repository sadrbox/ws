import { FC, useCallback, useEffect, useMemo, useState } from "react";
import LookupField from "./LookupField";
import FieldActionButton from "./FieldActionButton";
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
      const label = `${activeType.label} _#_#${item.id} · ${getFormatDateOnly(item.date) ?? ""}`;
      onSelect(activeType.type, item.uuid, label);
    },
    [activeType, onSelect],
  );

  const hasValue = !!basisDocumentUuid;
  const showTypeSelect = allowedTypes.length > 1 && !hasValue;

  return (
    <div className={styles.BasisWrapper}>
      <label className={styles.FieldLabel}>{translate("basisDocument")}</label>

      <div className={styles.FieldInputWrapper}>
        {hasValue ? (
          <>
            <span className={styles.BasisValue}>{basisDocumentLabel || basisDocumentUuid}</span>
            <FieldActionButton
              icon="clear"
              label={translate("clear") || "Очистить"}
              onClick={onClear}
              disabled={disabled}
            />
          </>
        ) : (
          <>
            {showTypeSelect && (
              <select
                className={`${styles.FieldSelect} ${styles.BasisTypeSelect}`}
                value={selectedType}
                onChange={handleTypeChange}
                disabled={disabled}
              >
                {allowedTypes.map((t) => (
                  <option key={t.type} value={t.type}>
                    {t.label}
                  </option>
                ))}
              </select>
            )}
            <LookupField
              name={`${formUid}_basisDocument`}
              value={undefined}
              displayValue={undefined}
              endpoint={activeType?.endpoint ?? ""}
              displayField="id"
              columns={[
                { key: "id", label: "№" },
                { key: "date", label: translate("date") },
              ]}
              onSelect={handleSelect}
              disabled={disabled || !activeType}
              visibleActions={[]}
              variant="table"
            />
          </>
        )}
      </div>
    </div>
  );
};

export default BasisDocumentField;

import { FC, useEffect, useState } from "react";
import LookupField from "./LookupField";
import { translate } from "src/i18";
import { getFormatDateOnly } from "src/utils/main.module";

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
    if (basisDocumentType) setSelectedType(basisDocumentType);
  }, [basisDocumentType]);

  const activeType = allowedTypes.find((t) => t.type === selectedType) ?? allowedTypes[0];

  const handleSelect = (_uuid: string, _display: string, item: Record<string, any>) => {
    if (!activeType) return;
    const label = `${activeType.label} #${item.id} · ${getFormatDateOnly(item.date) ?? ""}`;
    onSelect(activeType.type, item.uuid, label);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: "var(--fontsize, 13px)", whiteSpace: "nowrap", color: "var(--color6)" }}>
          {translate("basisDocument")}
        </span>
        {basisDocumentUuid && (
          <button
            type="button"
            onClick={onClear}
            disabled={disabled}
            style={{ fontSize: 11, lineHeight: 1, padding: "1px 6px", cursor: "pointer", border: "1px solid #ccc", borderRadius: 3, background: "#fff" }}
            title="Очистить основание"
          >
            ×
          </button>
        )}
      </div>

      {allowedTypes.length > 1 && !basisDocumentUuid && (
        <select
          value={selectedType}
          onChange={(e) => setSelectedType(e.target.value)}
          disabled={disabled}
          style={{ fontSize: "var(--fontsize, 13px)", border: "1px solid var(--color5)", borderRadius: "var(--radius2)", padding: "0 4px", height: 26 }}
        >
          {allowedTypes.map((t) => (
            <option key={t.type} value={t.type}>{t.label}</option>
          ))}
        </select>
      )}

      {basisDocumentUuid ? (
        <div style={{ fontSize: "var(--fontsize, 13px)", padding: "2px 6px", border: "1px solid var(--color5)", borderRadius: "var(--radius2)", background: "var(--color31)", minHeight: 26, display: "flex", alignItems: "center" }}>
          {basisDocumentLabel || basisDocumentUuid}
        </div>
      ) : (
        <LookupField
          name={`${formUid}_basisDocument`}
          value={undefined}
          displayValue={undefined}
          endpoint={activeType?.endpoint ?? ""}
          displayField="id"
          columns={[{ key: "id", label: "№" }, { key: "date", label: translate("date") }]}
          onSelect={handleSelect}
          disabled={disabled || !activeType}
          visibleActions={[]}
        />
      )}
    </div>
  );
};

export default BasisDocumentField;

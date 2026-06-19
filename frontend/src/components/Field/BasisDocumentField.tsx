import { FC, useCallback, useEffect, useMemo, useState } from "react";
import LookupField from "./LookupField";
import { translate } from "src/i18";
import { getFormatDateOnly } from "src/utils/datetime";
import { docTypeLabel, docTypeToEndpoint } from "src/utils/accountingDocTypes";
import { api } from "src/services/api/client";
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
  /** Подсказка о корректности заполнения документа. Показывается в месте
   *  «предупреждения» о расхождении, когда самого расхождения нет (mismatch=false). */
  hint?: string;
}

/**
 * Поле «Основание» фильтруется по ВИДИМОЙ метке («{Тип}: ID {n} · {дата}»)
 * на клиенте. Серверный поиск тут не годится:
 *   • бэкенд не ищет по переведённому названию типа («Коммерческое предложение»);
 *   • числовой поиск делает `id EQUALS`, поэтому «ID 1» не находит id 113/115/…
 *     (подстрока по числовому id невозможна).
 * Возврат "" заставляет LookupField загрузить записи и отфильтровать их по
 * getSuggestionLabel — тогда «ID 15» находит 150–159, «ID 1» — все с «1» и т.д.
 */
const extractBasisSearch = (): string => "";

/**
 * Метка документа-основания: «{Тип}: №{number} · {дата}». Если номер документа
 * не задан — фолбэк на «ID {id}». Независимо от типа/вида документа.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const basisItemLabel = (name: string, item: Record<string, any>): string => {
  const num = item.number ?? item.documentNumber;
  const ref = num != null && String(num).trim() !== "" ? `№${num}` : `ID ${item.id}`;
  return `${name}: ${ref} · ${getFormatDateOnly(item.date) ?? ""}`;
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
  mismatch,
  mismatchDetails,
  hint,
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
    // Если основание уже выбрано — смена типа сбрасывает значение
    // (выбранный документ был другого типа).
    if (basisDocumentUuid) onClear();
  }, [basisDocumentUuid, onClear]);

  // Локализованное название типа документа: пользовательский label из конфига
  // (если задан) либо единое i18-название по коду типа (docTypeLabel).
  const nameForType = useCallback(
    (type?: string, cfg?: BasisTypeConfig) =>
      (cfg && cfg.type === type && cfg.label) || docTypeLabel(type ?? ""),
    [],
  );

  // Нормализация отображения основания. Если сохранённая метка не в каноническом
  // виде «{Тип}: ID {n} · {дата}» (напр. данные генератора «payment_invoice #165»),
  // подтягиваем документ-основание по uuid и собираем корректную метку.
  const [resolvedLabel, setResolvedLabel] = useState<string | undefined>(undefined);
  useEffect(() => {
    const isCanonical = !!basisDocumentLabel && /:\s*(?:ID\s+\d+|№\S+)/i.test(basisDocumentLabel);
    const type = basisDocumentType || "";
    const endpoint = allowedTypes.find((t) => t.type === type)?.endpoint ?? docTypeToEndpoint(type);
    if (!basisDocumentUuid || !type || !endpoint || isCanonical) {
      setResolvedLabel(undefined);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const resp = await api.get<any>(`${endpoint}/${basisDocumentUuid}`);
        const item = resp?.item ?? resp;
        if (!cancelled && item) {
          const name = nameForType(type, allowedTypes.find((t) => t.type === type));
          setResolvedLabel(basisItemLabel(name, item));
        }
      } catch {
        /* недоступно — оставляем исходную метку */
      }
    })();
    return () => { cancelled = true; };
  }, [basisDocumentUuid, basisDocumentType, basisDocumentLabel, allowedTypes, nameForType]);

  const handleSelect = useCallback(
    (_uuid: string, _display: string, item: Record<string, any>) => {
      if (!activeType) return;
      const label = basisItemLabel(nameForType(activeType.type, activeType), item);
      onSelect(activeType.type, item.uuid, label);
    },
    [activeType, onSelect, nameForType],
  );

  const hasValue = !!basisDocumentUuid;
  const hasMultipleTypes = allowedTypes.length > 1;

  // Селектор типа документа-основания (встроен в label поля, как в OwnerLookupField).
  // Доступен в обеих ветках: при выбранном значении смена типа сбрасывает его
  // (см. handleTypeChange) и переводит поле в режим выбора нового документа.
  const typeSelectLabel = (
    <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
      <span>{translate("basisDocument")}</span>
      <select
        id={`${formUid}_basisType`}
        name={`${formUid}_basisType`}
        aria-label={translate("basisDocument")}
        value={selectedType}
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
        {allowedTypes.map((t) => (
          <option key={t.type} value={t.type}>{nameForType(t.type, t)}</option>
        ))}
      </select>
    </span>
  );

  const columns = [
    { key: "id", label: "ID" },
    { key: "name", label: translate("document") },
    { key: "date", label: translate("date") },
  ];

  // Примечание под полем. Слот рендерится ВСЕГДА (с зарезервированной высотой —
  // см. .FieldNote*), чтобы появление/скрытие не сдвигало разметку. Приоритет:
  //   1) «предупреждение» о расхождении документа с основанием (красное);
  //   2) подсказка о незаполненных обязательных полях (янтарная), если передана;
  //   3) когда всё заполнено (hint === "") — нейтральное «Обязательные поля
  //      заполнены»; если подсказка не передана (hint === undefined) — пустой
  //      зарезервированный слот.
  const note = mismatch ? (
    <div className={styles.FieldNote} title={(mismatchDetails ?? []).join(", ")}>
      ⚠ {translate("basisMismatch")}
      {mismatchDetails && mismatchDetails.length > 0 ? `: ${mismatchDetails.join(", ")}` : ""}
    </div>
  ) : hint ? (
    <div className={styles.FieldNoteHint}>{hint}</div>
  ) : (
    <div className={styles.FieldNoteOk}>
      {hint === "" ? `✓ ${translate("requiredFieldsFilled")}` : " "}
    </div>
  );

  // Когда значение уже выбрано — отдаём управление LookupField (он сам рисует FieldWrapper + label).
  // Тип документа берём из basisDocumentType (надёжно даже вне allowedTypes).
  if (hasValue) {
    const valueType = basisDocumentType || activeType?.type || "";
    const typeName = nameForType(valueType, activeType);
    return (
      <div className={styles.BasisFieldWrapper}>
        <LookupField
          label={hasMultipleTypes ? typeSelectLabel : `${translate("basisDocument")} (${typeName})`}
          name={`${formUid}_basisDocument`}
          value={basisDocumentUuid}
          displayValue={resolvedLabel ?? basisDocumentLabel}
          endpoint={activeType?.endpoint ?? docTypeToEndpoint(valueType) ?? ""}
          displayField="id"
          getSuggestionLabel={(item) => basisItemLabel(typeName, item)}
          columns={columns}
          secondaryFields={["name", "counterparty.name", "documentNumber"]}
          postedIndicator
          onSelect={handleSelect}
          onClear={onClear}
          disabled={disabled || !activeType}
          variant="default"
          searchTransform={extractBasisSearch}
        />
        {note}
      </div>
    );
  }

  // Когда значения ещё нет — показываем селектор типа (если основанием может быть
  // несколько типов документов) + LookupField. Селектор встроен в label поля —
  // аналогично OwnerLookupField.
  const newTypeName = nameForType(activeType?.type ?? selectedType, activeType);
  const labelNode = hasMultipleTypes
    ? typeSelectLabel
    : `${translate("basisDocument")}${newTypeName ? ` (${newTypeName})` : ""}`;
  return (
    <div className={styles.BasisFieldWrapper}>
      <LookupField
        label={labelNode}
        name={`${formUid}_basisDocument`}
        value={undefined}
        displayValue={undefined}
        endpoint={activeType?.endpoint ?? ""}
        displayField="id"
        getSuggestionLabel={(item) => basisItemLabel(newTypeName, item)}
        columns={columns}
        secondaryFields={["name", "counterparty.name", "documentNumber"]}
        onSelect={handleSelect}
        disabled={disabled || !activeType}
        searchTransform={extractBasisSearch}
      />
      {note}
    </div>
  );
};

export default BasisDocumentField;

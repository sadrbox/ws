import { FC, useCallback, useEffect, useMemo, useState } from "react";
import { asText } from "src/utils/asText";
import LookupField, { type LookupExtraAction } from "./LookupField";
import { translate } from "src/i18";
import { getFormatDateOnly } from "src/utils/datetime";
import { docTypeLabel, docTypeToEndpoint, docTypeUsesPosted } from "src/utils/accountingDocTypes";
import { api } from "src/services/api/client";
import { onLiveEvent } from "src/services/liveEvents";
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
  /**
   * Действие «Перезаполнить по основанию» — кнопкой ВНУТРИ поля (раньше жило в
   * тулбаре пейна, рядом с «Удалить»/«Печать», хотя относится ровно к этому полю).
   * Показывается, только когда основание выбрано. Перезаполнение перетирает
   * введённые данные, поэтому владелец обязан спросить подтверждение —
   * см. useRefillAction.
   */
  onRefill?: () => void;
  /** Перезаполнение выполняется — спиннер вместо иконки. */
  refilling?: boolean;
  disabled?: boolean;
  formUid: string;
  /**
   * Организация документа. Ограничивает подбор основания её документами —
   * во ВСЕХ трёх режимах лукапа (выбор из списка, быстрый выбор, автокомплит),
   * т.к. LookupField прокидывает extraParams во все запросы.
   * Не задана → фильтра нет (показываем все доступные пользователю документы).
   */
  organizationUuid?: string;
  /** Контекст для ПРЕДЗАПОЛНЕНИЯ формы нового документа-основания при «Создать
   *  новый» (в отличие от фильтра по организации выше). Имена нужны, чтобы поля-
   *  лукапы новой формы показывали текст, а не только uuid. */
  organizationName?: string;
  counterpartyUuid?: string;
  counterpartyName?: string;
  warehouseUuid?: string;
  warehouseName?: string;
  /** Документ-основание не совпадает с текущим (организация/контрагент/строки). */
  mismatch?: boolean;
  /** Перечень расхождений с основанием (для подсказки). */
  mismatchDetails?: string[];
  /** Подсказка о корректности заполнения документа. Показывается в месте
   *  «предупреждения» о расхождении, когда самого расхождения нет (mismatch=false). */
  hint?: string;
}

/**
 * Поле «Основание» фильтруется по ВИДИМОЙ метке («{Тип}: ID {n} - {дата}»)
 * на клиенте. Серверный поиск тут не годится:
 *   • бэкенд не ищет по переведённому названию типа («Коммерческое предложение»);
 *   • числовой поиск делает `id EQUALS`, поэтому «ID 1» не находит id 113/115/…
 *     (подстрока по числовому id невозможна).
 * Возврат "" заставляет LookupField загрузить записи и отфильтровать их по
 * getSuggestionLabel — тогда «ID 15» находит 150–159, «ID 1» — все с «1» и т.д.
 */
const extractBasisSearch = (): string => "";

/**
 * Метка документа-основания: «{Тип}: №{number} - {дата}». Если номер документа
 * не задан — фолбэк на «ID {id}». Независимо от типа/вида документа.
 */
const basisItemLabel = (name: string, item: Record<string, unknown>): string => {
  const num = item.number ?? item.documentNumber;
  const ref = num != null && asText(num).trim() !== "" ? `№${asText(num)}` : translate("docNoNumber");
  return `${name}: ${ref} - ${getFormatDateOnly(asText(item.date)) ?? ""}`;
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
  organizationUuid,
  organizationName,
  counterpartyUuid,
  counterpartyName,
  warehouseUuid,
  warehouseName,
  mismatch,
  mismatchDetails,
  onRefill,
  refilling,
}) => {
  const [selectedType, setSelectedType] = useState<string>(
    basisDocumentType || allowedTypes[0]?.type || "",
  );

  // Подбор основания — только документы организации, выбранной в форме.
  // Используем общий фильтр списков `filter[поле][equals]` (его поддерживают все
  // роутеры-источники основания), а не отдельный query-параметр: тогда не нужно
  // добавлять `organizationUuid` в каждый из ~11 роутеров.
  const extraParams = useMemo(
    () => (organizationUuid ? { "filter[organizationUuid][equals]": organizationUuid } : undefined),
    [organizationUuid],
  );

  // Предзаполнение формы НОВОГО документа-основания («Создать новый» в лукапе):
  // организация + контрагент этого документа. Общий мёрж useFormStore перенесёт
  // лишь те ключи, что есть в defaultFields целевой формы, поэтому передавать оба
  // безопасно даже для типов основания без контрагента.
  const createDefaults = useMemo(() => {
    const d: Record<string, unknown> = {};
    if (organizationUuid) { d.organizationUuid = organizationUuid; if (organizationName) d.organizationName = organizationName; }
    if (counterpartyUuid) { d.counterpartyUuid = counterpartyUuid; if (counterpartyName) d.counterpartyName = counterpartyName; }
    if (warehouseUuid) { d.warehouseUuid = warehouseUuid; if (warehouseName) d.warehouseName = warehouseName; }
    return Object.keys(d).length ? d : undefined;
  }, [organizationUuid, organizationName, counterpartyUuid, counterpartyName, warehouseUuid, warehouseName]);

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
  // виде «{Тип}: ID {n} - {дата}» (напр. данные генератора «payment_invoice #165»),
  // подтягиваем документ-основание по uuid и собираем корректную метку.
  const [resolvedLabel, setResolvedLabel] = useState<string | undefined>(undefined);
  // E4: живое обновление подписи, когда документ-основание получает номер в другой
  // панели («б/н» → «№…»). Инкремент форсирует перерезолв даже для канонической метки.
  const [refreshTick, setRefreshTick] = useState(0);
  useEffect(
    () => onLiveEvent("docnumber", (ev) => {
      if ((ev as { uuid?: string }).uuid === basisDocumentUuid) setRefreshTick((t) => t + 1);
    }),
    [basisDocumentUuid],
  );
  useEffect(() => {
    // Каноничны только ФИНАЛЬНЫЕ формы метки — «№…» и «б/н» (docNoNumber). Любую
    // иную (легаси «ID {n}», данные генератора и т.п.) перерезолвим по документу,
    // чтобы показать № или «б/н» — у документов ID в UI не светим. При live-событии
    // (refreshTick>0) перерезолвим и каноническую «б/н» — она могла стать «№…».
    const isCanonical = !!basisDocumentLabel &&
      (/:\s*№/.test(basisDocumentLabel) || basisDocumentLabel.includes(translate("docNoNumber")));
    const type = basisDocumentType || "";
    const endpoint = allowedTypes.find((t) => t.type === type)?.endpoint ?? docTypeToEndpoint(type);
    if (!basisDocumentUuid || !type || !endpoint || (isCanonical && refreshTick === 0)) {
      setResolvedLabel(undefined);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const resp = await api.get<{ item?: Record<string, unknown> } & Record<string, unknown>>(`${endpoint}/${basisDocumentUuid}`);
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
  }, [basisDocumentUuid, basisDocumentType, basisDocumentLabel, allowedTypes, nameForType, refreshTick]);

  const handleSelect = useCallback(
    (_uuid: string, _display: string, item: Record<string, unknown>) => {
      if (!activeType) return;
      const label = basisItemLabel(nameForType(activeType.type, activeType), item);
      onSelect(activeType.type, item.uuid as string, label);
    },
    [activeType, onSelect, nameForType],
  );

  const hasValue = !!basisDocumentUuid;
  const hasMultipleTypes = allowedTypes.length > 1;

  // Отображаемая метка: перерезолвленная (№/б/н) или исходная, но НИКОГДА не показываем
  // сырой «ID {n}» — на время перерезолва подменяем на «б/н» (документы ID не светят).
  const displayLabel = resolvedLabel ?? (basisDocumentLabel
    ? basisDocumentLabel.replace(/(:\s*)ID\b\s*\S*/i, `$1${translate("docNoNumber")}`)
    : basisDocumentLabel);

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
          color: "var(--text-secondary)",
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
  // Расхождение с основанием (mismatch/mismatchDetails) выводится на уровне формы
  // в компоненте <Notice /> и индикатором на кнопке «Перезаполнить по основанию»
  // — она же живёт в ряду действий этого поля (см. refillActions ниже).

  // Действие «Перезаполнить по основанию» в ряду кнопок поля. Подсказка при
  // расхождении перечисляет конкретные различия — по кнопке сразу видно, ЧТО
  // разошлось, и это видно у самого поля-источника, а не в шапке пейна.
  const refillActions = useMemo<LookupExtraAction[] | undefined>(() => {
    if (!onRefill) return undefined;
    const base = "Перезаполнить по основанию";
    return [{
      id: "refill",
      icon: "syncFromBasis",
      label: mismatch
        ? `${translate("basisMismatch")}:\n• ${(mismatchDetails ?? []).join("\n• ")}\n\n${base}`
        : base,
      onClick: onRefill,
      disabled: disabled || refilling,
      loading: refilling,
      tone: mismatch ? "warn" : undefined,
    }];
  }, [onRefill, mismatch, mismatchDetails, refilling, disabled]);

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
          displayValue={displayLabel}
          endpoint={activeType?.endpoint ?? docTypeToEndpoint(valueType) ?? ""}
          displayField="id"
          getSuggestionLabel={(item) => basisItemLabel(typeName, item)}
          columns={columns}
          secondaryFields={["name", "counterparty.name", "documentNumber"]}
          postedIndicator={docTypeUsesPosted(valueType)}
          onSelect={handleSelect}
          onClear={onClear}
          disabled={disabled || !activeType}
          extraActions={refillActions}
          variant="default"
          searchTransform={extractBasisSearch}
          extraParams={extraParams}
          createDefaults={createDefaults}
        />
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
        postedIndicator={docTypeUsesPosted(activeType?.type ?? selectedType)}
        onSelect={handleSelect}
        disabled={disabled || !activeType}
        searchTransform={extractBasisSearch}
        extraParams={extraParams}
        createDefaults={createDefaults}
      />
    </div>
  );
};

export default BasisDocumentField;

import { FC, useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import type { TDataItem, TColumn } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import LookupField from "src/components/Field/LookupField";
import { FieldDate } from "src/components/Field";
import { FieldNumber } from "src/components/Field";
import { GroupRow } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import { useFormStore } from "src/hooks/useFormStore";
import { useAccessRight } from "src/hooks/useAccessRight";
import useOrgAccountingUsageStats from "src/hooks/useOrgAccountingUsageStats";
import { makePaneLabel } from "src/utils/buildPaneLabel";
import ModelForm from "src/components/ModelForm";
import ModelList from "src/components/ModelList";

const MODEL_ENDPOINT = "organization-accounting-settings";
const LIST_NAME = "OrganizationAccountingSettingsList";

interface TFields {
  id?: number;
  uuid?: string;
  organizationUuid: string | null;
  organizationName: string;
  /** Дата начала действия настроек (ISO yyyy-mm-dd для input). */
  startDate: string;
  /** Учитывать ли НДС в строках документов продажи. */
  useVat: boolean;
  /** Ставка НДС, % (ввод как строка). */
  vatRate: string;
  /** Способ расчёта НДС: INCLUDED — в сумме; ADDED — сверху. */
  vatCalculationMethod: "INCLUDED" | "ADDED";
  /** Включить колонки скидок в SaleItemsTable. */
  useDiscount: boolean;
  /** Включить колонки акциза в SaleItemsTable (НК РК ст. 463). */
  useExcise: boolean;
  /** Ставка акциза по умолчанию, % (ввод в форме как строка). */
  exciseRate: string;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

const DEFAULT_FIELDS: TFields = {
  organizationUuid: null,
  organizationName: "",
  startDate: todayIso(),
  useVat: false,
  vatRate: "12",
  vatCalculationMethod: "INCLUDED",
  useDiscount: false,
  useExcise: false,
  exciseRate: "0",
};

// ─────────────────────────────────────────────────────────────────────────
// Форма «Настройки учёта организации»: организация (LookupField), дата
// начала действия, переключатели «Использовать НДС» и «Использовать скидки»,
// числовая ставка НДС и способ расчёта (сверху / в сумме) — активны только при useVat.
// Справочник «Ставки НДС» удалён — согласно НК РК ставка НДС одна на организацию
// на дату.
// При сохранении создаётся новая запись журнала; старая для этой организации
// помечается deletedAt.
// ─────────────────────────────────────────────────────────────────────────
const OrganizationAccountingSettingsForm: FC<Partial<TPane>> = (paneProps) => {
  const { canWrite } = useAccessRight("OrganizationAccountingSetting");
  const queryClient = useQueryClient();

  const form = useFormStore<TFields>({
    endpoint: MODEL_ENDPOINT,
    storageKey: "organization-accounting-settings-form",
    defaultFields: DEFAULT_FIELDS,
    paneProps,
    mapServerToForm: (d, prev) => ({
      ...(prev ?? DEFAULT_FIELDS),
      ...d,
      organizationUuid: (d.organizationUuid as string) ?? null,
      organizationName:
        (d.organization as { shortName?: string } | null)?.shortName ?? "",
      startDate:
        typeof d.startDate === "string" && d.startDate
          ? String(d.startDate).slice(0, 10)
          : todayIso(),
      useVat: Boolean(d.useVat),
      vatRate:
        d.vatRate != null && d.vatRate !== "" ? String(d.vatRate) : "12",
      vatCalculationMethod:
        String(d.vatCalculationMethod ?? "INCLUDED").toUpperCase() === "ADDED"
          ? "ADDED"
          : "INCLUDED",
      useDiscount: Boolean(d.useDiscount),
      useExcise: Boolean(d.useExcise),
      exciseRate:
        d.exciseRate != null && d.exciseRate !== ""
          ? String(d.exciseRate)
          : "0",
    }),
    buildPayload: (fd) => {
      const vatRateNum =
        fd.vatRate === "" || fd.vatRate == null ? 12 : Number(fd.vatRate);
      if (
        fd.useVat &&
        (!Number.isFinite(vatRateNum) || vatRateNum < 0 || vatRateNum > 100)
      )
        return "Ставка НДС должна быть от 0 до 100% (НК РК ст. 422; стандарт 12%)";
      const exciseRateNum =
        fd.exciseRate === "" || fd.exciseRate == null
          ? 0
          : Number(fd.exciseRate);
      if (fd.useExcise && (!Number.isFinite(exciseRateNum) || exciseRateNum < 0))
        return "Некорректная ставка акциза";
      return {
        organizationUuid: fd.organizationUuid || null,
        startDate: fd.startDate || todayIso(),
        useVat: Boolean(fd.useVat),
        vatRate: fd.useVat ? vatRateNum : 0,
        vatCalculationMethod: fd.vatCalculationMethod ?? "INCLUDED",
        useDiscount: Boolean(fd.useDiscount),
        useExcise: Boolean(fd.useExcise),
        exciseRate: fd.useExcise ? exciseRateNum : 0,
      };
    },
    buildPaneLabel: (saved) => {
      const orgName = (saved as { organization?: { shortName?: string } } | null)
        ?.organization?.shortName;
      return makePaneLabel(
        LIST_NAME,
        "Настройки учёта организации",
        saved,
        orgName ?? "Глобальные",
      );
    },
    afterSave: () => {
      // Сбрасываем кэш активных настроек, чтобы SaleItemsTable
      // и др. подписчики useOrgAccountingSettings немедленно
      // увидели новое состояние НДС/скидок.
      void queryClient.invalidateQueries({
        queryKey: ["organization-accounting-settings", "active"],
      });
    },
  });

  // Статистика использования НДС/скидок/акциза в проведённых документах.
  // Если хотя бы один проведённый sale_item фактически использует НДС
  // (vatRate>0), скидку (сумма/%>0) или акциз (сумма/%>0) — соответствующий
  // переключатель в форме блокируется ПОЛНОСТЬЮ (в обе стороны: и
  // включить, и отключить нельзя), чтобы изменение настроек не повлияло
  // на уже проведённые документы и расчёты ЭСФ РК остались корректными.
  // Бэкенд дополнительно выполняет ту же проверку на POST/PUT (HTTP 409).
  const { stats: usageStats } = useOrgAccountingUsageStats(
    form.fields.organizationUuid,
  );
  const lockVat = usageStats.hasPostedVat;
  const lockDiscount = usageStats.hasPostedDiscount;
  const lockExcise = usageStats.hasPostedExcise;

  const tabs = useMemo(
    () => [
      {
        id: "general",
        label: translate("general"),
        component: (
          <div className={styles.FormWrapper}>
            <div className={styles.Form}>
              <GroupRow>
                <LookupField
                  label="Организация"
                  name={`${form.formUid}_org`}
                  value={form.fields.organizationUuid ?? ""}
                  displayValue={form.fields.organizationName}
                  endpoint="organizations"
                  displayField="shortName"
                  columns={[
                    { key: "shortName", label: "Краткое имя" },
                    { key: "bin", label: "БИН" },
                  ]}
                  onSelect={(uuid, display) =>
                    form.setFields({
                      organizationUuid: uuid,
                      organizationName: display,
                    })
                  }
                  onClear={() =>
                    form.setFields({ organizationUuid: null, organizationName: "" })
                  }
                  disabled={form.isLoading || !canWrite}
                  width="320px"
                />
                <FieldDate
                  label="Дата начала *"
                  name={`${form.formUid}_startDate`}
                  value={form.fields.startDate}
                  onChange={(e) => form.setField("startDate", e.target.value)}
                  disabled={form.isLoading || !canWrite}
                  minWidth="180px"
                  required
                />
                <span style={{ alignSelf: "center", fontSize: 12, color: "#6b7280" }}>
                  Если организация не выбрана — настройки считаются глобальными.
                  Дата используется для исторических запросов.
                </span>
              </GroupRow>

              <GroupRow style={{ marginTop: 12 }}>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 10px",
                    border: "1px solid #e5e7eb",
                    borderRadius: 6,
                    background: form.fields.useVat ? "#eff6ff" : "#fff",
                    cursor: canWrite ? "pointer" : "default",
                    userSelect: "none",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={Boolean(form.fields.useVat)}
                    onChange={(e) => {
                      const useVat = e.target.checked;
                      form.setFields({ useVat });
                    }}
                    disabled={form.isLoading || !canWrite || lockVat}
                    title={
                      lockVat
                        ? "Нельзя изменить флаг НДС: есть проведённые документы со ставкой НДС"
                        : undefined
                    }
                  />
                  <span style={{ fontWeight: 500 }}>Использовать НДС</span>
                </label>
                <FieldNumber
                  label="Ставка НДС, %"
                  name={`${form.formUid}_vatRate`}
                  value={form.fields.vatRate ?? "12"}
                  onChange={(e) => form.setField("vatRate", e.target.value)}
                  disabled={form.isLoading || !canWrite || !form.fields.useVat || lockVat}
                  step="0.01"
                  min="0"
                  max="100"
                  width="140px"
                />
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 10px",
                    border: "1px solid #e5e7eb",
                    borderRadius: 6,
                    background: "#fff",
                    cursor: canWrite && form.fields.useVat ? "pointer" : "default",
                  }}
                >
                  <span style={{ fontSize: 12, color: "#374151" }}>Способ расчёта:</span>
                  <select
                    value={form.fields.vatCalculationMethod}
                    onChange={(e) =>
                      form.setField(
                        "vatCalculationMethod",
                        e.target.value === "ADDED" ? "ADDED" : "INCLUDED",
                      )
                    }
                    disabled={form.isLoading || !canWrite || !form.fields.useVat || lockVat}
                  >
                    <option value="INCLUDED">В сумме (в т.ч.)</option>
                    <option value="ADDED">Сверху</option>
                  </select>
                </label>
                <span style={{ alignSelf: "center", fontSize: 12, color: "#6b7280" }}>
                  НК РК: стандартная ставка НДС — 12%, расчёт «в сумме»
                  или «сверху» определяется учётной политикой организации.
                </span>
              </GroupRow>

              <GroupRow style={{ marginTop: 12 }}>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 10px",
                    border: "1px solid #e5e7eb",
                    borderRadius: 6,
                    background: form.fields.useDiscount ? "#eff6ff" : "#fff",
                    cursor: canWrite ? "pointer" : "default",
                    userSelect: "none",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={Boolean(form.fields.useDiscount)}
                    onChange={(e) => form.setField("useDiscount", e.target.checked)}
                    disabled={form.isLoading || !canWrite || lockDiscount}
                    title={
                      lockDiscount
                        ? "Нельзя изменить флаг скидок: есть проведённые документы со скидками"
                        : undefined
                    }
                  />
                  <span style={{ fontWeight: 500 }}>Использовать скидки</span>
                </label>
                <span style={{ alignSelf: "center", fontSize: 12, color: "#6b7280" }}>
                  При включении в строках документов продажи отображаются колонки
                  «Процент скидки» и «Скидка».
                </span>
              </GroupRow>

              <GroupRow style={{ marginTop: 12 }}>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 10px",
                    border: "1px solid #e5e7eb",
                    borderRadius: 6,
                    background: form.fields.useExcise ? "#eff6ff" : "#fff",
                    cursor: canWrite ? "pointer" : "default",
                    userSelect: "none",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={Boolean(form.fields.useExcise)}
                    onChange={(e) => form.setField("useExcise", e.target.checked)}
                    disabled={form.isLoading || !canWrite || lockExcise}
                    title={
                      lockExcise
                        ? "Нельзя изменить флаг акциза: есть проведённые документы с акцизом"
                        : undefined
                    }
                  />
                  <span style={{ fontWeight: 500 }}>Использовать акциз</span>
                </label>
                <span style={{ alignSelf: "center", fontSize: 12, color: "#6b7280" }}>
                  При включении в строках документов продажи отображаются колонки
                  «Ставка акциза» и «Сумма акциза» (НК РК ст. 463).
                </span>
              </GroupRow>

              <GroupRow style={{ marginTop: 12 }}>
                <FieldNumber
                  label="Ставка акциза, %"
                  name="exciseRate"
                  value={form.fields.exciseRate ?? "0"}
                  onChange={(e) => form.setField("exciseRate", e.target.value)}
                  disabled={form.isLoading || !canWrite || !form.fields.useExcise || lockExcise}
                  step="0.01"
                  min="0"
                  width="200px"
                />
                <span style={{ alignSelf: "center", fontSize: 12, color: "#6b7280" }}>
                  Подставляется в новые строки документов продажи как значение
                  по умолчанию (можно скорректировать в каждой строке).
                </span>
              </GroupRow>
            </div>
          </div>
        ),
      },
    ],
    [
      form.fields,
      form.formUid,
      form.isLoading,
      form.setField,
      form.setFields,
      canWrite,
      lockVat,
      lockDiscount,
      lockExcise,
    ],
  );

  return (
    <ModelForm
      paneId={form.paneId}
      tabs={tabs}
      onSave={form.handleSave}
      onSaveAndClose={form.handleSaveAndClose}
      onClose={form.handleClose}
      onReload={form.isEditMode ? form.handleReload : undefined}
      isLoading={form.isLoading} isInitialLoading={form.isInitialLoading}
      readonly={!canWrite}
      isDirty={form.isDirty}
    />
  );
};
OrganizationAccountingSettingsForm.displayName = "OrganizationAccountingSettingsForm";

// ─────────────────────────────────────────────────────────────────────────
// Список
// ─────────────────────────────────────────────────────────────────────────
const renderListCell = (row: TDataItem, col: TColumn) => {
  if (col.identifier === "organization.shortName") {
    const org = row.organization as { shortName?: string } | null | undefined;
    if (!org?.shortName)
      return (
        <span style={{ color: "#9ca3af", fontStyle: "italic" }}>Глобальные</span>
      );
    return <span>{org.shortName}</span>;
  }
  if (col.identifier === "vatRate") {
    const useVat = Boolean(row.useVat);
    if (!useVat) return <span style={{ color: "#9ca3af" }}>—</span>;
    const r = row.vatRate;
    return <span>{r != null ? `${r}%` : "—"}</span>;
  }
  if (col.identifier === "vatCalculationMethod") {
    const useVat = Boolean(row.useVat);
    if (!useVat) return <span style={{ color: "#9ca3af" }}>—</span>;
    const m = String(row.vatCalculationMethod ?? "INCLUDED").toUpperCase();
    return <span>{m === "ADDED" ? "Сверху" : "В сумме"}</span>;
  }
  if (col.identifier === "useVat") {
    return <span>{row.useVat ? "Да" : "Нет"}</span>;
  }
  if (col.identifier === "useDiscount") {
    return <span>{row.useDiscount ? "Да" : "Нет"}</span>;
  }
  if (col.identifier === "useExcise") {
    return <span>{row.useExcise ? "Да" : "Нет"}</span>;
  }
  if (col.identifier === "startDate") {
    const v = row.startDate as string | null | undefined;
    if (!v) return <span style={{ color: "#9ca3af" }}>—</span>;
    return <span>{String(v).slice(0, 10)}</span>;
  }
  return undefined;
};

const OrganizationAccountingSettingsList: FC<{
  variant?: TTableVariant;
  onSelectItem?: (item: TDataItem) => void;
}> = ({ variant, onSelectItem }) => {
  // При монтировании списка инвалидируем кэш «активных», чтобы SaleItemsTable
  // увидел свежие настройки сразу.
  const qc = useQueryClient();
  useEffect(() => {
    qc.invalidateQueries({
      queryKey: ["organization-accounting-settings", "active"],
    });
  }, [qc]);

  return (
    <ModelList
      endpoint={MODEL_ENDPOINT}
      listName={LIST_NAME}
      columnsJson={columnsJson}
      FormComponent={OrganizationAccountingSettingsForm}
      getLabel={(d) =>
        ((d?.organization as { shortName?: string } | null)?.shortName as string) ||
        "Глобальные"
      }
      variant={variant}
      onSelectItem={onSelectItem}
      renderCell={renderListCell}
    />
  );
};
OrganizationAccountingSettingsList.displayName = "OrganizationAccountingSettingsList";

export {
  OrganizationAccountingSettingsList,
  OrganizationAccountingSettingsForm,
};

import { FC, useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import type { TDataItem, TColumn } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import LookupField from "src/components/Field/LookupField";
import { FieldDate } from "src/components/Field";
import { GroupRow } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import { useFormStore } from "src/hooks/useFormStore";
import { useAccessRight } from "src/hooks/useAccessRight";
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
  /** UUID выбранной ставки НДС (VatRate). null — НДС не используется. */
  vatRateUuid: string | null;
  vatRateName: string;
  /** Включить колонки скидок в SaleItemsTable. */
  useDiscount: boolean;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

const DEFAULT_FIELDS: TFields = {
  organizationUuid: null,
  organizationName: "",
  startDate: todayIso(),
  useVat: false,
  vatRateUuid: null,
  vatRateName: "",
  useDiscount: false,
};

// ─────────────────────────────────────────────────────────────────────────
// Форма «Настройки учёта организации»: организация (LookupField), дата
// начала действия, переключатели «Использовать НДС» и «Использовать скидки»,
// ставка НДС (LookupField → VatRates) — активна только при useVat.
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
      vatRateUuid: (d.vatRateUuid as string | null) ?? null,
      vatRateName:
        (d.vatRateRef as { shortName?: string } | null)?.shortName ?? "",
      useDiscount: Boolean(d.useDiscount),
    }),
    buildPayload: (fd) => {
      if (fd.useVat && !fd.vatRateUuid)
        return "Выберите ставку НДС или отключите учёт НДС";
      return {
        organizationUuid: fd.organizationUuid || null,
        startDate: fd.startDate || todayIso(),
        useVat: Boolean(fd.useVat),
        vatRateUuid: fd.useVat ? fd.vatRateUuid || null : null,
        useDiscount: Boolean(fd.useDiscount),
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
                      form.setFields(
                        useVat
                          ? { useVat: true }
                          : { useVat: false, vatRateUuid: null, vatRateName: "" },
                      );
                    }}
                    disabled={form.isLoading || !canWrite}
                  />
                  <span style={{ fontWeight: 500 }}>Использовать НДС</span>
                </label>
                <LookupField
                  label="Ставка НДС"
                  name={`${form.formUid}_vatRate`}
                  value={form.fields.vatRateUuid ?? ""}
                  displayValue={form.fields.vatRateName}
                  endpoint="vat-rates"
                  displayField="shortName"
                  columns={[
                    { key: "shortName", label: "Наименование" },
                    { key: "rate", label: "Ставка, %" },
                    { key: "calculationMethod", label: "Способ расчёта" },
                  ]}
                  onSelect={(uuid, display) =>
                    form.setFields({ vatRateUuid: uuid, vatRateName: display })
                  }
                  onClear={() =>
                    form.setFields({ vatRateUuid: null, vatRateName: "" })
                  }
                  disabled={form.isLoading || !canWrite || !form.fields.useVat}
                  width="280px"
                />
                <span style={{ alignSelf: "center", fontSize: 12, color: "#6b7280" }}>
                  Способ расчёта (в сумме / сверху) определяется выбранной ставкой
                  в справочнике «Ставки НДС».
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
                    disabled={form.isLoading || !canWrite}
                  />
                  <span style={{ fontWeight: 500 }}>Использовать скидки</span>
                </label>
                <span style={{ alignSelf: "center", fontSize: 12, color: "#6b7280" }}>
                  При включении в строках документов продажи отображаются колонки
                  «Процент скидки» и «Скидка».
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
    ],
  );

  return (
    <ModelForm
      paneId={form.paneId}
      tabs={tabs}
      onSave={form.handleSave}
      onSaveAndClose={form.handleSaveAndClose}
      onClose={form.handleClose}
      onReload={form.uuid ? () => form.loadFromServer(form.uuid!) : undefined}
      isLoading={form.isLoading}
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
  if (col.identifier === "vatRateRef.shortName") {
    const useVat = Boolean(row.useVat);
    const vat = row.vatRateRef as
      | { shortName?: string; rate?: number | string }
      | null
      | undefined;
    if (!useVat) return <span style={{ color: "#9ca3af" }}>—</span>;
    if (!vat?.shortName) return <span style={{ color: "#9ca3af" }}>—</span>;
    return (
      <span>
        {vat.shortName}
        {vat.rate != null ? ` (${vat.rate}%)` : ""}
      </span>
    );
  }
  if (col.identifier === "useVat") {
    return <span>{row.useVat ? "Да" : "Нет"}</span>;
  }
  if (col.identifier === "useDiscount") {
    return <span>{row.useDiscount ? "Да" : "Нет"}</span>;
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

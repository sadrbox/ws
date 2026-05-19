/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Фабрика для кассовых ордеров (ПКО/РКО).
 * Оба документа имеют идентичную структуру — отличаются только endpoint/docType/метки.
 */
import { FC, useMemo, useCallback } from "react";
import { translate } from "src/i18";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import { Field, FieldDate } from "src/components/Field";
import FieldToggle from "src/components/Field/FieldToggle";
import LookupField from "src/components/Field/LookupField";
import { Group, GroupCol, GroupRow } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import { useFormStore } from "src/hooks/useFormStore";
import { useDefaultOrganization } from "src/hooks/useDefaultOrganization";
import { useAccessRight } from "src/hooks/useAccessRight";
import { useAutoFillPrimary } from "src/hooks/useAutoFillPrimary";
import { makeDocLabel } from "src/utils/buildPaneLabel";
import { getFormatDateOnly } from "src/utils/main.module";
import ModelForm from "src/components/ModelForm";
import ModelList from "src/components/ModelList";
import type { DocumentType } from "src/utils/validatePostedDocument";
import { validateDocumentFields, formatValidationErrors } from "src/utils/validatePostedDocument";
import { FormRequiredScope } from "src/hooks/useFormRequired";
import { renderPostedCell } from "src/models/_shared/renderPostedCell";

export interface CashOrderFormConfig {
  endpoint: string;
  listName: string;
  formLabel: string;
  storageKey: string;
  accessRightModel: string;
  docType: DocumentType;
  formDisplayName: string;
  columnsJson: any;
}

interface TFields {
  id?: number; uuid?: string;
  date: string; comment: string; amount: string;
  posted: boolean;
  organizationUuid: string; organizationName: string;
  counterpartyUuid: string; counterpartyName: string;
  contractUuid: string; contractName: string;
  authorUuid: string; authorName: string;
}

const DEFAULT_FIELDS: TFields = {
  date: "", comment: "", amount: "",
  posted: false,
  organizationUuid: "", organizationName: "",
  counterpartyUuid: "", counterpartyName: "",
  contractUuid: "", contractName: "",
  authorUuid: "", authorName: "",
};

export function createCashOrderForm(cfg: CashOrderFormConfig): {
  Form: FC<Partial<TPane>>;
  List: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void; ownerUuid?: string; ownerField?: string }>;
} {
  const Form: FC<Partial<TPane>> = (paneProps) => {
    const defaultOrg = useDefaultOrganization();
    const { canWrite } = useAccessRight(cfg.accessRightModel);

    const initialFields: TFields | undefined = (() => {
      const data = paneProps.data;
      if (!data || data.uuid) return undefined;
      const init = { ...DEFAULT_FIELDS };
      if (data.organizationUuid) {
        init.organizationUuid = data.organizationUuid as string;
        init.organizationName = (data.organizationName as string) || "";
      } else if (defaultOrg.organizationUuid) {
        init.organizationUuid = defaultOrg.organizationUuid;
        init.organizationName = defaultOrg.organizationName;
      }
      if (data.counterpartyUuid) {
        init.counterpartyUuid = data.counterpartyUuid as string;
        init.counterpartyName = (data.counterpartyName as string) || "";
      }
      return init;
    })();

    const form = useFormStore<TFields>({
      endpoint: cfg.endpoint,
      storageKey: cfg.storageKey,
      defaultFields: DEFAULT_FIELDS,
      initialFields,
      paneProps,
      mapServerToForm: (d, prev) => ({
        ...(prev ?? DEFAULT_FIELDS), ...d,
        date: d.date?.slice(0, 10) ?? "",
        comment: d.comment ?? "",
        amount: d.amount != null ? String(d.amount) : "",
        posted: d.posted === true,
        organizationUuid: d.organizationUuid ?? "",
        organizationName: d.organization?.shortName ?? "",
        counterpartyUuid: d.counterpartyUuid ?? "",
        counterpartyName: d.counterparty?.shortName ?? "",
        contractUuid: d.contractUuid ?? "",
        contractName: d.contract?.shortName ?? "",
        authorUuid: d.authorUuid ?? d.author?.uuid ?? "",
        authorName: d.author?.username ?? d.author?.email ?? "",
      }),
      buildPayload: (fd) => {
        const validation = validateDocumentFields(cfg.docType, fd as unknown as Record<string, unknown>);
        if (!validation.isValid) return formatValidationErrors(validation.errors);
        return {
          date: fd.date || null,
          comment: fd.comment?.trim() || null,
          amount: fd.amount ? parseFloat(fd.amount) : null,
          posted: fd.posted === true,
          organizationUuid: fd.organizationUuid || null,
          counterpartyUuid: fd.counterpartyUuid || null,
          contractUuid: fd.contractUuid || null,
        };
      },
      buildPaneLabel: (saved) => makeDocLabel(cfg.listName, cfg.formLabel, saved, "date"),
    });

    const handleContractSelect = useCallback((uuid: string, displayValue: string, item: Record<string, any>) => {
      const updates: Partial<TFields> = { contractUuid: uuid, contractName: displayValue };
      if (item.organizationUuid) { updates.organizationUuid = item.organizationUuid; updates.organizationName = item.organization?.shortName ?? ""; }
      if (item.counterpartyUuid) { updates.counterpartyUuid = item.counterpartyUuid; updates.counterpartyName = item.counterparty?.shortName ?? ""; }
      form.setFields(updates);
    }, [form.setFields]);

    const contractScope = useMemo<Record<string, string> | null>(() => {
      const hasOrg = !!form.fields.organizationUuid;
      const hasCpty = !!form.fields.counterpartyUuid;
      if (!hasOrg && !hasCpty) return null;
      const s: Record<string, string> = {};
      if (hasOrg) s.organizationUuid = form.fields.organizationUuid;
      if (hasCpty) s.counterpartyUuid = form.fields.counterpartyUuid;
      return s;
    }, [form.fields.organizationUuid, form.fields.counterpartyUuid]);

    useAutoFillPrimary({
      endpoint: "contracts", scope: contractScope, currentUuid: form.fields.contractUuid,
      isEditMode: form.isEditMode, isLoading: form.isLoading,
      apply: (uuid, name) => form.setFields({ contractUuid: uuid, contractName: name } as Partial<TFields>),
    });

    const tabs = useMemo(() => [
      {
        id: "tab-details",
        label: translate("general"),
        component: (
          <div className={styles.FormWrapper}>
            <div className={styles.Form}>
              <GroupCol>
                <GroupRow style={{ width: "100%", justifyContent: "space-between" }}>
                  <FieldDate label="Дата" name={`${form.formUid}_date`} value={form.fields.date} onChange={e => form.setField("date", e.target.value)} disabled={form.isLoading} width="160px" />
                  <FieldToggle name={`${form.formUid}_posted`} label="Проведён" value={form.fields.posted === true} onChange={(v) => form.setField("posted", v)} disabled={form.isLoading || !canWrite} variant="success" />
                </GroupRow>
                <Group>
                  <LookupField label="Организация" name={`${form.formUid}_organizationUuid`} value={form.fields.organizationUuid} displayValue={form.fields.organizationName} endpoint="organizations" displayField="shortName"
                    onSelect={(u, d) => form.setFields({ organizationUuid: u, organizationName: d } as Partial<TFields>)}
                    onClear={() => form.setFields({ organizationUuid: "", organizationName: "" } as Partial<TFields>)}
                    disabled={form.isLoading} />
                </Group>
                <Group>
                  <LookupField label="Контрагент" name={`${form.formUid}_counterpartyUuid`} value={form.fields.counterpartyUuid} displayValue={form.fields.counterpartyName} endpoint="counterparties" displayField="shortName"
                    onSelect={(u, d) => form.setFields({ counterpartyUuid: u, counterpartyName: d } as Partial<TFields>)}
                    onClear={() => form.setFields({ counterpartyUuid: "", counterpartyName: "" } as Partial<TFields>)}
                    disabled={form.isLoading} />
                  <LookupField label="Договор" name={`${form.formUid}_contractUuid`} value={form.fields.contractUuid} displayValue={form.fields.contractName} endpoint="contracts" displayField="shortName"
                    onSelect={handleContractSelect}
                    onClear={() => form.setFields({ contractUuid: "", contractName: "" } as Partial<TFields>)}
                    disabled={form.isLoading}
                    extraParams={{
                      ...(form.fields.organizationUuid ? { organizationUuid: form.fields.organizationUuid } : {}),
                      ...(form.fields.counterpartyUuid ? { counterpartyUuid: form.fields.counterpartyUuid } : {}),
                    }} />
                </Group>
                <GroupRow>
                  <Field label="Сумма" name={`${form.formUid}_amount`} width="200px" value={form.fields.amount} onChange={e => form.setField("amount", e.target.value)} disabled={form.isLoading} />
                </GroupRow>
              </GroupCol>
              {form.isEditMode && <><Group align="row" style={{ flex: 1, alignItems: "end", justifyContent: "end", gap: 6 }}>
                <Field label={translate("Comment")} name={`${form.formUid}_comment`} value={form.fields.comment} onChange={e => form.setField("comment", e.target.value)} disabled={form.isLoading} />
                <Field label={translate("Author")} name={`${form.formUid}_author`} value={form.fields.authorName || ""} disabled width="auto" />
              </Group></>}
            </div>
          </div>
        ),
      },
    ], [form.fields, form.formUid, form.isLoading, form.isEditMode, form.setField, form.setFields, handleContractSelect, canWrite]);

    return (
      <FormRequiredScope docType={cfg.docType}>
        <ModelForm
          paneId={form.paneId} tabs={tabs}
          onSave={form.handleSave} onSaveAndClose={form.handleSaveAndClose} onClose={form.handleClose}
          onReload={form.isEditMode ? form.handleReload : undefined}
          isLoading={form.isLoading} isInitialLoading={form.isInitialLoading}
          readonly={!canWrite}
        />
      </FormRequiredScope>
    );
  };
  Form.displayName = cfg.formDisplayName;

  const List: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void; ownerUuid?: string; ownerField?: string }> = (
    { variant, onSelectItem, ownerUuid, ownerField }
  ) => (
    <ModelList
      endpoint={cfg.endpoint} listName={cfg.listName} columnsJson={cfg.columnsJson} FormComponent={Form}
      getLabel={(d) => d?.date ? getFormatDateOnly(d.date as string) : ""}
      variant={variant} onSelectItem={onSelectItem} ownerUuid={ownerUuid} ownerField={ownerField}
      defaultSort={{ id: "desc" }}
      renderCell={renderPostedCell}
    />
  );
  List.displayName = cfg.listName;

  return { Form, List };
}

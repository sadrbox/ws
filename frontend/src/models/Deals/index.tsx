// Deals (E9 CRM) — сделки воронки продаж. Форма + список. Канбан — DealsKanban.
import { FC, useMemo, type ReactNode } from "react";
import { translate } from "src/i18";
import type { TDataItem } from "src/components/Table/types";
import type { TColumn } from "src/components/Table/types.tsx";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { Field, FieldSelect, FieldDate, FieldNumber, FieldTextarea } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import { Group, GroupCol, GroupRow } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import { useFormStore } from "src/hooks/useFormStore";
import ModelForm from "src/components/ModelForm";
import ModelList from "src/components/ModelList";
import Notice from "src/components/Notice";
import { useFormNotices } from "src/hooks/useFormNotices";
import { makePaneLabel, type LabelSource } from "src/utils/buildPaneLabel";
import { asText } from "src/utils/asText";
import { FormRequiredScope, FormDirtyScope } from "src/hooks/useFormRequired";
import { DEAL_STAGES } from "./stages";

const MODEL_ENDPOINT = "deals";
const LIST_NAME = "DealsList";

/** stage-ключ → переведённая подпись (для формы и списка). */
export const stageLabel = (stage: string): string => {
  const s = DEAL_STAGES.find((x) => x.key === stage);
  return s ? translate(s.labelKey) : stage;
};

/** Ячейка «Стадия» в списке — переведённая подпись вместо сырого ключа. */
export function renderDealCell(row: TDataItem, col: TColumn): ReactNode | undefined {
  if (col.identifier !== "stage") return undefined;
  return <span>{stageLabel(asText(row.stage))}</span>;
}

interface TFields {
  id?: number; uuid?: string;
  number: string; title: string; stage: string;
  amount: string; currency: string; probability: string;
  expectedCloseDate: string; comment: string;
  counterpartyUuid: string; counterpartyName: string;
  responsibleUuid: string; responsibleName: string;
}

const DEFAULT_FIELDS: TFields = {
  number: "", title: "", stage: "new",
  amount: "", currency: "KZT", probability: "",
  expectedCloseDate: "", comment: "",
  counterpartyUuid: "", counterpartyName: "",
  responsibleUuid: "", responsibleName: "",
};

interface DealServerRecord {
  id?: number; uuid?: string;
  number?: string | null; title?: string | null; stage?: string | null;
  amount?: number | string | null; currency?: string | null; probability?: number | null;
  expectedCloseDate?: string | null; comment?: string | null;
  counterpartyUuid?: string | null; counterpartyName?: string | null;
  responsibleUuid?: string | null; responsibleName?: string | null;
}

const DealsForm: FC<Partial<TPane>> = (paneProps) => {
  const form = useFormStore<TFields>({
    endpoint: MODEL_ENDPOINT,
    storageKey: "deals-form",
    defaultFields: DEFAULT_FIELDS,
    paneProps,
    mapServerToForm: (d: DealServerRecord) => ({
      ...DEFAULT_FIELDS,
      id: d.id, uuid: d.uuid,
      number: d.number ?? "",
      title: d.title ?? "",
      stage: d.stage ?? "new",
      amount: d.amount != null ? String(d.amount) : "",
      currency: d.currency ?? "KZT",
      probability: d.probability != null ? String(d.probability) : "",
      expectedCloseDate: d.expectedCloseDate ?? "",
      comment: d.comment ?? "",
      counterpartyUuid: d.counterpartyUuid ?? "",
      counterpartyName: d.counterpartyName ?? "",
      responsibleUuid: d.responsibleUuid ?? "",
      responsibleName: d.responsibleName ?? "",
    }),
    buildPayload: (fd) => {
      if (!fd.title.trim()) return translate("dealTitleRequired");
      return {
        number: fd.number, title: fd.title, stage: fd.stage,
        amount: fd.amount === "" ? 0 : Number(fd.amount),
        currency: fd.currency,
        probability: fd.probability === "" ? 0 : Number(fd.probability),
        expectedCloseDate: fd.expectedCloseDate || null,
        comment: fd.comment,
        counterpartyUuid: fd.counterpartyUuid || null,
        responsibleUuid: fd.responsibleUuid || null,
      };
    },
    buildPaneLabel: (saved: LabelSource & { title?: string | null }) =>
      makePaneLabel(LIST_NAME, translate("deal"), saved, saved.title || undefined),
  });

  const notices = useFormNotices(form);

  const tabs = useMemo(() => [
    {
      id: "tab-details", label: translate("general"), component: (
        <div className={styles.FormWrapper}>
          <div className={styles.Form}>
            <GroupCol>
              <Group>
                <Field label={translate("dealTitle")} name={`${form.formUid}_title`} minWidth="360px" required
                  value={form.fields.title} onChange={(e) => form.setField("title", e.target.value)} disabled={form.isLoading} />
              </Group>
              <GroupRow>
                <FieldSelect label={translate("dealStage")} name={`${form.formUid}_stage`}
                  options={DEAL_STAGES.map((s) => ({ value: s.key, label: translate(s.labelKey) }))}
                  value={form.fields.stage} onChange={(e) => form.setField("stage", e.target.value)} disabled={form.isLoading} />
                <Field label={translate("number")} name={`${form.formUid}_number`} minWidth="140px"
                  value={form.fields.number} onChange={(e) => form.setField("number", e.target.value)} disabled={form.isLoading} />
              </GroupRow>
              <Group>
                <LookupField label={translate("counterparty")} name={`${form.formUid}_counterparty`}
                  value={form.fields.counterpartyUuid} displayValue={form.fields.counterpartyName}
                  endpoint="counterparties" displayField="name"
                  onSelect={(u, d) => form.setFields({ counterpartyUuid: u, counterpartyName: d })}
                  onClear={() => form.setFields({ counterpartyUuid: "", counterpartyName: "" })} disabled={form.isLoading} />
              </Group>
              <Group>
                <LookupField label={translate("dealResponsible")} name={`${form.formUid}_responsible`}
                  value={form.fields.responsibleUuid} displayValue={form.fields.responsibleName}
                  endpoint="users" displayField="username"
                  onSelect={(u, d) => form.setFields({ responsibleUuid: u, responsibleName: d })}
                  onClear={() => form.setFields({ responsibleUuid: "", responsibleName: "" })} disabled={form.isLoading} />
              </Group>
              <GroupRow>
                <FieldNumber label={translate("dealAmount")} name={`${form.formUid}_amount`} minWidth="150px"
                  value={form.fields.amount} onChange={(e) => form.setField("amount", e.target.value)} disabled={form.isLoading} />
                <Field label={translate("currency")} name={`${form.formUid}_currency`} minWidth="90px"
                  value={form.fields.currency} onChange={(e) => form.setField("currency", e.target.value)} disabled={form.isLoading} />
                <FieldNumber label={translate("dealProbability")} name={`${form.formUid}_probability`} minWidth="120px"
                  value={form.fields.probability} onChange={(e) => form.setField("probability", e.target.value)} disabled={form.isLoading} />
                <FieldDate label={translate("dealExpectedClose")} name={`${form.formUid}_expectedCloseDate`}
                  value={form.fields.expectedCloseDate} onChange={(e) => form.setField("expectedCloseDate", e.target.value)} disabled={form.isLoading} />
              </GroupRow>
              <Group>
                <FieldTextarea label={translate("comment")} name={`${form.formUid}_comment`}
                  value={form.fields.comment} onChange={(e) => form.setField("comment", e.target.value)} disabled={form.isLoading} />
              </Group>
            </GroupCol>
            <GroupCol className={styles.FormNotice}>
              <Notice items={notices} />
            </GroupCol>
          </div>
        </div>
      )
    },
  ], [form.fields, form.formUid, form.isLoading, form.setField, form.setFields, notices]);

  return (
    <FormRequiredScope requiredKeys={["title"]}>
      <FormDirtyScope dirtyKeys={form.unsavedFields}>
        <ModelForm paneId={form.paneId} endpoint={MODEL_ENDPOINT} recordUuid={form.fields.uuid} tabs={tabs}
          onSave={form.handleSave} onSaveAndClose={form.handleSaveAndClose} onClose={form.handleClose}
          onReload={form.isEditMode ? form.handleReload : undefined}
          isLoading={form.isLoading} isInitialLoading={form.isInitialLoading} />
      </FormDirtyScope>
    </FormRequiredScope>
  );
};
DealsForm.displayName = "DealsForm";

const DealsList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void; ownerUuid?: string; ownerField?: string }> = (
  { variant, onSelectItem, ownerUuid, ownerField }
) => (
  <ModelList
    endpoint={MODEL_ENDPOINT} listName={LIST_NAME} columnsJson={columnsJson} FormComponent={DealsForm}
    getLabel={(d) => (d?.title as string | undefined) || ""}
    variant={variant} onSelectItem={onSelectItem} ownerUuid={ownerUuid} ownerField={ownerField}
    defaultSort={{ id: "desc" }} renderCell={renderDealCell}
  />
);
DealsList.displayName = LIST_NAME;

export { DealsList, DealsForm };

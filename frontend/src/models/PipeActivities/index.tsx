// ─────────────────────────────────────────────────────────────────────────────
// Входящие события 1С (PipeActivity) — ТОЛЬКО ПРОСМОТР.
//
// Данные пишет внешняя система: 1С шлёт события на POST /pipe, они падают в
// таблицу pipe_activity вместе с оригинальным payload. Пользователь их не создаёт
// и не редактирует — у роутера pipeactivities только GET. Структура повторяет
// «Журнал действий» (ActivityHistories), но источник другой: не наш аудит-middleware,
// а интеграция.
// ─────────────────────────────────────────────────────────────────────────────
import { FC, useMemo } from "react";
import type { ReactNode } from "react";
import { translate } from "src/i18";
import type { TDataItem, TColumn } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { Field } from "src/components/Field";
import { Group, GroupCol } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import { useFormStore } from "src/hooks/useFormStore";
import ModelForm from "src/components/ModelForm";
import ModelList from "src/components/ModelList";
import { makePaneLabel } from "src/utils/buildPaneLabel";
import { getFormatDate } from "src/utils/datetime";
import { FormLookup } from "src/components/Field/FormLookup";

const MODEL_ENDPOINT = "pipeactivities";
const LIST_NAME = "PipeActivitiesList";

/** actionType → i18-ключ (тот же набор, что в журнале действий). */
const ACTION_LABEL_KEYS: Record<string, string> = {
  create: "auditCreate", update: "auditUpdate", delete: "auditDelete", batch_delete: "auditBatchDelete",
};
const actionLabel = (v: unknown): string => {
  const k = ACTION_LABEL_KEYS[String(v)];
  return k ? translate(k) : String(v ?? "");
};

/** Результат применения события к справочнику (см. services/pipeReference.js). */
const APPLY_LABEL_KEYS: Record<string, string> = {
  created: "pipeApplyCreated", updated: "pipeApplyUpdated", linked: "pipeApplyLinked",
  skipped: "pipeApplySkipped", error: "pipeApplyError",
};
const applyLabel = (v: unknown): string => {
  const k = APPLY_LABEL_KEYS[String(v)];
  return k ? translate(k) : String(v ?? "");
};

/** JSON-реквизиты от 1С → компактная строка «ключ: значение; …». */
function formatProps(v: unknown): string {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v !== "object") return String(v);
  try {
    return Object.entries(v as Record<string, unknown>)
      .map(([k, val]) => `${k}: ${val === null || val === undefined ? "—" : String(val)}`)
      .join("; ");
  } catch {
    return "";
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// FORM (только просмотр)
// ═══════════════════════════════════════════════════════════════════════════

interface TFields {
  id?: number; uuid?: string;
  receivedAt: string; actionDate: string; actionType: string;
  objectType: string; objectName: string; objectId: string;
  userName: string; organizationShortName: string; bin: string;
  host: string; ip: string;
  props: string; propsJson: string; payload: string;
  organizationUuid: string; userUuid: string;
  applyStatus: string; applyMessage: string;
}

const DEFAULT_FIELDS: TFields = {
  receivedAt: "", actionDate: "", actionType: "",
  objectType: "", objectName: "", objectId: "",
  userName: "", organizationShortName: "", bin: "",
  host: "", ip: "", props: "", propsJson: "", payload: "",
  organizationUuid: "", userUuid: "",
  applyStatus: "", applyMessage: "",
};

const PipeActivitiesForm: FC<Partial<TPane>> = (paneProps) => {
  const form = useFormStore<TFields>({
    endpoint: MODEL_ENDPOINT,
    storageKey: "pipe-activities-form",
    defaultFields: DEFAULT_FIELDS,
    paneProps,
    mapServerToForm: (d) => ({
      id: d.id, uuid: d.uuid,
      receivedAt: d.receivedAt ? (getFormatDate(String(d.receivedAt)) ?? "") : "",
      actionDate: d.actionDate ? (getFormatDate(String(d.actionDate)) ?? "") : "",
      actionType: actionLabel(d.actionType),
      objectType: d.objectType ?? "",
      objectName: d.objectName ?? "",
      objectId: d.objectId ?? "",
      // Имя показываем НАШЕ (из справочника), если объект сопоставлен: в 1С оно может
      // быть записано иначе. Если не сопоставлен — то, что прислала 1С.
      userName: (d.user as { username?: string } | null)?.username ?? d.userName ?? "",
      organizationShortName: (d.organization as { name?: string } | null)?.name ?? d.organizationShortName ?? "",
      organizationUuid: (d.organization as { uuid?: string } | null)?.uuid ?? "",
      userUuid: (d.user as { uuid?: string } | null)?.uuid ?? "",
      bin: d.bin ?? "",
      host: d.host ?? "",
      ip: d.ip ?? "",
      props: formatProps(d.props),
      // Реквизиты 1С — вложенный объект. Однострочное поле его расплющивало
      // («ключ: значение; …») и делало нечитаемым; показываем объект-нотацией.
      propsJson: d.props ? JSON.stringify(d.props, null, 2) : "",
      // Оригинальный JSON от 1С — как есть, для разбора инцидентов интеграции.
      payload: d.payload ? JSON.stringify(d.payload, null, 2) : "",
      applyStatus: applyLabel(d.applyStatus),
      applyMessage: d.applyMessage ?? "",
    }),
    // Записи создаёт 1С (POST /pipe). У роутера нет POST/PUT — сохранять нечего.
    buildPayload: () => ({}),
    buildPaneLabel: (saved) => makePaneLabel(LIST_NAME, "Событие 1С", saved, saved.objectName || undefined),
  });

  const tabs = useMemo(() => [
    {
      id: "tab-details", label: translate("general"), component: (
        <div className={styles.FormWrapper}>
          <div className={styles.Form}>
            <GroupCol>
              <div className={styles.SettingHint}>{translate("pipeReadOnlyNote")}</div>
              <Group>
                <Field label={translate("pipeReceivedAt")} name={`${form.formUid}_recv`} value={form.fields.receivedAt} disabled />
                <Field label={translate("actionDate")} name={`${form.formUid}_ad`} value={form.fields.actionDate} disabled />
                <Field label={translate("actionType")} name={`${form.formUid}_at`} value={form.fields.actionType} disabled />
              </Group>
              <Group>
                <Field label={translate("objectType")} name={`${form.formUid}_ot`} value={form.fields.objectType} disabled />
                <Field label={translate("objectName")} name={`${form.formUid}_on`} value={form.fields.objectName} disabled />
                <Field label={translate("objectId")} name={`${form.formUid}_oi`} value={form.fields.objectId} disabled />
              </Group>
              {/* Организация и пользователь — ССЫЛКИ на объекты справочников, а не текст:
                  при приёме события они находятся (а если нет — создаются), см.
                  services/pipeActor.js. disabled — журнал только на чтение, но лукап
                  показывает связанный объект и открывает его карточку. */}
              <Group>
                <FormLookup form={form} field="user" endpoint="users" nameField="userName" label={translate("userName")} disabled />
                <FormLookup form={form} field="organization" endpoint="organizations" nameField="organizationShortName" label={translate("organization")} disabled />
                <Field label={translate("bin")} name={`${form.formUid}_bin`} value={form.fields.bin} disabled />
              </Group>
              <Group>
                <Field label={translate("host")} name={`${form.formUid}_h`} value={form.fields.host} disabled />
                <Field label={translate("ip")} name={`${form.formUid}_ip`} value={form.fields.ip} disabled />
              </Group>
              <GroupCol>
                <label className={styles.JsonViewLabel}>{translate("pipeProps")}</label>
                <pre className={styles.JsonView}>{form.fields.propsJson || "—"}</pre>
              </GroupCol>
              {/* Что событие сделало со справочником: создан / обновлён / привязан /
                  пропущено / ошибка (см. services/pipeReference.js). Отдельного поля
                  «какой справочник» тут НЕТ — это objectName из самого события
                  («Номенклатура», «Контрагенты», «Склады»…), дублировать его не нужно. */}
              <Group>
                <Field label={translate("applyStatus")} name={`${form.formUid}_as`} value={form.fields.applyStatus} disabled />
                <Field label={translate("applyMessage")} name={`${form.formUid}_amsg`} value={form.fields.applyMessage} disabled />
              </Group>
            </GroupCol>
          </div>
        </div>
      ),
    },
    {
      id: "tab-payload", label: translate("pipePayload"), component: (
        <div className={styles.FormWrapper}>
          <div className={styles.Form}>
            {/* Сырой JSON, как прислала 1С — источник истины при разборе инцидентов. */}
            <pre style={{ margin: 0, padding: "8px 12px", overflow: "auto", fontSize: 12, lineHeight: 1.45 }}>
              {form.fields.payload || "—"}
            </pre>
          </div>
        </div>
      ),
    },
  ], [form.fields, form.formUid]);

  return (
    <ModelForm paneId={form.paneId} tabs={tabs} readonly
      onSave={form.handleSave} onSaveAndClose={form.handleSaveAndClose} onClose={form.handleClose}
      onReload={form.isEditMode ? form.handleReload : undefined}
      isLoading={form.isLoading} isInitialLoading={form.isInitialLoading} />
  );
};
PipeActivitiesForm.displayName = "PipeActivitiesForm";

// ═══════════════════════════════════════════════════════════════════════════
// LIST
// ═══════════════════════════════════════════════════════════════════════════

/** Тип действия — на языке интерфейса; JSON-реквизиты — компактной строкой. */
function renderPipeCell(row: TDataItem, col: TColumn): ReactNode | undefined {
  if (col.identifier === "actionType") return <span>{actionLabel(row.actionType)}</span>;
  if (col.identifier === "applyStatus") return <span>{applyLabel(row.applyStatus)}</span>;
  if (col.identifier === "props") {
    const text = formatProps(row.props);
    return <span title={text}>{text}</span>;
  }
  return undefined;
}

/** JSON объект-нотацией — и в форме, и в предпросмотре (плоская строка нечитаема). */
const JsonBlock: FC<{ value: unknown }> = ({ value }) => (
  <pre className={styles.JsonView}>{value ? JSON.stringify(value, null, 2) : "—"}</pre>
);
JsonBlock.displayName = "JsonBlock";

/** Реквизиты 1С в предпросмотре — как в форме: объект-нотацией, а не «ключ: значение; …». */
function renderPipePreviewValue(row: TDataItem, col: TColumn): ReactNode | undefined {
  if (col.identifier === "props") return <JsonBlock value={row.props} />;
  if (col.identifier === "actionType") return <span>{actionLabel(row.actionType)}</span>;
  if (col.identifier === "applyStatus") return <span>{applyLabel(row.applyStatus)}</span>;
  return undefined;
}

/** Вкладка «Исходный JSON» — то, что прислала 1С, без наших интерпретаций. */
function pipePreviewTabs(row: TDataItem) {
  return [{
    id: "payload",
    label: translate("pipePayload"),
    component: <JsonBlock value={row.payload} />,
  }];
}

const PipeActivitiesList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void; ownerUuid?: string; ownerField?: string; extraQueryParams?: Record<string, string> }> = (
  { variant, onSelectItem, ownerUuid, ownerField, extraQueryParams }
) => (
  <ModelList
    endpoint={MODEL_ENDPOINT} listName={LIST_NAME} columnsJson={columnsJson} FormComponent={PipeActivitiesForm}
    getLabel={(d) => (d?.objectName as string | undefined) || ""}
    variant={variant} onSelectItem={onSelectItem} ownerUuid={ownerUuid} ownerField={ownerField} extraQueryParams={extraQueryParams}
    defaultSort={{ id: "desc" }} enableDateRange
    renderCell={renderPipeCell}
    // Предпросмотр: «Основное» (с реквизитами объект-нотацией) + «Исходный JSON».
    renderPreviewValue={renderPipePreviewValue}
    previewTabs={pipePreviewTabs}
    // «Добавить» нет: события порождает 1С (POST /pipe), руками их не заводят.
    // «Удалить» есть: журнал растёт, разобранные и ошибочные записи нужно убирать.
    // Удаляется только ЗАПИСЬ ЖУРНАЛА — созданный ею элемент справочника остаётся.
    hideAdd
  />
);
PipeActivitiesList.displayName = LIST_NAME;

export { PipeActivitiesList, PipeActivitiesForm };

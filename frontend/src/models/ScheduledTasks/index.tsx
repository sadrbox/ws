import { FC, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { FIELD_WIDTH } from "src/components/Field/fieldWidths";
import { translate } from "src/i18";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { Field, FieldNumber, FieldSelect, FieldTextarea } from "src/components/Field";
import { FormLookup } from "src/components/Field/FormLookup";
import { Group, GroupCol, GroupRow } from "src/components/UI";
import { ValueList, ValueRow } from "src/components/ValueList";
import styles from "src/styles/main.module.scss";
import { useFormStore } from "src/hooks/useFormStore";
import { useAccessPermission } from "src/hooks/useAccessPermission";
import { makePaneLabel , type LabelSource } from "src/utils/buildPaneLabel";
import { getFormatDate } from "src/utils/datetime";
import ModelForm from "src/components/ModelForm";
import ModelList from "src/components/ModelList";
import Notice, { type NoticeItem } from "src/components/Notice";
import { useFormNotices } from "src/hooks/useFormNotices";
import { fetchQualitySettings } from "src/services/quality/api";
import { fetchRecordName, userDisplayName } from "src/models/Todos/recordName";
import {
  DEFAULT_TZ_OFFSET_MINUTES, deadlineDaysError, deadlineDaysValue, scheduleStatusLabel, scheduleStatusOptions, tzLabel,
} from "./scheduleForm";

const MODEL_ENDPOINT = "scheduled-tasks";
const LIST_NAME = "ScheduledTasksList";
const FORM_LABEL = "Регламентная задача";

/** Что создаёт расписание. Исполняется только regulation — регламентная задача (СК1.7). */
const KIND_REGULATION = "regulation";

interface TFields {
  id?: number; uuid?: string;
  name: string; description: string; cronExpr: string; status: string;
  /** Последний и ближайший запуск ставит исполнитель расписаний — здесь только показ. */
  lastRunAt: string; nextRunAt: string;
  organizationUuid: string; organizationName: string;
  authorUuid: string; authorName: string;
  kind: string;
  /** Кому задача, если группа не задана. */
  executorUuid: string; executorName: string;
  /** Группа сотрудников: задача — по каждому клиенту группы его ответственному бухгалтеру. */
  staffGroupUuid: string; staffGroupName: string;
  /** Срок создаваемой задачи, дней от её создания (0–365); пусто — без срока. */
  deadlineDays: string;
}

const DEFAULT_FIELDS: TFields = {
  name: "", description: "", cronExpr: "", status: "active",
  lastRunAt: "", nextRunAt: "", organizationUuid: "", organizationName: "",
  authorUuid: "", authorName: "",
  kind: KIND_REGULATION, executorUuid: "", executorName: "", staffGroupUuid: "", staffGroupName: "",
  deadlineDays: "",
};

/** Поля, которые ставит сервер: в «несохранено» не участвуют. */
const SERVER_FIELDS: readonly (keyof TFields)[] = ["lastRunAt", "nextRunAt", "authorUuid", "authorName"];

/** Серверная запись — вход mapServerToForm (T3). */
interface ScheduledTasksServerRecord {
  author?: { uuid?: string | null; username?: string | null; email?: string | null } | null;
  authorUuid?: string | null;
  cronExpr?: string | null;
  description?: string | null;
  id?: number;
  lastRunAt?: string | null;
  name?: string | null;
  nextRunAt?: string | null;
  organization?: { name?: string | null } | null;
  organizationUuid?: string | null;
  status?: string | null;
  uuid?: string;
  kind?: string | null;
  executorUuid?: string | null;
  staffGroupUuid?: string | null;
  deadlineDays?: number | null;
}

const ScheduledTasksForm: FC<Partial<TPane>> = (paneProps) => {
  const { canWrite } = useAccessPermission("ScheduledTask");
  // Имя исполнителя по uuid читается из /users — без права на пользователей запрос вернул бы 403
  // (и тост при каждом открытии). Тогда поле просто без подписи, а uuid уходит при записи как был.
  const { canRead: canReadUsers } = useAccessPermission("User");
  const canReadUsersRef = useRef(canReadUsers);
  canReadUsersRef.current = canReadUsers;

  /*
   * ЧАСОВОЙ ПОЯС РАСПИСАНИЙ — из настроек качества (tzOffsetMinutes): по нему исполнитель считает
   * «0 9 1 * *» как 9:00 местного времени. Нет ответа — умолчание сервера, UTC+5.
   * ПРОВЕРИТЬ ПОТОМ: часовой пояс — настройка «Качество → Настройки», а не свойство установки;
   * при фирме в другом поясе расписания сработают по её часам, не по часам пользователя.
   */
  const tzQ = useQuery({
    queryKey: ["scheduled-tasks", "quality-tz"],
    queryFn: fetchQualitySettings,
    select: (d) => d.settings?.tzOffsetMinutes,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const tz = tzLabel(typeof tzQ.data === "number" ? tzQ.data : DEFAULT_TZ_OFFSET_MINUTES);

  const form = useFormStore<TFields>({
    endpoint: MODEL_ENDPOINT, storageKey: "scheduled-tasks-form", defaultFields: DEFAULT_FIELDS, paneProps,
    derivedFields: SERVER_FIELDS,
    mapServerToForm: async (d: ScheduledTasksServerRecord, prev) => {
      const executorUuid = d.executorUuid ?? "";
      const staffGroupUuid = d.staffGroupUuid ?? "";
      // Связей в ответе нет — подписи по uuid; тот же uuid, что был (после записи), — прежняя подпись.
      const [executorName, staffGroupName] = await Promise.all([
        !executorUuid ? ""
          : prev?.executorUuid === executorUuid && prev.executorName ? prev.executorName
            : canReadUsersRef.current ? fetchRecordName("users", executorUuid, userDisplayName) : "",
        !staffGroupUuid ? ""
          : prev?.staffGroupUuid === staffGroupUuid && prev.staffGroupName ? prev.staffGroupName
            : fetchRecordName("staff-groups", staffGroupUuid),
      ]);
      return {
        ...(prev ?? DEFAULT_FIELDS),
        id: d.id, uuid: d.uuid,
        name: d.name ?? "", description: d.description ?? "",
        cronExpr: d.cronExpr ?? "", status: d.status ?? "active",
        lastRunAt: d.lastRunAt ?? "", nextRunAt: d.nextRunAt ?? "",
        organizationUuid: d.organizationUuid ?? "",
        organizationName: d.organization?.name ?? "",
        authorUuid: d.authorUuid ?? d.author?.uuid ?? "",
        authorName: d.author?.username ?? d.author?.email ?? "",
        kind: d.kind || KIND_REGULATION,
        executorUuid, executorName, staffGroupUuid, staffGroupName,
        deadlineDays: d.deadlineDays != null ? String(d.deadlineDays) : "",
      };
    },
    buildPayload: (fd) => {
      const daysErr = deadlineDaysError(fd.deadlineDays ?? "");
      if (daysErr) return daysErr;
      return {
        name: fd.name?.trim() || null, description: fd.description?.trim() || null,
        cronExpr: fd.cronExpr?.trim() || null, status: fd.status || "active",
        // lastRunAt/nextRunAt НЕ отправляем: их ведёт исполнитель расписаний. Без nextRunAt в запросе
        // сервер при записи выражения пересчитает ближайший запуск сам (scheduledtasks.js PUT).
        organizationUuid: fd.organizationUuid || null,
        kind: KIND_REGULATION,
        executorUuid: fd.executorUuid || null,
        staffGroupUuid: fd.staffGroupUuid || null,
        deadlineDays: deadlineDaysValue(fd.deadlineDays ?? ""),
      };
    },
    buildPaneLabel: (saved: LabelSource) => makePaneLabel(LIST_NAME, FORM_LABEL, saved),
  });

  // Ошибки ДАННЫХ формы → <Notice /> внутри формы (системные — в <UIToast />).
  const formNotices = useFormNotices(form);
  const { fields, formUid, isLoading, setField } = form;
  const hasTarget = !!fields.executorUuid || !!fields.staffGroupUuid;

  const notices = useMemo<NoticeItem[]>(() => {
    const out: NoticeItem[] = [...formNotices];
    // Как работает расписание — пояснение, а не тревога: раньше оно не исполнялось вовсе.
    out.push({ type: "info", text: translate("scheduleRunsHint") });
    if (!hasTarget) out.push({ type: "warning", text: translate("scheduleNoExecutorWarning") });
    out.push({ type: "info", text: translate("scheduleTzCheckLater").replace("{tz}", tz) });
    return out;
  }, [formNotices, hasTarget, tz]);

  const tabs = useMemo(() => [
    {
      id: "tab-details", label: translate("general"), component: (
        <div className={styles.FormWrapper}>
          <div className={styles.Form}>
            <GroupCol>
              <Group>
                <Field label={translate("name")} name={`${formUid}_name`} minWidth={FIELD_WIDTH.lg} value={fields.name} onChange={e => setField("name", e.target.value)} disabled={isLoading} />
              </Group>
              <Group>
                <Field label={translate("scheduleCron")} name={`${formUid}_cron`} minWidth={FIELD_WIDTH.lg} value={fields.cronExpr} onChange={e => setField("cronExpr", e.target.value)} disabled={isLoading}
                  hint={translate("scheduleCronHint").replace("{tz}", tz)} />
              </Group>
              <GroupRow>
                <Group className={styles.w1of2}>
                  <FieldSelect label={translate("status")} name={`${formUid}_status`} value={fields.status} options={scheduleStatusOptions()} onChange={e => setField("status", e.target.value)} disabled={isLoading} />
                </Group>
                <Group className={styles.w1of2}>
                  {/* Вид один — «Регламентная задача»: исполнитель расписаний создаёт только её. */}
                  <FieldSelect label={translate("todoKind")} name={`${formUid}_kind`} value={KIND_REGULATION}
                    options={[{ value: KIND_REGULATION, label: translate("todoKindRegulation") }]} disabled />
                </Group>
              </GroupRow>
              <Group>
                {/* С группой — задача каждому клиенту группы его ответственному (см. пояснение справа). */}
                <FormLookup form={form} field="staffGroup" endpoint="staff-groups" label={translate("staffGroup")} minWidth={FIELD_WIDTH.lg} />
              </Group>
              <Group>
                <FormLookup form={form} field="executor" endpoint="users" displayField="username" secondaryFields={["employee.fullName"]} minWidth={FIELD_WIDTH.lg}
                  onSelect={(uuid, display, item: { employee?: { fullName?: string | null } | null }) => form.setFields({ executorUuid: uuid, executorName: item?.employee?.fullName || display })} />
              </Group>
              <Group>
                <FormLookup form={form} field="organization" endpoint="organizations" minWidth={FIELD_WIDTH.lg} />
              </Group>
              <Group>
                <FieldNumber label={translate("deadlineDays")} name={`${formUid}_deadlineDays`} width={FIELD_WIDTH.sm} value={fields.deadlineDays}
                  onChange={e => setField("deadlineDays", e.target.value)} disabled={isLoading} decimals={0} hint={translate("scheduleDeadlineDaysHint")} />
              </Group>
              <Group>
                <FieldTextarea label={translate("description")} name={`${formUid}_description`} value={fields.description} onChange={e => setField("description", e.target.value)} disabled={isLoading} minWidth={FIELD_WIDTH.lg} minHeight="80px" rows={4} />
              </Group>
              {/* Запуски ведёт исполнитель расписаний: правка руками обманывала бы его. */}
              <ValueList>
                <ValueRow label={translate("lastRunAt")} value={fields.lastRunAt ? getFormatDate(fields.lastRunAt) : ""} />
                <ValueRow label={translate("nextRunAt")} value={fields.nextRunAt ? getFormatDate(fields.nextRunAt) : ""} />
                <ValueRow label={translate("Author")} value={fields.authorName} />
              </ValueList>
            </GroupCol>
          </div>
          <GroupCol className={styles.FormNotice}>
            <Notice items={notices} />
          </GroupCol>
        </div>
      )
    },
  ], [form, fields, formUid, isLoading, setField, tz, notices]);

  return (
    <ModelForm paneId={form.paneId} endpoint={MODEL_ENDPOINT} recordUuid={fields.uuid} tabs={tabs} onSave={form.handleSave} onSaveAndClose={form.handleSaveAndClose} onClose={form.handleClose}
      onReload={form.isEditMode ? form.handleReload : undefined} isLoading={isLoading} isInitialLoading={form.isInitialLoading}
      readonly={!canWrite} />
  );
};
ScheduledTasksForm.displayName = "ScheduledTasksForm";

const ScheduledTasksList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void; ownerUuid?: string; ownerField?: string; extraQueryParams?: Record<string, string> }> = ({ variant, onSelectItem, ownerUuid, ownerField, extraQueryParams }) => (
  <ModelList endpoint={MODEL_ENDPOINT} listName={LIST_NAME} columnsJson={columnsJson} FormComponent={ScheduledTasksForm}
    getLabel={(d) => d?.name ? (d.name as string).slice(0, 50) : "?"} variant={variant} onSelectItem={onSelectItem}
    ownerUuid={ownerUuid} ownerField={ownerField} extraQueryParams={extraQueryParams} defaultSort={{ id: "desc" }}
    // Статус — подписью, а не кодом («active» в ячейке ничего не говорит бухгалтеру).
    renderCell={(row, col) => (col.identifier === "status" ? <span>{scheduleStatusLabel(row.status)}</span> : undefined)} />
);
ScheduledTasksList.displayName = "ScheduledTasksList";

export { ScheduledTasksList, ScheduledTasksForm };

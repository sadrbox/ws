import { FC, useMemo, useCallback, useEffect, useRef, useState } from "react";
import { asText } from "src/utils/asText";
import { FIELD_WIDTH } from "src/components/Field/fieldWidths";
import { translate } from "src/i18";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { ONEC_CHAT_SOURCE, isFromOnec, isOnecObject, onecOriginLabel, originOf, sourceChipLabel, sourceCellText } from "./source";
import {
  KIND_LABEL_KEYS, isFinalStatus, isKindLocked, isWaitingStatus, kindLabel, kindOptions, needsResult, priorityLabel,
  priorityOptions, reactionOverdue, reportedByOptions, statusOptions as buildStatusOptions, todoFormError,
} from "./todoRules";
import { fetchRecordName } from "./recordName";
import TodoActions from "./TodoActions";
import TodoHistory from "./TodoHistory";
import FilesPanel from "src/components/FilesPanel";
import { Field, FieldNumber, FieldDate, FieldSelect, FieldTextarea } from "src/components/Field";
import { FormLookup } from "src/components/Field/FormLookup";
import { FormArea, Group, GroupCol, GroupRow } from "src/components/UI";
import { ValueList, ValueRow } from "src/components/ValueList";
import ObjectLink from "src/components/ObjectLink";
import ObjectMarks from "src/components/ObjectMarks";
import { refFromRestore } from "src/utils/objectRef";
import { getFormatDate } from "src/utils/datetime";
import styles from "src/styles/main.module.scss";
import todoStyles from "./Todos.module.scss";
import { useDefaultOrganization } from "src/hooks/useDefaultOrganization";
import { useFormStore } from "src/hooks/useFormStore";
import { useAccessPermission } from "src/hooks/useAccessPermission";
import { useTodoStatuses } from "src/hooks/useTodoStatuses";
import { makePaneLabel, type LabelSource } from "src/utils/buildPaneLabel";
import ModelForm from "src/components/ModelForm";
import ModelList from "src/components/ModelList";
import Notice, { type NoticeItem } from "src/components/Notice";
import { useFormNotices } from "src/hooks/useFormNotices";

const MODEL_ENDPOINT = "todos";

/**
 * Поля формы задачи.
 *
 * E17 «Стандарт качества» (СК1): вид, приоритет, результат, дата следующего контроля, для ошибки —
 * кто её нашёл и тип. Остальное из СК1 (сроки реакции, напоминания, возвраты, оценка) ставит
 * сервер и действия формы — здесь оно только показывается (derivedFields: в «несохранено» не
 * участвует, в запрос не уходит).
 */
interface TFields {
  id?: number; uuid?: string;
  /** Короткое название: у задач от расписания, проверок учёта и из 1С. Только показ. */
  name: string;
  description: string; status: string;
  kind: string; priority: string;
  /** Что сделано. Без результата задачу не закрыть (п. 1). */
  result: string;
  /** Дата следующего контроля — обязательна для статусов ожидания. */
  nextControlAt: string;
  /** Только у ошибки: кто нашёл (п. 4 — клиент) и тип (п. 6 — повтор разобранной). */
  reportedBy: string; errorTypeUuid: string; errorTypeName: string;
  organizationUuid: string; organizationName: string;
  curatorUuid: string; curatorName: string;
  executorUuid: string; executorName: string;
  /** Почему задача передана другому исполнителю — уходит в журнал передачи (п. 22). */
  transferReason: string;
  createdAt: string; deadline: string; deadlineDays: string;
  /** Объект-источник задачи (документ/справочник/заметка) — ссылка «Источник». */
  sourceType: string; sourceUuid: string; sourceLabel: string;
  /** Откуда пришла задача («из чата в 1С») и подпись происхождения — отдельно от ссылки. */
  origin: string; originLabel: string;
  // ── Только с сервера ──
  /** Статус и исполнитель, с которыми задача загружена: по ним видно смену статуса и передачу. */
  loadedStatus: string; loadedExecutorUuid: string;
  parentTodoUuid: string; checkCode: string;
  acceptedAt: string; reactionDueAt: string; startedAt: string; completedAt: string;
  lastReminderAt: string; helpRequestedAt: string;
  reminderCount: number; returnedCount: number; escalationLevel: number;
  clientRating: string; clientRatingNote: string;
}

const DEFAULT_FIELDS: TFields = {
  name: "", description: "", status: "new",
  kind: "task", priority: "normal", result: "", nextControlAt: "",
  reportedBy: "", errorTypeUuid: "", errorTypeName: "",
  organizationUuid: "", organizationName: "",
  curatorUuid: "", curatorName: "",
  executorUuid: "", executorName: "", transferReason: "",
  createdAt: "", deadline: "", deadlineDays: "",
  sourceType: "", sourceUuid: "", sourceLabel: "",
  origin: "", originLabel: "",
  loadedStatus: "", loadedExecutorUuid: "", parentTodoUuid: "", checkCode: "",
  acceptedAt: "", reactionDueAt: "", startedAt: "", completedAt: "",
  lastReminderAt: "", helpRequestedAt: "",
  reminderCount: 0, returnedCount: 0, escalationLevel: 0,
  clientRating: "", clientRatingNote: "",
};

/** Поля, которые ставит сервер: форма их показывает, но не меняет и не считает несохранёнными. */
const SERVER_FIELDS: readonly (keyof TFields)[] = [
  "name", "loadedStatus", "loadedExecutorUuid", "parentTodoUuid", "checkCode",
  "acceptedAt", "reactionDueAt", "startedAt", "completedAt", "lastReminderAt", "helpRequestedAt",
  "reminderCount", "returnedCount", "escalationLevel", "clientRating", "clientRatingNote",
];

/** Серверная запись задачи — вход mapServerToForm (T3).
 *  curator/executor — пользователи, у которых может быть связанный сотрудник. */
interface TodoServerRecord {
  id?: number;
  uuid?: string;
  name?: string | null;
  description?: string | null;
  status?: string | null;
  organizationUuid?: string | null;
  curatorUuid?: string | null;
  executorUuid?: string | null;
  sourceType?: string | null;
  origin?: string | null;
  originLabel?: string | null;
  sourceUuid?: string | null;
  sourceLabel?: string | null;
  createdAt?: string | null;
  deadline?: string | null;
  deadlineDays?: number | null;
  kind?: string | null;
  priority?: string | null;
  result?: string | null;
  nextControlAt?: string | null;
  reportedBy?: string | null;
  errorTypeUuid?: string | null;
  parentTodoUuid?: string | null;
  checkCode?: string | null;
  acceptedAt?: string | null;
  reactionDueAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  lastReminderAt?: string | null;
  helpRequestedAt?: string | null;
  reminderCount?: number | null;
  returnedCount?: number | null;
  escalationLevel?: number | null;
  clientRating?: number | null;
  clientRatingNote?: string | null;
  organization?: { name?: string | null } | null;
  curator?: { username?: string | null; employee?: { fullName?: string | null } | null } | null;
  executor?: { username?: string | null; employee?: { fullName?: string | null } | null } | null;
}

const TodosForm: FC<Partial<TPane>> = (paneProps) => {
  const defaultOrg = useDefaultOrganization();
  const { canWrite } = useAccessPermission("Todo");
  // Статусы — из справочника (E9.5), а не захардкоженный набор.
  const { statuses, finalCodes } = useTodoStatuses();

  const initialFields: TFields | undefined = (() => {
    const data = paneProps.data;
    if (data?.uuid) return undefined;
    const init = { ...DEFAULT_FIELDS };
    if (data?.organizationUuid) { init.organizationUuid = data?.organizationUuid as string; }
    else if (defaultOrg.organizationUuid) { init.organizationUuid = defaultOrg.organizationUuid; init.organizationName = defaultOrg.organizationName; }
    // Описание и ссылка на источник при создании «из заметки» (см. NotesButton).
    if (data?.description) init.description = asText(data.description);
    if (data?.sourceType) init.sourceType = asText(data.sourceType);
    if (data?.sourceUuid) init.sourceUuid = asText(data.sourceUuid);
    if (data?.sourceLabel) init.sourceLabel = asText(data.sourceLabel);
    return init;
  })();

  const form = useFormStore<TFields>({
    endpoint: MODEL_ENDPOINT, storageKey: "todos-form", defaultFields: DEFAULT_FIELDS, initialFields, paneProps,
    derivedFields: SERVER_FIELDS,
    mapServerToForm: async (d: TodoServerRecord, prev) => {
      const errorTypeUuid = d.errorTypeUuid ?? "";
      // Подпись типа ошибки: связи в ответе нет. Тот же тип, что был (после записи), — прежняя подпись.
      const errorTypeName = !errorTypeUuid ? ""
        : prev?.errorTypeUuid === errorTypeUuid && prev.errorTypeName ? prev.errorTypeName
          : await fetchRecordName("error-types", errorTypeUuid);
      return {
        ...(prev ?? DEFAULT_FIELDS),
        name: d.name ?? "",
        description: d.description ?? "", status: d.status ?? "new",
        kind: d.kind || "task", priority: d.priority || "normal",
        result: d.result ?? "", nextControlAt: d.nextControlAt?.slice(0, 10) ?? "",
        reportedBy: d.reportedBy ?? "", errorTypeUuid, errorTypeName,
        organizationUuid: d.organizationUuid ?? "", organizationName: d.organization?.name ?? "",
        curatorUuid: d.curatorUuid ?? "", curatorName: d.curator?.employee?.fullName || d.curator?.username || "",
        executorUuid: d.executorUuid ?? "", executorName: d.executor?.employee?.fullName || d.executor?.username || "",
        transferReason: "",
        createdAt: d.createdAt?.slice(0, 10) ?? "",
        deadline: d.deadline?.slice(0, 10) ?? "", deadlineDays: d.deadlineDays?.toString() ?? "",
        sourceType: d.sourceType ?? "", sourceUuid: d.sourceUuid ?? "", sourceLabel: d.sourceLabel ?? "",
        // Происхождение только показываем: ставит его тот, кто создал запись (панель или канал 1С).
        origin: d.origin ?? "", originLabel: d.originLabel ?? "",
        loadedStatus: d.status ?? "new", loadedExecutorUuid: d.executorUuid ?? "",
        parentTodoUuid: d.parentTodoUuid ?? "", checkCode: d.checkCode ?? "",
        acceptedAt: d.acceptedAt ?? "", reactionDueAt: d.reactionDueAt ?? "",
        startedAt: d.startedAt ?? "", completedAt: d.completedAt ?? "",
        lastReminderAt: d.lastReminderAt ?? "", helpRequestedAt: d.helpRequestedAt ?? "",
        reminderCount: d.reminderCount ?? 0, returnedCount: d.returnedCount ?? 0, escalationLevel: d.escalationLevel ?? 0,
        clientRating: d.clientRating != null ? String(d.clientRating) : "", clientRatingNote: d.clientRatingNote ?? "",
        id: d.id, uuid: d.uuid,
      };
    },
    buildPayload: (fd) => {
      const isEdit = !!fd.uuid;
      const status = fd.status || "new";
      // Правила сервера (СК1.2) — до запроса: финал без результата и ожидание без даты контроля
      // вернулись бы 400; <Notice /> формы скажет то же самое сразу.
      const err = todoFormError({ isEdit, status, loadedStatus: fd.loadedStatus, statuses, result: fd.result, nextControlAt: fd.nextControlAt });
      if (err) return err;
      const kind = fd.kind || "task";
      const transferred = isEdit && !!fd.loadedExecutorUuid && fd.executorUuid !== fd.loadedExecutorUuid;
      return {
        description: fd.description?.trim() || null, status,
        // counterpartyUuid НЕ отправляем: поля контрагента в форме нет, а null затирал бы
        // контрагента, которого задаче поставил сервер (проверка исправления ошибки, канал 1С).
        organizationUuid: fd.organizationUuid || null,
        curatorUuid: fd.curatorUuid || null, executorUuid: fd.executorUuid || null,
        deadline: fd.deadline || null, deadlineDays: fd.deadlineDays || null,
        sourceType: fd.sourceType || null, sourceUuid: fd.sourceUuid || null,
        sourceLabel: fd.sourceLabel || null,
        kind, priority: fd.priority || "normal",
        result: fd.result?.trim() || null,
        nextControlAt: fd.nextControlAt || null,
        // Кто нашёл и тип — только у ошибки: у другого вида сервер их всё равно не хранит.
        reportedBy: kind === "error" ? fd.reportedBy || null : null,
        errorTypeUuid: kind === "error" ? fd.errorTypeUuid || null : null,
        ...(transferred ? { transferReason: fd.transferReason?.trim() || null } : {}),
      };
    },
    buildPaneLabel: (saved: LabelSource & { description?: string | null }) => makePaneLabel("TodosList", "Задачи", saved, saved.description ? String(saved.description).slice(0, 60) : undefined),
  });

  // Ошибки ДАННЫХ формы → <Notice /> внутри формы (системные — в <UIToast />).
  const formNotices = useFormNotices(form);
  // Отказ действия без своего окна («Принять в работу») — тоже сообщение формы.
  const [actionNotices, setActionNotices] = useState<NoticeItem[]>([]);
  // Журнал грузим, когда вкладку «История» открыли (все вкладки смонтированы сразу).
  const [historyOpened, setHistoryOpened] = useState(false);

  const { fields, formUid, isLoading, isEditMode, isDirty, setField, setFields, store, loadFromServer } = form;

  /*
   * СТАТУС С ДОСКИ (TaskBoard): карточку бросили в «Выполнена»/«Ждём клиента», а для этого не хватает
   * результата или даты контроля — доска открывает задачу с выбранным статусом. Ставим его один раз,
   * после первой загрузки, как правку пользователя: форма «несохранена», поле результата — обязательное.
   */
  const pendingStatusRef = useRef(asText(paneProps.data?.nextStatus));
  useEffect(() => {
    const next = pendingStatusRef.current;
    if (form.isInitialLoading || !next) return;
    pendingStatusRef.current = "";
    if (store.getSnapshot().fields.status !== next) setField("status", next);
  }, [form.isInitialLoading, store, setField]);

  const handleDeadlineDaysChange = useCallback((value: string) => {
    const days = parseInt(value);
    const snap = store.getSnapshot().fields;
    const base = snap.createdAt ? new Date(snap.createdAt) : new Date();
    const deadline = !isNaN(days) && days > 0
      ? new Date(base.getTime() + days * 86400000).toISOString().substring(0, 10)
      : snap.deadline;
    setFields({ deadlineDays: value, deadline } as Partial<TFields>);
  }, [store, setFields]);

  /** После действия (принять, напомнить, вернуть…) — перечитать задачу с сервера. */
  const reloadAfterAction = useCallback(async () => {
    const uuid = store.getSnapshot().meta.uuid || store.getSnapshot().fields.uuid;
    if (uuid) await loadFromServer(uuid, { noCache: true });
  }, [store, loadFromServer]);

  const statusName = useCallback((code: string) => statuses.find((s) => s.code === code)?.name ?? code, [statuses]);

  // ── Что показывать ──────────────────────────────────────────────────────────
  const status = fields.status || "new";
  const isError = fields.kind === "error";
  const finalNow = isFinalStatus(statuses, status);
  const waitingNow = isWaitingStatus(statuses, status);
  // Правило результата действует, если статус меняется на финальный (или задача новая);
  // правку уже закрытой задачи без смены статуса сервер не блокирует — и форма не требует.
  const resultEnforced = needsResult(statuses, status) && !(isEditMode && status === fields.loadedStatus);
  const showResult = finalNow || !!fields.result.trim();
  const showNextControl = waitingNow || !!fields.nextControlAt;
  const transferred = isEditMode && !!fields.loadedExecutorUuid && fields.executorUuid !== fields.loadedExecutorUuid;
  const overdueReaction = reactionOverdue({ ...fields, status: fields.loadedStatus || status }, finalCodes);

  const notices = useMemo<NoticeItem[]>(() => {
    const out: NoticeItem[] = [...formNotices, ...actionNotices];
    if (overdueReaction) out.push({ type: "warning", text: translate("todoReactionOverdue") });
    // Сводную задачу по находкам закрывает прогон проверки (СК2.3) — сказать, почему «Выполнена» не спасёт.
    if (fields.kind === "check_finding") out.push({ type: "info", text: translate("todoCheckFindingHint") });
    return out;
  }, [formNotices, actionNotices, overdueReaction, fields.kind]);

  const tabs = useMemo(() => {
    const escalation = fields.escalationLevel >= 2 ? translate("todoEscalationManager")
      : fields.escalationLevel === 1 ? translate("todoEscalationChief") : "";
    // Сроки и контроль исполнения — только то, что есть: пустые строки ничего не говорят.
    const controlRows = isEditMode ? [
      fields.reactionDueAt && (
        <ValueRow key="reaction" label={translate("todoReactionDueAt")}>
          <span className={overdueReaction ? todoStyles.Overdue : undefined}>{getFormatDate(fields.reactionDueAt)}</span>
        </ValueRow>
      ),
      fields.acceptedAt && <ValueRow key="accepted" label={translate("todoAcceptedAt")} value={getFormatDate(fields.acceptedAt)} />,
      fields.startedAt && <ValueRow key="started" label={translate("todoStartedAt")} value={getFormatDate(fields.startedAt)} />,
      fields.completedAt && <ValueRow key="completed" label={translate("todoCompletedAt")} value={getFormatDate(fields.completedAt)} />,
      fields.reminderCount > 0 && (
        <ValueRow key="reminders" label={translate("todoReminderCount")}
          value={fields.lastReminderAt ? `${fields.reminderCount} · ${getFormatDate(fields.lastReminderAt)}` : String(fields.reminderCount)} />
      ),
      fields.returnedCount > 0 && <ValueRow key="returned" label={translate("todoReturnedCount")} value={String(fields.returnedCount)} />,
      escalation && <ValueRow key="escalation" label={translate("todoEventEscalation")} value={escalation} />,
      fields.helpRequestedAt && <ValueRow key="help" label={translate("todoHelpRequestedAt")} value={getFormatDate(fields.helpRequestedAt)} />,
      fields.clientRating && (
        <ValueRow key="rating" label={translate("todoClientRating")}
          value={[translate("todoRatingValue").replace("{n}", fields.clientRating), fields.clientRatingNote].filter(Boolean).join(" · ")} />
      ),
      fields.parentTodoUuid && (
        <ValueRow key="parent" label={translate("todoParentTask")}>
          <ObjectLink objectRef={refFromRestore({ kind: "form", endpoint: MODEL_ENDPOINT, uuid: fields.parentTodoUuid }, translate("todoParentTask"))} />
        </ValueRow>
      ),
    ].filter(Boolean) : [];

    const t: { id: string; label: string; component: React.ReactNode }[] = [
      {
        id: "tab-details", label: translate("general"), component: (
          <div className={styles.FormWrapper}>
            <div className={styles.Form}>
              <GroupCol>
                {/* Название показываем, если оно не начало описания: у задач из 1С название — первые
                    строки описания, а у задач расписания и проверок учёта — самостоятельный заголовок. */}
                {fields.name && !fields.description.startsWith(fields.name) && (
                  <Group>
                    <Field label={translate("name")} name={`${formUid}_name`} value={fields.name} disabled minWidth={FIELD_WIDTH.lg} />
                  </Group>
                )}
                <GroupRow>
                  <Group className={styles.w1of3}>
                    <FieldSelect label={translate("todoKind")} name={`${formUid}_kind`} options={kindOptions(fields.kind)} value={fields.kind}
                      onChange={e => setField("kind", e.target.value)} disabled={isLoading || isKindLocked(fields.kind)} />
                  </Group>
                  <Group className={styles.w1of3}>
                    <FieldSelect label={translate("priority")} name={`${formUid}_priority`} options={priorityOptions(fields.priority)} value={fields.priority}
                      onChange={e => setField("priority", e.target.value)} disabled={isLoading} />
                  </Group>
                  <Group className={styles.w1of3}>
                    <FieldSelect label={translate("status")} name={`${formUid}_status`} options={buildStatusOptions(statuses, status)} value={status}
                      onChange={e => setField("status", e.target.value)} disabled={isLoading} />
                  </Group>
                </GroupRow>
                {isError && (
                  <Group>
                    <FieldSelect label={translate("todoReportedBy")} name={`${formUid}_reportedBy`} options={reportedByOptions()} value={fields.reportedBy}
                      onChange={e => setField("reportedBy", e.target.value)} disabled={isLoading} hint={translate("todoReportedByHint")} />
                    <FormLookup form={form} field="errorType" endpoint="error-types" label={translate("errorType")} minWidth={FIELD_WIDTH.wide} />
                  </Group>
                )}
                <Group>
                  <FormLookup form={form} field="organization" endpoint="organizations" minWidth={FIELD_WIDTH.lg} />
                </Group>
                <Group>
                  <FormLookup form={form} field="curator" endpoint="users" displayField="username" secondaryFields={["employee.fullName"]} minWidth={FIELD_WIDTH.lg}
                    onSelect={(uuid, display, item: { employee?: { fullName?: string | null } | null }) => setFields({ curatorUuid: uuid, curatorName: item?.employee?.fullName || display } as Partial<TFields>)} />
                  <FormLookup form={form} field="executor" endpoint="users" displayField="username" secondaryFields={["employee.fullName"]} minWidth={FIELD_WIDTH.lg}
                    onSelect={(uuid, display, item: { employee?: { fullName?: string | null } | null }) => setFields({ executorUuid: uuid, executorName: item?.employee?.fullName || display } as Partial<TFields>)} />
                </Group>
                {transferred && (
                  <Group>
                    <Field label={translate("todoTransferReason")} name={`${formUid}_transferReason`} value={fields.transferReason}
                      onChange={e => setField("transferReason", e.target.value)} disabled={isLoading} minWidth={FIELD_WIDTH.lg}
                      hint={translate("todoTransferHint")} />
                  </Group>
                )}
                <GroupRow>
                  <Group className={styles.w1of2}>
                    <FieldDate label={translate("createdAt")} name={`${formUid}_createdAt`} width={FIELD_WIDTH.date} value={fields.createdAt} disabled />
                    <FieldNumber label={translate("days")} name={`${formUid}_deadlineDays`} width={FIELD_WIDTH.sm} value={fields.deadlineDays} onChange={e => handleDeadlineDaysChange(e.target.value)} disabled={isLoading} decimals={0} />
                  </Group>
                  <Group className={styles.w1of2}>
                    <FieldDate label={translate("deadline")} name={`${formUid}_deadline`} width={FIELD_WIDTH.date} value={fields.deadline} onChange={e => setField("deadline", e.target.value)} disabled={isLoading}
                      hint={!isEditMode && fields.kind === "client_request" && !fields.deadline ? translate("todoDeadlineSlaHint") : undefined} />
                  </Group>
                </GroupRow>
                {showNextControl && (
                  <Group>
                    <FieldDate label={translate("todoNextControlAt")} name={`${formUid}_nextControlAt`} width={FIELD_WIDTH.date} value={fields.nextControlAt}
                      onChange={e => setField("nextControlAt", e.target.value)} disabled={isLoading} required={waitingNow}
                      hint={waitingNow ? translate("todoNextControlHint") : undefined} />
                  </Group>
                )}
                <Group>
                  <FieldTextarea label={translate("taskDescription")} name={`${formUid}_description`} value={fields.description} onChange={e => setField("description", e.target.value)} disabled={isLoading} minWidth={FIELD_WIDTH.lg} minHeight="120px" rows={6} />
                </Group>
                {showResult && (
                  <Group>
                    <FieldTextarea label={translate("result")} name={`${formUid}_result`} value={fields.result} onChange={e => setField("result", e.target.value)}
                      disabled={isLoading} minWidth={FIELD_WIDTH.lg} minHeight="80px" rows={4} required={resultEnforced}
                      hint={translate("todoResultHint")} />
                  </Group>
                )}
                {/* Объект, из которого создана задача (напр. заметка к документу) —
                    клик по чипу открывает сам объект. Подпись = «Тип + ссылка»
                    (напр. «Реализация ТМЗ и услуг № 12 - 01.02.2026»), а не сырой
                    код типа: имя типа берём из реестра моделей. */}
                {/* ОТКУДА ПРИШЛА задача — не то же, что «на что ссылается»: задача из чата 1С
                    может быть связана с созданным там документом, и видеть нужно обе вещи. */}
                {isFromOnec(fields) && (
                  <Group>
                    <div className={todoStyles.InlineRow}>
                      <span className={todoStyles.InlineLabel}>{translate("origin")}:</span>
                      <span>{onecOriginLabel(originOf(fields).label)}</span>
                    </div>
                  </Group>
                )}
                {fields.sourceUuid && (
                  <Group>
                    <div className={todoStyles.InlineRow}>
                      <span className={todoStyles.InlineLabel}>{translate("source")}:</span>
                      {/* Объект 1С в панели не открыть — его здесь нет. Подпись показываем, а ссылку
                          не делаем: чип, ведущий в «не найдено», хуже простого текста. */}
                      {isOnecObject(fields.sourceType)
                        ? <span>{sourceChipLabel(fields.sourceType, fields.sourceLabel)}</span>
                        : (
                          <ObjectLink
                            objectRef={refFromRestore(
                              { kind: "form", endpoint: fields.sourceType, uuid: fields.sourceUuid },
                              sourceChipLabel(fields.sourceType, fields.sourceLabel),
                            )}
                          />
                        )}
                    </div>
                  </Group>
                )}
                {/* Сроки и контроль исполнения (E17): ставит сервер и действия формы, здесь — только показ. */}
                {controlRows.length > 0 && (
                  <FormArea title={translate("todoControlArea")}>
                    <ValueList>{controlRows}</ValueList>
                  </FormArea>
                )}
                {/* Метки — ссылки на связанные объекты (справочники/документы/задачи).
                    Доступны у сохранённой задачи; ObjectMarks сам скрывается без uuid. */}
                <Group>
                  <ObjectMarks
                    endpoint={MODEL_ENDPOINT}
                    uuid={fields.uuid}
                    organizationUuid={fields.organizationUuid || undefined}
                    readonly={!canWrite}
                  />
                </Group>
              </GroupCol>
            </div>

            <GroupCol className={styles.FormNotice}>
              <Notice items={notices} />
            </GroupCol>
          </div>
        )
      },
    ];
    if (isEditMode && fields.uuid) {
      t.push({ id: "files", label: translate("files"), component: <FilesPanel ownerType="todo" ownerUuid={fields.uuid} /> });
      t.push({ id: "history", label: translate("todoHistory"), component: <TodoHistory uuid={fields.uuid} active={historyOpened} statusName={statusName} /> });
    }
    return t;
  }, [form, fields, formUid, isLoading, isEditMode, setField, setFields, handleDeadlineDaysChange, canWrite, statuses, status, isError,
    waitingNow, resultEnforced, showResult, showNextControl, transferred, overdueReaction, notices, historyOpened, statusName]);

  return (
    <ModelForm paneId={form.paneId} endpoint={MODEL_ENDPOINT} recordUuid={fields.uuid} tabs={tabs} onSave={form.handleSave} onSaveAndClose={form.handleSaveAndClose} onClose={form.handleClose}
      onReload={isEditMode ? form.handleReload : undefined} isLoading={isLoading} isInitialLoading={form.isInitialLoading}
      readonly={!canWrite} hideMarks
      onTabChange={(id) => { if (id === "history") setHistoryOpened(true); }}
      afterCloseButtons={canWrite && isEditMode && fields.uuid ? (
        <TodoActions uuid={fields.uuid} kind={fields.kind} status={fields.loadedStatus} acceptedAt={fields.acceptedAt} statuses={statuses}
          busy={isLoading} dirty={isDirty} onNotices={setActionNotices} onDone={reloadAfterAction} />
      ) : undefined} />
  );
};
TodosForm.displayName = "TodosForm";

/** Подпись приоритета в списке: срочное и высокое выделены — их ищут глазами первыми. */
const PRIORITY_CLASS: Record<string, string | undefined> = {
  high: todoStyles.PriorityHigh,
  urgent: todoStyles.PriorityUrgent,
};

const TodosList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void; ownerUuid?: string; ownerField?: string; extraQueryParams?: Record<string, string> }> = ({ variant, onSelectItem, ownerUuid, ownerField, extraQueryParams }) => {
  /*
   * ФИЛЬТР ПО ПРОИСХОЖДЕНИЮ (ПН2). Задач из 1С со временем станет больше, чем заведённых руками, и
   * «показать только их» (или наоборот) — первое, что спросят. Отбор идёт на сервере, как и весь
   * список: страница в тысячу задач не должна приезжать в браузер ради одного признака.
   *
   * «Из панели» — это ПУСТОЕ происхождение, и отбирается оно оператором `isNull`, а не «не равно»:
   * Prisma в `not` строки со значением NULL не возвращает (проверено на живой базе), и «не из 1С»
   * так не выразить.
   */
  /*
   * СТАТУС В СПИСКЕ — ИЗ СПРАВОЧНИКА (С3.3 аудита 23.09). Подписи статусов были перечислены в columns.json
   * («new» → «Новая» и так далее), тогда как форма и сервис давно работают со справочником `TodoStatus`:
   * добавленный статус в списке было не увидеть. Хуже того, тип колонки `select` таблица не умеет вовсе —
   * ячейка выходила ПУСТОЙ, а не с сырым кодом. Подпись берём там же, где её берёт форма; неизвестный код
   * показываем как есть: пустая ячейка не отличима от «статуса нет».
   */
  const { statuses } = useTodoStatuses();
  const statusLabels = useMemo(() => new Map(statuses.map((s) => [s.code, s.name])), [statuses]);
  const [origin, setOrigin] = useState("");
  // Вид задачи (E17): «только обращения клиентов», «только ошибки» — тоже отбор на сервере.
  const [kind, setKind] = useState("");
  const extraFilter = useMemo(() => {
    const f: Record<string, string | { value: unknown; operator: string }> = {};
    if (origin === ONEC_CHAT_SOURCE) f.origin = ONEC_CHAT_SOURCE;
    else if (origin === "panel") f.origin = { value: true, operator: "isNull" };
    if (kind) f.kind = kind;
    return Object.keys(f).length ? f : undefined;
  }, [origin, kind]);
  const kindFilterOptions = useMemo(() => [
    { value: "", label: translate("todoKindAll") },
    ...Object.keys(KIND_LABEL_KEYS).map((k) => ({ value: k, label: kindLabel(k) })),
  ], []);
  return (
    <ModelList endpoint={MODEL_ENDPOINT} listName="TodosList" columnsJson={columnsJson} FormComponent={TodosForm}
      getLabel={(d) => {
        // У задач от расписания и проверок учёта описания может не быть — тогда подпись по названию.
        const text = asText(d?.description) || asText(d?.name);
        return text ? text.slice(0, 50) + (text.length > 50 ? "..." : "") : "?";
      }}
      variant={variant} onSelectItem={onSelectItem} ownerUuid={ownerUuid} ownerField={ownerField}
      extraQueryParams={extraQueryParams} defaultSort={{ id: "desc" }}
      extraFilter={extraFilter}
      renderCell={(row, col) => {
        if (col.identifier === "sourceLabel") return sourceCellText(row);
        if (col.identifier === "status") {
          const code = asText(row.status);
          return <span>{statusLabels.get(code) ?? code}</span>;
        }
        if (col.identifier === "kind") return <span>{kindLabel(row.kind)}</span>;
        if (col.identifier === "priority") {
          const code = asText(row.priority);
          return <span className={PRIORITY_CLASS[code]}>{priorityLabel(code)}</span>;
        }
        return undefined;
      }}
      extraButtons={(
        <>
          <FieldSelect name="todos_origin" label={translate("origin")} size="sm" value={origin}
            onChange={(e) => setOrigin(e.target.value)}
            options={[
              { value: "", label: translate("todoSourceAll") },
              { value: "panel", label: translate("todoFromPanel") },
              { value: ONEC_CHAT_SOURCE, label: translate("todoFromOnec") },
            ]} />
          <FieldSelect name="todos_kind" label={translate("todoKind")} size="sm" value={kind}
            onChange={(e) => setKind(e.target.value)} options={kindFilterOptions} />
        </>
      )} />
  );
};
TodosList.displayName = "TodosList";

export { TodosList, TodosForm };

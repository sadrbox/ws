/**
 * Чек-листы самопроверки (E17 СК3, пп. 26–28 стандарта): прогон шаблона по клиенту за период.
 *
 * Исполнитель отмечает пункты («ок», «не применимо», «проблема» с комментарием) и сдаёт
 * чек-лист главбуху; главбух подписывает — это его установленный контроль (п. 28).
 *
 * Сервер не принимает «ок» по пункту с привязкой к проверке учёта, пока по ней у клиента
 * открыты ошибки, а при открытых предупреждениях требует комментарий: его текст показываем
 * у самого пункта. Если после «ок» ночной прогон найдёт за этот период новую находку той же
 * проверки — это кандидат по п. 27 (исполнителю) и, после подписи, по п. 28 (главбуху).
 */
import { FC, useCallback, useEffect, useMemo, useState, type ComponentType } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { TPane } from "src/app/types";
import type { TColumn, TDataItem } from "src/components/Table/types";
import type { TTableVariant } from "src/components/Table";
import ModelList from "src/components/ModelList";
import ModelForm from "src/components/ModelForm";
import Notice, { type NoticeItem } from "src/components/Notice";
import { Button } from "src/components/Button";
import { Field, FieldSelect, FieldTextarea } from "src/components/Field";
import { FIELD_WIDTH } from "src/components/Field/fieldWidths";
import { Group, GroupCol } from "src/components/UI";
import { HelpBox, HelpText } from "src/components/HelpBox";
import { showToast } from "src/components/UIToast";
import { useAppContext } from "src/app/context";
import { useQualityMe } from "src/hooks/useQualityMe";
import { routeError } from "src/services/errors/route";
import {
	deleteChecklistRun, fetchChecklistRun, markChecklistItem, reviewChecklistRun, submitChecklistRun,
	type ChecklistItemStatus, type ChecklistRun, type ChecklistRunItem,
} from "src/services/quality/api";
import { checkLabel } from "src/services/quality/checkCatalog";
import { makePaneLabel, makePaneLabelFromData } from "src/utils/buildPaneLabel";
import { getFormatDate } from "src/utils/datetime";
import { asText } from "src/utils/asText";
import { cx } from "src/utils/cx";
import { translate } from "src/i18";
import QualityChip from "src/models/_quality/QualityChip";
import { QualityListButtons } from "src/models/_quality/ListButtons";
import { useQualityListActions } from "src/models/_quality/useQualityListActions";
import { openFindingsPane } from "src/models/CheckFindings/openFindings";
import { CreateChecklistRunModal } from "./CreateRunModal";
import {
	MARKS, itemStatusLabel, itemStatusTone, pendingCount, periodText, progressText, runStatusLabel, runStatusTone,
} from "./runView";
import columnsJson from "./columns.json";
import styles from "./ChecklistRuns.module.scss";

const MODEL_ENDPOINT = "checklist-runs";
const LIST_NAME = "ChecklistRunsList";
/** Ключ карточки — вне ключей списка: перечитывание списка не должно дёргать открытую карточку. */
const runKey = (uuid: string) => ["quality", "checklist-run", uuid] as const;

const ITEM_CLASS: Partial<Record<ChecklistItemStatus, string>> = { ok: styles.ItemOk, problem: styles.ItemProblem, na: styles.ItemNa };

export const ChecklistRunsForm: FC<Partial<TPane>> = ({ uniqId, data }) => {
	const uuid = asText(data?.uuid);
	const { addPane, requestClose, updatePaneLabel } = useAppContext().windows;
	const { confirm } = useAppContext().actions;
	const { me } = useQualityMe();
	const qc = useQueryClient();
	const q = useQuery({ queryKey: runKey(uuid), queryFn: async () => (await fetchChecklistRun(uuid)).item, enabled: !!uuid });
	const run = q.data;
	const items = useMemo(() => run?.items ?? [], [run?.items]);

	const [drafts, setDrafts] = useState<Record<string, string>>({});
	const [itemNotices, setItemNotices] = useState<Record<string, NoticeItem[]>>({});
	const [busy, setBusy] = useState<string | null>(null);
	const [formNotices, setFormNotices] = useState<NoticeItem[]>([]);

	// Отказ загрузки (нет доступа, удалён) — сообщение формы; системный сбой routeError покажет тостом.
	useEffect(() => {
		if (q.error) setFormNotices(routeError(q.error, { source: translate("ChecklistRunsForm") }));
	}, [q.error]);

	// Подпись вкладки — после загрузки: открыть могли и по ссылке (только uuid).
	useEffect(() => {
		if (!run || !uniqId) return;
		const detail = run.clientName ? `${run.name} · ${run.clientName}` : run.name;
		updatePaneLabel(uniqId, makePaneLabel(LIST_NAME, translate("ChecklistRunsForm"), { id: run.id, name: run.name }, detail));
	}, [run, uniqId, updatePaneLabel]);

	const refresh = useCallback(async () => {
		await q.refetch();
		void qc.invalidateQueries({ queryKey: [MODEL_ENDPOINT] });
	}, [q, qc]);

	const canMarkNow = !!run?.canMark && run.status !== "reviewed";

	const mark = useCallback(async (item: ChecklistRunItem, status: Exclude<ChecklistItemStatus, "pending">) => {
		const comment = (drafts[item.uuid] ?? item.comment ?? "").trim();
		// Правило сервера повторено здесь, чтобы ответ был на языке интерфейса и без запроса.
		if (status === "problem" && !comment) {
			setItemNotices((p) => ({ ...p, [item.uuid]: [{ type: "error", text: translate("checklistRunProblemNeedsComment") }] }));
			return;
		}
		setBusy(item.uuid);
		try {
			await markChecklistItem(uuid, item.uuid, status, comment || undefined);
			setItemNotices((p) => ({ ...p, [item.uuid]: [] }));
			setDrafts((p) => {
				const next = { ...p };
				delete next[item.uuid];
				return next;
			});
			await refresh();
		} catch (e) {
			// «Нельзя отметить „ок“: открыто ошибок — N» — ответ ЭТОМУ пункту, его и показываем рядом.
			setItemNotices((p) => ({ ...p, [item.uuid]: routeError(e, { source: translate("ChecklistRunsForm") }) }));
		} finally {
			setBusy(null);
		}
	}, [drafts, uuid, refresh]);

	const act = useCallback(async (kind: "submit" | "review" | "delete") => {
		if (!run) return;
		const question = { submit: "checklistRunSubmitConfirm", review: "checklistRunReviewConfirm", delete: "checklistRunDeleteConfirm" }[kind];
		if (!(await confirm(translate(question)))) return;
		setBusy(kind);
		setFormNotices([]);
		try {
			if (kind === "submit") await submitChecklistRun(run.uuid);
			else if (kind === "review") await reviewChecklistRun(run.uuid);
			else await deleteChecklistRun(run.uuid);
			showToast(translate({ submit: "checklistRunSubmitted", review: "checklistRunReviewed", delete: "checklistRunDeleted" }[kind]), "success");
			if (kind === "delete") {
				void qc.invalidateQueries({ queryKey: [MODEL_ENDPOINT] });
				if (uniqId) await requestClose(uniqId, { force: true });
				return;
			}
			await refresh();
		} catch (e) {
			setFormNotices(routeError(e, { source: translate("ChecklistRunsForm") }));
		} finally {
			setBusy(null);
		}
	}, [run, confirm, qc, uniqId, requestClose, refresh]);

	const openFindings = useCallback((checkCode: string) => {
		if (!run) return;
		openFindingsPane(addPane, { organizationUuid: run.clientOrganizationUuid, organizationName: run.clientName ?? "", checkCode, state: "open" });
	}, [addPane, run]);

	const pending = pendingCount(items);
	const mayDelete = !!run && !!me && (run.status !== "reviewed" || me.isAdmin) && (run.canMark || me.isHead || me.isAdmin);
	const name = `checklist_run_${uuid}`;

	const tabs = useMemo(() => [{
		id: "tab-run", label: translate("checklistRunItemsTab"), component: (
			<div className={styles.Body}>
				{run && (
					<GroupCol>
						<div className={styles.Chips}>
							<QualityChip tone={runStatusTone(run.status)}>{runStatusLabel(run.status)}</QualityChip>
							{run.progress && <QualityChip tone={run.progress.problems ? "bad" : "muted"}>{progressText(run.progress)}</QualityChip>}
						</div>
						<Group>
							<Field label={translate("checklistRunClient")} name={`${name}_client`} value={run.clientName ?? ""} disabled minWidth={FIELD_WIDTH.lg} />
							<Field label={translate("period")} name={`${name}_period`} value={periodText(run.periodFrom, run.periodTo)} disabled width={FIELD_WIDTH.wide} />
						</Group>
						<Group>
							<Field label={translate("executor")} name={`${name}_executor`} value={run.executorName ?? ""} disabled width={FIELD_WIDTH.wide} />
							<Field label={translate("checklistRunReviewer")} name={`${name}_reviewer`} value={run.reviewerName ?? ""} disabled width={FIELD_WIDTH.wide} />
						</Group>
						<Group>
							<Field label={translate("checklistRunSubmittedAt")} name={`${name}_submitted`} value={getFormatDate(run.submittedAt ?? undefined)} disabled width={FIELD_WIDTH.date} />
							<Field label={translate("checklistRunReviewedAt")} name={`${name}_reviewed`} value={getFormatDate(run.reviewedAt ?? undefined)} disabled width={FIELD_WIDTH.date} />
						</Group>
					</GroupCol>
				)}
				<HelpBox title={translate("checklistRunHelpTitle")}>
					<HelpText text={translate("checklistRunHelp")} />
				</HelpBox>
				{run && !items.length && <span className={styles.Empty}>{translate("checklistRunNoItems")}</span>}
				<div className={styles.Items}>
					{items.map((item, i) => {
						const comment = drafts[item.uuid] ?? item.comment ?? "";
						const changed = comment.trim() !== (item.comment ?? "").trim();
						return (
							<div key={item.uuid} className={cx(styles.Item, ITEM_CLASS[item.status])}>
								<div className={styles.ItemHead}>
									<span className={styles.ItemNum}>{i + 1}</span>
									<span className={styles.ItemText}>{item.text}</span>
									<QualityChip tone={itemStatusTone(item.status)}>{itemStatusLabel(item.status)}</QualityChip>
									{item.checkCode && (
										<button type="button" className={styles.CheckLink} onClick={() => openFindings(item.checkCode ?? "")}
											title={translate("checklistRunCheckLinkHint")}>
											{checkLabel(item.checkCode, item.checkTitle)}
										</button>
									)}
								</div>
								<div className={styles.ItemControls}>
									<div className={styles.Marks} role="group" aria-label={translate("checklistRunMarks")}>
										{MARKS.map((m) => (
											<Button key={m} size="sm" variant={item.status === m ? "primary" : "secondary"} active={item.status === m}
												disabled={!canMarkNow || busy !== null} onClick={() => void mark(item, m)}>
												{itemStatusLabel(m)}
											</Button>
										))}
									</div>
									<div className={styles.Comment}>
										<FieldTextarea name={`${name}_comment${i}`} value={comment} rows={2} disabled={!canMarkNow || busy !== null}
											placeholder={translate("checklistRunCommentPlaceholder")}
											onChange={(e) => setDrafts((p) => ({ ...p, [item.uuid]: e.target.value }))} />
									</div>
									{canMarkNow && changed && item.status !== "pending" && (
										<Button size="sm" disabled={busy !== null} onClick={() => void mark(item, item.status as Exclude<ChecklistItemStatus, "pending">)}>
											{translate("checklistRunSaveComment")}
										</Button>
									)}
								</div>
								{item.confirmedAt && (
									<div className={styles.ItemMeta}>
										{translate("checklistRunConfirmed")}: {item.confirmedByName ?? ""} · {getFormatDate(item.confirmedAt)}
									</div>
								)}
								{(itemNotices[item.uuid] ?? []).length > 0 && (
									<div className={styles.ItemNotice}>
										<Notice inline items={itemNotices[item.uuid]} />
									</div>
								)}
							</div>
						);
					})}
				</div>
				<Notice items={formNotices} />
			</div>
		),
	}], [run, items, name, drafts, itemNotices, busy, canMarkNow, formNotices, mark, openFindings]);

	const actions = run ? (
		<>
			<Button onClick={() => void refresh()} disabled={q.isFetching}>{translate("refresh")}</Button>
			{run.canMark && run.status === "open" && (
				<Button variant="primary" onClick={() => void act("submit")} disabled={busy !== null || pending > 0}
					title={pending > 0 ? translate("checklistRunPendingLeft").replace("{n}", String(pending)) : undefined}>
					{translate("checklistRunSubmit")}
				</Button>
			)}
			{run.canReview && (
				<Button variant="primary" onClick={() => void act("review")} disabled={busy !== null}>{translate("checklistRunReview")}</Button>
			)}
			{mayDelete && <Button onClick={() => void act("delete")} disabled={busy !== null}>{translate("delete")}</Button>}
		</>
	) : undefined;

	return (
		<ModelForm paneId={uniqId} tabs={tabs} onSave={() => undefined} onSaveAndClose={() => undefined}
			onClose={() => { if (uniqId) void requestClose(uniqId); }} isLoading={q.isLoading} isInitialLoading={q.isLoading}
			readonly afterCloseButtons={actions} />
	);
};
ChecklistRunsForm.displayName = "ChecklistRunsForm";

export const ChecklistRunsList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void }> = ({ variant, onSelectItem }) => {
	const { me } = useQualityMe();
	const { addPane } = useAppContext().windows;
	const { deleteRows, refresh } = useQualityListActions(MODEL_ENDPOINT, LIST_NAME, ChecklistRunsForm as ComponentType<Record<string, unknown>>);
	const [creating, setCreating] = useState(false);
	const [status, setStatus] = useState("");
	const extraFilter = useMemo(() => (status ? { status } : undefined), [status]);

	const openRun = useCallback((run: ChecklistRun) => {
		addPane({
			component: ChecklistRunsForm,
			label: makePaneLabelFromData(LIST_NAME, translate(LIST_NAME), { id: run.id, uuid: run.uuid, name: run.name }),
			data: { uuid: run.uuid } as Partial<TDataItem>,
			restore: { kind: "form", endpoint: MODEL_ENDPOINT, uuid: run.uuid },
		});
	}, [addPane]);

	const renderCell = useCallback((row: TDataItem, col: TColumn) => {
		switch (col.identifier) {
			case "checklistRunPeriod": return <span>{periodText(asText(row.periodFrom), asText(row.periodTo))}</span>;
			case "status": return <QualityChip tone={runStatusTone(asText(row.status))}>{runStatusLabel(asText(row.status))}</QualityChip>;
			case "progress": return <span>{progressText(row.progress as ChecklistRun["progress"])}</span>;
			default: return undefined;
		}
	}, []);

	const statusFilter = (
		<FieldSelect name="checklist_runs_status" size="sm" value={status} onChange={(e) => setStatus(e.target.value)}
			options={[
				{ value: "", label: translate("checklistRunAllStatuses") },
				{ value: "open", label: runStatusLabel("open") },
				{ value: "submitted", label: runStatusLabel("submitted") },
				{ value: "reviewed", label: runStatusLabel("reviewed") },
			]} />
	);

	return (
		<>
			<ModelList endpoint={MODEL_ENDPOINT} listName={LIST_NAME} columnsJson={columnsJson} FormComponent={ChecklistRunsForm}
				getLabel={(d) => asText(d?.name).slice(0, 50) || "?"} variant={variant} onSelectItem={onSelectItem}
				defaultSort={{ periodFrom: "desc" }} hideAddDelete extraFilter={extraFilter} renderCell={renderCell}
				extraButtons={!onSelectItem && me
					? (selected: TDataItem[]) => (
						<QualityListButtons canAdd canDelete selected={selected} onAdd={() => setCreating(true)} onDelete={deleteRows}>
							{statusFilter}
						</QualityListButtons>
					)
					: statusFilter} />
			{creating && (
				<CreateChecklistRunModal onClose={() => setCreating(false)} onCreated={(run) => { void refresh(); openRun(run); }} />
			)}
		</>
	);
};
ChecklistRunsList.displayName = "ChecklistRunsList";

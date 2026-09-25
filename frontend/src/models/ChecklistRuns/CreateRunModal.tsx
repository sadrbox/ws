/**
 * «Создать чек-лист»: шаблон, клиент, период; исполнитель и главбух — по желанию.
 *
 * Пустые исполнитель и главбух сервер подставит сам: ответственного за клиента и главбуха
 * группы клиента (checklists.js). Период по умолчанию — прошедший по периодичности шаблона.
 */
import { FC, useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Modal from "src/components/Modal";
import Notice, { type NoticeItem } from "src/components/Notice";
import { FieldDate, FieldSelect } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import { FIELD_WIDTH } from "src/components/Field/fieldWidths";
import { Group, GroupCol } from "src/components/UI";
import { showToast } from "src/components/UIToast";
import { routeError } from "src/services/errors/route";
import { createChecklistRun, fetchChecklistTemplates, type ChecklistRun } from "src/services/quality/api";
import { getAppUtcOffset } from "src/utils/datetime";
import { translate } from "src/i18";
import { localYmd } from "src/models/_quality/month";
import { userDisplayName } from "src/models/_quality/people";
import { defaultPeriod } from "./runView";
import { periodicityLabel } from "src/models/ChecklistTemplates/templateItems";
import styles from "./ChecklistRuns.module.scss";

interface Props {
	onClose: () => void;
	/** Чек-лист создан — открыть его. */
	onCreated: (run: ChecklistRun) => void;
	/** Клиент по умолчанию (открыли из карточки клиента или панели главбуха). */
	client?: { uuid: string; name: string };
}

interface Person { uuid: string; name: string }
const NOBODY: Person = { uuid: "", name: "" };

export const CreateChecklistRunModal: FC<Props> = ({ onClose, onCreated, client }) => {
	const templates = useQuery({
		queryKey: ["checklist-templates", "active"],
		queryFn: async () => (await fetchChecklistTemplates({ activeOnly: true })).items ?? [],
	});
	const [templateUuid, setTemplateUuid] = useState("");
	const [org, setOrg] = useState<Person>(client ?? NOBODY);
	const [from, setFrom] = useState("");
	const [to, setTo] = useState("");
	const [executor, setExecutor] = useState<Person>(NOBODY);
	const [reviewer, setReviewer] = useState<Person>(NOBODY);
	const [notices, setNotices] = useState<NoticeItem[]>([]);
	const [busy, setBusy] = useState(false);

	const options = useMemo(() => [
		{ value: "", label: translate("checklistRunChooseTemplate") },
		...(templates.data ?? []).map((t) => ({ value: t.uuid, label: `${t.name} · ${periodicityLabel(t.periodicity)}` })),
	], [templates.data]);

	const pickTemplate = useCallback((uuid: string) => {
		setTemplateUuid(uuid);
		const t = (templates.data ?? []).find((x) => x.uuid === uuid);
		if (t) {
			const p = defaultPeriod(t.periodicity, localYmd(getAppUtcOffset() * 60));
			setFrom(p.from);
			setTo(p.to);
		}
	}, [templates.data]);

	const apply = useCallback(async () => {
		if (busy) return;
		const errors: NoticeItem[] = [];
		if (!templateUuid) errors.push({ type: "error", text: translate("checklistRunNeedTemplate") });
		if (!org.uuid) errors.push({ type: "error", text: translate("checklistRunNeedClient") });
		if (!from || !to || from > to) errors.push({ type: "error", text: translate("checklistRunNeedPeriod") });
		setNotices(errors);
		if (errors.length) return;
		setBusy(true);
		try {
			const r = await createChecklistRun({
				templateUuid, clientOrganizationUuid: org.uuid, periodFrom: from, periodTo: to,
				...(executor.uuid ? { executorUuid: executor.uuid } : {}),
				...(reviewer.uuid ? { reviewerUuid: reviewer.uuid } : {}),
			});
			showToast(translate("checklistRunCreated"), "success");
			onCreated(r.item);
			onClose();
		} catch (e) {
			setNotices(routeError(e, { source: translate("ChecklistRunsList") }));
		} finally {
			setBusy(false);
		}
	}, [busy, templateUuid, org.uuid, from, to, executor.uuid, reviewer.uuid, onCreated, onClose]);

	return (
		<Modal
			title={translate("checklistRunCreateTitle")}
			onClose={onClose}
			buttons={[
				{ label: translate("create"), onClick: () => void apply(), variant: "primary" },
				{ label: translate("cancel"), onClick: onClose, variant: "secondary" },
			]}
		>
			<div className={styles.ModalBody}>
				<GroupCol>
					<Group>
						<FieldSelect label={translate("checklistTemplate")} name="checklist_run_template" value={templateUuid} options={options}
							onChange={(e) => pickTemplate(e.target.value)} disabled={busy} required
							hint={!templates.isLoading && !(templates.data ?? []).length ? translate("checklistRunNoTemplates") : undefined} />
					</Group>
					<Group>
						<LookupField label={translate("checklistRunClient")} name="checklist_run_client" endpoint="organizations" value={org.uuid} displayValue={org.name}
							onSelect={(uuid, display) => setOrg({ uuid, name: uuid ? display : "" })} allowCreate={false} disabled={busy} required minWidth={FIELD_WIDTH.lg} />
					</Group>
					<Group>
						<FieldDate label={translate("checklistRunFrom")} name="checklist_run_from" value={from} onChange={(e) => setFrom(e.target.value)} disabled={busy} width={FIELD_WIDTH.date} required />
						<FieldDate label={translate("checklistRunTo")} name="checklist_run_to" value={to} onChange={(e) => setTo(e.target.value)} disabled={busy} width={FIELD_WIDTH.date} required />
					</Group>
					<Group>
						<LookupField label={translate("executor")} name="checklist_run_executor" endpoint="users" displayField="username" secondaryFields={["employee.fullName"]}
							value={executor.uuid} displayValue={executor.name} allowCreate={false} disabled={busy} minWidth={FIELD_WIDTH.lg}
							onSelect={(uuid, display, item) => setExecutor({ uuid, name: uuid ? userDisplayName(item, display) : "" })} />
					</Group>
					<p className={styles.FieldNote}>{translate("checklistRunExecutorHint")}</p>
					<Group>
						<LookupField label={translate("checklistRunReviewer")} name="checklist_run_reviewer" endpoint="users" displayField="username" secondaryFields={["employee.fullName"]}
							value={reviewer.uuid} displayValue={reviewer.name} allowCreate={false} disabled={busy} minWidth={FIELD_WIDTH.lg}
							onSelect={(uuid, display, item) => setReviewer({ uuid, name: uuid ? userDisplayName(item, display) : "" })} />
					</Group>
					<p className={styles.FieldNote}>{translate("checklistRunReviewerHint")}</p>
					<Notice inline items={notices} />
				</GroupCol>
			</div>
		</Modal>
	);
};
CreateChecklistRunModal.displayName = "CreateChecklistRunModal";

export default CreateChecklistRunModal;

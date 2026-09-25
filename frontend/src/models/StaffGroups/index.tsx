/**
 * Группы сотрудников фирмы (E17 СК0.2): главбух группы, руководитель, участники и клиенты с
 * ответственным бухгалтером.
 *
 * ЗАЧЕМ. Роль в учёте качества задают группы, а не права на модели: главбух видит нарушения,
 * задачи и находки участников своей группы и подтверждает их нарушения; руководитель — ещё и
 * главбуха; о себе не решает никто. Ответственный за клиента получает задачи по находкам
 * проверок учёта.
 *
 * Настраивают администратор и руководитель (canManage); остальные видят группы только для
 * чтения. Сервер при сохранении заменяет состав целиком — форма шлёт всех участников и клиентов.
 */
import { type ComponentType, type FC, useMemo } from "react";
import { translate } from "src/i18";
import type { TDataItem } from "src/components/Table/types";
import type { TTableVariant } from "src/components/Table";
import type { TPane } from "src/app/types";
import { Field, FieldTextarea } from "src/components/Field";
import { FormLookup } from "src/components/Field/FormLookup";
import { FIELD_WIDTH } from "src/components/Field/fieldWidths";
import { Group, GroupCol } from "src/components/UI";
import ModelForm from "src/components/ModelForm";
import ModelList from "src/components/ModelList";
import Notice from "src/components/Notice";
import { useFormStore } from "src/hooks/useFormStore";
import { useFormNotices } from "src/hooks/useFormNotices";
import { useQualityMe } from "src/hooks/useQualityMe";
import { asText } from "src/utils/asText";
import { makePaneLabel, type LabelSource } from "src/utils/buildPaneLabel";
import QualityListButtons from "src/models/_quality/ListButtons";
import { useQualityListActions } from "src/models/_quality/useQualityListActions";
import { userDisplayName } from "src/models/_quality/people";
import { ClientsEditor, MembersEditor } from "./Composition";
import {
	clientsOf, membersOf, staffGroupPayload, validateStaffGroup, type ClientRow, type MemberRow, type StaffGroupRecord,
} from "./staffGroups";
import columnsJson from "./columns.json";
import main from "src/styles/main.module.scss";
import styles from "./StaffGroups.module.scss";

const MODEL_ENDPOINT = "staff-groups";
const LIST_NAME = "StaffGroupsList";
const FORM_NAME = "StaffGroupsForm";

interface TFields {
	id?: number;
	uuid?: string;
	name: string;
	headUuid: string;
	headName: string;
	managerUuid: string;
	managerName: string;
	comment: string;
	members: MemberRow[];
	clients: ClientRow[];
}

const DEFAULT_FIELDS: TFields = {
	name: "", headUuid: "", headName: "", managerUuid: "", managerName: "", comment: "", members: [], clients: [],
};

// ═══════════════════════════════════════════════════════════════════════════
// ФОРМА
// ═══════════════════════════════════════════════════════════════════════════

const StaffGroupsForm: FC<Partial<TPane>> = (paneProps) => {
	const { canManage } = useQualityMe();
	const form = useFormStore<TFields>({
		endpoint: MODEL_ENDPOINT, storageKey: "staff-groups-form", defaultFields: DEFAULT_FIELDS, paneProps,
		mapServerToForm: (d: StaffGroupRecord, prev) => ({
			...(prev ?? DEFAULT_FIELDS),
			id: d.id, uuid: d.uuid,
			name: d.name ?? "",
			headUuid: d.headUuid ?? "", headName: d.headName ?? "",
			managerUuid: d.managerUuid ?? "", managerName: d.managerName ?? "",
			comment: d.comment ?? "",
			members: membersOf(d),
			clients: clientsOf(d),
		}),
		buildPayload: (fd) => {
			const err = validateStaffGroup(fd);
			return err ? translate(err) : staffGroupPayload(fd);
		},
		buildPaneLabel: (saved: LabelSource) => makePaneLabel(LIST_NAME, translate(FORM_NAME), saved),
	});
	const notices = useFormNotices(form);
	const readonly = !canManage;
	const off = form.isLoading || readonly;
	const f = form.fields;

	// Сообщения формы — ОДИН <Notice /> на форму: он не рисуется на месте, а сообщает строки в
	// область «Технические сообщения», и каждый экземпляр завёл бы там свою копию (вкладки
	// смонтированы все сразу). Поэтому он стоит только на первой вкладке.
	const notice = (
		<GroupCol className={main.FormNotice}>
			<Notice items={notices} />
		</GroupCol>
	);

	const tabs = [
		{
			id: "tab-details", label: translate("general"), component: (
				<div className={main.FormWrapper}>
					<div className={main.Form}>
						<GroupCol>
							<Field label={translate("name")} name={`${form.formUid}_name`} value={f.name} disabled={off} required
								onChange={(e) => form.setField("name", e.target.value)} minWidth={FIELD_WIDTH.lg} />
							<p className={styles.RolesHint}>{translate("staffGroupRolesHint")}</p>
							<Group>
								<FormLookup form={form} field="head" endpoint="users" displayField="username" secondaryFields={["employee.fullName"]}
									label={translate("headName")} minWidth={FIELD_WIDTH.lg} disabled={off} allowCreate={false}
									onSelect={(uuid, display, item) => form.setFields({ headUuid: uuid, headName: uuid ? userDisplayName(item, display) : "" })} />
							</Group>
							<Group>
								<FormLookup form={form} field="manager" endpoint="users" displayField="username" secondaryFields={["employee.fullName"]}
									label={translate("managerName")} minWidth={FIELD_WIDTH.lg} disabled={off} allowCreate={false}
									onSelect={(uuid, display, item) => form.setFields({ managerUuid: uuid, managerName: uuid ? userDisplayName(item, display) : "" })} />
							</Group>
							<FieldTextarea label={translate("comment")} name={`${form.formUid}_comment`} value={f.comment} disabled={off}
								onChange={(e) => form.setField("comment", e.target.value)} rows={3} minWidth={FIELD_WIDTH.lg} />
						</GroupCol>
					</div>
					{notice}
				</div>
			),
		},
		{
			id: "tab-members", label: `${translate("staffGroupMembers")} (${f.members.length})`, component: (
				<div className={main.FormWrapper}>
					<div className={main.Form}>
						<GroupCol>
							<span className={main.SettingHint}>{translate("staffGroupMembersHint")}</span>
							<MembersEditor formUid={form.formUid} members={f.members} disabled={off}
								onChange={(next) => form.setField("members", next)} />
						</GroupCol>
					</div>
				</div>
			),
		},
		{
			id: "tab-clients", label: `${translate("staffGroupClients")} (${f.clients.length})`, component: (
				<div className={main.FormWrapper}>
					<div className={main.Form}>
						<GroupCol>
							{/* Ответственный берётся отсюда, а если не указан — ведущий из назначения обслуживания
							    (lead). Решено 25.09: участок группы главнее — так работу делят главбухи
							    (backend services/quality/access.js responsibleForClient). */}
							<span className={main.SettingHint}>{translate("staffGroupClientsHint")}</span>
							<span className={main.SettingHint}>{translate("staffGroupResponsibleRule")}</span>
							<ClientsEditor formUid={form.formUid} clients={f.clients} disabled={off}
								onChange={(next) => form.setField("clients", next)} />
						</GroupCol>
					</div>
				</div>
			),
		},
	];

	return (
		<ModelForm paneId={form.paneId} endpoint={MODEL_ENDPOINT} recordUuid={f.uuid} tabs={tabs}
			onSave={form.handleSave} onSaveAndClose={form.handleSaveAndClose} onClose={form.handleClose}
			onReload={form.isEditMode ? form.handleReload : undefined} isLoading={form.isLoading} isInitialLoading={form.isInitialLoading}
			readonly={readonly} />
	);
};
StaffGroupsForm.displayName = FORM_NAME;

// ═══════════════════════════════════════════════════════════════════════════
// СПИСОК
// ═══════════════════════════════════════════════════════════════════════════

interface ListProps {
	variant?: TTableVariant;
	onSelectItem?: (item: TDataItem) => void;
	extraQueryParams?: Record<string, string>;
}

const StaffGroupsList: FC<ListProps> = ({ variant, onSelectItem, extraQueryParams }) => {
	const { canManage } = useQualityMe();
	const actions = useQualityListActions(MODEL_ENDPOINT, LIST_NAME, StaffGroupsForm as ComponentType<Record<string, unknown>>);
	const buttons = useMemo(() => (canManage
		? (selected: TDataItem[]) => (
			<QualityListButtons canAdd canDelete selected={selected} onAdd={() => actions.openNew()} onDelete={actions.deleteRows} />
		)
		: undefined), [canManage, actions]);

	return (
		<ModelList endpoint={MODEL_ENDPOINT} listName={LIST_NAME} columnsJson={columnsJson}
			FormComponent={StaffGroupsForm as ComponentType<Record<string, unknown>>}
			getLabel={(d) => asText(d?.name).slice(0, 50) || "?"} variant={variant} onSelectItem={onSelectItem}
			extraQueryParams={extraQueryParams} defaultSort={{ name: "asc" }} hideAddDelete extraButtons={buttons} />
	);
};
StaffGroupsList.displayName = LIST_NAME;

export { StaffGroupsList, StaffGroupsForm };

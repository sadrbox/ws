// Справочник «Лицензии ЭСФ» (superadmin) по единому паттерну справочников:
// ModelList (стандартный тулбар) + ModelForm (шапка сохранить/закрыть) + useFormStore +
// стандартные Field*/Notice. Запись имеет штатные id+uuid; бизнес-ключ bin — unique
// (публичные /api1/esf-license/* для 1С находят запись по bin, здесь только админка).
// Активация — на форме элемента (тумблер «Активна»), в списке статус только для чтения.
import { FC, useCallback, useMemo } from "react";
import { asText } from "src/utils/asText";
import { translate } from "src/i18";
import type { TColumn, TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { Field, FieldDate } from "src/components/Field";
import FieldToggle from "src/components/Field/FieldToggle";
import { Group, GroupCol } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import { useFormStore } from "src/hooks/useFormStore";
import { useFormNotices } from "src/hooks/useFormNotices";
import { FormRequiredScope } from "src/hooks/useFormRequired";
import { makePaneLabel } from "src/utils/buildPaneLabel";
import { getFormatDate } from "src/utils/datetime";
import { getCurrentUser } from "src/services/auth";
import ModelForm from "src/components/ModelForm";
import ModelList from "src/components/ModelList";
import Notice from "src/components/Notice";

const MODEL_ENDPOINT = "esf-licenses";
const LIST_NAME = "EsfLicensesList";

interface TFields {
	id?: number;
	uuid?: string;
	bin: string;
	note: string;
	active: boolean;
	expiresAt: string;
	// Только для чтения (телеметрия 1С).
	requestCount: number;
	lastRequestAtText: string;
	lastHeartbeatAtText: string;
	lastHeartbeatInstallId: string;
}

const DEFAULT_FIELDS: TFields = {
	bin: "", note: "", active: false, expiresAt: "",
	requestCount: 0, lastRequestAtText: "—", lastHeartbeatAtText: "—", lastHeartbeatInstallId: "",
};

interface EsfLicenseServerRecord {
	id?: number;
	uuid?: string;
	bin?: string;
	note?: string | null;
	active?: boolean | null;
	expiresAt?: string | null;
	requestCount?: number | null;
	lastRequestAt?: string | null;
	lastHeartbeatAt?: string | null;
	lastHeartbeatInstallId?: string | null;
}

const EsfLicensesForm: FC<Partial<TPane>> = (paneProps) => {
	const isSuperAdmin = !!getCurrentUser()?.isSuperAdmin;

	const form = useFormStore<TFields>({
		endpoint: MODEL_ENDPOINT,
		storageKey: "esf-licenses-form",
		defaultFields: DEFAULT_FIELDS,
		paneProps,
		mapServerToForm: (d: EsfLicenseServerRecord, prev) => ({
			...(prev ?? DEFAULT_FIELDS),
			bin: d.bin ?? "",
			note: d.note ?? "",
			active: d.active === true,
			expiresAt: d.expiresAt ? String(d.expiresAt).slice(0, 10) : "",
			requestCount: d.requestCount ?? 0,
			lastRequestAtText: d.lastRequestAt ? getFormatDate(d.lastRequestAt) : "—",
			lastHeartbeatAtText: d.lastHeartbeatAt ? getFormatDate(d.lastHeartbeatAt) : "—",
			lastHeartbeatInstallId: d.lastHeartbeatInstallId ?? "",
			id: d.id,
			uuid: d.uuid,
		}),
		buildPayload: (fd) => {
			const bin = fd.bin?.trim() ?? "";
			if (!bin) return translate("esfBinRequired");
			return {
				bin,
				note: fd.note?.trim() || null,
				active: fd.active === true,
				expiresAt: fd.expiresAt || null,
			};
		},
		buildPaneLabel: (saved) => makePaneLabel(LIST_NAME, translate("EsfLicensesList"), saved, saved.bin),
	});

	const notices = useFormNotices(form);

	const tabs = useMemo(() => [
		{
			id: "tab-details",
			label: translate("general"),
			component: (
				<div className={styles.FormWrapper}>
					<div className={styles.Form}>
						<GroupCol>
							<Group>
								{/* БИН — бизнес-ключ: у сохранённой записи не меняем. */}
								<Field label={translate("bin")} name={`${form.formUid}_bin`} minWidth="200px"
									value={form.fields.bin} onChange={(e) => form.setField("bin", e.target.value)}
									disabled={form.isLoading || form.isEditMode} required />
							</Group>
							<Group>
								<Field label={translate("esfNote")} name={`${form.formUid}_note`} minWidth="339px"
									value={form.fields.note} onChange={(e) => form.setField("note", e.target.value)}
									disabled={form.isLoading} />
							</Group>
							<Group>
								<FieldToggle name={`${form.formUid}_active`} label={translate("esfActiveToggle")}
									value={form.fields.active === true} onChange={(v) => form.setField("active", v)}
									disabled={form.isLoading} />
							</Group>
							<Group>
								<FieldDate label={translate("esfExpiresHint")} name={`${form.formUid}_expiresAt`}
									value={form.fields.expiresAt} onChange={(e) => form.setField("expiresAt", e.target.value)}
									disabled={form.isLoading} />
							</Group>

							{form.isEditMode && (
								<GroupCol>
									<Group>
										<Field label={translate("esfRequestCountFull")} name={`${form.formUid}_requestCount`} minWidth="120px"
											value={String(form.fields.requestCount)} disabled />
									</Group>
									<Group>
										<Field label={translate("esfLastRequest")} name={`${form.formUid}_lastRequestAt`} minWidth="200px"
											value={form.fields.lastRequestAtText} disabled />
									</Group>
									<Group>
										<Field label={translate("esfLastHeartbeat")} name={`${form.formUid}_lastHeartbeatAt`} minWidth="200px"
											value={form.fields.lastHeartbeatAtText} disabled />
									</Group>
									{form.fields.lastHeartbeatInstallId ? (
										<Group>
											<Field label={translate("esfInstallId")} name={`${form.formUid}_installId`} minWidth="339px"
												value={form.fields.lastHeartbeatInstallId} disabled />
										</Group>
									) : null}
								</GroupCol>
							)}
						</GroupCol>
					</div>
					<GroupCol className={styles.FormNotice}>
						<Notice items={notices} />
					</GroupCol>
				</div>
			),
		},
	], [form.fields, form.formUid, form.isLoading, form.isEditMode, form.setField, notices]);

	return (
		<FormRequiredScope requiredKeys={["bin"]} active>
			<ModelForm
				paneId={form.paneId} endpoint={MODEL_ENDPOINT} recordUuid={form.fields.uuid}
				tabs={tabs}
				onSave={form.handleSave}
				onSaveAndClose={form.handleSaveAndClose}
				onClose={form.handleClose}
				onReload={form.isEditMode ? form.handleReload : undefined}
				isLoading={form.isLoading} isInitialLoading={form.isInitialLoading}
				readonly={!isSuperAdmin}
			/>
		</FormRequiredScope>
	);
};
EsfLicensesForm.displayName = "EsfLicensesForm";

// Статус лицензии для колонки списка (только чтение; активация — на форме).
function statusCell(row: TDataItem) {
	const active = row.active === true;
	const expired = active && row.expiresAt && new Date(asText(row.expiresAt)) < new Date();
	const key = !active ? "esfStatusInactive" : expired ? "esfStatusExpired" : "esfStatusActive";
	const color = !active ? "var(--text-muted)" : expired ? "var(--danger)" : "var(--success)";
	return <span style={{ color, fontWeight: 600 }}>{translate(key)}</span>;
}

const EsfLicensesList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void }> = ({ variant, onSelectItem }) => {
	const renderCell = useCallback((row: TDataItem, col: TColumn) => {
		if (col.identifier === "status") return statusCell(row);
		return undefined;
	}, []);

	return (
		<ModelList
			endpoint={MODEL_ENDPOINT}
			listName={LIST_NAME}
			columnsJson={columnsJson}
			FormComponent={EsfLicensesForm}
			getLabel={(d) => (d?.bin as string) || "?"}
			variant={variant}
			onSelectItem={onSelectItem}
			renderCell={renderCell}
		/>
	);
};
EsfLicensesList.displayName = LIST_NAME;

export { EsfLicensesList, EsfLicensesForm };
export default EsfLicensesList;

/**
 * «Сверка с лицевым счётом КН» (E17 СК2.5, п. 11 стандарта): выписка лицевого счёта из кабинета
 * налогоплательщика против расчётов с бюджетом в 1С.
 *
 * Строки выписки (КБК, наименование, сальдо) загружаются файлом или вводятся руками; при записи
 * сервер сравнивает их с последним ночным снимком `taxes` из 1С и хранит результат. Выписка не
 * меняется: после записи форма показывает сравнение только для чтения. Расхождения объясняет
 * человек — сами по себе они нарушением не считаются.
 *
 * ПРОВЕРИТЬ ПОТОМ: формат выписки из КНП (нужен образец файла) и есть ли КБК в аналитике 1С —
 * без КБК строки сопоставляются только по наименованию налога (findingRules.compareKn).
 */
import { FC, useMemo, useState, type ComponentType } from "react";
import type { TPane } from "src/app/types";
import type { TColumn, TDataItem } from "src/components/Table/types";
import Table, { type TTableVariant } from "src/components/Table";
import ModelList from "src/components/ModelList";
import ModelForm from "src/components/ModelForm";
import Notice, { type NoticeItem } from "src/components/Notice";
import { Field, FieldDate } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import { FormLookup } from "src/components/Field/FormLookup";
import { FIELD_WIDTH } from "src/components/Field/fieldWidths";
import { Group, GroupCol } from "src/components/UI";
import { getModelColumns } from "src/components/Table/services";
import { useFormStore } from "src/hooks/useFormStore";
import { useFormNotices } from "src/hooks/useFormNotices";
import { useQualityMe } from "src/hooks/useQualityMe";
import { api } from "src/services/api/client";
import type { KnStatement } from "src/services/quality/api";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { withStableIds } from "src/utils/stableRowId";
import { makePaneLabel, type LabelSource } from "src/utils/buildPaneLabel";
import { getAppUtcOffset, getFormatDate, getFormatDateOnly } from "src/utils/datetime";
import { asText } from "src/utils/asText";
import { translate } from "src/i18";
import QualityChip from "src/models/_quality/QualityChip";
import { QualityListButtons } from "src/models/_quality/ListButtons";
import { useQualityListActions } from "src/models/_quality/useQualityListActions";
import { localYmd } from "src/models/_quality/month";
import { KnRowsEditor } from "./KnRowsEditor";
import { knResultLabel, knResultState, knRowsErrorText, knRowsToPayload, knTotals, toKnDrafts, type KnDraftRow, type KnResultState } from "./knSheet";
import columnsJson from "./columns.json";
import comparisonColumnsJson from "./comparisonColumns.json";
import styles from "./KnStatements.module.scss";

const MODEL_ENDPOINT = "kn-statements";
const LIST_NAME = "KnStatementsList";

const RESULT_TONE: Record<KnResultState, "ok" | "bad" | "warn"> = { ok: "ok", mismatch: "bad", unmatched: "warn" };

/** Пояснения экрана: знак сальдо и что ещё не проверено вживую. */
const infoNotices = (): NoticeItem[] => [
	{ type: "info", text: translate("knSignInfo") },
	{ type: "info", text: translate("knCheckLater") },
];

/**
 * Имя клиента выписки, открытой по ссылке (в ответе GET /kn-statements/:id имени нет).
 * Берём из списка выписок того же клиента, а не из справочника организаций: на него у
 * бухгалтера может не быть права, и каждое открытие выписки кончалось бы тостом 403.
 */
async function organizationNameOf(organizationUuid: string): Promise<string> {
	if (!organizationUuid) return "";
	try {
		const r = await api.get<{ items?: { organizationName?: string | null }[] }>(`/${MODEL_ENDPOINT}`, {
			params: { "filter[organizationUuid][equals]": organizationUuid, limit: 1 },
		});
		return asText(r.items?.[0]?.organizationName);
	} catch {
		return "";
	}
}

interface TFields {
	id?: number;
	uuid?: string;
	organizationUuid: string;
	organizationName: string;
	onDate: string;
	rows: KnDraftRow[];
	comparison: KnStatement["comparison"];
	createdAt: string;
}

const DEFAULT_FIELDS: TFields = { organizationUuid: "", organizationName: "", onDate: "", rows: [], comparison: null, createdAt: "" };

export const KnStatementsForm: FC<Partial<TPane>> = (paneProps) => {
	const data = paneProps.data as Record<string, unknown> | undefined;
	const paneOrgUuid = asText(data?.organizationUuid);
	const paneOrgName = asText(data?.organizationName);
	const initialFields: TFields | undefined = data?.uuid ? undefined : {
		...DEFAULT_FIELDS,
		organizationUuid: paneOrgUuid,
		organizationName: paneOrgUuid ? paneOrgName : "",
		onDate: localYmd(getAppUtcOffset() * 60),
	};

	const form = useFormStore<TFields>({
		endpoint: MODEL_ENDPOINT, storageKey: "kn-statements-form", paneProps, defaultFields: DEFAULT_FIELDS, initialFields,
		mapServerToForm: async (d: KnStatement, prev) => {
			const organizationUuid = d.organizationUuid ?? "";
			const known = d.organizationName
				|| (prev?.organizationUuid === organizationUuid ? prev.organizationName : "")
				|| (organizationUuid === paneOrgUuid ? paneOrgName : "");
			return {
				...(prev ?? DEFAULT_FIELDS),
				id: d.id, uuid: d.uuid,
				organizationUuid,
				organizationName: known || (await organizationNameOf(organizationUuid)),
				onDate: asText(d.onDate),
				rows: toKnDrafts(d.rows),
				comparison: d.comparison ?? null,
				createdAt: asText(d.createdAt),
			};
		},
		buildPayload: (fd) => {
			if (!fd.organizationUuid) return translate("knNeedOrganization");
			if (!fd.onDate) return translate("knNeedDate");
			const rows = knRowsToPayload(fd.rows);
			if (!rows.ok) return knRowsErrorText(rows);
			return { organizationUuid: fd.organizationUuid, onDate: fd.onDate.slice(0, 10), rows: rows.rows };
		},
		buildPaneLabel: (saved: LabelSource & { organizationName?: string; onDate?: string }) => makePaneLabel(LIST_NAME, translate("KnStatementsForm"), saved,
			[saved.organizationName, getFormatDateOnly(saved.onDate)].filter(Boolean).join(" · ") || undefined),
	});
	const f = form.fields;
	const saved = !!f.uuid;
	const formNotices = useFormNotices(form);
	const disabled = form.isLoading || saved;

	const [cols, setCols] = useState<TColumn[]>(() => getModelColumns(comparisonColumnsJson as TColumn[], "KnComparison"));
	const cmpRows = useMemo(() => withStableIds((f.comparison?.rows ?? []).map((r, i) => ({
		uuid: `${i}:${r.kbk ?? ""}:${r.name ?? ""}`,
		kbk: r.kbk ?? "", name: r.name ?? "",
		knBalance: r.knBalance, onecBalance: r.onecBalance, knDiff: r.diff,
		knResult: knResultLabel(knResultState(r)), knState: knResultState(r),
	})), (r) => r.uuid), [f.comparison]);
	const totals = useMemo(() => knTotals(f.comparison?.rows ?? []), [f.comparison]);

	const notices = useMemo<NoticeItem[]>(() => [
		...formNotices,
		// Снимка расчётов с бюджетом из 1С ещё нет — сравнивать не с чем, сказать это громко.
		...(saved && f.comparison && !f.comparison.snapshotAt ? [{ type: "warning" as const, text: translate("knNoSnapshot") }] : []),
		...infoNotices(),
	], [formNotices, saved, f.comparison]);

	const tabs = useMemo(() => [{
		id: "tab-kn", label: translate("general"), component: (
			<div className={styles.Body}>
				<div className={styles.Header}>
					<GroupCol>
						<Group>
							{saved
								? <Field label={translate("organization")} name={`${form.formUid}_org`} value={f.organizationName} disabled minWidth={FIELD_WIDTH.lg} />
								: <FormLookup form={form} field="organization" endpoint="organizations" minWidth={FIELD_WIDTH.lg} required allowCreate={false} />}
							{saved
								? <Field label={translate("onDate")} name={`${form.formUid}_onDate`} value={getFormatDateOnly(f.onDate)} disabled width={FIELD_WIDTH.date} />
								: <FieldDate label={translate("onDate")} name={`${form.formUid}_onDate`} value={f.onDate} required width={FIELD_WIDTH.date}
									onChange={(e) => form.setField("onDate", e.target.value)} disabled={disabled} hint={translate("knOnDateHint")} />}
							{saved && <Field label={translate("createdAt")} name={`${form.formUid}_created`} value={getFormatDate(f.createdAt)} disabled width={FIELD_WIDTH.date} />}
						</Group>
					</GroupCol>
				</div>
				{saved ? (
					<>
						<div className={styles.Summary}>
							<QualityChip tone={totals.mismatches ? "bad" : "ok"}>
								{totals.mismatches ? `${translate("mismatches")}: ${totals.mismatches}` : translate("knAllMatched")}
							</QualityChip>
							<span><span className={styles.SummaryLabel}>{translate("knRowsTotal")}:</span> {cmpRows.length}</span>
							{totals.unmatched > 0 && <span><span className={styles.SummaryLabel}>{translate("knResultUnmatched")}:</span> {totals.unmatched}</span>}
							<span>
								<span className={styles.SummaryLabel}>{translate("knSnapshotAt")}:</span>{" "}
								{f.comparison?.snapshotAt ? getFormatDate(f.comparison.snapshotAt) : translate("knNoSnapshotShort")}
							</span>
						</div>
						<div className={styles.TableArea}>
							<Table {...buildStaticTableProps({
								componentName: "KnComparison", rows: cmpRows, columns: cols, setColumns: setCols,
								emptyText: translate("knNoRows"),
								renderCell: (row: TDataItem, col: TColumn) => (col.identifier === "knResult"
									? <QualityChip tone={RESULT_TONE[row.knState as KnResultState] ?? "muted"}>{asText(row.knResult)}</QualityChip>
									: undefined),
							})} />
						</div>
					</>
				) : (
					<KnRowsEditor rows={f.rows} onChange={(rows) => form.setField("rows", rows)} disabled={disabled} namePrefix={form.formUid} />
				)}
			</div>
		),
	}], [f, form, saved, disabled, totals, cmpRows, cols]);

	return (
		<>
			<Notice items={notices} />
			<ModelForm paneId={form.paneId} tabs={tabs} onSave={form.handleSave} onSaveAndClose={form.handleSaveAndClose} onClose={form.handleClose}
				onReload={form.isEditMode ? form.handleReload : undefined} isLoading={form.isLoading} isInitialLoading={form.isInitialLoading}
				readonly={saved} saveTitle={translate("knSaveTitle")} />
		</>
	);
};
KnStatementsForm.displayName = "KnStatementsForm";

export const KnStatementsList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void; data?: Partial<TDataItem> }> = ({ variant, onSelectItem, data }) => {
	const { me } = useQualityMe();
	const [org, setOrg] = useState({ uuid: asText(data?.organizationUuid), name: asText(data?.organizationName) });
	const { openNew } = useQualityListActions(MODEL_ENDPOINT, LIST_NAME, KnStatementsForm as ComponentType<Record<string, unknown>>);
	const extraQueryParams = useMemo(() => (org.uuid ? { organizationUuid: org.uuid } : undefined), [org.uuid]);

	const orgFilter = (
		<LookupField name="kn_statements_org" endpoint="organizations" value={org.uuid} displayValue={org.name}
			onSelect={(uuid, display) => setOrg({ uuid, name: uuid ? display : "" })}
			placeholder={translate("organization")} allowCreate={false} visibleActions={["quickselect", "list", "clear"]} width={FIELD_WIDTH.wide} />
	);

	return (
		<>
			<Notice items={infoNotices()} />
			<ModelList endpoint={MODEL_ENDPOINT} listName={LIST_NAME} columnsJson={columnsJson} FormComponent={KnStatementsForm}
				getLabel={(d) => [asText(d?.organizationName), getFormatDateOnly(asText(d?.onDate))].filter(Boolean).join(" · ") || "?"}
				variant={variant} onSelectItem={onSelectItem} defaultSort={{ onDate: "desc" }} hideAddDelete
				extraQueryParams={extraQueryParams}
				renderCell={(row: TDataItem, col: TColumn) => {
					if (col.identifier !== "mismatches" || row.mismatches === null || row.mismatches === undefined) return undefined;
					const n = Number(row.mismatches);
					return <QualityChip tone={n ? "bad" : "ok"}>{String(n)}</QualityChip>;
				}}
				extraButtons={(
					<QualityListButtons canAdd={!!me && !onSelectItem} canDelete={false}
						onAdd={() => openNew(org.uuid ? { organizationUuid: org.uuid, organizationName: org.name } : {})}>
						{orgFilter}
					</QualityListButtons>
				)} />
		</>
	);
};
KnStatementsList.displayName = "KnStatementsList";

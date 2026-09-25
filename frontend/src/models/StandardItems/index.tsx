/**
 * Справочник пунктов стандарта качества (E17 СК5.1): номер, формулировка, кто может нарушить,
 * как выявляется, «действует».
 *
 * Заполняется из утверждённого текста стандарта (40 пунктов, приложение А плана) — сервер делает
 * это сам при первом обращении, кнопка «Заполнить из стандарта» нужна для пустого справочника.
 * Пунктов не добавляют и не удаляют: номер пункта — часть стандарта, на него ссылаются
 * нарушения. Выключенный пункт правила больше не применяют.
 *
 * Править — администратор или руководитель (canManage); остальные видят справочник только
 * для чтения. Роль — по группам сотрудников (useQualityMe), а не по правам на модель.
 */
import { type ComponentType, type FC, type ReactNode, useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import type { TColumn, TDataItem } from "src/components/Table/types";
import type { TTableVariant } from "src/components/Table";
import type { TPane } from "src/app/types";
import { Field, FieldSelect, FieldTextarea } from "src/components/Field";
import FieldToggle from "src/components/Field/FieldToggle";
import { FIELD_WIDTH } from "src/components/Field/fieldWidths";
import { Group, GroupCol } from "src/components/UI";
import { Button } from "src/components/Button";
import { showToast } from "src/components/UIToast";
import ModelForm from "src/components/ModelForm";
import ModelList from "src/components/ModelList";
import Notice from "src/components/Notice";
import { useFormStore } from "src/hooks/useFormStore";
import { useFormNotices } from "src/hooks/useFormNotices";
import { useQualityMe } from "src/hooks/useQualityMe";
import { reportError } from "src/services/errors/route";
import { asText } from "src/utils/asText";
import { makePaneLabelFromData, type LabelSource } from "src/utils/buildPaneLabel";
import { seedStandardItems, type StandardItem } from "src/services/quality/api";
import {
	appliesToLabel, appliesToOptions, detectionKindLabel, detectionKindOptions, standardItemPayload,
} from "./standardItems";
import columnsJson from "./columns.json";
import main from "src/styles/main.module.scss";

const MODEL_ENDPOINT = "standard-items";
const LIST_NAME = "StandardItemsList";
const FORM_NAME = "StandardItemsForm";

interface TFields {
	id?: number;
	uuid?: string;
	number: string;
	title: string;
	text: string;
	appliesTo: string;
	kind: string;
	isActive: boolean;
	version: string;
}

const DEFAULT_FIELDS: TFields = { number: "", title: "", text: "", appliesTo: "employee", kind: "manual", isActive: true, version: "" };

/** «№ 12 - Нарушение сроков»: пункт узнают по номеру стандарта, а не по внутреннему ID. */
const paneLabel = (saved: LabelSource) =>
	makePaneLabelFromData(LIST_NAME, translate(FORM_NAME), saved, asText(saved.title) || undefined);

// ═══════════════════════════════════════════════════════════════════════════
// ФОРМА
// ═══════════════════════════════════════════════════════════════════════════

const StandardItemsForm: FC<Partial<TPane>> = (paneProps) => {
	const { canManage } = useQualityMe();
	const form = useFormStore<TFields>({
		endpoint: MODEL_ENDPOINT, storageKey: "standard-items-form", defaultFields: DEFAULT_FIELDS, paneProps,
		mapServerToForm: (d: Partial<StandardItem>, prev) => ({
			...(prev ?? DEFAULT_FIELDS),
			id: d.id, uuid: d.uuid,
			number: d.number != null ? String(d.number) : "",
			title: d.title ?? "", text: d.text ?? "",
			appliesTo: d.appliesTo ?? "employee", kind: d.kind ?? "manual",
			isActive: d.isActive !== false,
			version: d.version ?? "",
		}),
		buildPayload: (fd) => {
			const r = standardItemPayload(fd);
			return "error" in r ? translate(r.error) : r.payload;
		},
		buildPaneLabel: paneLabel,
	});
	const notices = useFormNotices(form);
	const off = form.isLoading || !canManage;
	const f = form.fields;

	const tabs = [{
		id: "tab-details", label: translate("general"), component: (
			<div className={main.FormWrapper}>
				<div className={main.Form}>
					<GroupCol>
						<Group>
							<Field label={translate("number")} name={`${form.formUid}_number`} value={f.number} disabled width={FIELD_WIDTH.sm} />
							<Field label={translate("version")} name={`${form.formUid}_version`} value={f.version} disabled width={FIELD_WIDTH.md}
								hint={translate("standardItemVersionHint")} />
						</Group>
						<Field label={translate("standardItemTitle")} name={`${form.formUid}_title`} value={f.title} disabled={off} required
							onChange={(e) => form.setField("title", e.target.value)} minWidth={FIELD_WIDTH.xl} />
						<FieldTextarea label={translate("standardItemText")} name={`${form.formUid}_text`} value={f.text} disabled={off} required
							onChange={(e) => form.setField("text", e.target.value)} rows={8} minWidth={FIELD_WIDTH.xl} />
						<Group>
							<FieldSelect label={translate("appliesTo")} name={`${form.formUid}_appliesTo`} value={f.appliesTo} disabled={off}
								options={appliesToOptions()} onChange={(e) => form.setField("appliesTo", e.target.value)}
								hint={translate("standardItemAppliesHint")} />
							<FieldSelect label={translate("detectionKind")} name={`${form.formUid}_kind`} value={f.kind} disabled={off}
								options={detectionKindOptions()} onChange={(e) => form.setField("kind", e.target.value)}
								hint={translate("standardItemKindHint")} />
						</Group>
						<FieldToggle name={`${form.formUid}_isActive`} label={translate("isActive")} value={f.isActive} disabled={off}
							onChange={(v) => form.setField("isActive", v)} />
						<span className={main.SettingHint}>{translate("standardItemActiveHint")}</span>
					</GroupCol>
				</div>
				<GroupCol className={main.FormNotice}>
					<Notice items={notices} />
				</GroupCol>
			</div>
		),
	}];

	return (
		<ModelForm paneId={form.paneId} endpoint={MODEL_ENDPOINT} recordUuid={f.uuid} tabs={tabs}
			onSave={form.handleSave} onSaveAndClose={form.handleSaveAndClose} onClose={form.handleClose}
			onReload={form.isEditMode ? form.handleReload : undefined} isLoading={form.isLoading} isInitialLoading={form.isInitialLoading}
			readonly={!canManage} />
	);
};
StandardItemsForm.displayName = FORM_NAME;

// ═══════════════════════════════════════════════════════════════════════════
// СПИСОК
// ═══════════════════════════════════════════════════════════════════════════

const renderCell = (row: TDataItem, col: TColumn): ReactNode | undefined => {
	if (col.identifier === "appliesTo") return <span>{appliesToLabel(row.appliesTo)}</span>;
	// «Как выявляется» — вычисляемая колонка: поле записи называется kind.
	if (col.identifier === "detectionKind") return <span>{detectionKindLabel(row.kind)}</span>;
	return undefined;
};

interface ListProps {
	variant?: TTableVariant;
	onSelectItem?: (item: TDataItem) => void;
	extraQueryParams?: Record<string, string>;
}

const StandardItemsList: FC<ListProps> = ({ variant, onSelectItem, extraQueryParams }) => {
	const { canManage } = useQualityMe();
	const queryClient = useQueryClient();
	const [busy, setBusy] = useState(false);

	const seed = useCallback(async () => {
		setBusy(true);
		try {
			const r = await seedStandardItems();
			const created = r.data?.created ?? 0;
			showToast(created ? `${translate("standardItemsSeeded")}: ${created}` : translate("standardItemsSeedNothing"), created ? "success" : "info");
			await queryClient.invalidateQueries({ queryKey: [MODEL_ENDPOINT] });
		} catch (e) {
			reportError(e, { source: translate(LIST_NAME) });
		} finally {
			setBusy(false);
		}
	}, [queryClient]);

	return (
		<ModelList endpoint={MODEL_ENDPOINT} listName={LIST_NAME} columnsJson={columnsJson}
			FormComponent={StandardItemsForm as ComponentType<Record<string, unknown>>}
			getLabel={(d) => asText(d?.title).slice(0, 60) || "?"} variant={variant} onSelectItem={onSelectItem}
			extraQueryParams={extraQueryParams} defaultSort={{ number: "asc" }}
			renderCell={renderCell} renderPreviewValue={renderCell}
			// Пунктов не добавляют и не удаляют: их набор — сам стандарт (сервер таких маршрутов не имеет).
			hideAddDelete
			extraButtons={canManage ? (
				<Button onClick={() => void seed()} disabled={busy} title={translate("standardItemsSeedHint")}>
					{translate("standardItemsSeed")}
				</Button>
			) : undefined} />
	);
};
StandardItemsList.displayName = LIST_NAME;

export { StandardItemsList, StandardItemsForm };

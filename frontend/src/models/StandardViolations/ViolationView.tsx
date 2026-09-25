/**
 * Карточка записи реестра нарушений — только чтение: факт (кто, пункт, клиент или участок,
 * даты, суть), доказательства со ссылками, решение и история решений.
 *
 * Факт после заведения не правится с панели: стандарт требует «подтверждённый конкретный факт»,
 * и спор о нём — это возражение и решение уровнем выше, а не правка задним числом.
 */
import { type FC } from "react";
import { translate } from "src/i18";
import { Field, FieldTextarea } from "src/components/Field";
import { FIELD_WIDTH } from "src/components/Field/fieldWidths";
import { FormArea, Group, GroupCol } from "src/components/UI";
import type { NoticeItem } from "src/components/Notice";
import { getFormatDate, getFormatDateOnly } from "src/utils/datetime";
import type { EvidenceRow, ViolationStatus } from "src/services/quality/api";
import QualityChip from "src/models/_quality/QualityChip";
import RecordLink from "src/models/_quality/RecordLink";
import DecisionBlock from "./DecisionBlock";
import {
	buildHistory, evidenceKindKey, evidenceLabel, evidenceList, evidenceTarget, itemCaption, sourceKey, statusLabel, statusTone, violationArea,
} from "./violations";
import main from "src/styles/main.module.scss";
import styles from "./StandardViolations.module.scss";

/** Поля записи, которые показывает карточка (подмножество полей формы). */
export interface ViolationViewData {
	uuid: string;
	userName: string;
	itemNumber: string;
	itemTitle: string;
	clientName: string;
	occurredAt: string;
	detectedAt: string;
	bonusMonth: string;
	description: string;
	evidence: EvidenceRow[];
	source: string;
	status: ViolationStatus;
	selfDetected: boolean;
	createdByName: string;
	decidedByName: string;
	decidedAt: string;
	decisionNote: string;
	disputeText: string;
	disputedAt: string;
	disputeDecision: string;
	disputeDecidedByName: string;
	disputeDecidedAt: string;
	canDecide: boolean;
	isMine: boolean;
}

interface Props {
	v: ViolationViewData;
	formUid: string;
	disabled: boolean;
	/** Имя формы — подпись записей журнала. */
	source: string;
	onReload: () => Promise<void> | void;
	onNotices: (items: NoticeItem[]) => void;
}

const EvidenceItem: FC<{ e: EvidenceRow }> = ({ e }) => {
	const target = evidenceTarget(e);
	const kind = translate(evidenceKindKey(e.kind));
	const text = evidenceLabel(e) || kind;
	return (
		<li className={styles.EvidenceItem}>
			<span className={styles.EvidenceKind}>{kind}</span>
			{target ? <RecordLink endpoint={target.endpoint} uuid={target.uuid}>{text}</RecordLink> : <span>{text}</span>}
		</li>
	);
};

export const ViolationView: FC<Props> = ({ v, formUid, disabled, source, onReload, onNotices }) => {
	const area = violationArea(v.evidence);
	const evidence = evidenceList(v.evidence);
	const history = buildHistory({
		source: v.source, status: v.status, selfDetected: v.selfDetected, detectedAt: v.detectedAt,
		createdByName: v.createdByName || null, decidedAt: v.decidedAt || null, decidedByName: v.decidedByName || null,
		decisionNote: v.decisionNote || null, disputedAt: v.disputedAt || null, disputeText: v.disputeText || null,
		disputeDecision: v.disputeDecision || null, disputeDecidedByName: v.disputeDecidedByName || null,
		disputeDecidedAt: v.disputeDecidedAt || null, userName: v.userName || null,
	});
	const name = (k: string) => `${formUid}_view_${k}`;

	return (
		<GroupCol>
			<div className={styles.StatusRow}>
				<QualityChip tone={statusTone(v.status)}>{statusLabel(v.status)}</QualityChip>
				{v.selfDetected && <QualityChip tone="ok">{translate("violationSelfDetectedChip")}</QualityChip>}
			</div>
			<Group>
				<Field label={translate("violationFieldEmployee")} name={name("user")} value={v.userName || "—"} disabled minWidth={FIELD_WIDTH.md} />
				<Field label={translate("violationFieldItem")} name={name("item")} value={itemCaption(v.itemNumber, v.itemTitle)} disabled minWidth={FIELD_WIDTH.lg} />
			</Group>
			<Group>
				<Field label={translate("violationFieldClientOrArea")} name={name("client")} value={v.clientName || area || "—"} disabled minWidth={FIELD_WIDTH.md} />
				<Field label={translate("violationFieldOccurredAt")} name={name("occurredAt")} value={getFormatDateOnly(v.occurredAt)} disabled width={FIELD_WIDTH.date} />
				<Field label={translate("detectedAt")} name={name("detectedAt")} value={getFormatDate(v.detectedAt)} disabled width={FIELD_WIDTH.date} />
			</Group>
			<Group>
				<Field label={translate("bonusMonth")} name={name("bonusMonth")} value={v.bonusMonth} disabled width={FIELD_WIDTH.sm}
					title={translate("violationBonusMonthHint")} />
				<Field label={translate("source")} name={name("source")} value={translate(sourceKey(v.source))} disabled width={FIELD_WIDTH.sm} title={v.source} />
				<Field label={translate("violationCreatedBy")} name={name("createdBy")} value={v.createdByName || "—"} disabled minWidth={FIELD_WIDTH.md} />
			</Group>
			<FieldTextarea label={translate("violationFieldDescription")} name={name("description")} value={v.description} disabled rows={4} />
			{v.disputeText && (
				<FieldTextarea label={translate("violationDisputeText")} name={name("dispute")} value={v.disputeText} disabled rows={3} />
			)}

			<FormArea title={translate("violationEvidence")}>
				{evidence.length ? (
					<ul className={styles.EvidenceList}>
						{evidence.map((e, i) => <EvidenceItem key={`${e.kind}-${String(e.uuid ?? i)}`} e={e} />)}
					</ul>
				) : (
					<div className={main.SettingHint}>{translate("violationNoEvidence")}</div>
				)}
			</FormArea>

			<FormArea title={translate("violationDecision")}>
				<DecisionBlock uuid={v.uuid} status={v.status} selfDetected={v.selfDetected} canDecide={v.canDecide} isMine={v.isMine}
					disabled={disabled} source={source} onDone={onReload} onNotices={onNotices} />
			</FormArea>

			<FormArea title={translate("violationHistory")}>
				<ul className={styles.History}>
					{history.map((h) => (
						<li key={h.key} className={styles.HistoryItem}>
							<span className={styles.HistoryAt}>{h.at ? getFormatDate(h.at) : "—"}</span>
							<span>
								{translate(h.textKey)}
								{h.actor && <span className={styles.HistoryActor}> — {h.actor}</span>}
							</span>
							{h.note && <div className={styles.HistoryNote}>{h.note}</div>}
						</li>
					))}
				</ul>
			</FormArea>
		</GroupCol>
	);
};

export default ViolationView;

/**
 * Окно «Исключение по находке» — решение главбуха с причиной и, при желании, сроком (СК2.3).
 *
 * Исключение — не «устранено», а осознанное решение: находка остаётся в базе, но выходит из
 * сводной задачи и не предлагается кандидатом в нарушения (п. 17: «ОС используем дальше»).
 * Сервер хранит причину, автора и срок; истёкшее исключение перестаёт действовать само.
 */
import { FC, useCallback, useState } from "react";
import Modal from "src/components/Modal";
import Notice, { type NoticeItem } from "src/components/Notice";
import { FieldDate, FieldTextarea } from "src/components/Field";
import { FIELD_WIDTH } from "src/components/Field/fieldWidths";
import { showToast } from "src/components/UIToast";
import { routeError } from "src/services/errors/route";
import { setFindingException } from "src/services/quality/api";
import { getAppUtcOffset, localInputToIso } from "src/utils/datetime";
import { localYmd } from "src/models/_quality/month";
import { translate } from "src/i18";
import styles from "./CheckFindings.module.scss";

interface Props {
	findingUuid: string;
	onClose: () => void;
	/** Исключение записано: перечитать карточку и списки. */
	onDone: () => void;
}

/** Короче этого сервер причину не примет (services/quality/checks.js). */
const MIN_REASON = 5;

export const FindingExceptionModal: FC<Props> = ({ findingUuid, onClose, onDone }) => {
	const [reason, setReason] = useState("");
	const [until, setUntil] = useState("");
	const [notices, setNotices] = useState<NoticeItem[]>([]);
	const [busy, setBusy] = useState(false);

	const apply = useCallback(async () => {
		if (busy) return;
		const text = reason.trim();
		const errors: NoticeItem[] = [];
		if (text.length < MIN_REASON) errors.push({ type: "error", text: translate("findingExceptionReasonShort") });
		// Срок в прошлом сделал бы исключение недействующим с первой секунды.
		if (until && until < localYmd(getAppUtcOffset() * 60)) errors.push({ type: "error", text: translate("findingExceptionUntilPast") });
		setNotices(errors);
		if (errors.length) return;
		setBusy(true);
		try {
			// «До даты» — включительно: конец этого дня по времени приложения, а не его начало.
			await setFindingException(findingUuid, text, until ? localInputToIso(`${until}T23:59`) : null);
			showToast(translate("findingExceptionSaved"), "success");
			onDone();
			onClose();
		} catch (e) {
			setNotices(routeError(e, { source: translate("CheckFindingsForm") }));
		} finally {
			setBusy(false);
		}
	}, [busy, reason, until, findingUuid, onDone, onClose]);

	return (
		<Modal
			title={translate("findingExceptionTitle")}
			onClose={onClose}
			buttons={[
				{ label: translate("findingExceptionApply"), onClick: () => void apply(), variant: "primary" },
				{ label: translate("cancel"), onClick: onClose, variant: "secondary" },
			]}
		>
			<div className={styles.ModalBody}>
				<p className={styles.ModalHint}>{translate("findingExceptionHint")}</p>
				<FieldTextarea label={translate("findingExceptionReason")} name="finding_exception_reason" value={reason}
					onChange={(e) => setReason(e.target.value)} disabled={busy} minWidth={FIELD_WIDTH.xl} rows={4} required />
				<FieldDate label={translate("findingExceptionUntil")} name="finding_exception_until" value={until}
					onChange={(e) => setUntil(e.target.value)} disabled={busy} width={FIELD_WIDTH.date}
					hint={translate("findingExceptionUntilHint")} />
				<Notice inline items={notices} />
			</div>
		</Modal>
	);
};
FindingExceptionModal.displayName = "FindingExceptionModal";

export default FindingExceptionModal;

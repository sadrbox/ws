import { useMemo } from "react";
import { translate } from "src/i18";
import { getDocumentFillHint, type DocumentType } from "src/utils/validatePostedDocument";
import type { NoticeItem } from "src/components/Notice";

interface UseDocumentNoticesArgs {
	docType: DocumentType;
	fields: Record<string, unknown>;
	/** Расхождение с документом-основанием (useBasisMismatch). */
	basisMismatch?: { mismatch: boolean; differences: string[] };
	/** Договор не соответствует контрагенту (useContractCounterpartyMismatch). */
	contractMismatch?: boolean;
	/**
	 * Ошибка ДАННЫХ формы (form.error при form.errorKind === "form"): клиентская
	 * валидация или бизнес-отказ бэка — «серий меньше количества», «период закрыт»,
	 * «основание не проведено». Показывается первой: её чинят правкой полей.
	 * Системные сбои (сеть, 5xx, права) сюда НЕ попадают — они уходят в <UIToast />.
	 */
	formError?: string | null;
}

/**
 * Собирает сообщения формы документа для компонента <Notice />:
 *   attention — незаполненные обязательные поля (нужны для проведения);
 *   warning   — условные расхождения (основание / договор↔контрагент);
 *   success   — всё заполнено и без расхождений.
 */
export function useDocumentNotices({
	docType,
	fields,
	basisMismatch,
	contractMismatch,
	formError,
}: UseDocumentNoticesArgs): NoticeItem[] {
	const hint = getDocumentFillHint(docType, fields);
	const basisOn = !!basisMismatch?.mismatch;
	const basisText = basisMismatch?.differences?.join(", ") ?? "";
	const cptyOn = !!contractMismatch;

	return useMemo(() => {
		const items: NoticeItem[] = [];
		// Ошибка данных — первой: именно её пользователь пришёл чинить.
		if (formError) items.push({ type: "error", text: formError });
		if (hint) items.push({ type: "attention", text: hint });
		if (basisOn) {
			items.push({
				type: "warning",
				text: translate("basisMismatch") + (basisText ? `: ${basisText}` : ""),
			});
		}
		if (cptyOn) items.push({ type: "warning", text: translate("contractCounterpartyMismatch") });
		if (items.length === 0) items.push({ type: "success", text: translate("documentFilledCorrectly") });
		return items;
	}, [formError, hint, basisOn, basisText, cptyOn]);
}

export default useDocumentNotices;

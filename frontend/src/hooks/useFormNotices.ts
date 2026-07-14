import { useMemo } from "react";
import type { NoticeItem } from "src/components/Notice";

interface FormLike {
	error: string | null;
	/** "form" — ошибка данных; "system" — сбой сети/сервера (уходит в <UIToast />). */
	errorKind?: "form" | "system" | null;
}

/**
 * Сообщения формы для <Notice /> — для форм БЕЗ документной специфики (справочники,
 * настройки, журналы). Документы используют useDocumentNotices: там к ошибке
 * добавляются подсказки о незаполненных реквизитах и расхождениях с основанием.
 *
 * Зачем вообще: ошибки ДАННЫХ формы показываются внутри формы (<Notice />) — рядом с
 * полями, которые пользователь пришёл править. Системные сбои (сеть, 5xx, права) сюда
 * НЕ попадают: они не про эту форму и уходят в <UIToast /> (см. useFormStore.errorKind).
 * Раньше формы-справочники не показывали ошибку данных вовсе — 422 от бэка («БИН занят»,
 * «период закрыт») исчезал бесследно, и пользователь не понимал, почему запись не
 * сохраняется.
 */
export function useFormNotices(form: FormLike): NoticeItem[] {
	const error = form.errorKind === "form" ? form.error : null;
	return useMemo(() => (error ? [{ type: "error" as const, text: error }] : []), [error]);
}

export default useFormNotices;

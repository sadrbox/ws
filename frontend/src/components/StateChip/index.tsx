/**
 * Метка состояния: «Доступна», «Не опубликована», «Нет в СУБД».
 *
 * ЗАЧЕМ ОТДЕЛЬНО ОТ СПИСКА РЕКВИЗИТОВ. Состояние отвечает на вопрос, с которым карточку и
 * открывают, — «что с ней сейчас». В общем списке оно стояло третьей строкой наравне с
 * именем сервера, и чтобы узнать, опубликована ли база, приходилось прочитать семь строк.
 * Метка отвечает раньше чтения: форма и цвет видны боковым зрением.
 *
 * ЦВЕТ — ПОДСПОРЬЕ, А НЕ СМЫСЛ. Слово в метке говорит то же самое, что и точка: человек,
 * который не различает красный и зелёный, читает ровно тот же ответ.
 */
import { type FC, type ReactNode } from "react";
import styles from "./StateChip.module.scss";

/** Тон метки: хорошо / плохо / «неизвестно или пусто» / нейтрально. */
export type ChipTone = "ok" | "bad" | "unknown" | "neutral";

export const StateChip: FC<{ tone?: ChipTone; title?: string; children: ReactNode }> =
	({ tone = "neutral", title, children }) => (
		<span className={styles.Chip} data-tone={tone} title={title}>{children}</span>
	);

/** Ряд меток: перенос по ширине, одинаковый шаг. */
export const StateChips: FC<{ children: ReactNode }> = ({ children }) => (
	<div className={styles.Chips}>{children}</div>
);

export default StateChip;

/**
 * Метка состояния экранов «Качества»: статус нарушения, «бонус есть / нет», «систематично».
 *
 * Рисует общий StateChip (точка цвета + слово), а тонов у него четыре: хорошо, плохо,
 * неизвестно, нейтрально. Экранам качества нужны ещё два — «ждёт решения» (оранжевый: кандидат,
 * «мер нет») и «на рассмотрении» (синий: возражение). Общий компонент не трогаем: точку этих
 * двух тонов перекрашивает обёртка по атрибуту data-tone, который StateChip уже ставит.
 *
 * Слово в метке говорит то же, что цвет, — различать цвета для чтения не нужно.
 */
import { type FC, type ReactNode } from "react";
import StateChip, { type ChipTone } from "src/components/StateChip";
import styles from "./QualityChip.module.scss";

/** Тон метки качества. */
export type QualityTone = "ok" | "bad" | "warn" | "info" | "muted";

const BASE: Record<QualityTone, ChipTone> = { ok: "ok", bad: "bad", warn: "neutral", info: "neutral", muted: "unknown" };
const WRAP: Partial<Record<QualityTone, string>> = { warn: styles.ToneWarn, info: styles.ToneInfo };

export const QualityChip: FC<{ tone: QualityTone; title?: string; children: ReactNode }> = ({ tone, title, children }) => (
	<span className={[styles.Chip, WRAP[tone]].filter(Boolean).join(" ")}>
		<StateChip tone={BASE[tone]} title={title}>{children}</StateChip>
	</span>
);

export default QualityChip;

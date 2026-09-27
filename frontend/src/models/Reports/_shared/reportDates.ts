// Дефолты периода отчётов (ISO yyyy-mm-dd). Убирают повтор инлайновых
// вычислений «первое число месяца» / «сегодня» в каждом отчёте.
//
// Дата — МЕСТНАЯ (часовой пояс из «Общих настроек»), а не UTC (У5): toISOString().slice(0, 10)
// с 00:00 до 05:00 по Алматы давал вчерашнее число, а 1-го — прошлый месяц.
import { isoToLocalInput } from "src/utils/datetime";

/** Сегодня. */
export const today = (): string => isoToLocalInput(new Date()).slice(0, 10);

/** Первое число текущего месяца. */
export const firstOfMonth = (): string => `${today().slice(0, 8)}01`;

// Дефолты периода отчётов (ISO yyyy-mm-dd). Убирают повтор инлайновых
// вычислений «первое число месяца» / «сегодня» в каждом отчёте.

/** Первое число текущего месяца. */
export const firstOfMonth = (): string => {
	const d = new Date();
	d.setDate(1);
	return d.toISOString().slice(0, 10);
};

/** Сегодня. */
export const today = (): string => new Date().toISOString().slice(0, 10);

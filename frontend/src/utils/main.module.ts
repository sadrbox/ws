// Форматирование даты (только дд.мм.гггг)
export const getFormatDateOnly = (dateString?: string | null): string => {
	if (!dateString) return "";
	const s = String(dateString).slice(0, 10); // "YYYY-MM-DD"
	if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
	return `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}`;
};

// Форматирование даты
export const getFormatDate = (dateString?: string) => {
	if (!dateString) return "";

	const date = new Date(dateString);
	if (isNaN(date.getTime())) return "";

	const formatter = new Intl.DateTimeFormat("ru-RU", {
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	});

	// Получаем части и убираем запятую
	return formatter.format(date).replace(/,\s*/, " ");
};

// Уникальный генератор UUID (полифилл)
export const crypto = {
	randomUUID: (): string => {
		return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
			/[xy]/g,
			function (c) {
				const r = (Math.random() * 16) | 0,
					v = c === "x" ? r : (r & 0x3) | 0x8;
				return v.toString(16);
			},
		);
	},
};

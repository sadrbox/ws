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
				var r = (Math.random() * 16) | 0,
					v = c === "x" ? r : (r & 0x3) | 0x8;
				return v.toString(16);
			},
		);
	},
};

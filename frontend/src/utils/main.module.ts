// Формат числовой идентификатор /////////////////////////////////////////////////////////////////////////
export function getFormatNumericalID(n: number): string {
	return n.toString().padStart(5, "0");
}

// Формат числа /////////////////////////////////////////////////////////////////////////
export function getFormatNumerical(n: number): string {
	const formater = new Intl.NumberFormat("ru-RU", {
		style: "decimal",
		minimumFractionDigits: 1,
	});
	return formater.format(n);
}

// Формат даты /////////////////////////////////////////////////////////////////////////
export function getFormatDate(d: string): string {
	const date = new Date(d);
	const localDateString = date.toLocaleString();

	return localDateString;
}

// Уникальный генератор ///////////////////////////////////////////////////////////////
export const crypto = {
	randomUUID: (): string => {
		// Простая реализация UUID для полифилла
		return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
			/[xy]/g,
			function (c) {
				var r = (Math.random() * 16) | 0,
					v = c === "x" ? r : (r & 0x3) | 0x8;
				return v.toString(16);
			}
		);
	},
};

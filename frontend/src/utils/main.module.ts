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

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
// export function getFormatDate(d: string): string {
// 	const date = new Date(d);
// 	const localDateString = date.toLocaleString();

// 	return localDateString;
// }

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
			},
		);
	},
};
// Проверка доступности сервера ///////////////////////////////////////////////////////////////
export const checkServerAvailability = async (
	url: string,
	signal: AbortSignal,
) => {
	try {
		const response = await fetch(url, { method: "HEAD", signal });
		return response.ok;
	} catch {
		return false;
	}
};
// Преобразование формат даты ///////////////////////////////////////////////////////////////

// export function formatDateForInput(
// 	date: Date | string | null | undefined
// ): string {
// 	const parsedDate = typeof date === "string" ? new Date(date) : date;

// 	if (!(parsedDate instanceof Date) || isNaN(parsedDate.getTime())) {
// 		return "";
// 	}

// 	return parsedDate.toISOString().slice(0, 16); // формат: yyyy-MM-ddThh:mm
// }

export const formatDateForInput = (date: Date) => {
	const pad = (n: number) => n.toString().padStart(2, "0");
	const year = date.getFullYear();
	const month = pad(date.getMonth() + 1);
	const day = pad(date.getDate());
	const hours = pad(date.getHours());
	const minutes = pad(date.getMinutes());
	return `${year}-${month}-${day}T${hours}:${minutes}`;
};

function getApiUrl() {
	const LOCAL_API_URL = "http://192.168.1.112:3000/api/v1";
	const REMOTE_API_URL = "http://buhprof.ddns.me:3000/api/v1";

	const isLocalNetwork =
		window.location.hostname.includes("192.168.") ||
		window.location.hostname === "localhost" ||
		window.location.hostname === "127.0.0.1";

	return isLocalNetwork ? LOCAL_API_URL : REMOTE_API_URL;
}

export const API_BASE_URL = getApiUrl();

import moment from "moment";

import { getTranslation } from "src/app/i18";

export function getDateFromISO(dateString: string): string {
	const date = moment(dateString);
	// const dateUTC = date.add(24, "hours").utc();
	return date.format("DD.MM.YYYY HH:mm:ss");
}
export function getDurationSession(seconds: number): string {
	// Рассчитываем часы
	const hours: number = Math.floor(seconds / 3600);
	// Оставшиеся секунды после вычета часов
	const remainingSeconds: number = seconds % 3600;
	// Рассчитываем минуты
	const minutes: number = Math.floor(remainingSeconds / 60);
	return `${hours}:${minutes}`;
}

export function isValidEmail(email: string) {
	const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
	return emailRegex.test(email);
}

export function stringJoin(...str: string[]) {
	return str.join(" ");
}

export function getViewValue(
	value: string | number | boolean,
	columnID: string,
) {
	const formater = new Intl.NumberFormat("ru-RU", {
		style: "decimal",
		minimumFractionDigits: 2,
	});

	const result =
		typeof value === "string"
			? value
			: typeof value === "number"
				? columnID === "id"
					? value.toString().padStart(6, "0")
					: formater.format(+value)
				: typeof value === "boolean"
					? Boolean(value) === true
						? getTranslation("completed")
						: getTranslation("inprogress")
					: value; // Если тип не string, number или boolean
	return result;
}

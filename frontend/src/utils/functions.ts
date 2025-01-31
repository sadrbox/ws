import moment from "moment";

import {
	CSSProperties,
	DetailedHTMLProps,
	HTMLAttributes,
	RefObject,
} from "react";
import { ResolveFnOutput } from "module";
// import { TColumn, TDataItem } from "src/components/ui/DataGrid/services";
import { getTranslation } from "src/i18";
import { TColumn, TDataItem } from "src/components/ui/Grid/types";
// import { TColumn, TDataItem } from "src/objects/Todos";
// import { ICol, IProduct } from "src/components/ui/DataGrid/types";
// import { translateWord } from "src/i18";

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

// export function getFormatValue(item: TDataItem, column: TColumn) {
// 	// console.log(rowId);
// 	if (column.identifier === "id") {
// 		return item.id.toString().padStart(6, "0");
// 	} else if (column.type === "number") {
// 		const formater = new Intl.NumberFormat("ru-RU", {
// 			style: "decimal",
// 			minimumFractionDigits: 2,
// 		});
// 		return formater.format(+item[column.identifier]);
// 	}
// 	return item[column.identifier];
// }

export function isValidEmail(email: string) {
	const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
	return emailRegex.test(email);
}

export function stringJoin(...str: string[]) {
	return str.join(" ");
}

export function getViewValue(
	value: string | number | boolean,
	columnID: string
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
// export function getSumOfColumn(data, columnName) {
// 	let sum = 0;
// 	for (let i = 0; i < data.length; i++) {
// 		sum += +data[i][columnName];
// 	}
// 	const options = { style: "decimal", minimumFractionDigits: 2 };
// 	const formater = new Intl.NumberFormat("ru-RU", options);
// 	return formater.format(sum);
// }
// // Функция для загрузки данных из localStorage
// async function getDataFromLocalStorage(key) {
// 	return new Promise((resolve) => {
// 		const data = localStorage.getItem(key);
// 		resolve(data ? JSON.parse(data) : null);
// 	});
// }

// // функция для сохранения данных в localStorage
// async function saveDataToLocalStorage(key, data) {
// 	return new Promise((resolve) => {
// 		localStorage.setItem(key, JSON.stringify(data));
// 		resolve();
// 	});
// }

// // Асинхронная функция для получения данных с использыванием кэширования
// export async function fetchDataWitCache(key, fetchDataFunction) {
// 	try {
// 		// Пытаемся сначала загрузить данные из localStorage
// 		let cachedData = await getDataFromLocalStorage(key);
// 		if (!cachedData) {
// 			// Если данных нет в кеше, делаем асинхронных запрос к серверу
// 			cachedData = await fetchDataFunction();
// 			// Сохранаяем полученные данные в кеше localStorage
// 			await saveDataToLocalStorage(key, cachedData);
// 		}
// 		return cachedData;
// 	} catch (error) {
// 		console.error("Ошибка при загрузки данных:", error);
// 		throw error;
// 	}
// }

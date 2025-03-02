import moment from "moment";
// const moment = require("moment");

export function getDateFromISO(dateString) {
	const date = moment(dateString);
	const dateUTC = date.add(24, "hours").utc();
	return date.format("DD.MM.YYYY HH:mm:ss");
}
export function getDurationSession(seconds) {
	// Рассчитываем часы
	var hours = Math.floor(seconds / 3600);
	// Оставшиеся секунды после вычета часов
	var remainingSeconds = seconds % 3600;
	// Рассчитываем минуты
	var minutes = Math.floor(remainingSeconds / 60);
	return `${hours}:${minutes}`;
}

export function getFormatValue(element, column) {
	// console.log(rowId);
	if (column.field === "id") {
		return element.id.toString().padStart(6, "0");
	} else if (column.type === "number") {
		const options = { style: "decimal", minimumFractionDigits: 2 };
		const formater = new Intl.NumberFormat("ru-RU", options);
		return formater.format(element[column.field]);
	} else {
		return element[column.field];
	}
}

export function getSumOfColumn(data, columnName) {
	let sum = 0;
	for (let i = 0; i < data.length; i++) {
		sum += +data[i][columnName];
	}
	const options = { style: "decimal", minimumFractionDigits: 2 };
	const formater = new Intl.NumberFormat("ru-RU", options);
	return formater.format(sum);
}

export function formatIpAddress(ip) {
	const formattedIP =
		ip.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/)?.[1] || "";
	return formattedIP;
}
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

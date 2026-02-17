// hooks/queryParamsUtils.ts
/**
 * Утилиты для работы с параметрами запроса
 */

/**
 * Преобразование параметров в строку запроса
 */
export function paramsToQueryString(params: Record<string, any>): string {
	const searchParams = new URLSearchParams();

	Object.entries(params).forEach(([key, value]) => {
		if (value === null || value === undefined) return;

		if (Array.isArray(value)) {
			value.forEach((item) => {
				searchParams.append(`${key}[]`, String(item));
			});
		} else if (typeof value === "object") {
			Object.entries(value).forEach(([subKey, subValue]) => {
				if (subValue !== null && subValue !== undefined) {
					searchParams.append(`${key}[${subKey}]`, String(subValue));
				}
			});
		} else {
			searchParams.append(key, String(value));
		}
	});

	return searchParams.toString();
}

/**
 * Парсинг строки запроса в объект
 */
export function queryStringToParams(queryString: string): Record<string, any> {
	const params = new URLSearchParams(queryString);
	const result: Record<string, any> = {};

	params.forEach((value, key) => {
		// Обработка массивов: key[]
		if (key.endsWith("[]")) {
			const cleanKey = key.slice(0, -2);
			if (!result[cleanKey]) {
				result[cleanKey] = [];
			}
			result[cleanKey].push(parseValue(value));
		}
		// Обработка вложенных объектов: key[subKey]
		else if (key.includes("[") && key.includes("]")) {
			const match = key.match(/^([^\[]+)\[([^\]]+)\]$/);
			if (match) {
				const [, mainKey, subKey] = match;
				if (!result[mainKey]) {
					result[mainKey] = {};
				}
				result[mainKey][subKey] = parseValue(value);
			}
		}
		// Обычные параметры
		else {
			result[key] = parseValue(value);
		}
	});

	return result;
}

/**
 * Парсинг значения с учетом типа
 */
function parseValue(value: string): any {
	if (value === "true") return true;
	if (value === "false") return false;
	if (value === "null") return null;
	if (value === "undefined") return undefined;

	const num = Number(value);
	if (!isNaN(num) && value.trim() !== "") return num;

	try {
		return JSON.parse(value);
	} catch {
		return value;
	}
}

/**
 * Создание URL с параметрами
 */
export function createUrlWithParams(
	baseUrl: string,
	params: Record<string, any>,
): string {
	const queryString = paramsToQueryString(params);
	return queryString ? `${baseUrl}?${queryString}` : baseUrl;
}

/**
 * Обновление параметров в URL
 */
export function updateUrlParams(
	currentParams: Record<string, any>,
	updates: Record<string, any>,
): Record<string, any> {
	const result = { ...currentParams };

	Object.entries(updates).forEach(([key, value]) => {
		if (value === undefined || value === null) {
			delete result[key];
		} else {
			result[key] = value;
		}
	});

	return result;
}

/**
 * Удаление параметров из URL
 */
export function removeUrlParams(
	currentParams: Record<string, any>,
	keysToRemove: string[],
): Record<string, any> {
	const result = { ...currentParams };

	keysToRemove.forEach((key) => {
		delete result[key];
	});

	return result;
}

/**
 * Сравнение параметров
 */
export function areParamsEqual(
	params1: Record<string, any>,
	params2: Record<string, any>,
): boolean {
	const clean1 = Object.fromEntries(
		Object.entries(params1).filter(([_, v]) => v !== undefined && v !== null),
	);

	const clean2 = Object.fromEntries(
		Object.entries(params2).filter(([_, v]) => v !== undefined && v !== null),
	);

	return JSON.stringify(clean1) === JSON.stringify(clean2);
}

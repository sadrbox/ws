// parseUploadErrors — построчный разбор ошибок из ответа upload* (ЭСФ/СНТ/ЭАВР).
// (T7.8) Раньше uploadSnt/uploadAwp возвращали только {id,registrationNumber,
// status,raw} — отклонённые/ошибочные строки терялись. Здесь — общий парсер
// (мирроринг ЭСФ parseErrors): собирает все блоки <error> (в т.ч. вложенные в
// declinedSet/failureSet — они попадают в общий скан), с фолбэком на одиночную
// ошибку верхнего уровня. Формат ответов СНТ/ЭАВР — гипотеза до живого контура
// (T7.1); парсер устойчив к вариантам имён (text|description|errorText).
import { extractTag } from "./soapClient.js";

/**
 * @param {string} xml — сырой ответ SOAP.
 * @returns {{errorCode:string|null,text:string|null,property:string|null}[]}
 */
export function parseUploadErrors(xml) {
	if (!xml || typeof xml !== "string") return [];
	const blocks = xml.match(/<(?:\w+:)?error\b[^>]*>[\s\S]*?<\/(?:\w+:)?error>/gi) || [];
	const errors = blocks.map((b) => ({
		errorCode: extractTag(b, "errorCode") || null,
		text: extractTag(b, "text") || extractTag(b, "description") || extractTag(b, "errorText") || null,
		property: extractTag(b, "property") || extractTag(b, "field") || null,
	}));
	// Фолбэк: одиночная ошибка без обёртки <error> (напр. верхнеуровневый fault-текст).
	if (!errors.length) {
		const text = extractTag(xml, "errorText") || extractTag(xml, "text") || extractTag(xml, "description");
		const code = extractTag(xml, "errorCode");
		if (text || code) errors.push({ errorCode: code || null, text: text || null, property: null });
	}
	return errors;
}

/** Свести список ошибок в одну строку для поля *ErrorText документа. */
export function joinErrorText(errors) {
	if (!errors || !errors.length) return null;
	return errors
		.map((e) => [e.errorCode, e.text].filter(Boolean).join(": ") + (e.property ? ` (${e.property})` : ""))
		.filter(Boolean)
		.join("\n") || null;
}

export default parseUploadErrors;

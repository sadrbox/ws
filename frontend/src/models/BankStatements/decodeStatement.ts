/**
 * ТЕКСТ ФАЙЛА ВЫПИСКИ — В ЕГО СОБСТВЕННОЙ КОДИРОВКЕ (аудит 26.09, И18).
 *
 * Раньше файл читался `file.text()`, то есть всегда как UTF-8. Но 1CClientBankExchange по
 * стандарту формата пишется в «Кодировка=Windows» (windows-1251), изредка в «Кодировка=DOS»
 * (cp866): кириллические ключи превращались в «�», парсер сервера не находил ни одной
 * «СекцияДокумент» и импорт давал 0 строк без объяснений. CSV из русского Excel — тоже
 * windows-1251.
 *
 * Порядок: корректный UTF-8 (в том числе с BOM) берём как есть; иначе смотрим заголовок
 * «Кодировка=» — DOS → cp866, прочее → windows-1251.
 */

const CP1251 = "windows-1251";
const CP866 = "ibm866";

/** Заголовок 1С «Кодировка=…» в уже декодированном тексте. */
function declaredEncoding(text: string): string | null {
	const m = /Кодировка\s*=\s*([^\r\n]+)/i.exec(text);
	return m ? m[1].trim().toUpperCase() : null;
}

export function decodeStatementBytes(input: ArrayBuffer | Uint8Array): string {
	const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);

	// Строгий UTF-8: невалидная последовательность бросает — значит, файл не в UTF-8.
	// Файл, где кириллицы нет вовсе, валиден в любой из кодировок — UTF-8 его и прочтёт.
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		/* не UTF-8 — определяем однобайтовую кодировку ниже */
	}

	const cp1251 = new TextDecoder(CP1251).decode(bytes);
	const declared1251 = declaredEncoding(cp1251);
	if (declared1251 && declared1251.startsWith("DOS")) return new TextDecoder(CP866).decode(bytes);
	if (declared1251) return cp1251;

	// В cp866 слово «Кодировка» в windows-1251 не читается — пробуем прочесть заголовок как DOS.
	const cp866 = new TextDecoder(CP866).decode(bytes);
	if (declaredEncoding(cp866)?.startsWith("DOS")) return cp866;

	return cp1251;
}

/**
 * Склейка имён классов.
 *
 * Заменяет повторяющееся `[a, b && c].filter(Boolean).join(" ")`: в таблице такая
 * склейка выполняется на КАЖДУЮ ячейку каждой видимой строки, и каждый раз создаёт
 * промежуточный массив. Здесь массива нет, а ложные значения (false/undefined/null/"")
 * отбрасываются — это и есть весь смысл функции.
 */
export function cx(...parts: (string | false | null | undefined)[]): string {
	let out = "";
	for (const p of parts) {
		if (!p) continue;
		out = out ? `${out} ${p}` : p;
	}
	return out;
}

export default cx;

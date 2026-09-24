// Содержимое файла, извлечённое БЕЗ ИИ — единый вид для любого формата.
//
// Зачем. Модель, читающая PDF целиком, платит за картинки страниц и сама ищет в них текст. Если
// текст можно достать кодом (PDF с текстовым слоем, XLSX), модели остаётся только разложить его по
// полям документа: это дешевле, быстрее и доступно любой модели, включая локальную. Сканы и фото
// текстового слоя не имеют — их по-прежнему читает модель со зрением (hasText: false).
//
// Строки таблиц передаются как есть, колонки — разделителем « │ »: код не угадывает, что значит
// колонка, он только сохраняет, где кончается одна ячейка и начинается другая.

export type FileKind = "pdf" | "xlsx";

export type PdfPage = { number: number; lines: string[] };
/** rowNumbers — номера строк как в Excel (пустые строки листа пропущены, номера — нет). */
export type Sheet = { name: string; rows: string[][]; rowNumbers: number[] };

export type FileContent = {
	kind: FileKind;
	/** Есть ли в файле текст, достаточный для разбора без картинки. */
	hasText: boolean;
	pages?: PdfPage[];
	sheets?: Sheet[];
	stats: { pages?: number; sheets?: number; rows?: number; chars: number; ms: number };
};

export const COLUMN_SEPARATOR = " │ ";

/** Меньше стольких знаков на страницу — считаем, что текстового слоя нет (скан с колонтитулом). */
export const MIN_CHARS_PER_PAGE = 50;

/** Текст для модели. Формат описан в системном промпте экстрактора. */
export function contentToText(c: FileContent): string {
	if (c.kind === "pdf") {
		return (c.pages ?? []).map((p) => `=== Страница ${p.number} ===\n${p.lines.join("\n")}`).join("\n\n");
	}
	return (c.sheets ?? []).map((s) => {
		const rows = s.rows.map((r, i) => `${s.rowNumbers[i] ?? i + 1}: ${r.join(COLUMN_SEPARATOR)}`);
		return `=== Лист «${s.name}» ===\n${rows.join("\n")}`;
	}).join("\n\n");
}

/** Вид файла по первым байтам и имени: содержимому верим больше, чем расширению. */
export function detectKind(bytes: Buffer, fileName: string): FileKind | null {
	if (bytes.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
	// XLSX — zip; отличить от DOCX/ODS по сигнатуре нельзя, поэтому ещё и расширение.
	if (bytes.length >= 4 && bytes.readUInt32LE(0) === 0x04034b50 && /\.xlsx$/i.test(fileName)) return "xlsx";
	return null;
}

export class ContentError extends Error {
	readonly code: string;
	constructor(code: string, message: string) {
		super(message);
		this.code = code;
	}
}

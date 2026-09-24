// Текст PDF с сохранением раскладки — pdf.js, без отрисовки страниц.
//
// pdf.js отдаёт фрагменты текста с координатами. Строку страницы собираем из фрагментов с одной высотой
// (y), а внутри строки — по x: большой промежуток между фрагментами — граница колонки таблицы
// (COLUMN_SEPARATOR), маленький — пробел между словами. Так таблица выписки или счёта приходит модели
// строками с ячейками, а не сплошным потоком слов.
//
// ПОВЁРНУТЫЙ ТЕКСТ. Kaspi печатает таблицу выписки повёрнутой на 90°: фрагменты идут снизу вверх, и по
// высоте на странице строк не собрать. Поэтому каждый фрагмент сначала переводится в систему координат
// своего текста (угол из матрицы шрифта, округлённый до 90°), а фрагменты разных углов раскладываются
// отдельно — сначала обычный текст, затем повёрнутый.
//
// canvas (@napi-rs/canvas) сервису не нужен и заменён заглушкой (stubs/napi-rs-canvas): его сборка требует
// AVX, которого у процессора сервера нет, и роняла бы процесс.

import { COLUMN_SEPARATOR, ContentError, MIN_CHARS_PER_PAGE, type FileContent, type PdfPage } from "./content.ts";

export type PdfLimits = { maxPages: number; maxChars: number };

type Item = { str: string; x: number; y: number; w: number; h: number };
type RawItem = { str: string; t: number[]; w: number };

export async function readPdf(bytes: Uint8Array, limits: PdfLimits): Promise<FileContent> {
	const started = Date.now();
	const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
	const task = pdfjs.getDocument({
		data: bytes, verbosity: pdfjs.VerbosityLevel.ERRORS,
		// Чужой файл: никаких шрифтов и ресурсов извне (eval pdf.js 6 не использует вовсе).
		disableFontFace: true, useSystemFonts: false, stopAtErrors: false,
	});
	let doc;
	try {
		doc = await task.promise;
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		await task.destroy();
		if (/password/i.test(msg)) throw new ContentError("PDF_ENCRYPTED", "PDF защищён паролем");
		throw new ContentError("PDF_BROKEN", `PDF не читается: ${msg}`);
	}
	try {
		if (doc.numPages > limits.maxPages) throw new ContentError("TOO_MANY_PAGES", `В PDF ${doc.numPages} страниц — больше предела ${limits.maxPages}`);
		const pages: PdfPage[] = [];
		let chars = 0;
		for (let n = 1; n <= doc.numPages; n++) {
			const page = await doc.getPage(n);
			const tc = await page.getTextContent();
			const raw: RawItem[] = [];
			for (const it of tc.items) {
				if (!("str" in it) || !it.str.trim()) continue;
				raw.push({ str: it.str, t: it.transform, w: it.width });
			}
			const lines = pageLines(raw);
			chars += lines.reduce((a, l) => a + l.length, 0);
			if (chars > limits.maxChars) throw new ContentError("TOO_MUCH_TEXT", `Текста в PDF больше предела (${limits.maxChars} знаков)`);
			pages.push({ number: n, lines });
			page.cleanup();
		}
		return { kind: "pdf", hasText: chars >= MIN_CHARS_PER_PAGE * Math.max(1, pages.length), pages, stats: { pages: pages.length, chars, ms: Date.now() - started } };
	} finally {
		await task.destroy();
	}
}

/** Фрагменты страницы → строки с учётом поворота текста. */
export function pageLines(raw: RawItem[]): string[] {
	const byAngle = new Map<number, Item[]>();
	for (const r of raw) {
		const [a, b, c, d, e, f] = r.t;
		// Угол базовой линии, округлённый до 90°: 0, 90, 180, 270.
		const angle = ((Math.round(Math.atan2(b, a) / (Math.PI / 2)) % 4) + 4) % 4;
		const rad = angle * Math.PI / 2;
		const cos = Math.round(Math.cos(rad)), sin = Math.round(Math.sin(rad));
		// Поворот точки на −угол: координаты в системе текста, где строка снова горизонтальна.
		const x = e * cos + f * sin;
		const y = -e * sin + f * cos;
		const item = { str: r.str, x, y, w: r.w, h: Math.hypot(c, d) || 8 };
		const list = byAngle.get(angle);
		if (list) list.push(item);
		else byAngle.set(angle, [item]);
	}
	return [...byAngle.keys()].sort((a, b) => a - b).flatMap((k) => layoutLines(byAngle.get(k)!));
}

/** Фрагменты страницы → строки: сверху вниз, слева направо, колонки через разделитель. */
export function layoutLines(items: Item[]): string[] {
	if (!items.length) return [];
	// Сверху вниз (в PDF y растёт вверх), при равной высоте — слева направо.
	const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
	const rows: Item[][] = [];
	for (const it of sorted) {
		const row = rows.at(-1);
		// Одна строка — если базовые линии ближе половины высоты шрифта.
		if (row && Math.abs(row[0].y - it.y) <= Math.max(1.5, Math.min(row[0].h, it.h) * 0.5)) row.push(it);
		else rows.push([it]);
	}
	return rows.map((row) => {
		row.sort((a, b) => a.x - b.x);
		let out = "";
		let end = -Infinity;
		for (const it of row) {
			const text = it.str.replace(/\s+/g, " ");
			if (out) {
				const gap = it.x - end;
				// Средняя ширина знака этого фрагмента: промежуток шире двух знаков — новая колонка.
				const charW = it.w > 0 && it.str.length ? it.w / it.str.length : it.h * 0.5;
				// Сумма, закончившаяся копейками («4 381,07»), продолжиться не может: цифры за ней — уже соседняя
				// колонка, даже вплотную (в выписке БЦК «Кредит» стоит почти впритык к «КНП»: «4 381,07 316»).
				const afterMoney = /[.,]\d{2}$/.test(out) && /^\d/.test(text);
				out += gap > Math.max(4, charW * 2) || (afterMoney && gap > 0) ? COLUMN_SEPARATOR : gap > charW * 0.2 ? " " : "";
			}
			out += text;
			end = Math.max(end, it.x + it.w);
		}
		return out.trim();
	}).filter(Boolean);
}

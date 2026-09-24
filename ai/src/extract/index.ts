// Извлечение содержимого файла без ИИ — точка входа для сервиса.
//
// Разбор идёт в отдельном потоке (worker.ts) с пределами: размер файла, страницы, строки, распакованный
// объём, память потока и время. Всё, что за пределами, — отказ с понятным кодом, а не зависший сервис.

import { Worker } from "node:worker_threads";
import { ContentError, detectKind, type FileContent, type FileKind } from "./content.ts";
import type { PdfLimits } from "./pdf.ts";
import type { XlsxLimits } from "./xlsx.ts";

export { ContentError, contentToText, type FileContent } from "./content.ts";

export type ContentLimits = PdfLimits & XlsxLimits & { maxFileBytes: number; timeoutMs: number; heapMb: number };

export const DEFAULT_LIMITS: ContentLimits = {
	maxFileBytes: 30 * 1024 * 1024,
	maxPages: 300,
	maxChars: 2_000_000,
	maxEntries: 5_000,
	maxEntryBytes: 50 * 1024 * 1024,
	maxTotalBytes: 150 * 1024 * 1024,
	maxRows: 50_000,
	maxCols: 200,
	timeoutMs: 60_000,
	heapMb: 512,
};

export type WorkerInput = { kind: FileKind; bytes: Uint8Array; limits: ContentLimits };
export type WorkerOutput = { ok: true; content: FileContent } | { ok: false; code: string; message: string };

/** Читает содержимое файла; null — формат не поддерживается разбором без ИИ. */
export type ContentReader = (bytes: Buffer, fileName: string) => Promise<FileContent | null>;

export function createContentReader(limits: ContentLimits = DEFAULT_LIMITS): ContentReader {
	return async (bytes, fileName) => {
		const kind = detectKind(bytes, fileName);
		if (!kind) return null;
		if (bytes.length > limits.maxFileBytes) throw new ContentError("TOO_LARGE", `Файл больше ${Math.round(limits.maxFileBytes / 1048576)} МБ`);
		return runWorker({ kind, bytes: new Uint8Array(bytes), limits });
	};
}

function runWorker(input: WorkerInput): Promise<FileContent> {
	return new Promise((resolve, reject) => {
		const worker = new Worker(new URL("./worker.ts", import.meta.url), {
			workerData: input, transferList: [input.bytes.buffer as ArrayBuffer],
			resourceLimits: { maxOldGenerationSizeMb: input.limits.heapMb },
		});
		let settled = false;
		const done = (fn: () => void) => { if (!settled) { settled = true; clearTimeout(timer); fn(); void worker.terminate(); } };
		const timer = setTimeout(() => done(() => reject(new ContentError("TIMEOUT", `Разбор файла не уложился в ${Math.round(input.limits.timeoutMs / 1000)} с`))), input.limits.timeoutMs);
		worker.once("message", (out: WorkerOutput) => done(() => (out.ok ? resolve(out.content) : reject(new ContentError(out.code, out.message)))));
		worker.once("error", (e) => done(() => reject(new ContentError(/memory/i.test(e.message) ? "OUT_OF_MEMORY" : "CONTENT_ERROR", `Разбор файла прерван: ${e.message}`))));
		worker.once("exit", (code) => done(() => reject(new ContentError("CONTENT_ERROR", `Поток разбора завершился (код ${code})`))));
	});
}

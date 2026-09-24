// Поток разбора файла: чужой PDF или XLSX читается здесь, а не в процессе сервиса.
//
// Зависший разбор (испорченный PDF) или разбор, съедающий память, убивает только этот поток: родитель
// ставит ему предел кучи (resourceLimits) и срок (terminate), чат и агенты продолжают работать.

import { parentPort, workerData } from "node:worker_threads";
import { readPdf } from "./pdf.ts";
import { readXlsx } from "./xlsx.ts";
import { ContentError } from "./content.ts";
import type { WorkerInput, WorkerOutput } from "./index.ts";

const input = workerData as WorkerInput;

/*
 * pdf.js при загрузке пишет в консоль «Warning: Cannot load @napi-rs/canvas…» — это ожидаемо (canvas
 * заменён заглушкой) и в журнале сервиса был бы шумом на каждый файл. Глушим только предупреждения pdf.js
 * и только в этом потоке.
 */
for (const k of ["log", "warn"] as const) {
	const orig = console[k].bind(console);
	console[k] = (...args: unknown[]) => { if (typeof args[0] === "string" && args[0].startsWith("Warning: ")) return; orig(...args); };
}

async function run(): Promise<WorkerOutput> {
	try {
		const content = input.kind === "pdf"
			? await readPdf(input.bytes, input.limits)
			: readXlsx(Buffer.from(input.bytes.buffer, input.bytes.byteOffset, input.bytes.byteLength), input.limits);
		return { ok: true, content };
	} catch (e) {
		if (e instanceof ContentError) return { ok: false, code: e.code, message: e.message };
		return { ok: false, code: "CONTENT_ERROR", message: e instanceof Error ? e.message : String(e) };
	}
}

run().then((out) => parentPort!.postMessage(out));

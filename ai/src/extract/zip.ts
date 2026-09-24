// Чтение zip-архива (контейнер XLSX) с жёсткими пределами — без сторонних библиотек.
//
// Файл чужой, поэтому архиву не верим ни в чём: заявленные размеры проверяются, а распаковка каждого
// элемента ограничена средствами zlib (maxOutputLength). «Zip-бомба» из 100 КБ, разворачивающаяся в
// гигабайты, остановится на пределе, а не на исчерпании памяти сервиса.

import { inflateRawSync } from "node:zlib";
import { ContentError } from "./content.ts";

export type ZipLimits = { maxEntries: number; maxEntryBytes: number; maxTotalBytes: number };

export type ZipEntry = { name: string; method: number; compressedSize: number; size: number; offset: number };

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

export class ZipReader {
	private readonly buf: Buffer;
	private readonly limits: ZipLimits;
	private total = 0;
	readonly entries: Map<string, ZipEntry>;

	constructor(buf: Buffer, limits: ZipLimits) {
		this.buf = buf;
		this.limits = limits;
		this.entries = this.readCentral();
	}

	private readCentral(): Map<string, ZipEntry> {
		const b = this.buf;
		// Конец центрального каталога — в последних 64 КБ + 22 байта (комментарий архива до 64 КБ).
		let eocd = -1;
		for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 0xffff); i--) {
			if (b.readUInt32LE(i) === EOCD) { eocd = i; break; }
		}
		if (eocd < 0) throw new ContentError("ZIP_BROKEN", "Файл не является zip-архивом (XLSX)");
		const count = b.readUInt16LE(eocd + 10);
		const dirOffset = b.readUInt32LE(eocd + 16);
		if (count === 0xffff || dirOffset === 0xffffffff) throw new ContentError("ZIP_UNSUPPORTED", "Архив ZIP64 не поддерживается");
		if (count > this.limits.maxEntries) throw new ContentError("ZIP_LIMIT", `В архиве ${count} элементов — больше предела`);
		const out = new Map<string, ZipEntry>();
		let p = dirOffset;
		for (let i = 0; i < count; i++) {
			if (p + 46 > b.length || b.readUInt32LE(p) !== CENTRAL) throw new ContentError("ZIP_BROKEN", "Повреждён каталог zip-архива");
			const method = b.readUInt16LE(p + 10);
			const compressedSize = b.readUInt32LE(p + 20);
			const size = b.readUInt32LE(p + 24);
			const nameLen = b.readUInt16LE(p + 28);
			const extraLen = b.readUInt16LE(p + 30);
			const commentLen = b.readUInt16LE(p + 32);
			const offset = b.readUInt32LE(p + 42);
			const name = b.subarray(p + 46, p + 46 + nameLen).toString("utf8");
			out.set(name, { name, method, compressedSize, size, offset });
			p += 46 + nameLen + extraLen + commentLen;
		}
		return out;
	}

	has(name: string): boolean {
		return this.entries.has(name);
	}

	/** Содержимое элемента строкой UTF-8; null — элемента нет. */
	text(name: string): string | null {
		const e = this.entries.get(name);
		if (!e) return null;
		const b = this.buf;
		if (e.offset + 30 > b.length || b.readUInt32LE(e.offset) !== LOCAL) throw new ContentError("ZIP_BROKEN", `Повреждён элемент архива ${name}`);
		const start = e.offset + 30 + b.readUInt16LE(e.offset + 26) + b.readUInt16LE(e.offset + 28);
		const data = b.subarray(start, start + e.compressedSize);
		if (data.length !== e.compressedSize) throw new ContentError("ZIP_BROKEN", `Элемент архива ${name} обрезан`);
		const left = this.limits.maxTotalBytes - this.total;
		const cap = Math.min(this.limits.maxEntryBytes, left);
		let raw: Buffer;
		if (e.method === 0) raw = data;
		else if (e.method === 8) {
			try {
				raw = inflateRawSync(data, { maxOutputLength: Math.max(1, cap) });
			} catch (err) {
				const code = (err as { code?: string }).code;
				if (code === "ERR_BUFFER_TOO_LARGE") throw new ContentError("ZIP_LIMIT", `Элемент ${name} после распаковки больше предела`);
				throw new ContentError("ZIP_BROKEN", `Элемент ${name} не распаковывается`);
			}
		} else throw new ContentError("ZIP_UNSUPPORTED", `Метод сжатия ${e.method} не поддерживается`);
		if (raw.length > cap) throw new ContentError("ZIP_LIMIT", `Элемент ${name} после распаковки больше предела`);
		this.total += raw.length;
		return raw.toString("utf8");
	}
}

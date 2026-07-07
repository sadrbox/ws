// Сервис классификаторов РК/ЕАЭС (единая таблица Classifier). Чтение с поиском
// по type + наполнение импортом (bulk upsert). Крупные официальные справочники
// (tnved/kato) грузятся импортом; страны — сидом (seedCountries).
import { prisma } from "../../prisma/prisma-client.js";
import { COUNTRIES } from "./countries.js";

/** Список значений классификатора с поиском (по коду/наименованию). */
export async function listClassifiers({ type, search, parentCode, limit = 100 } = {}) {
	if (!type) return [];
	const where = { type, deletedAt: null, isActive: true };
	if (parentCode !== undefined) where.parentCode = parentCode || null;
	const q = (search || "").trim();
	if (q) where.OR = [
		{ code: { contains: q, mode: "insensitive" } },
		{ name: { contains: q, mode: "insensitive" } },
	];
	return prisma.classifier.findMany({
		where, orderBy: [{ code: "asc" }], take: Math.min(Number(limit) || 100, 1000),
		select: { code: true, name: true, parentCode: true },
	});
}

/**
 * Массовое наполнение классификатора (upsert по [type, code]).
 * @param {string} type
 * @param {Array<{code:string, name:string, parentCode?:string}>} rows
 * @returns {Promise<{upserted:number}>}
 */
export async function importClassifiers(type, rows) {
	if (!type) throw new Error("Не указан type классификатора");
	const list = (rows || []).filter((r) => r && r.code && r.name);
	let upserted = 0;
	// Батчами в транзакциях, чтобы не держать одну огромную транзакцию.
	const CHUNK = 500;
	for (let i = 0; i < list.length; i += CHUNK) {
		const chunk = list.slice(i, i + CHUNK);
		await prisma.$transaction(chunk.map((r) =>
			prisma.classifier.upsert({
				where: { type_code: { type, code: String(r.code) } },
				create: { type, code: String(r.code), name: String(r.name), parentCode: r.parentCode ? String(r.parentCode) : null },
				update: { name: String(r.name), parentCode: r.parentCode ? String(r.parentCode) : null, isActive: true, deletedAt: null },
			}),
		));
		upserted += chunk.length;
	}
	return { upserted };
}

/** Сид стран (idempotent). */
export function seedCountries() {
	return importClassifiers("country", COUNTRIES.map(([code, name]) => ({ code, name })));
}

export default { listClassifiers, importClassifiers, seedCountries };

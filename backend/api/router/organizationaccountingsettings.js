import express from "express";
import { prisma } from "../../prisma/prisma-client.js";

const router = express.Router();

const MODEL = "organizationAccountingSetting";
const ROUTE = "organization-accounting-settings";
const INCLUDE = { organization: true, vatRateRef: true };

/**
 * Журнальная модель OrganizationAccountingSetting:
 *   - 1 активная запись на организацию (deletedAt IS NULL).
 *     organizationUuid = NULL → глобальные настройки (fallback).
 *   - useVat:       включает учёт НДС в строках документов продажи;
 *   - vatRateUuid:  ссылка на справочник VatRate (выбранная ставка НДС);
 *   - useDiscount:  включает колонки скидок в SaleItemsTable;
 *   - startDate:    дата начала действия настроек (для исторических запросов).
 *   - При обновлении старая запись soft-deleted, создаётся новая.
 */

// ── helpers ─────────────────────────────────────────────────────────────
function parseDateOrNull(v) {
	if (v == null || v === "") return null;
	const d = new Date(v);
	return isNaN(d.getTime()) ? undefined : d;
}

// ── GET list ────────────────────────────────────────────────────────────
router.get(`/${ROUTE}`, async (req, res) => {
	try {
		const rawLimit = req.query.limit;
		const rawCursor = req.query.cursor;
		const parsedLimit = rawLimit !== undefined ? Number(rawLimit) : 500;
		const limitNumber = Math.min(Math.max(parsedLimit, 1), 999999);
		const cursorNumber = rawCursor !== undefined ? Number(rawCursor) : null;
		if (rawCursor !== undefined && (isNaN(cursorNumber) || cursorNumber <= 0))
			return res
				.status(400)
				.json({ success: false, message: "Некорректный параметр cursor" });

		const includeHistory =
			req.query.includeHistory === "1" || req.query.includeHistory === "true";
		const search =
			typeof req.query.search === "string" ? req.query.search.trim() : "";

		const orderBy = [];
		const sortParam =
			typeof req.query.sort === "string" ? req.query.sort : null;
		if (sortParam) {
			try {
				const s = JSON.parse(sortParam);
				if (s && typeof s === "object")
					for (const [f, d] of Object.entries(s)) {
						if (d === "asc" || d === "desc") orderBy.push({ [f]: d });
					}
			} catch {}
		}
		if (orderBy.length === 0) orderBy.push({ id: "desc" });

		const where = {};
		if (!includeHistory) where.deletedAt = null;

		// Фильтр по organizationUuid (если не передан — все организации;
		// "null"/"NULL" — глобальные)
		if (req.query.organizationUuid !== undefined) {
			const v = String(req.query.organizationUuid);
			if (v === "null" || v === "NULL" || v === "")
				where.organizationUuid = null;
			else where.organizationUuid = v;
		}

		const searchWords = search ? search.split(/\s+/).filter(Boolean) : [];
		if (searchWords.length > 0)
			where.AND = searchWords.map((w) => ({
				organization: {
					OR: [
						{ shortName: { contains: w, mode: "insensitive" } },
						{ displayName: { contains: w, mode: "insensitive" } },
					],
				},
			}));

		const opts = {
			take: limitNumber,
			where,
			orderBy,
			include: INCLUDE,
		};
		if (cursorNumber !== null) {
			opts.cursor = { id: cursorNumber };
			opts.skip = 1;
		}

		const items = await prisma[MODEL].findMany(opts);
		const hasMore = items.length === limitNumber;
		const nextCursor = hasMore ? items[items.length - 1].id : null;
		let total;
		if (cursorNumber === null) total = await prisma[MODEL].count({ where });

		return res.status(200).json({
			success: true,
			items,
			nextCursor,
			hasMore,
			...(total !== undefined ? { total } : {}),
		});
	} catch (error) {
		console.error(`GET /${ROUTE} error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── GET active ──────────────────────────────────────────────────────────
// Активная запись для организации. Если для конкретной нет — fallback на глобальную.
router.get(`/${ROUTE}/active`, async (req, res) => {
	try {
		const orgQ = req.query.organizationUuid;
		const orgUuid =
			typeof orgQ === "string" && orgQ && orgQ !== "null" && orgQ !== "NULL"
				? orgQ
				: null;

		let item = null;
		if (orgUuid) {
			item = await prisma[MODEL].findFirst({
				where: { organizationUuid: orgUuid, deletedAt: null },
				orderBy: { id: "desc" },
				include: INCLUDE,
			});
		}
		if (!item) {
			item = await prisma[MODEL].findFirst({
				where: { organizationUuid: null, deletedAt: null },
				orderBy: { id: "desc" },
				include: INCLUDE,
			});
		}
		return res.status(200).json({ success: true, item });
	} catch (error) {
		console.error(`GET /${ROUTE}/active error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── GET by id ───────────────────────────────────────────────────────────
router.get(`/${ROUTE}/:id`, async (req, res) => {
	try {
		const p = req.params.id;
		const n = Number(p);
		const w =
			!isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: p };
		const item = await prisma[MODEL].findUnique({
			where: w,
			include: INCLUDE,
		});
		if (!item)
			return res.status(404).json({ success: false, message: "Не найдено" });
		return res.status(200).json({ success: true, item });
	} catch (error) {
		console.error(`GET /${ROUTE}/:id error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── helpers для валидации тела ──────────────────────────────────────────
async function buildBodyData(body, existing = null) {
	// organizationUuid
	let orgUuid;
	if (Object.prototype.hasOwnProperty.call(body, "organizationUuid")) {
		const orgRaw = body.organizationUuid;
		orgUuid =
			typeof orgRaw === "string" &&
			orgRaw &&
			orgRaw !== "null" &&
			orgRaw !== "NULL"
				? orgRaw
				: null;
	} else {
		orgUuid = existing ? existing.organizationUuid : null;
	}
	if (orgUuid) {
		const org = await prisma.organization.findUnique({
			where: { uuid: orgUuid },
			select: { uuid: true, deletedAt: true },
		});
		if (!org || org.deletedAt)
			return { error: "Организация не найдена" };
	}

	// useVat
	const useVat = Object.prototype.hasOwnProperty.call(body, "useVat")
		? Boolean(body.useVat)
		: Boolean(existing?.useVat);

	// vatRateUuid
	let vatRateUuid;
	if (Object.prototype.hasOwnProperty.call(body, "vatRateUuid")) {
		const vatRaw = body.vatRateUuid;
		vatRateUuid =
			typeof vatRaw === "string" && vatRaw && vatRaw !== "null" ? vatRaw : null;
	} else {
		vatRateUuid = existing?.vatRateUuid ?? null;
	}
	if (vatRateUuid) {
		const vat = await prisma.vatRate.findUnique({
			where: { uuid: vatRateUuid },
			select: { uuid: true, deletedAt: true },
		});
		if (!vat || vat.deletedAt) return { error: "Ставка НДС не найдена" };
	}
	// Если useVat=false, обнуляем ставку
	if (!useVat) vatRateUuid = null;

	// useDiscount
	const useDiscount = Object.prototype.hasOwnProperty.call(body, "useDiscount")
		? Boolean(body.useDiscount)
		: Boolean(existing?.useDiscount);

	// startDate
	let startDate;
	if (Object.prototype.hasOwnProperty.call(body, "startDate")) {
		const parsed = parseDateOrNull(body.startDate);
		if (parsed === undefined)
			return { error: "Некорректное значение startDate" };
		startDate = parsed ?? new Date();
	} else {
		startDate = existing?.startDate ?? new Date();
	}

	return {
		data: { organizationUuid: orgUuid, useVat, vatRateUuid, useDiscount, startDate },
	};
}

// ── POST: создать активную запись (журнал) ─────────────────────────────
router.post(`/${ROUTE}`, async (req, res) => {
	try {
		const built = await buildBodyData(req.body || {});
		if (built.error)
			return res.status(400).json({ success: false, message: built.error });

		const item = await prisma.$transaction(async (tx) => {
			await tx[MODEL].updateMany({
				where: {
					organizationUuid: built.data.organizationUuid,
					deletedAt: null,
				},
				data: { deletedAt: new Date() },
			});
			return tx[MODEL].create({ data: built.data, include: INCLUDE });
		});

		return res.status(201).json({ success: true, item });
	} catch (error) {
		console.error(`POST /${ROUTE} error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── PUT: обновление через создание новой версии ────────────────────────
router.put(`/${ROUTE}/:id`, async (req, res) => {
	try {
		const p = req.params.id;
		const n = Number(p);
		const w =
			!isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: p };

		const existing = await prisma[MODEL].findUnique({ where: w });
		if (!existing)
			return res.status(404).json({ success: false, message: "Не найдено" });

		const built = await buildBodyData(req.body || {}, existing);
		if (built.error)
			return res.status(400).json({ success: false, message: built.error });

		const item = await prisma.$transaction(async (tx) => {
			// Soft-delete текущей активной записи для СТАРОЙ организации
			await tx[MODEL].updateMany({
				where: {
					organizationUuid: existing.organizationUuid,
					deletedAt: null,
				},
				data: { deletedAt: new Date() },
			});
			// Если организация изменилась — также soft-delete активной для новой
			if (built.data.organizationUuid !== existing.organizationUuid) {
				await tx[MODEL].updateMany({
					where: {
						organizationUuid: built.data.organizationUuid,
						deletedAt: null,
					},
					data: { deletedAt: new Date() },
				});
			}
			return tx[MODEL].create({ data: built.data, include: INCLUDE });
		});

		return res.status(200).json({ success: true, item });
	} catch (error) {
		console.error(`PUT /${ROUTE}/:id error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── DELETE ──────────────────────────────────────────────────────────────
router.delete(`/${ROUTE}/:id`, async (req, res) => {
	try {
		const p = req.params.id;
		const n = Number(p);
		const w =
			!isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: p };
		await prisma[MODEL].update({ where: w, data: { deletedAt: new Date() } });
		return res.status(200).json({ success: true, message: "Удалено" });
	} catch (error) {
		if (error.code === "P2025")
			return res.status(404).json({ success: false, message: "Не найдено" });
		console.error(`DELETE /${ROUTE}/:id error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

export default router;

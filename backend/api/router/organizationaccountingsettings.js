import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
import { handleDelete } from "../../utils/checkReferences.js";

const router = express.Router();

const MODEL = "organizationAccountingSetting";
const ROUTE = "organization-accounting-settings";
const INCLUDE = { organization: true };

/**
 * Журнальная модель OrganizationAccountingSetting:
 *   - 1 активная запись на организацию (deletedAt IS NULL).
 *     organizationUuid = NULL → глобальные настройки (fallback).
 *   - useVat:                включает учёт НДС в строках документов;
 *   - vatRate:               Ставка НДС, % (справочник VatRate удалён);
 *   - vatCalculationMethod:  "INCLUDED" (в сумме) | "ADDED" (сверху);
 *   - useDiscount:           включает колонки скидок в SaleItemsTable;
 *   - startDate:             дата начала действия настроек (историчность).
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
						{ name: { contains: w, mode: "insensitive" } },
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

// ── GET usage-stats ─────────────────────────────────────────────────────
// Возвращает информацию о том, использует ли организация (или глобально,
// если organizationUuid не передан) проведённые документы с НДС, скидкой
// или акцизом. Используется на фронтенде для блокировки соответствующих
// переключателей в форме НУО — если есть проведённые (posted=true) документы
// с фактически применёнными значениями, нельзя отключать соответствующую
// настройку (это нарушит исторические расчёты ЭСФ РК).
//
// Ответ: { success, hasPostedVat, hasPostedDiscount, hasPostedExcise }
router.get(`/${ROUTE}/usage-stats`, async (req, res) => {
	try {
		const orgQ = req.query.organizationUuid;
		const orgUuid =
			typeof orgQ === "string" && orgQ && orgQ !== "null" && orgQ !== "NULL"
				? orgQ
				: null;

		// Условие на родительскую продажу: posted=true. Если organizationUuid
		// задан — фильтр по организации; иначе глобально (без фильтра).
		const saleWhere = { posted: true };
		if (orgUuid) saleWhere.organizationUuid = orgUuid;

		const [vatItem, discountItem, exciseItem] = await Promise.all([
			prisma.saleItem.findFirst({
				where: { sale: saleWhere, vatRate: { gt: 0 } },
				select: { uuid: true },
			}),
			prisma.saleItem.findFirst({
				where: {
					sale: saleWhere,
					OR: [{ discountPercent: { gt: 0 } }, { discountAmount: { gt: 0 } }],
				},
				select: { uuid: true },
			}),
			prisma.saleItem.findFirst({
				where: {
					sale: saleWhere,
					OR: [{ exciseRate: { gt: 0 } }, { exciseAmount: { gt: 0 } }],
				},
				select: { uuid: true },
			}),
		]);

		return res.status(200).json({
			success: true,
			hasPostedVat: Boolean(vatItem),
			hasPostedDiscount: Boolean(discountItem),
			hasPostedExcise: Boolean(exciseItem),
		});
	} catch (error) {
		console.error(`GET /${ROUTE}/usage-stats error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── GET active ──────────────────────────────────────────────────────────
// Активная запись для организации. Если для конкретной нет — fallback на глобальную.
//
// Параметр `date` (необязательный, ISO-строка): возвращает настройки, которые
// действовали на указанную дату (историчность). При обновлении настроек старая
// запись soft-deleted (deletedAt != null), но в БД сохраняется — поэтому при
// запросе с прошлой датой выбирается запись с максимальным startDate <= date,
// независимо от deletedAt. Без параметра date — поведение прежнее: текущая
// активная (deletedAt IS NULL).
router.get(`/${ROUTE}/active`, async (req, res) => {
	try {
		const orgQ = req.query.organizationUuid;
		const orgUuid =
			typeof orgQ === "string" && orgQ && orgQ !== "null" && orgQ !== "NULL"
				? orgQ
				: null;

		// Историческая дата (опциональна).
		const dateParam = req.query.date;
		const historicalDate = parseDateOrNull(dateParam);
		// historicalDate === undefined → невалидная дата → игнорируем (берём текущие)
		const useHistorical = historicalDate instanceof Date;

		async function findFor(uuid) {
			if (useHistorical) {
				// Историческая выборка: среди всех записей со startDate <= date берём
				// САМУЮ НОВУЮ по id (id монотонно растёт с временем создания).
				// Сортировка по startDate desc НЕ работает корректно при смешанных
				// временах startDate (полночь встроках vs бывшие timestamp) — приоритет id.
				return prisma[MODEL].findFirst({
					where: {
						organizationUuid: uuid,
						startDate: { lte: historicalDate },
					},
					orderBy: { id: "desc" },
					include: INCLUDE,
				});
			}
			return prisma[MODEL].findFirst({
				where: { organizationUuid: uuid, deletedAt: null },
				orderBy: { id: "desc" },
				include: INCLUDE,
			});
		}

		let item = null;
		if (orgUuid) item = await findFor(orgUuid);
		if (!item) item = await findFor(null);
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
		if (!org || org.deletedAt) return { error: "Организация не найдена" };
	}

	// useVat
	const useVat = Object.prototype.hasOwnProperty.call(body, "useVat")
		? Boolean(body.useVat)
		: Boolean(existing?.useVat);

	// vatRate — числовая Ставка НДС, %. Раньше была ссылкой на справочник
	// VatRate (vatRateUuid) — справочник удалён, значение хранится напрямую.
	let vatRate;
	if (Object.prototype.hasOwnProperty.call(body, "vatRate")) {
		const raw = body.vatRate;
		const num = raw === "" || raw == null ? 12 : Number(raw);
		if (!Number.isFinite(num) || num < 0 || num > 100)
			return { error: "Некорректное значение vatRate (0…100)" };
		vatRate = num;
	} else {
		vatRate = Number(existing?.vatRate ?? 12) || 12;
	}

	// vatCalculationMethod — "INCLUDED" | "ADDED".
	let vatCalculationMethod;
	if (Object.prototype.hasOwnProperty.call(body, "vatCalculationMethod")) {
		const m = String(body.vatCalculationMethod ?? "INCLUDED").toUpperCase();
		vatCalculationMethod = m === "ADDED" ? "ADDED" : "INCLUDED";
	} else {
		vatCalculationMethod =
			String(existing?.vatCalculationMethod ?? "INCLUDED").toUpperCase() ===
			"ADDED"
				? "ADDED"
				: "INCLUDED";
	}

	// useDiscount
	const useDiscount = Object.prototype.hasOwnProperty.call(body, "useDiscount")
		? Boolean(body.useDiscount)
		: Boolean(existing?.useDiscount);

	// useExcise — флаг использования акциза (НК РК ст. 463). Включает колонки
	// «Ставка акциза, %» и «Сумма акциза» в строках документов продажи.
	const useExcise = Object.prototype.hasOwnProperty.call(body, "useExcise")
		? Boolean(body.useExcise)
		: Boolean(existing?.useExcise);

	// exciseRate — ставка акциза по умолчанию (% от стоимости после скидки).
	// Используется как значение по умолчанию при добавлении новых строк
	// документов продажи. Если useExcise=false — обнуляется.
	let exciseRate;
	if (Object.prototype.hasOwnProperty.call(body, "exciseRate")) {
		const raw = body.exciseRate;
		const num = raw === "" || raw == null ? 0 : Number(raw);
		if (!Number.isFinite(num) || num < 0)
			return { error: "Некорректное значение exciseRate" };
		exciseRate = num;
	} else {
		exciseRate = Number(existing?.exciseRate ?? 0) || 0;
	}
	if (!useExcise) exciseRate = 0;

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
		data: {
			organizationUuid: orgUuid,
			useVat,
			vatRate,
			vatCalculationMethod,
			useDiscount,
			useExcise,
			exciseRate,
			startDate,
		},
	};
}

/**
 * Проверяет, что изменения useVat/useDiscount/useExcise согласованы с
 * историей проведённых документов. Если организация уже имеет хотя бы один
 * проведённый sale_item с фактическим использованием соответствующего
 * флага, отключать его нельзя (нарушит исторические расчёты).
 *
 * @param newData результат buildBodyData (новые желаемые значения)
 * @param existing предыдущая активная запись (или null при создании)
 * @returns строка с сообщением об ошибке либо null если изменения допустимы
 */
async function validateAgainstPostedDocs(newData, existing) {
	const orgUuid = newData.organizationUuid;
	const prevUseVat = Boolean(existing?.useVat);
	const prevUseDiscount = Boolean(existing?.useDiscount);
	const prevUseExcise = Boolean(existing?.useExcise);
	const prevVatRate = Number(existing?.vatRate ?? 0) || 0;
	const prevVatMethod = String(
		existing?.vatCalculationMethod ?? "INCLUDED",
	).toUpperCase();
	const prevExciseRate = Number(existing?.exciseRate ?? 0) || 0;

	// Любое изменение значений (флаг ВКЛ/ВЫКЛ, ставка, метод расчёта НДС,
	// Ставка акциза, %) при наличии проведённых документов с фактически
	// применённой соответствующей настройкой — запрещено: уже проведённые
	// документы изменять нельзя.
	const newUseVat = Boolean(newData.useVat);
	const newUseDiscount = Boolean(newData.useDiscount);
	const newUseExcise = Boolean(newData.useExcise);
	const newVatRate = Number(newData.vatRate ?? 0) || 0;
	const newVatMethod = String(
		newData.vatCalculationMethod ?? "INCLUDED",
	).toUpperCase();
	const newExciseRate = Number(newData.exciseRate ?? 0) || 0;

	const changingVat =
		prevUseVat !== newUseVat ||
		prevVatRate !== newVatRate ||
		prevVatMethod !== newVatMethod;
	const changingDiscount = prevUseDiscount !== newUseDiscount;
	const changingExcise =
		prevUseExcise !== newUseExcise || prevExciseRate !== newExciseRate;

	if (!changingVat && !changingDiscount && !changingExcise) return null;

	const saleWhere = { posted: true };
	if (orgUuid) saleWhere.organizationUuid = orgUuid;

	if (changingVat) {
		const found = await prisma.saleItem.findFirst({
			where: { sale: saleWhere, vatRate: { gt: 0 } },
			select: { uuid: true },
		});
		if (found)
			return "Нельзя изменить настройки НДС: существуют проведённые документы со ставкой НДС > 0";
	}
	if (changingDiscount) {
		const found = await prisma.saleItem.findFirst({
			where: {
				sale: saleWhere,
				OR: [{ discountPercent: { gt: 0 } }, { discountAmount: { gt: 0 } }],
			},
			select: { uuid: true },
		});
		if (found)
			return "Нельзя изменить настройки скидок: существуют проведённые документы со Сумма скидкими";
	}
	if (changingExcise) {
		const found = await prisma.saleItem.findFirst({
			where: {
				sale: saleWhere,
				OR: [{ exciseRate: { gt: 0 } }, { exciseAmount: { gt: 0 } }],
			},
			select: { uuid: true },
		});
		if (found)
			return "Нельзя изменить настройки акциза: существуют проведённые документы с акцизом";
	}
	return null;
}

// ── POST: создать активную запись (журнал) ─────────────────────────────
router.post(`/${ROUTE}`, async (req, res) => {
	try {
		const built = await buildBodyData(req.body || {});
		if (built.error)
			return res.status(400).json({ success: false, message: built.error });

		// При создании «предыдущая» активная запись для той же организации —
		// источник флагов для валидации (оппозиция «был включён → выключается»).
		const prev = await prisma[MODEL].findFirst({
			where: {
				organizationUuid: built.data.organizationUuid,
				deletedAt: null,
			},
		});
		const validationError = await validateAgainstPostedDocs(built.data, prev);
		if (validationError)
			return res.status(409).json({ success: false, message: validationError });

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

		const validationError = await validateAgainstPostedDocs(
			built.data,
			existing,
		);
		if (validationError)
			return res.status(409).json({ success: false, message: validationError });

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
router.delete(`/${ROUTE}/:id`, (req, res) =>
	handleDelete({ req, res, prisma, modelName: MODEL, softDelete: true }),
);

export default router;

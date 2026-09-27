import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
import { clampLimit, sendError } from "../../utils/listQuery.js";
import { handleDelete, handleBatchDelete } from "../../utils/checkReferences.js";
import { idSearchCondition } from "../../utils/searchId.js";
import { tenantFilter, orgIsAccessible, isAdminOfOrg } from "../../utils/auth.js";
import { buildOrganizationSeed } from "../../services/orgFromOnec.js";

const router = express.Router();

/*
 * ОРГАНИЗАЦИЯ ПО :id — ТОЛЬКО СВОЯ (Б6 аудита 26.09).
 *
 * У Organization нет поля `organizationUuid`, и общий `checkOwnership` видел в этом «глобальную
 * запись»: GET/PUT/DELETE чужой организации проходили, а перебор числовых id отдавал и её
 * `inviteCode` — пропуск в чужую фирму через /auth/join. Теперь организация по :id видна, только
 * если она доступна пользователю; код приглашения отдаётся лишь её администраторам; менять
 * реквизиты — те, у кого есть право (middleware) И организация доступна; удалять — только её
 * администратор.
 */
async function findAccessibleOrg(req, param) {
	const n = Number(param);
	const where = !isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: String(param) };
	const item = await prisma.organization.findUnique({ where });
	if (!item || !orgIsAccessible(req, item.uuid)) return null;
	return item;
}

/** Убрать код приглашения, если вызывающий не администратор этой организации. */
export function stripInvite(req, org) {
	if (!org || isAdminOfOrg(req, org.uuid)) return org;
	const { inviteCode: _omit, ...rest } = org;
	return rest;
}

// ============================================
// GET /organizations — курсорная пагинация
// ============================================
router.get("/organizations", async (req, res) => {
	try {
		const rawLimit = req.query.limit;
		const rawCursor = req.query.cursor;
		const search =
			typeof req.query.search === "string" ? req.query.search.trim() : "";

		const limitNumber = clampLimit(rawLimit);
		const cursorNumber = rawCursor !== undefined ? Number(rawCursor) : null;

		if (rawCursor !== undefined && (isNaN(cursorNumber) || cursorNumber <= 0)) {
			return res.status(400).json({
				success: false,
				message: "Некорректный параметр cursor",
			});
		}

		const filter =
			req.query.filter && typeof req.query.filter === "object"
				? req.query.filter
				: {};

		// ── Сортировка ────────────────────────────────────────────────────────
		const orderBy = [];
		const sortParam =
			typeof req.query.sort === "string" ? req.query.sort : null;

		if (sortParam) {
			try {
				const sortObj = JSON.parse(sortParam);
				if (sortObj && typeof sortObj === "object") {
					for (const [field, dir] of Object.entries(sortObj)) {
						if (dir !== "asc" && dir !== "desc") continue;
						if (field === "inviteCode") continue; // код приглашения — не для сортировки-оракула
						if (field.includes(".")) {
							const parts = field.split(".");
							let nested = { [parts[parts.length - 1]]: dir };
							for (let i = parts.length - 2; i >= 0; i--) {
								nested = { [parts[i]]: nested };
							}
							orderBy.push(nested);
						} else {
							orderBy.push({ [field]: dir });
						}
					}
				}
			} catch {
				// Некорректный JSON — игнорируем
			}
		}

		if (orderBy.length === 0) {
			orderBy.push({ id: "asc" });
		} else {
			const hasId = orderBy.some((o) => "id" in o);
			if (!hasId) orderBy.push({ id: "asc" });
		}

		// ── Поиск ─────────────────────────────────────────────────────────────
		const TEXT_FIELDS = ["bin", "name", "legalName"];
		const searchWords = search ? search.split(/\s+/).filter(Boolean) : [];
		let searchWhereClause = {};

		if (searchWords.length > 0) {
			searchWhereClause = {
				AND: searchWords.map((word) => {
					const orConditions = TEXT_FIELDS.map((field) => ({
						[field]: { contains: word, mode: "insensitive" },
					}));
					const idNum = idSearchCondition(word);
					if (idNum) orConditions.push(idNum);
					return { OR: orConditions };
				}),
			};
		}

		// ── Фильтр по дате ────────────────────────────────────────────────────
		const dateRangeFilter = {};

		// ── Произвольные фильтры ──────────────────────────────────────────────
		const ALLOWED_OPERATORS = ["contains", "equals", "gte", "lte", "gt", "lt"];
		const SKIP_KEYS = ["searchBy", "dateRange"];
		const filterWhereClause = {};

		for (const [field, conditions] of Object.entries(filter)) {
			if (SKIP_KEYS.includes(field)) continue;
			// Фильтр по коду приглашения с `total` в ответе подбирал бы код посимвольно.
			if (field === "inviteCode") continue;
			if (!conditions || typeof conditions !== "object") continue;

			for (const [operator, value] of Object.entries(conditions)) {
				if (!ALLOWED_OPERATORS.includes(operator)) continue;

				if (!filterWhereClause[field]) filterWhereClause[field] = {};

				if (operator === "contains") {
					filterWhereClause[field] = {
						contains: String(value),
						mode: "insensitive",
					};
				} else {
					filterWhereClause[field][operator] = value;
				}
			}
		}

		// ── Итоговый where ────────────────────────────────────────────────────
		const baseWhere = {
			...searchWhereClause,
			...dateRangeFilter,
			...filterWhereClause,
			...tenantFilter(req, "uuid"),
		};

		// ── Курсорная пагинация ───────────────────────────────────────────────
		const queryOptions = {
			take: limitNumber,
			where: baseWhere,
			orderBy,
		};

		if (cursorNumber !== null) {
			queryOptions.cursor = { id: cursorNumber };
			queryOptions.skip = 1;
		}

		const items = (await prisma.organization.findMany(queryOptions)).map((o) => stripInvite(req, o));

		const hasMore = items.length === limitNumber;
		const nextCursor = hasMore ? items[items.length - 1].id : null;

		let total;
		if (cursorNumber === null) {
			total = await prisma.organization.count({ where: baseWhere });
		}

		return res.status(200).json({
			success: true,
			items,
			nextCursor,
			hasMore,
			...(total !== undefined ? { total } : {}),
		});
	} catch (error) {
		// Ошибка ввода (кривая дата, поле фильтра) — 400, остальное — 500 с записью в журнал.
		return sendError(res, error, { message: "Ошибка сервера при получении организаций", label: "GET /organizations" });
	}
});

// ============================================
// GET /organizations/:id
// ============================================
router.get("/organizations/:id", async (req, res) => {
	try {
		const item = await findAccessibleOrg(req, req.params.id);

		if (!item) {
			return res
				.status(404)
				.json({ success: false, message: "Организация не найдена" });
		}

		return res.status(200).json({ success: true, item: stripInvite(req, item) });
	} catch (error) {
		console.error("GET /organizations/:id error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ============================================
// POST /organizations
// ============================================
router.post("/organizations", async (req, res) => {
	try {
		const { bin, name, legalName, vatSeries, vatNumber, enterpriseCategory } = req.body;

		if (!bin || typeof bin !== "string" || !/^\d{12}$/.test(bin.trim())) {
			return res.status(400).json({
				success: false,
				message: "БИН обязателен и должен состоять из 12 цифр",
			});
		}

		const item = await prisma.organization.create({
			data: {
				bin: bin.trim(),
				name: name?.trim() ?? null,
				legalName: legalName?.trim() ?? null,
				vatSeries: vatSeries?.trim() ?? null,
				vatNumber: vatNumber?.trim() ?? null,
				enterpriseCategory: enterpriseCategory || null,
			},
		});

		return res.status(201).json({ success: true, item });
	} catch (error) {
		if (error.code === "P2002") {
			return res.status(409).json({
				success: false,
				message: "Организация с таким БИН уже существует",
			});
		}
		console.error("POST /organizations error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ============================================
// POST /organizations/from-onec — организация из реквизитов базы 1С
// ============================================
/*
 * Кнопка «Создать организацию» в одобрении заявки на подключение базы 1С («Управление 1С» → «Расширение
 * БухПроф AI»): организации базы в ERP нет, а одобрить заявку без неё нельзя. Реквизиты пришли в заявке
 * (services/orgFromOnec.js); здесь — организация вместе с контактами, контактными лицами и банковскими счетами
 * одной транзакцией.
 *
 * ТОЛЬКО АДМИНИСТРАТОР BUHPROF. Заявки одобряет он один, а маршрут создаёт сразу четыре вида записей: право
 * «создавать организации» не должно открывать запись банковских счетов и контактов в обход их собственных прав.
 */
router.post("/organizations/from-onec", async (req, res) => {
	if (!req.user?.isSuperAdmin) {
		return res.status(403).json({ success: false, message: "Создать организацию из заявки 1С может только администратор BuhProf" });
	}
	try {
		const seed = buildOrganizationSeed(req.body);
		if (seed.error) return res.status(400).json({ success: false, message: seed.error });

		const existing = await prisma.organization.findUnique({ where: { bin: seed.org.bin }, select: { uuid: true, name: true, deletedAt: true } });
		if (existing) {
			return res.status(409).json({
				success: false,
				message: existing.deletedAt
					? `Организация с БИН ${seed.org.bin} помечена на удаление — восстановите её, а не создавайте новую`
					: `Организация с БИН ${seed.org.bin} уже есть в ERP: ${existing.name ?? existing.uuid}`,
				item: { uuid: existing.uuid, name: existing.name },
			});
		}

		const codes = [...new Set(seed.accounts.map((a) => a.currencyCode).filter(Boolean))];
		const currencies = codes.length
			? await prisma.currency.findMany({ where: { code: { in: codes }, deletedAt: null }, select: { uuid: true, code: true } })
			: [];
		const currencyByCode = new Map(currencies.map((c) => [c.code, c.uuid]));

		const item = await prisma.$transaction(async (tx) => {
			const org = await tx.organization.create({ data: seed.org });
			// Вложенные записи принадлежат самой организации, а не активной организации того, кто нажал кнопку.
			const owner = { ownerType: "organization", ownerUuid: org.uuid, organizationUuid: org.uuid };
			if (seed.contacts.length) await tx.contact.createMany({ data: seed.contacts.map((c) => ({ ...c, ...owner })) });
			if (seed.persons.length) await tx.contactPerson.createMany({ data: seed.persons.map((p) => ({ ...p, ...owner })) });
			if (seed.accounts.length) {
				await tx.bankAccount.createMany({
					data: seed.accounts.map(({ currencyCode, ...a }) => ({ ...a, ...owner, currencyUuid: currencyByCode.get(currencyCode) ?? null })),
				});
			}
			return org;
		});

		return res.status(201).json({
			success: true,
			item: stripInvite(req, item),
			created: { contacts: seed.contacts.length, contactPersons: seed.persons.length, bankAccounts: seed.accounts.length },
		});
	} catch (error) {
		if (error.code === "P2002") {
			return res.status(409).json({ success: false, message: "Организация с таким БИН уже существует" });
		}
		console.error("POST /organizations/from-onec error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ============================================
// PUT /organizations/:id
// ============================================
router.put("/organizations/:id", async (req, res) => {
	try {
		const existing = await findAccessibleOrg(req, req.params.id);
		if (!existing) {
			return res.status(404).json({ success: false, message: "Организация не найдена" });
		}
		const whereClause = { uuid: existing.uuid };

		const { bin, name, legalName, vatSeries, vatNumber, enterpriseCategory } = req.body;
		const data = {};

		if (enterpriseCategory !== undefined) data.enterpriseCategory = enterpriseCategory || null;
		if (bin !== undefined) {
			// БИН редактируем — валидируем формат (12 цифр) и при записи; уникальность
			// обеспечивает БД-ограничение (P2002 → 409 ниже).
			if (typeof bin !== "string" || !/^\d{12}$/.test(bin.trim())) {
				return res.status(400).json({
					success: false,
					message: "БИН должен состоять ровно из 12 цифр",
				});
			}
			data.bin = bin.trim();
		}
		if (name !== undefined) data.name = name?.trim() ?? null;
		if (legalName !== undefined)
			data.legalName = legalName?.trim() ?? null;
		if (vatSeries !== undefined) data.vatSeries = vatSeries?.trim() ?? null;
		if (vatNumber !== undefined) data.vatNumber = vatNumber?.trim() ?? null;

		const item = await prisma.organization.update({
			where: whereClause,
			data,
		});

		return res.status(200).json({ success: true, item: stripInvite(req, item) });
	} catch (error) {
		if (error.code === "P2002") {
			return res.status(409).json({
				success: false,
				message: "Организация с таким БИН уже существует",
			});
		}
		if (error.code === "P2025") {
			return res
				.status(404)
				.json({ success: false, message: "Организация не найдена" });
		}
		console.error("PUT /organizations/:id error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ============================================
// DELETE /organizations/:id
// ============================================
// Удалять организацию может только её администратор (или суперадмин); проверка ДО общего
// обработчика, который считает Organization «глобальной» записью.
async function requireOrgAdmin(req, res, next) {
	try {
		const org = await findAccessibleOrg(req, req.params.id);
		if (!org) return res.status(404).json({ success: false, message: "Организация не найдена" });
		if (!isAdminOfOrg(req, org.uuid)) return res.status(403).json({ success: false, message: "Удалить организацию может только её администратор" });
		return next();
	} catch (error) {
		console.error("DELETE /organizations/:id error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
}
async function requireOrgAdminBatch(req, res, next) {
	try {
		const uuids = Array.isArray(req.body?.uuids) ? req.body.uuids.map(String) : null;
		if (!uuids) return next();
		if (uuids.some((u) => !orgIsAccessible(req, u) || !isAdminOfOrg(req, u))) {
			return res.status(404).json({ success: false, message: "Часть организаций не найдена — удаление не выполнено" });
		}
		return next();
	} catch (error) {
		console.error("POST /organizations/batch-delete error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
}

router.delete("/organizations/:id", requireOrgAdmin, (req, res) =>
	handleDelete({
		req,
		res,
		prisma,
		modelName: "organization",
		notFoundMessage: "Организация не найдена",
	}),
);

router.post("/organizations/batch-delete", requireOrgAdminBatch, (req, res) =>
	handleBatchDelete({ req, res, prisma, modelName: "organization" }),
);

export default router;

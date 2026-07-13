// ─────────────────────────────────────────────────────────────────────────────
// Приём справочников из 1С (события POST /pipe).
//
// Контракт события (см. router/activityhistories.js):
//   { actionType, organization:{shortName,bin}, user:{...},
//     object:{ id, type, name }, props:{...} }
//   • object.type = "Справочник"  — событие про элемент справочника;
//   • object.name = КАКОЙ справочник («Организации», «Контрагенты», «Номенклатура»…);
//   • object.id   = идентификатор элемента В 1С;
//   • props       = реквизиты («Код», «Наименование», «БИН», …).
//
// СОПОСТАВЛЕНИЕ (почему именно так). Ключ — пара (externalSource="1C", externalId=object.id).
// Без неё повторное событие по тому же элементу создавало бы ДУБЛЬ, а переименование
// в 1С — ещё один. При ПЕРВОЙ встрече элемента externalId у нас ещё не проставлен,
// поэтому сначала пытаемся ПРИВЯЗАТЬСЯ к существующей записи по естественному ключу
// (БИН у организации/контрагента, артикул/штрихкод/имя у товара) — иначе интеграция
// продублировала бы весь наш справочник.
//
// КОНФЛИКТ: 1С — источник истины, поля перезаписываются присланными (решение владельца).
//
// Итог применения возвращается вызывающему и пишется в pipe_activity
// (applyStatus/applyModel/applyUuid/applyMessage), чтобы «Входящие 1С» показывали,
// что произошло с каждым событием.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "../prisma/prisma-client.js";

const SOURCE = "1C";

/** Первое непустое значение из props по нескольким возможным именам реквизита. */
function pick(props, ...names) {
	if (!props || typeof props !== "object") return null;
	for (const n of names) {
		const v = props[n];
		if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
	}
	return null;
}

/** Нормализация БИН/ИИН: только цифры, ровно 12 знаков (иначе — не БИН). */
function normalizeBin(v) {
	if (!v) return null;
	const digits = String(v).replace(/\D/g, "");
	return digits.length === 12 ? digits : null;
}

// ─── Реестр справочников: object.name (как его зовёт 1С) → как класть к нам ───
//
// build(props, ctx) → поля для create/update.
// findNatural(props, ctx) → запись, к которой можно ПРИВЯЗАТЬСЯ при первой встрече.
// Справочник, которого здесь нет, не применяется (applyStatus="skipped") — событие
// всё равно сохраняется в pipe_activity, ничего не теряется.
const REF_BOOKS = {
	Организации: {
		model: "organization",
		build: (props, ctx) => {
			// БИН обязателен (Organization.bin — NOT NULL @unique). Если 1С не прислала
			// его в реквизитах, берём БИН организации-отправителя события.
			const bin = normalizeBin(pick(props, "БИН", "BIN", "Бин")) ?? ctx.senderBin;
			if (!bin) return null; // создать нельзя — вызывающий отдаст error
			return {
				bin,
				name: pick(props, "Наименование", "Название", "НаименованиеПолное") ?? ctx.objectName,
				shortName: pick(props, "НаименованиеСокращенное", "КраткоеНаименование"),
			};
		},
		findNatural: async (props, ctx) => {
			const bin = normalizeBin(pick(props, "БИН", "BIN", "Бин")) ?? ctx.senderBin;
			return bin ? prisma.organization.findUnique({ where: { bin } }) : null;
		},
	},

	Контрагенты: {
		model: "counterparty",
		build: (props, ctx) => {
			// БИН у контрагента НЕОБЯЗАТЕЛЕН: 1С шлёт физлиц и розницу без него, а раньше
			// такие события отбивались с «Не хватает обязательных реквизитов» — справочник
			// из 1С попросту не наполнялся. Обязательно только НАИМЕНОВАНИЕ.
			const name = pick(props, "Наименование", "Название") ?? ctx.objectName;
			if (!name) return null; // без имени контрагент бессмыслен
			return {
				bin: normalizeBin(pick(props, "БИН", "ИИН", "BIN", "Бин")) ?? null,
				name,
				legalName: pick(props, "НаименованиеПолное", "ЮридическоеНаименование"),
				organizationUuid: ctx.orgUuid,
			};
		},
		findNatural: async (props, ctx) => {
			// Есть БИН — он и есть надёжный ключ.
			const bin = normalizeBin(pick(props, "БИН", "ИИН", "BIN", "Бин"));
			if (bin) return prisma.counterparty.findUnique({ where: { bin } });

			// Без БИН привязываемся по имени В ПРЕДЕЛАХ организации — иначе интеграция
			// создала бы второго «Иванова» рядом с уже заведённым вручную. Имя — ключ
			// слабый, поэтому только точное совпадение и только при отсутствии БИН.
			const name = pick(props, "Наименование", "Название") ?? ctx.objectName;
			if (!name) return null;
			return prisma.counterparty.findFirst({
				where: { name, bin: null, organizationUuid: ctx.orgUuid ?? undefined, deletedAt: null },
			});
		},
	},

	Номенклатура: {
		model: "product",
		build: (props, ctx) => {
			const name = pick(props, "Наименование", "Название") ?? ctx.objectName;
			if (!name) return null; // Product.name — NOT NULL
			return {
				name,
				sku: pick(props, "Артикул", "Код"),
				barcode: pick(props, "Штрихкод", "ШтрихКод"),
				organizationUuid: ctx.orgUuid,
			};
		},
		// Штрихкод уникален среди активных (partial-unique index), артикул — нет,
		// поэтому по sku привязываемся только при однозначном совпадении.
		findNatural: async (props, ctx) => {
			const barcode = pick(props, "Штрихкод", "ШтрихКод");
			if (barcode) {
				const byBarcode = await prisma.product.findFirst({ where: { barcode, deletedAt: null } });
				if (byBarcode) return byBarcode;
			}
			const sku = pick(props, "Артикул", "Код");
			if (sku) {
				const bySku = await prisma.product.findMany({ where: { sku, deletedAt: null }, take: 2 });
				if (bySku.length === 1) return bySku[0];
			}
			const name = pick(props, "Наименование", "Название") ?? ctx.objectName;
			if (name) {
				const byName = await prisma.product.findMany({ where: { name, deletedAt: null }, take: 2 });
				if (byName.length === 1) return byName[0];
			}
			return null;
		},
	},

	Склады: {
		model: "warehouse",
		build: (props, ctx) => {
			const name = pick(props, "Наименование", "Название") ?? ctx.objectName;
			if (!name) return null;
			return { name, organizationUuid: ctx.orgUuid };
		},
		findNatural: async (props, ctx) => {
			const name = pick(props, "Наименование", "Название") ?? ctx.objectName;
			if (!name) return null;
			const rows = await prisma.warehouse.findMany({ where: { name, deletedAt: null }, take: 2 });
			return rows.length === 1 ? rows[0] : null;
		},
	},

	ЕдиницыИзмерения: {
		model: "unitOfMeasure",
		build: (props, ctx) => {
			const name = pick(props, "Наименование", "Название") ?? ctx.objectName;
			if (!name) return null;
			return { name, code: pick(props, "Код") };
		},
		findNatural: async (props, ctx) => {
			const name = pick(props, "Наименование", "Название") ?? ctx.objectName;
			if (!name) return null;
			const rows = await prisma.unitOfMeasure.findMany({ where: { name, deletedAt: null }, take: 2 });
			return rows.length === 1 ? rows[0] : null;
		},
	},
};
// Синонимы названий справочников (1С шлёт по-разному).
REF_BOOKS["Единицы измерения"] = REF_BOOKS.ЕдиницыИзмерения;
REF_BOOKS["Контрагент"] = REF_BOOKS.Контрагенты;
REF_BOOKS["Организация"] = REF_BOOKS.Организации;
REF_BOOKS["Товары"] = REF_BOOKS.Номенклатура;

/** Список поддерживаемых справочников (для тестов/диагностики). */
export const supportedRefBooks = () => Object.keys(REF_BOOKS);

/**
 * Применить входящее событие 1С к справочнику.
 *
 * @param {object} body — тело события (как пришло на POST /pipe).
 * @returns {Promise<{status:string, model?:string, uuid?:string, message?:string}>}
 *   status: created | updated | linked | skipped | error.
 *   Никогда не бросает: приём события не должен падать из-за проблем сопоставления.
 */
export async function applyPipeReference(body) {
	try {
		const object = body?.object ?? {};
		const objectType = String(object.type ?? "");
		const bookName = String(object.name ?? "");
		const externalId = object.id != null ? String(object.id) : null;
		const props = body?.props ?? {};

		// Событие не про справочник (документ и т.п.) — просто логируем, не трогаем данные.
		if (objectType !== "Справочник") {
			return { status: "skipped", message: `Не справочник (object.type = «${objectType || "—"}»)` };
		}
		const book = REF_BOOKS[bookName];
		if (!book) {
			return { status: "skipped", message: `Справочник «${bookName}» не поддерживается` };
		}
		if (!externalId) {
			return { status: "error", message: "Нет object.id — сопоставлять не по чему" };
		}

		// Организация-отправитель: по её БИН находим нашу орг (владельца создаваемых записей).
		const senderBin = normalizeBin(body?.organization?.bin);
		const senderOrg = senderBin
			? await prisma.organization.findUnique({ where: { bin: senderBin }, select: { uuid: true } })
			: null;

		const ctx = {
			senderBin,
			orgUuid: senderOrg?.uuid ?? null,
			objectName: null, // имя элемента 1С шлёт в props; object.name — это ИМЯ СПРАВОЧНИКА
		};

		const model = book.model;
		const data = book.build(props, ctx);
		if (!data) {
			return {
				status: "error",
				model,
				message: "Не хватает обязательных реквизитов (БИН / Наименование) — создать нельзя",
			};
		}

		// 1) Уже сопоставлен ранее → обновляем (1С — источник истины).
		const linked = await prisma[model].findFirst({
			where: { externalSource: SOURCE, externalId },
		});
		if (linked) {
			const updated = await prisma[model].update({
				where: { uuid: linked.uuid },
				data: cleanUndefined(data),
			});
			return { status: "updated", model, uuid: updated.uuid };
		}

		// 2) Первая встреча: пробуем ПРИВЯЗАТЬСЯ к существующей записи по естественному
		//    ключу — иначе интеграция продублировала бы наш справочник.
		const natural = await book.findNatural(props, ctx);
		if (natural) {
			const updated = await prisma[model].update({
				where: { uuid: natural.uuid },
				data: { ...cleanUndefined(data), externalSource: SOURCE, externalId },
			});
			return { status: "linked", model, uuid: updated.uuid };
		}

		// 3) Не нашли — создаём новый элемент справочника.
		const created = await prisma[model].create({
			data: { ...cleanUndefined(data), externalSource: SOURCE, externalId },
		});
		return { status: "created", model, uuid: created.uuid };
	} catch (err) {
		// Конфликт уникальности (напр. БИН занят другой записью) и прочие сбои —
		// событие сохранится с applyStatus=error, данные не порчены.
		return { status: "error", message: String(err?.message ?? err).slice(0, 500) };
	}
}

/** Убирает null/undefined-поля, чтобы не затирать наши данные пустотой из 1С. */
function cleanUndefined(obj) {
	const out = {};
	for (const [k, v] of Object.entries(obj)) {
		if (v !== undefined && v !== null) out[k] = v;
	}
	return out;
}

export default { applyPipeReference, supportedRefBooks };

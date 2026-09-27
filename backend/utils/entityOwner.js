// ─────────────────────────────────────────────────────────────────────────────
// Организация записи по паре «раздел панели + uuid» (аудит 26.09, п. 15 и 29 отчёта инспекции
// маршрутов).
//
// Заметки и метки привязаны к записи полиморфно: `entityType`/`ownerType` — это endpoint раздела
// («sales», «counterparties», «organizations»…), uuid — запись. Организацию заметки раньше
// присылал клиент, а кнопка заметок в форме не присылала её вовсе — заметка получала null и
// становилась видна ВСЕМ организациям установки (журнал заметок отдавал её каждому). Теперь
// организация определяется на сервере по самой записи.
//
// Раздел → модель: через карту прав ROUTE_TO_MODEL (она и так знает все разделы) и схему Prisma
// (есть ли у модели поле организации). Раздел, которого карта не знает, — «неизвестная запись»:
// тогда организацией заметки становится активная организация пользователя.
// ─────────────────────────────────────────────────────────────────────────────
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma/prisma-client.js";
import { ROUTE_TO_MODEL } from "./routeModels.js";
import { checkOwnership, orgIsAccessible } from "./auth.js";

const lowerFirst = (s) => s[0].toLowerCase() + s.slice(1);

/** Имя права ≠ имя модели: ПКО и РКО — одна таблица cash_orders. */
const DELEGATE_OVERRIDES = { CashReceiptOrder: "cashOrder", CashExpenseOrder: "cashOrder" };

/**
 * Модели, у которых `organizationUuid` — не принадлежность записи: у пользователя это его
 * АКТИВНАЯ организация. Заметка о пользователе ложится в организацию автора.
 */
const NOT_OWNED_BY_ORG = new Set(["user"]);

const FIELDS = new Map((Prisma.dmmf?.datamodel?.models ?? []).map((m) => [lowerFirst(m.name), new Set(m.fields.map((f) => f.name))]));

/** Делегат Prisma по разделу панели; null — раздел неизвестен. */
export function entityDelegate(endpoint) {
	const perm = ROUTE_TO_MODEL[String(endpoint ?? "")];
	if (!perm) return null;
	const delegate = DELEGATE_OVERRIDES[perm] ?? lowerFirst(perm);
	const fields = FIELDS.get(delegate);
	return fields?.has("uuid") ? delegate : null;
}

/**
 * Запись и её организация.
 * @returns {Promise<{ found: boolean, known: boolean, isOrganization?: boolean, orgScoped?: boolean, organizationUuid?: string|null }>}
 *   known — раздел знаком; found — запись есть; orgScoped — у записи есть организация-владелец
 *   (null в ней — общая запись справочника).
 */
export async function resolveEntity(endpoint, uuid, db = prisma) {
	const id = String(uuid ?? "");
	if (!id) return { found: false, known: false };
	if (endpoint === "organizations") {
		const row = await db.organization.findUnique({ where: { uuid: id }, select: { uuid: true } }).catch(() => null);
		return row ? { found: true, known: true, isOrganization: true, orgScoped: true, organizationUuid: row.uuid } : { found: false, known: true };
	}
	const delegate = entityDelegate(endpoint);
	if (!delegate) return { found: false, known: false };
	const orgScoped = FIELDS.get(delegate).has("organizationUuid") && !NOT_OWNED_BY_ORG.has(delegate);
	const row = await db[delegate].findUnique({
		where: { uuid: id },
		select: orgScoped ? { organizationUuid: true } : { uuid: true },
	}).catch(() => null);
	if (!row) return { found: false, known: true };
	return { found: true, known: true, orgScoped, organizationUuid: orgScoped ? row.organizationUuid ?? null : null };
}

/** Доступна ли пользователю найденная запись. Общая запись справочника (null) — доступна. */
export function entityAccessible(req, ent) {
	if (!ent?.found) return false;
	if (ent.isOrganization) return orgIsAccessible(req, ent.organizationUuid);
	if (!ent.orgScoped) return true; // справочник установки (валюты, единицы) и строки документов
	return checkOwnership({ organizationUuid: ent.organizationUuid }, req);
}

/**
 * Организация новой заметки или метки: организация записи; у общей записи и у записи без
 * организации — запрошенная (если доступна) или активная организация автора.
 * Бросает `{status:404}`, если запись есть, но чужая; `{status:403}` — если запрошена чужая организация.
 */
export async function organizationForAttachment(req, endpoint, uuid, requestedOrg = null, db = prisma) {
	if (requestedOrg && !orgIsAccessible(req, requestedOrg)) {
		throw Object.assign(new Error("Нет доступа к указанной организации"), { status: 403 });
	}
	const ent = await resolveEntity(endpoint, uuid, db);
	if (ent.found && !entityAccessible(req, ent)) {
		throw Object.assign(new Error("Запись не найдена"), { status: 404 });
	}
	if (ent.found && ent.organizationUuid) return ent.organizationUuid;
	return requestedOrg || req.user?.organizationUuid || null;
}

/** Организации, доступные пользователю; null — видит всё (суперадмин с открытыми данными, О5). */
export function allowedOrgList(req) {
	if (req.user?.isSuperAdmin && req.user?.operatorDataAccess !== false) return null;
	return [...new Set([req.user?.organizationUuid, ...(req.user?.allowedOrgUuids ?? [])].filter(Boolean))];
}

export default { entityDelegate, resolveEntity, entityAccessible, organizationForAttachment, allowedOrgList };

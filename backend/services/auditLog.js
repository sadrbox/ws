// ─────────────────────────────────────────────────────────────────────────────
// Сквозной журнал действий (E1.2): кто / что / когда / diff.
//
// Записи создаёт auditMiddleware на успешных мутирующих запросах. Здесь — чистые
// примитивы (сравнение снимков, нормализация значений) и запись в БД.
//
// Инварианты:
//   • Аудит НИКОГДА не ломает основной запрос: любая ошибка глушится.
//   • Секреты (пароли, TOTP-секрет, токены) в журнал не попадают.
//   • Служебные поля (updatedAt и т.п.) не считаются изменением.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "../prisma/prisma-client.js";

/** Поля, которые НИКОГДА не пишем в журнал (ни значение, ни факт изменения). */
export const SECRET_FIELDS = new Set([
	"password",
	"twoFactorSecret",
	"token",
	"refreshToken",
	"secret",
	"apiKey",
]);

/** Служебные поля: их изменение не является содержательным. */
const IGNORED_FIELDS = new Set(["updatedAt", "createdAt", "id"]);

/** Максимум символов на строковое значение в diff (защита от «простыней»). */
const MAX_VALUE_LEN = 500;

/**
 * Приводит значение Prisma (Decimal/Date/BigInt/объект) к JSON-совместимому виду.
 * Объекты-связи (organization, author…) в diff не попадают — только скаляры.
 */
export function normalizeValue(v) {
	if (v === null || v === undefined) return null;
	if (v instanceof Date) return v.toISOString();
	if (typeof v === "bigint") return v.toString();
	// Prisma.Decimal и подобные — имеют toString, но не являются простыми объектами.
	if (typeof v === "object") {
		if (typeof v.toNumber === "function") return v.toNumber();
		return undefined; // связи/вложенные объекты пропускаем
	}
	if (typeof v === "string" && v.length > MAX_VALUE_LEN) return v.slice(0, MAX_VALUE_LEN) + "…";
	return v;
}

/** Скалярный снимок записи: только простые поля, без секретов и связей. */
export function snapshot(record) {
	if (!record || typeof record !== "object") return {};
	const out = {};
	for (const [k, raw] of Object.entries(record)) {
		if (SECRET_FIELDS.has(k) || IGNORED_FIELDS.has(k)) continue;
		const v = normalizeValue(raw);
		if (v === undefined) continue;
		out[k] = v;
	}
	return out;
}

/**
 * Изменения между снимками: { поле: { from, to } }. Пустой объект = нет изменений.
 * Сравнение по нормализованным значениям, поэтому Decimal(100) и 100 равны.
 */
export function computeDiff(before, after) {
	const a = snapshot(before);
	const b = snapshot(after);
	const diff = {};
	for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
		const from = a[key] ?? null;
		const to = b[key] ?? null;
		if (from === to) continue;
		// null и "" считаем эквивалентными: очистка поля в форме шлёт "".
		if ((from === null || from === "") && (to === null || to === "")) continue;
		diff[key] = { from, to };
	}
	return diff;
}

/** Человекочитаемое имя объекта для журнала. */
export function objectNameOf(record, objectType) {
	if (!record) return objectType;
	return (
		record.name ??
		record.fullName ??
		record.legalName ??
		(record.number ? `№ ${record.number}` : null) ??
		record.username ??
		record.code ??
		objectType
	);
}

// Короткий кэш реквизитов организации (для колонок журнала).
const orgCache = new Map(); // uuid → { shortName, bin, at }
const ORG_TTL = 60_000;

async function orgProps(organizationUuid) {
	if (!organizationUuid) return { organizationShortName: null, bin: null };
	const hit = orgCache.get(organizationUuid);
	if (hit && Date.now() - hit.at < ORG_TTL) return { organizationShortName: hit.shortName, bin: hit.bin };
	try {
		const org = await prisma.organization.findUnique({
			where: { uuid: organizationUuid },
			select: { name: true, shortName: true, bin: true },
		});
		const shortName = org?.shortName || org?.name || null;
		const bin = org?.bin ?? null;
		orgCache.set(organizationUuid, { shortName, bin, at: Date.now() });
		return { organizationShortName: shortName, bin };
	} catch {
		return { organizationShortName: null, bin: null };
	}
}

/**
 * Записать событие в журнал. НИКОГДА не бросает — аудит не должен ронять запрос.
 *
 * @param {object} p
 * @param {"create"|"update"|"delete"|"batch_delete"} p.actionType
 * @param {string} p.objectType   — имя модели (PascalCase), напр. "Purchase"
 * @param {string} p.objectId     — uuid объекта
 * @param {string} [p.objectName]
 * @param {string} [p.organizationUuid]
 * @param {object} p.user         — req.user
 * @param {object} [p.diff]       — { поле: {from,to} }
 * @param {object} [p.props]      — доп. контекст (напр. список uuid при batch-delete)
 * @param {string} [p.host] @param {string} [p.ip]
 */
export async function recordAudit({
	actionType,
	objectType,
	objectId,
	objectName,
	organizationUuid = null,
	user,
	diff = null,
	props = null,
	host = null,
	ip = null,
}) {
	try {
		if (!objectType || !objectId || !user?.username) return;
		const { organizationShortName, bin } = await orgProps(organizationUuid);
		await prisma.activityHistory.create({
			data: {
				actionType,
				objectType,
				objectId: String(objectId),
				objectName: String(objectName ?? objectType).slice(0, 255),
				organizationUuid: organizationUuid || null,
				organizationShortName,
				bin,
				userUuid: user.uuid ?? null,
				userName: user.username,
				host,
				ip,
				diff: diff && Object.keys(diff).length ? diff : undefined,
				props: props ?? undefined,
			},
		});
		// Планировщика нет — чистим журнал попутно, не чаще раза в сутки.
		maybePrune();
	} catch (err) {
		// Журнал не должен ломать бизнес-операцию.
		console.error("recordAudit error:", err.message);
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// События безопасности (вход, неудачный вход, смена пароля, 2FA).
//
// Эти запросы обрабатываются ДО authMiddleware, поэтому auditMiddleware их не
// видит — они пишутся явно из auth-роутера. Выход (logout) серверу не виден:
// JWT stateless, клиент просто забывает токен.
// ─────────────────────────────────────────────────────────────────────────────

/** Типы событий безопасности. */
export const AUTH_ACTIONS = {
	LOGIN: "login",
	LOGIN_FAILED: "login_failed",
	PASSWORD_CHANGED: "password_changed",
	TWO_FACTOR_ENABLED: "2fa_enabled",
	TWO_FACTOR_DISABLED: "2fa_disabled",
};

/**
 * Записать событие безопасности. Для неудачного входа пользователь может быть
 * неизвестен — тогда objectId = введённый логин (иначе запись потеряется).
 *
 * @param {object} p
 * @param {string} p.actionType   — из AUTH_ACTIONS
 * @param {object} [p.user]       — { uuid, username, organizationUuid }
 * @param {string} [p.username]   — введённый логин (для неудачного входа)
 * @param {object} p.req          — express request (host/ip)
 * @param {object} [p.props]      — контекст, напр. { reason: "bad_password" }
 */
export async function recordAuthEvent({ actionType, user, username, req, props = null }) {
	const name = user?.username ?? username;
	if (!name) return;
	await recordAudit({
		actionType,
		objectType: "User",
		objectId: user?.uuid ?? name,
		objectName: name,
		organizationUuid: user?.organizationUuid ?? null,
		user: { uuid: user?.uuid ?? null, username: name },
		props,
		host: req?.hostname ?? null,
		ip: req?.ip ?? null,
	});
}

// ─────────────────────────────────────────────────────────────────────────────
// Ретенция журнала.
//
// Планировщика (cron) в проекте нет, поэтому чистка «оппортунистическая»: не чаще
// раза в сутки, из-под записи в журнал, асинхронно. Срок хранения —
// AUDIT_RETENTION_DAYS (по умолчанию 365); значение <= 0 отключает чистку.
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_RETENTION_DAYS = 365;
const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;
let lastPruneAt = 0;

/** Срок хранения из окружения (с валидацией). */
export function retentionDays() {
	const raw = process.env.AUDIT_RETENTION_DAYS;
	if (raw === undefined || raw === "") return DEFAULT_RETENTION_DAYS;
	const n = Number(raw);
	return Number.isFinite(n) ? n : DEFAULT_RETENTION_DAYS;
}

/**
 * Удалить записи журнала старше `days` суток.
 * @returns {Promise<{deleted:number, skipped?:boolean, cutoff?:Date}>}
 */
export async function pruneAuditLog(days = retentionDays(), client = prisma) {
	if (!Number.isFinite(days) || days <= 0) return { deleted: 0, skipped: true };
	const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
	const res = await client.activityHistory.deleteMany({ where: { actionDate: { lt: cutoff } } });
	return { deleted: res.count, cutoff };
}

/** Троттлинг: возвращает true, если чистку пора запускать (и «занимает» окно). */
export function shouldPrune(now = Date.now()) {
	if (now - lastPruneAt < PRUNE_INTERVAL_MS) return false;
	lastPruneAt = now;
	return true;
}

/** Сброс троттлинга — только для тестов. */
export function _resetPruneThrottle() {
	lastPruneAt = 0;
}

/** Оппортунистическая чистка: не чаще раза в сутки, ошибки глушатся. */
function maybePrune() {
	if (retentionDays() <= 0) return;
	if (!shouldPrune()) return;
	pruneAuditLog().catch((err) => console.error("pruneAuditLog error:", err.message));
}

export default { recordAudit, recordAuthEvent, computeDiff, snapshot, objectNameOf, pruneAuditLog, SECRET_FIELDS, AUTH_ACTIONS };

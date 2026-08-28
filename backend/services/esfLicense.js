// Лицензирование ЭСФ по БИН — логика, отделённая от HTTP (api/router/esfLicense.js).
//
// Здесь: подпись и проверка токена, решение «выдавать или отказать», учёт установок
// (баз 1С) по installId и журнал обращений. Всё, что можно, — чистые функции без БД:
// клиент Prisma передаётся параметром (тесты подставляют мок).
//
// Задачи ТЗ сервера: S-01 (отказ отключённому БИН), S-02 (отзыв через heartbeat),
// S-03 (TTL токена), S-04 (проверка подписи на сервере), S-05 (HMAC + kid),
// S-06 (журнал), S-07 (лимит установок), S-09 (уведомление о заявке).
import crypto from "node:crypto";
import axios from "axios";
import { prisma } from "../prisma/prisma-client.js";

// ─────────────────────────────────────────────────────────────────────────────
// Настройки из окружения (читаются на каждый вызов — тесты меняют env на лету)
// ─────────────────────────────────────────────────────────────────────────────

/** Секрет «старой» схемы подписи (её проверяет 1С у себя, пока не сделана T-13). */
export function legacySecret() {
	return process.env.LICENSE_TOKEN_SECRET || "";
}

/** Реестр HMAC-ключей: LICENSE_TOKEN_KEYS = {"kid":"<ключ>", …} (S-05, ротация). */
export function tokenKeys() {
	const raw = process.env.LICENSE_TOKEN_KEYS;
	if (!raw) return {};
	try {
		const parsed = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
		const out = {};
		for (const [kid, key] of Object.entries(parsed)) {
			if (typeof kid === "string" && kid && !kid.includes("|") && typeof key === "string" && key) out[kid] = key;
		}
		return out;
	} catch {
		console.error("[esf-license] LICENSE_TOKEN_KEYS is not valid JSON — HMAC signing disabled");
		return {};
	}
}

/** kid, которым подписываем сейчас. Пусто → подписываем старой схемой. */
export function activeKid() {
	const kid = (process.env.LICENSE_TOKEN_ACTIVE_KID || "").trim();
	return kid && tokenKeys()[kid] ? kid : "";
}

/** Есть ли чем подписывать токен вообще. */
export function signingConfigured() {
	return !!activeKid() || !!legacySecret();
}

export const DEFAULT_TOKEN_TTL_HOURS = 4;

/** Срок жизни токена = окно автономной работы после отключения БИН (S-03). 1..168ч. */
export function tokenTtlHours() {
	const n = Number(process.env.LICENSE_TOKEN_TTL_HOURS);
	if (!Number.isFinite(n) || n <= 0) return DEFAULT_TOKEN_TTL_HOURS;
	return Math.min(Math.max(n, 1), 168);
}

export const DEFAULT_INSTALL_LIMIT = 2;

/** Общий лимит установок на БИН (переопределяется полем EsfLicense.installLimit). */
export function defaultInstallLimit() {
	const n = Number(process.env.LICENSE_INSTALL_LIMIT);
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_INSTALL_LIMIT;
}

/** Отказывать ли в токене при превышении лимита. По умолчанию НЕТ: только учёт. */
export function installLimitEnforced() {
	return String(process.env.LICENSE_INSTALL_LIMIT_ENFORCE || "").toLowerCase() === "true";
}

/** Установка «протухает» (перестаёт считаться) без heartbeat дольше стольких суток. */
export function installStaleDays() {
	const n = Number(process.env.LICENSE_INSTALL_STALE_DAYS);
	return Number.isFinite(n) && n > 0 ? n : 30;
}

/** Лимит установок для конкретной лицензии (персональный или общий). */
export function installLimitFor(lic) {
	const own = Number(lic?.installLimit);
	return Number.isFinite(own) && own > 0 ? Math.floor(own) : defaultInstallLimit();
}

// ─────────────────────────────────────────────────────────────────────────────
// Подпись токена
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Старая (совместимая с 1С) подпись: base64(sha256("<secret>|<data>|<secret>")).
 * НЕ HMAC — самодельная конструкция, но её проверяет установленное расширение,
 * поэтому она остаётся до перевода клиента на /verify (S-04).
 */
export function signLegacy(data, secret) {
	return crypto.createHash("sha256").update(`${secret}|${data}|${secret}`, "utf-8").digest("base64");
}

/** Штатный HMAC-SHA256 (S-05) — включается через LICENSE_TOKEN_ACTIVE_KID. */
export function signHmac(data, key) {
	return crypto.createHmac("sha256", key).update(data, "utf-8").digest("base64");
}

/** Сравнение подписей за постоянное время (защита от timing-атак). */
function equalSignatures(a, b) {
	const ba = Buffer.from(String(a), "utf-8");
	const bb = Buffer.from(String(b), "utf-8");
	if (ba.length !== bb.length) return false;
	return crypto.timingSafeEqual(ba, bb);
}

/**
 * Токен: "<БИН>|<expUnix>|<подпись>" (старая схема) либо
 *        "<БИН>|<expUnix>|<подпись>|<kid>" (HMAC, S-05).
 * Четвёртый сегмент добавляется только при включённом kid — старый формат не ломается.
 */
export function issueToken(bin, { now = Date.now(), ttlHours = tokenTtlHours() } = {}) {
	const expiresAtUnix = Math.floor(now / 1000) + Math.round(ttlHours * 3600);
	const data = `${bin}|${expiresAtUnix}`;
	const kid = activeKid();
	if (kid) return `${data}|${signHmac(data, tokenKeys()[kid])}|${kid}`;
	return `${data}|${signLegacy(data, legacySecret())}`;
}

/** Разбор токена без проверки подписи. null — формат не тот. */
export function parseToken(token) {
	if (typeof token !== "string") return null;
	const parts = token.split("|");
	if (parts.length !== 3 && parts.length !== 4) return null;
	const [bin, expRaw, signature, kid] = parts;
	const expiresAtUnix = Number(expRaw);
	if (!bin || !signature || !Number.isInteger(expiresAtUnix)) return null;
	return { bin, expiresAtUnix, signature, kid: kid || "" };
}

/**
 * Проверка токена на сервере (S-04). Причины отказа: malformed|signature|expired.
 * @returns {{valid: boolean, reason?: string, bin?: string, expiresAtUnix?: number}}
 */
export function verifyTokenSignature(token, { now = Date.now(), bin = null } = {}) {
	const parsed = parseToken(token);
	if (!parsed) return { valid: false, reason: "malformed" };
	if (bin && parsed.bin !== bin) return { valid: false, reason: "signature" };

	const data = `${parsed.bin}|${parsed.expiresAtUnix}`;
	let expected;
	if (parsed.kid) {
		const key = tokenKeys()[parsed.kid];
		if (!key) return { valid: false, reason: "signature" };
		expected = signHmac(data, key);
	} else {
		const secret = legacySecret();
		if (!secret) return { valid: false, reason: "signature" };
		expected = signLegacy(data, secret);
	}
	if (!equalSignatures(parsed.signature, expected)) return { valid: false, reason: "signature" };
	if (parsed.expiresAtUnix * 1000 <= now) {
		return { valid: false, reason: "expired", bin: parsed.bin, expiresAtUnix: parsed.expiresAtUnix };
	}
	return { valid: true, bin: parsed.bin, expiresAtUnix: parsed.expiresAtUnix };
}

// ─────────────────────────────────────────────────────────────────────────────
// Состояние лицензии
// ─────────────────────────────────────────────────────────────────────────────

/** Причина отказа: unknown | inactive | expired; null — лицензия действует. */
export function licenseDenyReason(lic, now = new Date()) {
	if (!lic) return "unknown";
	if (lic.active !== true) return "inactive";
	if (lic.expiresAt != null && new Date(lic.expiresAt) <= now) return "expired";
	return null;
}

/** Лицензия действует: active И (без срока ИЛИ срок в будущем). */
export function isLicenseActive(lic, now = new Date()) {
	return licenseDenyReason(lic, now) === null;
}

/** Тексты отказа для пользователя 1С (поле message; S-01). */
export const DENY_MESSAGES = {
	unknown: "БИН не зарегистрирован. Отправьте запрос на активацию из карточки профиля.",
	inactive: "Доступ к обмену ЭСФ для этого БИН не активирован. Обратитесь к поставщику расширения.",
	expired: "Срок действия лицензии истёк. Обратитесь к поставщику расширения для продления.",
	install_limit: "Превышено число баз 1С для этой лицензии. Обратитесь к поставщику расширения.",
	revoked: "Доступ к обмену ЭСФ отозван.",
	signature: "Токен лицензии повреждён или подписан неизвестным ключом.",
	malformed: "Токен лицензии повреждён.",
};

// ─────────────────────────────────────────────────────────────────────────────
// Установки (базы 1С) — S-07
// ─────────────────────────────────────────────────────────────────────────────

/** Граница «живой» установки: heartbeat не старше installStaleDays суток. */
export function installActiveSince(now = Date.now()) {
	return new Date(now - installStaleDays() * 24 * 60 * 60 * 1000);
}

/**
 * Зафиксировать обращение установки. Возврат к жизни отвязанной (releasedAt)
 * установки СБРАСЫВАЕТ отвязку: раз база снова обращается, она реально работает
 * (отвязка рассчитана на перенесённую/погашенную базу, которая больше не придёт).
 */
export async function registerInstall(client, { bin, installId, ip = null }) {
	if (!bin || !installId) return null;
	const now = new Date();
	return client.esfLicenseInstall.upsert({
		where: { bin_installId: { bin, installId } },
		update: { lastSeenAt: now, lastIp: ip, releasedAt: null },
		create: { bin, installId, firstSeenAt: now, lastSeenAt: now, lastIp: ip },
	});
}

/** Сколько «живых» (не отвязанных, свежих) установок у БИН. */
export async function countActiveInstalls(client, bin, now = Date.now()) {
	if (!bin) return 0;
	return client.esfLicenseInstall.count({
		where: { bin, releasedAt: null, lastSeenAt: { gte: installActiveSince(now) } },
	});
}

/**
 * Проверка лимита установок. Возвращает {count, limit, exceeded, enforced}.
 * enforced=false → отказывать нельзя, только показать в админке (решение пользователя).
 */
export async function checkInstallLimit(client, lic, now = Date.now()) {
	const limit = installLimitFor(lic);
	const count = await countActiveInstalls(client, lic?.bin, now);
	return { count, limit, exceeded: count > limit, enforced: installLimitEnforced() };
}

// ─────────────────────────────────────────────────────────────────────────────
// Журнал обращений — S-06
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_LOG_RETENTION_DAYS = 180;

/** Срок хранения журнала; <= 0 отключает чистку. */
export function logRetentionDays() {
	const raw = process.env.LICENSE_LOG_RETENTION_DAYS;
	if (raw === undefined || raw === "") return DEFAULT_LOG_RETENTION_DAYS;
	const n = Number(raw);
	return Number.isFinite(n) ? n : DEFAULT_LOG_RETENTION_DAYS;
}

/** Удалить записи журнала старше `days` суток. */
export async function pruneLicenseLog(days = logRetentionDays(), client = prisma) {
	if (!Number.isFinite(days) || days <= 0) return { deleted: 0, skipped: true };
	const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
	const res = await client.esfLicenseLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
	return { deleted: res.count, cutoff };
}

// Планировщика в проекте нет — чистка оппортунистическая, не чаще раза в сутки
// (тот же приём, что в services/auditLog.js).
const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;
let lastPruneAt = 0;

export function shouldPruneLog(now = Date.now()) {
	if (now - lastPruneAt < PRUNE_INTERVAL_MS) return false;
	lastPruneAt = now;
	return true;
}

/** Сброс троттлинга — только для тестов. */
export function _resetLogPruneThrottle() {
	lastPruneAt = 0;
}

/**
 * Запись в журнал. Никогда не бросает: журналирование не должно ломать выдачу
 * токена. Вызывается без await (fire-and-forget).
 */
export function logLicenseRequest(entry, client = prisma) {
	const data = {
		bin: entry.bin ?? null,
		installId: entry.installId ?? null,
		endpoint: String(entry.endpoint || "unknown"),
		result: String(entry.result || "unknown"),
		reason: entry.reason ?? null,
		status: Number(entry.status) || 0,
		ip: entry.ip ?? null,
	};
	return client.esfLicenseLog
		.create({ data })
		.then(() => {
			if (logRetentionDays() > 0 && shouldPruneLog()) {
				pruneLicenseLog(logRetentionDays(), client).catch((err) => console.error("pruneLicenseLog error:", err.message));
			}
		})
		.catch((err) => console.error("[esf-license] log write error:", err.message));
}

// ─────────────────────────────────────────────────────────────────────────────
// Уведомление о заявке на активацию — S-09
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Сообщить ответственному о НОВОЙ заявке (повторные заявки того же БИН не шумят).
 * Канал — вебхук LICENSE_ALERT_WEBHOOK_URL (Telegram-бот/чат/что угодно, принимающее
 * JSON). Не настроен — остаётся запись в логе сервера и заявка в админке.
 */
export function notifyActivationRequest({ bin, installId, isNew }) {
	if (!isNew) return Promise.resolve();
	console.info(`[esf-license] НОВАЯ заявка на активацию: БИН ${bin} (installId=${installId ?? "-"})`);
	const url = process.env.LICENSE_ALERT_WEBHOOK_URL;
	if (!url) return Promise.resolve();
	return axios
		.post(url, { type: "esf_activation_request", bin, installId: installId ?? null, at: new Date().toISOString() }, { timeout: 5000 })
		.then(() => undefined)
		.catch((err) => console.error("[esf-license] webhook error:", err.message));
}

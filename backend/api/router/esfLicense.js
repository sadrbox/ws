// Лицензирование ЭСФ по БИН для 1С-расширения esf_exchange.
//
// ── publicRouter (/api1/esf-license/*) — БЕЗ авторизации, вызывает 1С ──────────
//   GET  /token?bin=            — токен, если лицензия активна (иначе 403);
//   POST /heartbeat             — телеметрия использования (обнаружение взлома);
//   POST /activation-request    — заявка на подключение (создаёт запись active:false).
//   Пути и формат токена — ЗАШИТЫЙ контракт 1С, менять нельзя.
//
// ── adminRouter (/api/v1/esf-licenses) — под общим authMiddleware + superadmin ──
//   CRUD для админ-панели «Лицензии ЭСФ».
import express from "express";
import crypto from "node:crypto";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { prisma } from "../../prisma/prisma-client.js";

// ── Подпись токена — ТОЧНО как проверяет 1С (CommonModules.ЛицензированиеЭСФ).
// НЕ JWT/HMAC: sha256("<secret>|<data>|<secret>") → base64. Менять нельзя.
function signToken(data, secret) {
	const hash = crypto.createHash("sha256");
	hash.update(`${secret}|${data}|${secret}`, "utf-8");
	return hash.digest("base64");
}
function issueToken(bin, secret, ttlHours) {
	const expiresAtUnix = Math.floor(Date.now() / 1000) + ttlHours * 3600;
	const data = `${bin}|${expiresAtUnix}`;
	return `${bin}|${expiresAtUnix}|${signToken(data, secret)}`;
}

const TOKEN_SECRET = process.env.LICENSE_TOKEN_SECRET || "";
// TTL кэша токена у 1С: компромисс скорость-отключения / офлайн-запас. 1..168ч, дефолт 24.
const TOKEN_TTL_HOURS = Math.min(Math.max(Number(process.env.LICENSE_TOKEN_TTL_HOURS) || 24, 1), 168);

/** Нормализованный БИН из тела/квери: непустая строка (обрезаем, ограничиваем длину). */
function normBin(v) {
	if (typeof v !== "string") return null;
	const b = v.trim();
	if (!b || b.length > 32) return null;
	return b;
}

/** Лицензия действует: active И (без срока ИЛИ срок в будущем). */
function isLicenseActive(lic) {
	return !!lic && lic.active === true && (lic.expiresAt == null || new Date(lic.expiresAt) > new Date());
}

// ─────────────────────────────────────────────────────────────────────────────
// ПУБЛИЧНЫЙ РОУТЕР (1С)
// ─────────────────────────────────────────────────────────────────────────────
export const publicRouter = express.Router();

// Лимит для POST-эндпоинтов (заявка/heartbeat) по IP — чтобы нельзя было завалить БД.
const writeLimiter = rateLimit({
	windowMs: 60 * 1000,
	max: 60, // 60 запросов с IP в минуту (1С шлёт heartbeat раз в час на БИН)
	standardHeaders: true,
	legacyHeaders: false,
	keyGenerator: (req) => `esf:${ipKeyGenerator(req.ip || "")}`,
	message: { error: "Too many requests" },
});

// GET /api1/esf-license/token?bin=<БИН>
publicRouter.get("/token", async (req, res) => {
	try {
		const bin = normBin(req.query.bin);
		if (!bin) return res.status(400).json({ error: "bin required" });
		if (!TOKEN_SECRET) {
			// Секрет не настроен — токен подписать нечем; выдавать нельзя (1С отвергнет).
			console.error("[esf-license] LICENSE_TOKEN_SECRET is not set — cannot issue tokens");
			return res.status(500).json({ error: "License service misconfigured" });
		}
		const lic = await prisma.esfLicense.findUnique({ where: { bin } });
		if (!isLicenseActive(lic)) return res.status(403).json({ error: "License is not active" });
		return res.status(200).json({ token: issueToken(bin, TOKEN_SECRET, TOKEN_TTL_HOURS) });
	} catch (err) {
		console.error("GET /api1/esf-license/token error:", err);
		return res.status(500).json({ error: "Server error" });
	}
});

// POST /api1/esf-license/heartbeat  { bin, installId, time }
publicRouter.post("/heartbeat", writeLimiter, async (req, res) => {
	try {
		const bin = normBin(req.body?.bin);
		if (!bin) return res.status(400).json({ error: "bin required" });
		const installId = typeof req.body?.installId === "string" ? req.body.installId.slice(0, 128) : null;

		// Пишем heartbeat даже для неизвестного/неактивного БИН — это и есть сигнал
		// несанкционированного использования (кто-то обошёл проверку в копии расширения).
		const lic = await prisma.esfLicense.upsert({
			where: { bin },
			update: { lastHeartbeatAt: new Date(), lastHeartbeatInstallId: installId },
			create: { bin, active: false, lastHeartbeatAt: new Date(), lastHeartbeatInstallId: installId },
		});
		if (!isLicenseActive(lic)) {
			console.warn(`[esf-license] heartbeat от НЕАКТИВНОГО БИН ${bin} (installId=${installId ?? "-"}) — возможное несанкц. использование`);
		}
		return res.status(200).json({ ok: true });
	} catch (err) {
		console.error("POST /api1/esf-license/heartbeat error:", err);
		return res.status(500).json({ error: "Server error" });
	}
});

// POST /api1/esf-license/activation-request  { bin, installId }
publicRouter.post("/activation-request", writeLimiter, async (req, res) => {
	try {
		const bin = normBin(req.body?.bin);
		if (!bin) return res.status(400).json({ error: "bin required" });
		const installId = typeof req.body?.installId === "string" ? req.body.installId.slice(0, 128) : null;

		// Идемпотентно: есть — обновляем дату/счётчик (active НЕ трогаем, активация ручная);
		// нет — создаём заявку active:false.
		await prisma.esfLicense.upsert({
			where: { bin },
			update: { lastRequestAt: new Date(), lastRequestInstallId: installId, requestCount: { increment: 1 } },
			create: { bin, active: false, lastRequestAt: new Date(), lastRequestInstallId: installId, requestCount: 1 },
		});
		return res.status(200).json({ ok: true });
	} catch (err) {
		console.error("POST /api1/esf-license/activation-request error:", err);
		return res.status(500).json({ error: "Server error" });
	}
});

// ─────────────────────────────────────────────────────────────────────────────
// АДМИН-РОУТЕР (superadmin) — монтируется под /api/v1 (общий authMiddleware)
// ─────────────────────────────────────────────────────────────────────────────
export const adminRouter = express.Router();

// Лицензии — системная сущность: только суперадмин.
adminRouter.use("/esf-licenses", (req, res, next) => {
	if (!req.user?.isSuperAdmin) return res.status(403).json({ success: false, message: "Только для администратора" });
	next();
});

// GET /api/v1/esf-licenses?active=true|false&search=&limit=&offset=
adminRouter.get("/esf-licenses", async (req, res) => {
	try {
		const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 1000);
		const offset = Math.max(Number(req.query.offset) || 0, 0);
		const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
		const where = {};
		if (req.query.active === "true") where.active = true;
		else if (req.query.active === "false") where.active = false;
		if (search) where.OR = [{ bin: { contains: search, mode: "insensitive" } }, { note: { contains: search, mode: "insensitive" } }];

		const [items, total] = await Promise.all([
			prisma.esfLicense.findMany({
				where,
				// Очередь на подключение: неактивные с заявками сверху, свежие заявки первыми.
				orderBy: [{ active: "asc" }, { lastRequestAt: { sort: "desc", nulls: "last" } }],
				take: limit,
				skip: offset,
			}),
			prisma.esfLicense.count({ where }),
		]);
		return res.json({ success: true, items, total });
	} catch (err) {
		console.error("GET /esf-licenses error:", err);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// POST /api/v1/esf-licenses  { bin, note?, active?, expiresAt? } — ручное добавление
adminRouter.post("/esf-licenses", async (req, res) => {
	try {
		const bin = normBin(req.body?.bin);
		if (!bin) return res.status(400).json({ success: false, message: "БИН обязателен" });
		const exists = await prisma.esfLicense.findUnique({ where: { bin } });
		if (exists) return res.status(409).json({ success: false, message: "БИН уже есть" });
		const item = await prisma.esfLicense.create({
			data: {
				bin,
				note: typeof req.body?.note === "string" ? req.body.note.trim() || null : null,
				active: req.body?.active === true,
				expiresAt: req.body?.expiresAt ? new Date(req.body.expiresAt) : null,
			},
		});
		return res.status(201).json({ success: true, item });
	} catch (err) {
		console.error("POST /esf-licenses error:", err);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// PATCH /api/v1/esf-licenses/:bin  { active?, expiresAt?, note? }
adminRouter.patch("/esf-licenses/:bin", async (req, res) => {
	try {
		const bin = normBin(req.params.bin);
		if (!bin) return res.status(400).json({ success: false, message: "БИН обязателен" });
		const data = {};
		if (typeof req.body?.active === "boolean") data.active = req.body.active;
		if ("expiresAt" in (req.body ?? {})) data.expiresAt = req.body.expiresAt ? new Date(req.body.expiresAt) : null;
		if ("note" in (req.body ?? {})) data.note = typeof req.body.note === "string" ? req.body.note.trim() || null : null;
		if (Object.keys(data).length === 0) return res.status(400).json({ success: false, message: "Нечего изменять" });
		const item = await prisma.esfLicense.update({ where: { bin }, data });
		return res.json({ success: true, item });
	} catch (err) {
		if (err?.code === "P2025") return res.status(404).json({ success: false, message: "БИН не найден" });
		console.error("PATCH /esf-licenses error:", err);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// DELETE /api/v1/esf-licenses/:bin
adminRouter.delete("/esf-licenses/:bin", async (req, res) => {
	try {
		const bin = normBin(req.params.bin);
		if (!bin) return res.status(400).json({ success: false, message: "БИН обязателен" });
		await prisma.esfLicense.delete({ where: { bin } });
		return res.json({ success: true });
	} catch (err) {
		if (err?.code === "P2025") return res.status(404).json({ success: false, message: "БИН не найден" });
		console.error("DELETE /esf-licenses error:", err);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

export default { publicRouter, adminRouter };

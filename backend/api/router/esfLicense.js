// Лицензирование ЭСФ по БИН для 1С-расширения esf_exchange.
//
// ── publicRouter (/api1/esf-license/*) — БЕЗ авторизации, вызывает 1С ──────────
//   GET  /token?bin=            — токен, если лицензия активна (иначе 403);
//   POST /heartbeat             — телеметрия + ОТЗЫВ ({revoked:true} → клиент чистит кэш);
//   POST /activation-request    — заявка на подключение (создаёт запись active:false);
//   POST /verify                — проверка токена НА СЕРВЕРЕ (S-04; парная задача 1С T-13);
//   GET  /health                — для внешнего мониторинга (S-10).
//   Пути и формат токена — ЗАШИТЫЙ контракт 1С, менять нельзя.
//
// ── adminRouter (/api/v1/esf-licenses) — под общим authMiddleware + superadmin ──
//   CRUD для админ-панели «Лицензии ЭСФ» + установки (S-07) и журнал (S-06).
//
// Вся логика (подпись, решения, учёт установок, журнал) — в services/esfLicense.js.
import express from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { prisma } from "../../prisma/prisma-client.js";
import {
	DENY_MESSAGES,
	checkInstallLimit,
	countActiveInstalls,
	installActiveSince,
	installLimitEnforced,
	installLimitFor,
	isLicenseActive,
	issueToken,
	licenseDenyReason,
	logLicenseRequest,
	notifyActivationRequest,
	registerInstall,
	signingConfigured,
	tokenTtlHours,
	verifyTokenSignature,
} from "../../services/esfLicense.js";

/** Нормализованный БИН из тела/квери: непустая строка (обрезаем, ограничиваем длину). */
function normBin(v) {
	if (typeof v !== "string") return null;
	const b = v.trim();
	if (!b || b.length > 32) return null;
	return b;
}

/** installId — SHA256 строки соединения ИБ (не сама строка); режем по длине. */
function normInstallId(v) {
	return typeof v === "string" && v.trim() ? v.trim().slice(0, 128) : null;
}

const ipOf = (req) => req.ip || null;

// ─────────────────────────────────────────────────────────────────────────────
// ПУБЛИЧНЫЙ РОУТЕР (1С)
// ─────────────────────────────────────────────────────────────────────────────
export const publicRouter = express.Router();

// ── Ограничение частоты (S-08) ───────────────────────────────────────────────
// Клиент 1С шлёт heartbeat раз в час на БИН, а токен запрашивает только когда
// кэшированный истёк, — легитимная нагрузка на порядки ниже лимитов. 429 клиент
// трактует как «токена нет», то есть откатывается на кэш и не ломается.
// ВНИМАНИЕ: счётчики живут в памяти воркера, а pm2 поднимает 4 воркера
// (ecosystem.config.js) — фактический предел примерно вчетверо выше указанного.
// Для перебора БИНов этого достаточно; жёсткий общий лимит потребовал бы Redis.
function limiter({ max, keyPrefix, byBin = false }) {
	return rateLimit({
		windowMs: 60 * 1000,
		max,
		standardHeaders: true,
		legacyHeaders: false,
		keyGenerator: (req) => {
			const bin = byBin ? normBin(req.query?.bin ?? req.body?.bin) : null;
			return `${keyPrefix}:${bin ?? ipKeyGenerator(req.ip || "")}`;
		},
		handler: (req, res) => {
			logLicenseRequest({
				bin: normBin(req.query?.bin ?? req.body?.bin),
				installId: normInstallId(req.body?.installId),
				endpoint: req.path.replace(/^\//, "") || "unknown",
				result: "denied",
				reason: "rate_limited",
				status: 429,
				ip: ipOf(req),
			});
			res.status(429).json({ error: "rate_limited", message: "Слишком много запросов, повторите позже." });
		},
	});
}

const tokenIpLimiter = limiter({ max: 120, keyPrefix: "esf-token-ip" });
const tokenBinLimiter = limiter({ max: 20, keyPrefix: "esf-token-bin", byBin: true });
const writeIpLimiter = limiter({ max: 60, keyPrefix: "esf-write-ip" });
const writeBinLimiter = limiter({ max: 20, keyPrefix: "esf-write-bin", byBin: true });
const verifyIpLimiter = limiter({ max: 600, keyPrefix: "esf-verify-ip" });

// GET /api1/esf-license/token?bin=<БИН>
publicRouter.get("/token", tokenIpLimiter, tokenBinLimiter, async (req, res) => {
	const ip = ipOf(req);
	try {
		const bin = normBin(req.query.bin);
		if (!bin) {
			logLicenseRequest({ bin: null, endpoint: "token", result: "denied", reason: "bad_request", status: 400, ip });
			return res.status(400).json({ error: "bad_request", message: "Не указан БИН." });
		}
		if (!signingConfigured()) {
			// Секрет не настроен — токен подписать нечем; выдавать нельзя (1С отвергнет).
			console.error("[esf-license] LICENSE_TOKEN_SECRET / LICENSE_TOKEN_KEYS не заданы — токены не выдаются");
			logLicenseRequest({ bin, endpoint: "token", result: "error", reason: "misconfigured", status: 500, ip });
			return res.status(500).json({ error: "misconfigured", message: "Сервис лицензий не настроен." });
		}

		const lic = await prisma.esfLicense.findUnique({ where: { bin } });

		// S-01: отключённому/неизвестному/просроченному БИН — 403. Клиент трактует
		// любой не-200 как «действующего токена нет» и перестаёт создавать документы,
		// как только истечёт уже выданный токен (окно = TTL, см. S-03).
		const denyReason = licenseDenyReason(lic);
		if (denyReason) {
			logLicenseRequest({ bin, endpoint: "token", result: "denied", reason: denyReason, status: 403, ip });
			return res.status(403).json({ error: denyReason, message: DENY_MESSAGES[denyReason] });
		}

		// S-07: лимит установок. По умолчанию только считаем и помечаем в журнале;
		// отказ включается флагом LICENSE_INSTALL_LIMIT_ENFORCE=true.
		const installs = await checkInstallLimit(prisma, lic);
		if (installs.exceeded) {
			if (installs.enforced) {
				logLicenseRequest({ bin, endpoint: "token", result: "denied", reason: "install_limit", status: 403, ip });
				return res.status(403).json({ error: "install_limit", message: DENY_MESSAGES.install_limit });
			}
			console.warn(`[esf-license] БИН ${bin}: установок ${installs.count} при лимите ${installs.limit} (отказ отключён)`);
		}

		const token = issueToken(bin);
		logLicenseRequest({
			bin,
			endpoint: "token",
			result: "issued",
			reason: installs.exceeded ? "install_limit_exceeded" : null,
			status: 200,
			ip,
		});
		return res.status(200).json({ token });
	} catch (err) {
		console.error("GET /api1/esf-license/token error:", err);
		return res.status(500).json({ error: "server_error", message: "Ошибка сервера." });
	}
});

// POST /api1/esf-license/heartbeat  { bin, installId, time }
publicRouter.post("/heartbeat", writeIpLimiter, writeBinLimiter, async (req, res) => {
	const ip = ipOf(req);
	try {
		const bin = normBin(req.body?.bin);
		if (!bin) return res.status(400).json({ error: "bad_request", message: "Не указан БИН." });
		const installId = normInstallId(req.body?.installId);

		// Пишем heartbeat даже для неизвестного/неактивного БИН — это и есть сигнал
		// несанкционированного использования (кто-то обошёл проверку в копии расширения).
		const lic = await prisma.esfLicense.upsert({
			where: { bin },
			update: { lastHeartbeatAt: new Date(), lastHeartbeatInstallId: installId },
			create: { bin, active: false, lastHeartbeatAt: new Date(), lastHeartbeatInstallId: installId },
		});
		if (installId) await registerInstall(prisma, { bin, installId, ip });

		// S-02: отзыв. Клиент уже умеет обрабатывать revoked:true — чистит кэш токена
		// и отметку heartbeat, сразу идёт за новым токеном и получает 403 (S-01).
		const revoked = !isLicenseActive(lic);
		if (revoked) {
			console.warn(`[esf-license] heartbeat от НЕАКТИВНОГО БИН ${bin} (installId=${installId ?? "-"}) — отправлен revoked`);
		}
		logLicenseRequest({
			bin,
			installId,
			endpoint: "heartbeat",
			result: revoked ? "revoked" : "ok",
			reason: revoked ? licenseDenyReason(lic) : null,
			status: 200,
			ip,
		});
		return res.status(200).json(revoked ? { ok: true, revoked: true } : { ok: true });
	} catch (err) {
		console.error("POST /api1/esf-license/heartbeat error:", err);
		return res.status(500).json({ error: "server_error", message: "Ошибка сервера." });
	}
});

// POST /api1/esf-license/activation-request  { bin, installId }
publicRouter.post("/activation-request", writeIpLimiter, writeBinLimiter, async (req, res) => {
	const ip = ipOf(req);
	try {
		const bin = normBin(req.body?.bin);
		if (!bin) return res.status(400).json({ error: "bad_request", message: "Не указан БИН." });
		const installId = normInstallId(req.body?.installId);

		// Идемпотентно: есть — обновляем дату/счётчик (active НЕ трогаем, активация ручная);
		// нет — создаём заявку active:false. Повторная заявка не плодит записи (S-09).
		const existing = await prisma.esfLicense.findUnique({ where: { bin } });
		await prisma.esfLicense.upsert({
			where: { bin },
			update: { lastRequestAt: new Date(), lastRequestInstallId: installId, requestCount: { increment: 1 } },
			create: { bin, active: false, lastRequestAt: new Date(), lastRequestInstallId: installId, requestCount: 1 },
		});
		if (installId) await registerInstall(prisma, { bin, installId, ip });

		logLicenseRequest({ bin, installId, endpoint: "activation-request", result: "ok", reason: existing ? "repeat" : "new", status: 200, ip });
		void notifyActivationRequest({ bin, installId, isNew: !existing || existing.lastRequestAt == null });
		return res.status(200).json({ ok: true });
	} catch (err) {
		console.error("POST /api1/esf-license/activation-request error:", err);
		return res.status(500).json({ error: "server_error", message: "Ошибка сервера." });
	}
});

// ── S-04: проверка токена на сервере ─────────────────────────────────────────
// Нужна, чтобы секрет подписи исчез из кода расширения (парная задача 1С T-13:
// ТокенДействителен вызывает /verify вместо локальной проверки подписи).
// Вызывается перед операциями, поэтому состояние лицензии кэшируется в памяти.
// Цена кэша: отзыв доходит до /verify с задержкой до LICENSE_VERIFY_CACHE_SECONDS
// (админка сбрасывает кэш, но только в СВОЁМ воркере pm2 — остальные ждут TTL).
// Токен всё равно живёт часами, так что минута погоды не делает; кому нужен
// мгновенный отзыв — LICENSE_VERIFY_CACHE_SECONDS=0.
const VERIFY_CACHE = new Map();
function verifyCacheTtlMs() {
	const n = Number(process.env.LICENSE_VERIFY_CACHE_SECONDS);
	return (Number.isFinite(n) && n >= 0 ? n : 60) * 1000;
}
async function licenseForVerify(bin, now = Date.now()) {
	const ttl = verifyCacheTtlMs();
	const hit = VERIFY_CACHE.get(bin);
	if (ttl > 0 && hit && hit.until > now) return hit.lic;
	const lic = await prisma.esfLicense.findUnique({ where: { bin } });
	if (ttl > 0) {
		VERIFY_CACHE.set(bin, { lic, until: now + ttl });
		// Кэш маленький (число БИН), но подстрахуемся от неограниченного роста.
		if (VERIFY_CACHE.size > 5000) VERIFY_CACHE.clear();
	}
	return lic;
}
/** Сбросить кэш /verify (админка после смены статуса — чтобы отзыв действовал сразу). */
function dropVerifyCache(bin) {
	if (bin) VERIFY_CACHE.delete(bin);
	else VERIFY_CACHE.clear();
}

// POST /api1/esf-license/verify  { bin, token, installId }
publicRouter.post("/verify", verifyIpLimiter, async (req, res) => {
	const ip = ipOf(req);
	try {
		const bin = normBin(req.body?.bin);
		const token = typeof req.body?.token === "string" ? req.body.token : "";
		if (!bin || !token) return res.status(400).json({ error: "bad_request", message: "Нужны bin и token." });
		const installId = normInstallId(req.body?.installId);

		const sig = verifyTokenSignature(token, { bin });
		if (!sig.valid) {
			// malformed наружу не отличаем от signature — контракт 1С знает
			// expired|revoked|unknown|signature.
			const reason = sig.reason === "expired" ? "expired" : "signature";
			logLicenseRequest({ bin, installId, endpoint: "verify", result: "invalid", reason, status: 200, ip });
			return res.status(200).json({ valid: false, reason });
		}

		const lic = await licenseForVerify(bin);
		const deny = licenseDenyReason(lic);
		if (deny) {
			// unknown — БИН не зарегистрирован; inactive → revoked (отозван/приостановлен).
			const reason = deny === "inactive" ? "revoked" : deny;
			logLicenseRequest({ bin, installId, endpoint: "verify", result: "invalid", reason, status: 200, ip });
			return res.status(200).json({ valid: false, reason });
		}

		// Журналировать КАЖДУЮ успешную проверку нельзя (вызывается перед операциями) —
		// пишем только отказы; успешная работа видна по heartbeat и выдаче токенов.
		return res.status(200).json({ valid: true, expiresAt: sig.expiresAtUnix });
	} catch (err) {
		console.error("POST /api1/esf-license/verify error:", err);
		return res.status(500).json({ error: "server_error", message: "Ошибка сервера." });
	}
});

// GET /api1/esf-license/health — внешний мониторинг (S-10): проверяет и БД,
// без которой отзыв и отказ не работают. Данных не отдаёт.
publicRouter.get("/health", async (_req, res) => {
	try {
		await prisma.$queryRaw`SELECT 1`;
		return res.status(200).json({ ok: true, signing: signingConfigured(), tokenTtlHours: tokenTtlHours(), at: new Date().toISOString() });
	} catch (err) {
		console.error("GET /api1/esf-license/health error:", err);
		return res.status(503).json({ ok: false });
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

// Записи имеют штатные id (PK) + uuid (unique). Админка (ModelList/useFormStore)
// ключует по uuid; `:id` принимает числовой id ИЛИ uuid. Публичные /api1/* — по bin.
const whereById = (p) => {
	const n = Number(p);
	return !isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: String(p) };
};

/** Лицензия по параметру маршрута (или null). */
async function findLicense(param) {
	return prisma.esfLicense.findUnique({ where: whereById(param) });
}

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

		// Число живых установок на строку (S-07) — одним запросом на страницу.
		const bins = items.map((i) => i.bin);
		const grouped = bins.length
			? await prisma.esfLicenseInstall.groupBy({
				by: ["bin"],
				where: { bin: { in: bins }, releasedAt: null, lastSeenAt: { gte: installActiveSince() } },
				_count: { _all: true },
			})
			: [];
		const counts = new Map(grouped.map((g) => [g.bin, g._count._all]));
		const rows = items.map((i) => ({ ...i, installsActive: counts.get(i.bin) ?? 0, installLimitEffective: installLimitFor(i) }));

		return res.json({ success: true, items: rows, total });
	} catch (err) {
		console.error("GET /esf-licenses error:", err);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// GET /api/v1/esf-licenses/:id  (id = uuid | числовой id) — загрузка формы
adminRouter.get("/esf-licenses/:id", async (req, res) => {
	try {
		const item = await findLicense(req.params.id);
		if (!item) return res.status(404).json({ success: false, message: "Не найдено" });
		const installsActive = await countActiveInstalls(prisma, item.bin);
		return res.json({
			success: true,
			item: { ...item, installsActive, installLimitEffective: installLimitFor(item), installLimitEnforced: installLimitEnforced() },
		});
	} catch (err) {
		console.error("GET /esf-licenses/:id error:", err);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// POST /api/v1/esf-licenses  { bin, note?, active?, expiresAt?, installLimit? } — ручное добавление
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
				installLimit: Number(req.body?.installLimit) > 0 ? Math.floor(Number(req.body.installLimit)) : null,
			},
		});
		dropVerifyCache(bin);
		return res.status(201).json({ success: true, item });
	} catch (err) {
		console.error("POST /esf-licenses error:", err);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// PUT /api/v1/esf-licenses/:id  (id = uuid | id) { note?, active?, expiresAt?, installLimit? }
// БИН — бизнес-ключ, здесь не меняется (правится удалением+созданием).
adminRouter.put("/esf-licenses/:id", async (req, res) => {
	try {
		const data = {};
		if ("active" in (req.body ?? {})) data.active = req.body.active === true;
		if ("expiresAt" in (req.body ?? {})) data.expiresAt = req.body.expiresAt ? new Date(req.body.expiresAt) : null;
		if ("note" in (req.body ?? {})) data.note = typeof req.body.note === "string" ? req.body.note.trim() || null : null;
		if ("installLimit" in (req.body ?? {})) data.installLimit = Number(req.body.installLimit) > 0 ? Math.floor(Number(req.body.installLimit)) : null;
		const item = await prisma.esfLicense.update({ where: whereById(req.params.id), data });
		// Отзыв должен действовать сразу — сбрасываем кэш /verify по этому БИН.
		dropVerifyCache(item.bin);
		return res.json({ success: true, item });
	} catch (err) {
		if (err?.code === "P2025") return res.status(404).json({ success: false, message: "Не найдено" });
		console.error("PUT /esf-licenses/:id error:", err);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// DELETE /api/v1/esf-licenses/:id  (id = uuid | id)
adminRouter.delete("/esf-licenses/:id", async (req, res) => {
	try {
		const item = await prisma.esfLicense.delete({ where: whereById(req.params.id) });
		dropVerifyCache(item.bin);
		return res.json({ success: true });
	} catch (err) {
		if (err?.code === "P2025") return res.status(404).json({ success: false, message: "Не найдено" });
		console.error("DELETE /esf-licenses/:id error:", err);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// POST /api/v1/esf-licenses/batch-delete  { uuids: [<uuid>, …] }
adminRouter.post("/esf-licenses/batch-delete", async (req, res) => {
	try {
		const uuids = Array.isArray(req.body?.uuids) ? req.body.uuids.filter((x) => typeof x === "string" && x) : [];
		if (uuids.length) await prisma.esfLicense.deleteMany({ where: { uuid: { in: uuids } } });
		dropVerifyCache();
		return res.json({ success: true, failed: [] });
	} catch (err) {
		console.error("POST /esf-licenses/batch-delete error:", err);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── Установки (S-07) ─────────────────────────────────────────────────────────

// GET /api/v1/esf-licenses/:id/installs — базы 1С этого БИН
adminRouter.get("/esf-licenses/:id/installs", async (req, res) => {
	try {
		const lic = await findLicense(req.params.id);
		if (!lic) return res.status(404).json({ success: false, message: "Не найдено" });
		const since = installActiveSince();
		const items = await prisma.esfLicenseInstall.findMany({
			where: { bin: lic.bin },
			orderBy: [{ releasedAt: { sort: "asc", nulls: "first" } }, { lastSeenAt: "desc" }],
			take: 500,
		});
		const rows = items.map((i) => ({
			...i,
			// Живая = не отвязана и есть свежий heartbeat; только такие считаются в лимит.
			isActive: i.releasedAt == null && new Date(i.lastSeenAt) >= since,
			status: i.releasedAt != null ? "released" : new Date(i.lastSeenAt) >= since ? "active" : "stale",
		}));
		return res.json({
			success: true,
			items: rows,
			total: rows.length,
			activeCount: rows.filter((r) => r.isActive).length,
			limit: installLimitFor(lic),
			enforced: installLimitEnforced(),
		});
	} catch (err) {
		console.error("GET /esf-licenses/:id/installs error:", err);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// DELETE /api/v1/esf-licenses/:id/installs/:installUuid — отвязать установку
// (перенос базы на другой сервер). Если база снова обратится — установка
// зарегистрируется заново: отвязка не блокирует, а освобождает место в лимите.
adminRouter.delete("/esf-licenses/:id/installs/:installUuid", async (req, res) => {
	try {
		const lic = await findLicense(req.params.id);
		if (!lic) return res.status(404).json({ success: false, message: "Не найдено" });
		const inst = await prisma.esfLicenseInstall.findUnique({ where: { uuid: String(req.params.installUuid) } });
		if (!inst || inst.bin !== lic.bin) return res.status(404).json({ success: false, message: "Установка не найдена" });
		const item = await prisma.esfLicenseInstall.update({ where: { uuid: inst.uuid }, data: { releasedAt: new Date() } });
		return res.json({ success: true, item });
	} catch (err) {
		console.error("DELETE /esf-licenses/:id/installs/:installUuid error:", err);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── Журнал обращений (S-06) ──────────────────────────────────────────────────

// GET /api/v1/esf-licenses/:id/logs?limit=&offset=&endpoint=&result=
adminRouter.get("/esf-licenses/:id/logs", async (req, res) => {
	try {
		const lic = await findLicense(req.params.id);
		if (!lic) return res.status(404).json({ success: false, message: "Не найдено" });
		const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 1000);
		const offset = Math.max(Number(req.query.offset) || 0, 0);
		const where = { bin: lic.bin };
		if (typeof req.query.endpoint === "string" && req.query.endpoint) where.endpoint = req.query.endpoint;
		if (typeof req.query.result === "string" && req.query.result) where.result = req.query.result;

		const [items, total] = await Promise.all([
			prisma.esfLicenseLog.findMany({ where, orderBy: { createdAt: "desc" }, take: limit, skip: offset }),
			prisma.esfLicenseLog.count({ where }),
		]);
		return res.json({ success: true, items, total });
	} catch (err) {
		console.error("GET /esf-licenses/:id/logs error:", err);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

export default { publicRouter, adminRouter };

// Юнит-тесты лицензирования ЭСФ (services/esfLicense.js) — без БД, на мок-клиенте.
//
// Контракт с 1С: токен "<БИН>|<expUnix>|<подпись>"; подпись старой схемы —
// base64(sha256("<secret>|<bin>|<exp>|<secret>")); HMAC-вариант добавляет "|<kid>".
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
	DEFAULT_TOKEN_TTL_HOURS,
	checkInstallLimit,
	countActiveInstalls,
	installLimitFor,
	isLicenseActive,
	issueToken,
	licenseDenyReason,
	logLicenseRequest,
	parseToken,
	pruneLicenseLog,
	registerInstall,
	signHmac,
	signLegacy,
	signingConfigured,
	tokenTtlHours,
	verifyTokenSignature,
	_resetLogPruneThrottle,
} from "../services/esfLicense.js";

const ENV_KEYS = [
	"LICENSE_TOKEN_SECRET", "LICENSE_TOKEN_KEYS", "LICENSE_TOKEN_ACTIVE_KID", "LICENSE_TOKEN_TTL_HOURS",
	"LICENSE_INSTALL_LIMIT", "LICENSE_INSTALL_LIMIT_ENFORCE", "LICENSE_INSTALL_STALE_DAYS", "LICENSE_LOG_RETENTION_DAYS",
];
beforeEach(() => {
	for (const k of ENV_KEYS) delete process.env[k];
	_resetLogPruneThrottle();
});

// ── Подпись и формат токена (зашитый контракт 1С) ────────────────────────────

test("issueToken: старая схема — формат и подпись, которые проверяет 1С", () => {
	process.env.LICENSE_TOKEN_SECRET = "s3cret";
	const now = 1_700_000_000_000;
	const token = issueToken("123456789012", { now, ttlHours: 4 });
	const [bin, exp, sig, kid] = token.split("|");
	assert.equal(bin, "123456789012");
	assert.equal(Number(exp), Math.floor(now / 1000) + 4 * 3600);
	assert.equal(kid, undefined, "без активного kid четвёртого сегмента быть не должно");
	// Ровно та конструкция, что зашита в 1С: sha256(secret|bin|exp|secret) → base64.
	const expected = crypto.createHash("sha256").update(`s3cret|123456789012|${exp}|s3cret`, "utf-8").digest("base64");
	assert.equal(sig, expected);
	assert.equal(sig, signLegacy(`123456789012|${exp}`, "s3cret"));
});

test("tokenTtlHours: дефолт 4 часа, диапазон 1..168", () => {
	assert.equal(tokenTtlHours(), DEFAULT_TOKEN_TTL_HOURS);
	assert.equal(DEFAULT_TOKEN_TTL_HOURS, 4);
	process.env.LICENSE_TOKEN_TTL_HOURS = "0.5";
	assert.equal(tokenTtlHours(), 1);
	process.env.LICENSE_TOKEN_TTL_HOURS = "1000";
	assert.equal(tokenTtlHours(), 168);
	process.env.LICENSE_TOKEN_TTL_HOURS = "мусор";
	assert.equal(tokenTtlHours(), DEFAULT_TOKEN_TTL_HOURS);
});

test("issueToken: с активным kid подписывает HMAC и добавляет kid четвёртым сегментом", () => {
	process.env.LICENSE_TOKEN_SECRET = "s3cret";
	process.env.LICENSE_TOKEN_KEYS = JSON.stringify({ k2: "hmac-key" });
	process.env.LICENSE_TOKEN_ACTIVE_KID = "k2";
	const token = issueToken("123", { now: 1_700_000_000_000, ttlHours: 1 });
	const parts = token.split("|");
	assert.equal(parts.length, 4);
	assert.equal(parts[3], "k2");
	assert.equal(parts[2], signHmac(`123|${parts[1]}`, "hmac-key"));
});

test("activeKid игнорируется, если ключа с таким kid нет (подписываем старой схемой)", () => {
	process.env.LICENSE_TOKEN_SECRET = "s3cret";
	process.env.LICENSE_TOKEN_ACTIVE_KID = "нет-такого";
	assert.equal(issueToken("123", { ttlHours: 1 }).split("|").length, 3);
});

test("signingConfigured: без секрета и без ключей подписывать нечем", () => {
	assert.equal(signingConfigured(), false);
	process.env.LICENSE_TOKEN_SECRET = "x";
	assert.equal(signingConfigured(), true);
});

test("parseToken: принимает 3 и 4 сегмента, отвергает мусор", () => {
	assert.deepEqual(parseToken("123|1700000000|sig"), { bin: "123", expiresAtUnix: 1700000000, signature: "sig", kid: "" });
	assert.equal(parseToken("123|1700000000|sig|k2").kid, "k2");
	assert.equal(parseToken("123|abc|sig"), null);
	assert.equal(parseToken("123|1700000000"), null);
	assert.equal(parseToken(null), null);
});

// ── Проверка токена на сервере (S-04) ────────────────────────────────────────

test("verifyTokenSignature: валидный токен старой схемы", () => {
	process.env.LICENSE_TOKEN_SECRET = "s3cret";
	const now = Date.now();
	const token = issueToken("123", { now, ttlHours: 4 });
	const r = verifyTokenSignature(token, { now, bin: "123" });
	assert.equal(r.valid, true);
	assert.equal(r.bin, "123");
});

test("verifyTokenSignature: чужой секрет → signature, чужой БИН → signature", () => {
	process.env.LICENSE_TOKEN_SECRET = "s3cret";
	const now = Date.now();
	const token = issueToken("123", { now, ttlHours: 4 });
	process.env.LICENSE_TOKEN_SECRET = "другой";
	assert.deepEqual(verifyTokenSignature(token, { now }), { valid: false, reason: "signature" });
	process.env.LICENSE_TOKEN_SECRET = "s3cret";
	assert.deepEqual(verifyTokenSignature(token, { now, bin: "999" }), { valid: false, reason: "signature" });
});

test("verifyTokenSignature: истёкший токен → expired (подпись при этом верна)", () => {
	process.env.LICENSE_TOKEN_SECRET = "s3cret";
	const now = Date.now();
	const token = issueToken("123", { now, ttlHours: 1 });
	const r = verifyTokenSignature(token, { now: now + 2 * 3600 * 1000, bin: "123" });
	assert.equal(r.valid, false);
	assert.equal(r.reason, "expired");
});

test("verifyTokenSignature: HMAC-токен проверяется ключом по kid; неизвестный kid → signature", () => {
	process.env.LICENSE_TOKEN_KEYS = JSON.stringify({ k2: "hmac-key" });
	process.env.LICENSE_TOKEN_ACTIVE_KID = "k2";
	const now = Date.now();
	const token = issueToken("123", { now, ttlHours: 4 });
	assert.equal(verifyTokenSignature(token, { now, bin: "123" }).valid, true);
	// Ротация: ключ убрали из реестра — старые токены с этим kid больше не проходят.
	process.env.LICENSE_TOKEN_KEYS = JSON.stringify({ k3: "next-key" });
	assert.deepEqual(verifyTokenSignature(token, { now, bin: "123" }), { valid: false, reason: "signature" });
});

test("verifyTokenSignature: мусор → malformed", () => {
	process.env.LICENSE_TOKEN_SECRET = "s3cret";
	assert.deepEqual(verifyTokenSignature("не токен", {}), { valid: false, reason: "malformed" });
});

// ── Решение о выдаче (S-01) ──────────────────────────────────────────────────

test("licenseDenyReason: unknown / inactive / expired / действует", () => {
	const now = new Date("2026-08-28T10:00:00Z");
	assert.equal(licenseDenyReason(null, now), "unknown");
	assert.equal(licenseDenyReason({ active: false }, now), "inactive");
	assert.equal(licenseDenyReason({ active: true, expiresAt: new Date("2026-08-01") }, now), "expired");
	assert.equal(licenseDenyReason({ active: true, expiresAt: null }, now), null);
	assert.equal(licenseDenyReason({ active: true, expiresAt: new Date("2026-09-01") }, now), null);
	assert.equal(isLicenseActive({ active: true, expiresAt: null }, now), true);
	assert.equal(isLicenseActive({ active: false }, now), false);
});

// ── Установки (S-07) ─────────────────────────────────────────────────────────

function installsMock({ count = 0 } = {}) {
	const calls = { upsert: [], count: [] };
	return {
		calls,
		client: {
			esfLicenseInstall: {
				upsert: async (args) => { calls.upsert.push(args); return { uuid: "i1", ...args.create }; },
				count: async (args) => { calls.count.push(args); return count; },
			},
		},
	};
}

test("registerInstall: upsert по (bin, installId), снимает отвязку при новом обращении", async () => {
	const { client, calls } = installsMock();
	await registerInstall(client, { bin: "123", installId: "hash1", ip: "10.0.0.1" });
	assert.deepEqual(calls.upsert[0].where, { bin_installId: { bin: "123", installId: "hash1" } });
	assert.equal(calls.upsert[0].update.releasedAt, null);
	assert.equal(calls.upsert[0].update.lastIp, "10.0.0.1");
});

test("registerInstall: без installId ничего не пишет", async () => {
	const { client, calls } = installsMock();
	assert.equal(await registerInstall(client, { bin: "123", installId: null }), null);
	assert.equal(calls.upsert.length, 0);
});

test("countActiveInstalls: считает только не отвязанные и свежие", async () => {
	process.env.LICENSE_INSTALL_STALE_DAYS = "30";
	const { client, calls } = installsMock({ count: 3 });
	assert.equal(await countActiveInstalls(client, "123"), 3);
	const w = calls.count[0].where;
	assert.equal(w.bin, "123");
	assert.equal(w.releasedAt, null);
	assert.ok(w.lastSeenAt.gte instanceof Date);
});

test("installLimitFor: персональный лимит лицензии важнее общего", () => {
	assert.equal(installLimitFor({}), 2);
	process.env.LICENSE_INSTALL_LIMIT = "5";
	assert.equal(installLimitFor({}), 5);
	assert.equal(installLimitFor({ installLimit: 1 }), 1);
});

test("checkInstallLimit: превышение видно, но отказ только при LICENSE_INSTALL_LIMIT_ENFORCE=true", async () => {
	process.env.LICENSE_INSTALL_LIMIT = "2";
	const { client } = installsMock({ count: 3 });
	let r = await checkInstallLimit(client, { bin: "123" });
	assert.deepEqual({ count: r.count, limit: r.limit, exceeded: r.exceeded, enforced: r.enforced }, { count: 3, limit: 2, exceeded: true, enforced: false });
	process.env.LICENSE_INSTALL_LIMIT_ENFORCE = "true";
	r = await checkInstallLimit(client, { bin: "123" });
	assert.equal(r.enforced, true);
});

// ── Журнал (S-06) ────────────────────────────────────────────────────────────

function logMock({ failCreate = false } = {}) {
	const calls = { create: [], deleteMany: [] };
	return {
		calls,
		client: {
			esfLicenseLog: {
				create: async (args) => { calls.create.push(args.data); if (failCreate) throw new Error("db down"); return args.data; },
				deleteMany: async (args) => { calls.deleteMany.push(args); return { count: 7 }; },
			},
		},
	};
}

test("logLicenseRequest: пишет строку журнала и не бросает при ошибке БД", async () => {
	const ok = logMock();
	await logLicenseRequest({ bin: "123", installId: "h1", endpoint: "token", result: "denied", reason: "inactive", status: 403, ip: "10.0.0.1" }, ok.client);
	assert.deepEqual(ok.calls.create[0], { bin: "123", installId: "h1", endpoint: "token", result: "denied", reason: "inactive", status: 403, ip: "10.0.0.1" });

	const bad = logMock({ failCreate: true });
	await logLicenseRequest({ bin: "123", endpoint: "token", result: "issued", status: 200 }, bad.client); // не должно бросить
});

test("pruneLicenseLog: удаляет по границе; days<=0 — чистка отключена", async () => {
	const { client, calls } = logMock();
	const res = await pruneLicenseLog(180, client);
	assert.equal(res.deleted, 7);
	assert.ok(calls.deleteMany[0].where.createdAt.lt instanceof Date);
	assert.deepEqual(await pruneLicenseLog(0, client), { deleted: 0, skipped: true });
});

// Регистрация базы 1С без токена (СВ4, docs/CONTRACT_BASE_REGISTRATION_2026-09-19.md, часть 1).
//
//   POST /v1/onec-chat/register                   заявка: код, секрет опроса, срок
//   GET  /v1/onec-chat/register/:registrationId   решение; токен — один раз, при первом опросе после одобрения
//
// Монтируется ДО onecChatRouter: у базы, которая подаёт заявку, токена ещё нет. Секрет опроса и токен в журнал не
// пишутся; в аудит — только код, база и решение.

import { Router, type Request, type RequestHandler } from "express";
import { z } from "zod";
import type { Db } from "../db/pool.ts";
import type { Logger } from "../logger.ts";
import type { Audit } from "../audit/index.ts";
import type { BaseTokenStore } from "../bases/tokens.ts";
import type { RegistrationRow, RegistrationStore } from "../bases/registrations.ts";
import { rateLimit } from "./rateLimit.ts";

const text = (max: number) => z.string().trim().max(max);

export const registrationSchema = z.object({
	base: z.object({
		id: text(100).min(1),
		name: text(200).min(1),
		kind: z.enum(["server", "file"]).optional(),
		server: text(200).nullable().optional(),
		configuration: z.object({ name: text(200).optional(), synonym: text(300).optional(), version: text(50).optional() }).nullable().optional(),
		platform: text(50).nullable().optional(),
		extensionVersion: text(50).nullable().optional(),
		computer: text(200).nullable().optional(),
	}),
	organizations: z.array(z.object({ id: text(100).nullable().optional(), name: text(300).nullable().optional(), bin: text(20).nullable().optional() })).max(200).default([]),
	user: z.object({ id: text(100).nullable().optional(), name: text(200).nullable().optional() }).nullable().optional(),
	contact: text(500).nullable().optional(),
	comment: text(2000).nullable().optional(),
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Сколько ждать форме до следующего опроса. */
const POLL_AFTER_SECS = 10;

export function baseRegistrationRouter(deps: {
	registrations: RegistrationStore;
	tokens: Pick<BaseTokenStore, "issue" | "revoke">;
	erp: Db;
	audit: Pick<Audit, "write">;
	log: Logger;
	/** Заявок в час с одного адреса и с одной базы (контракт: 5). */
	perHour?: number;
}) {
	const { registrations, tokens, erp, audit, log } = deps;
	const perHour = deps.perHour ?? 5;
	const r = Router();

	// Два лимита, а не один: база за NAT делит адрес с соседями, а одна база может ходить с разных адресов.
	const hour = 60 * 60_000;
	const byIp = rateLimit({ max: perHour, windowMs: hour, key: (req: Request) => `reg-ip:${req.ip ?? "?"}`, message: "Слишком много заявок с этого адреса — повторите через час" });
	const byBase = rateLimit({
		max: perHour, windowMs: hour,
		key: (req: Request) => `reg-base:${String((req.body as { base?: { id?: unknown } } | undefined)?.base?.id ?? "?")}`,
		message: "Слишком много заявок от этой базы — повторите через час",
	});

	// Express 4 не ловит отказы промисов: сбой БД иначе оставил бы форму 1С ждать ответа до своего предела.
	const safe = (h: RequestHandler): RequestHandler => (req, res, next) => {
		Promise.resolve(h(req, res, next)).catch((e: unknown) => {
			log.error({ err: e instanceof Error ? e.message : String(e), path: req.path }, "регистрация базы: сбой");
			if (!res.headersSent) res.status(500).json({ success: false, error: { code: "INTERNAL", message: "Внутренняя ошибка сервиса — повторите позже" } });
		});
	};

	r.post("/register", byIp, byBase, safe(async (req, res) => {
		const p = registrationSchema.safeParse(req.body);
		if (!p.success) {
			const issue = p.error.issues[0];
			res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: `Некорректная заявка: ${issue ? `${issue.path.join(".") || "тело"} — ${issue.message}` : "тело запроса"}` } });
			return;
		}
		const { row, secret, repeated } = await registrations.submit(p.data, req.ip ?? null);
		await audit.write({
			event: repeated ? "base.registration.repeated" : "base.registration.created",
			details: { registrationId: row.id, code: row.code, base: row.baseName, onecBaseId: row.onecBaseId, bins: p.data.organizations.map((o) => o.bin).filter(Boolean), ip: req.ip ?? null },
		});
		log.info({ registrationId: row.id, code: row.code, base: row.baseName, repeated }, "заявка на подключение базы 1С");
		res.json({ success: true, data: {
			registrationId: row.id, code: row.code, pollSecret: secret, expiresAt: row.expiresAt.toISOString(), pollAfterSecs: POLL_AFTER_SECS,
		} });
	}));

	r.get("/register/:id", safe(async (req, res) => {
		const secret = String(req.headers["x-registration-secret"] ?? "").trim();
		const notFound = () => res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Заявка не найдена" } });
		const id = String(req.params.id);
		if (!UUID_RE.test(id) || !secret) { notFound(); return; }
		// Неверный секрет — тот же 404: не выдавать, что заявка с таким id есть.
		const row = await registrations.bySecret(id, secret);
		if (!row) { notFound(); return; }

		const data: Record<string, unknown> = { state: row.state, code: row.code, note: row.note ?? null };
		if (row.state === "APPROVED") {
			data.base = { key: row.baseKey, name: row.baseName };
			data.organization = { uuid: row.organizationUuid, name: await orgName(erp, log, row.organizationUuid) };
			const token = await deliverToken(row);
			if (token) data.token = token;
		}
		res.json({ success: true, data });
	}));

	/**
	 * Токен — в момент первой выдачи и ровно один раз. Прежние токены этой базы 1С отзываются: заявку заново подают,
	 * когда своего токена у базы нет, и старый иначе остался бы действующим и ничьим.
	 */
	async function deliverToken(row: RegistrationRow): Promise<string | null> {
		if (row.tokenDeliveredAt || !row.baseId || !row.organizationUuid) return null;
		if (!(await registrations.claimDelivery(row.id))) return null;
		try {
			const t = await tokens.issue({ baseId: row.baseId, organizationUuid: row.organizationUuid, createdBy: `заявка ${row.code} (одобрил ${row.decidedBy ?? "?"})` });
			await registrations.setToken(row.id, t.id);
			const previous = await registrations.previousTokens(row.onecBaseId, row.id);
			for (const id of previous) await tokens.revoke(id, `новая заявка ${row.code}`);
			await audit.write({
				event: "base.registration.token_delivered", organizationUuid: row.organizationUuid,
				details: { registrationId: row.id, code: row.code, baseKey: row.baseKey, tokenId: t.id, revokedPrevious: previous.length },
			});
			return t.token;
		} catch (e) {
			await registrations.releaseDelivery(row.id);
			throw e;
		}
	}

	return r;
}

/** Имя организации ERP для ответа; не прочиталось — null, заявке это не мешает. */
async function orgName(erp: Db, log: Logger, uuid: string | null): Promise<string | null> {
	if (!uuid) return null;
	try {
		const o = await erp.query<{ name: string | null; legal_name: string | null }>(`SELECT name, "legalName" AS legal_name FROM organizations WHERE uuid = $1`, [uuid]);
		return o.rows[0]?.name ?? o.rows[0]?.legal_name ?? null;
	} catch (e) {
		log.warn({ err: e instanceof Error ? e.message : String(e) }, "регистрация базы: не прочитана организация ERP");
		return null;
	}
}

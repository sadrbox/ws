// Подключение агента по коду без токена (СВ5, docs/CONTRACT_AGENT_ENROLLMENT_2026-09-19.md).
//
//   POST /agent/v1/enroll                  заявка: код, секрет опроса, срок
//   GET  /agent/v1/enroll/:enrollmentId    решение; идентификатор и токен — один раз, при первом опросе после одобрения
//
// Монтируется ДО agentRouter: у агента, который просит подключение, токена ещё нет. Секрет опроса и токен в журнал
// не пишутся.

import { Router, type Request, type RequestHandler } from "express";
import { safeRouter } from "./safeRouter.ts";
import { z } from "zod";
import type { Logger } from "../logger.ts";
import type { Audit } from "../audit/index.ts";
import type { AgentService } from "../agents/service.ts";
import type { EnrollmentRow, EnrollmentStore } from "../agents/enrollments.ts";
import { rateLimit } from "./rateLimit.ts";

const text = (max: number) => z.string().trim().max(max);

export const enrollSchema = z.object({
	name: text(200).min(1),
	role: z.enum(["business", "admin"]),
	serverName: text(200).nullable().optional(),
	serviceName: text(200).min(1),
	computer: text(200).min(1),
	version: text(100).nullable().optional(),
	/**
	 * Секрет опроса прежней заявки (Б11 аудита 26.09): повтор с ним обновляет ТУ ЖЕ заявку и код, без него —
	 * новая заявка с новым кодом. Можно прислать и заголовком `X-Enrollment-Secret`, как при опросе.
	 */
	pollSecret: text(200).nullable().optional(),
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POLL_AFTER_SECS = 5;

export function agentEnrollRouter(deps: {
	enrollments: EnrollmentStore;
	agents: Pick<AgentService, "rotateToken">;
	audit: Pick<Audit, "write">;
	log: Logger;
	/** Заявок в час с одного адреса (контракт: 5). */
	perHour?: number;
}) {
	const { enrollments, agents, audit, log } = deps;
	const r = Router();
	// Отказ промиса в любом обработчике, включая `r.use`, — ответ 500, а не повисший запрос (Н1 аудита 26.09).
	safeRouter(r, log, "подключение агента");
	const byIp = rateLimit({
		max: deps.perHour ?? 5, windowMs: 60 * 60_000, key: (req: Request) => `enroll-ip:${req.ip ?? "?"}`,
		message: "Слишком много заявок на подключение с этого адреса — повторите через час",
	});
	const safe = (h: RequestHandler): RequestHandler => (req, res, next) => {
		Promise.resolve(h(req, res, next)).catch((e: unknown) => {
			log.error({ err: e instanceof Error ? e.message : String(e), path: req.path }, "подключение агента: сбой");
			if (!res.headersSent) res.status(500).json({ success: false, error: { code: "INTERNAL", message: "Внутренняя ошибка сервиса — повторите позже" } });
		});
	};

	r.post("/enroll", byIp, safe(async (req, res) => {
		const p = enrollSchema.safeParse(req.body);
		if (!p.success) {
			const issue = p.error.issues[0];
			res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: `Некорректная заявка: ${issue ? `${issue.path.join(".") || "тело"} — ${issue.message}` : "тело запроса"}` } });
			return;
		}
		const presented = String(req.headers["x-enrollment-secret"] ?? "").trim() || p.data.pollSecret || null;
		const { pollSecret: _presented, ...input } = p.data;
		const { row, secret, repeated } = await enrollments.submit(input, req.ip ?? null, presented);
		await audit.write({
			event: repeated ? "agent.enrollment.repeated" : "agent.enrollment.created",
			details: { enrollmentId: row.id, code: row.code, name: row.name, role: row.role, computer: row.computer, serviceName: row.serviceName, ip: req.ip ?? null },
		});
		log.info({ enrollmentId: row.id, code: row.code, computer: row.computer, role: row.role, repeated }, "заявка на подключение агента");
		res.json({ success: true, data: {
			enrollmentId: row.id, code: row.code, pollSecret: secret, expiresAt: row.expiresAt.toISOString(), pollAfterSecs: POLL_AFTER_SECS,
		} });
	}));

	r.get("/enroll/:id", safe(async (req, res) => {
		const secret = String(req.headers["x-enrollment-secret"] ?? "").trim();
		const id = String(req.params.id);
		const notFound = () => res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Заявка не найдена" } });
		if (!UUID_RE.test(id) || !secret) { notFound(); return; }
		const row = await enrollments.bySecret(id, secret);
		if (!row) { notFound(); return; }
		const data: Record<string, unknown> = { state: row.state, code: row.code, note: row.note ?? null };
		if (row.state === "APPROVED") {
			const token = await deliver(row);
			if (token) { data.agentId = row.agentId; data.token = token; }
		}
		res.json({ success: true, data });
	}));

	/**
	 * Идентификатор и токен — один раз. Токен выпускается здесь (rotate-token): прежний токен этого агента — не
	 * забранный при прошлой заявке или от переустановленной службы — перестаёт действовать.
	 */
	async function deliver(row: EnrollmentRow): Promise<string | null> {
		if (row.tokenDeliveredAt || !row.agentId) return null;
		if (!(await enrollments.claimDelivery(row.id))) return null;
		try {
			const token = await agents.rotateToken(row.agentId);
			if (!token) throw new Error("агент заявки не найден");
			await audit.write({ event: "agent.enrollment.token_delivered", agentId: row.agentId,
				details: { enrollmentId: row.id, code: row.code } });
			return token;
		} catch (e) {
			await enrollments.releaseDelivery(row.id);
			throw e;
		}
	}

	return r;
}

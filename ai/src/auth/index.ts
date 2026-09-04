// Три вида субъектов и три способа их проверить.
//
//   администратор — заголовок X-Admin-Key: регистрация агентов, служебные вызовы;
//   агент         — Authorization: Bearer <agent token> + X-Agent-Id;
//   пользователь  — Authorization: Bearer <JWT ERP>: тот же JWT_SECRET, что у бэкенда.
//
// Пользователь ERP проверяется в два шага: подпись JWT даёт uuid, а активная организация и
// список доступных читаются из базы ERP при КАЖДОМ запросе — как это делает tenantMiddleware
// бэкенда. Кэшировать нельзя: отзыв доступа должен действовать сразу.

import { createHash, timingSafeEqual, randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";
import type { Db } from "../db/pool.ts";

export type ErpUser = {
	uuid: string;
	isSuperAdmin: boolean;
	organizationUuid: string | null;
	allowedOrgUuids: string[];
	isOrgAdmin: boolean;
	/**
	 * Право «Администрирование 1С» (AccessPermission.modelName = 'OneCAdmin') хотя бы в
	 * одной организации. Сервер 1С один на всю установку и организации ERP не принадлежит,
	 * поэтому доступ к нему даёт именно право, а не совпадение активной организации.
	 */
	canOnecAdmin: boolean;
};

export type AgentIdentity = { agentId: string; organizationUuid: string };

// Расширяем Request типами субъектов — без any.
declare module "express-serve-static-core" {
	interface Request {
		erpUser?: ErpUser;
		agent?: AgentIdentity;
	}
}

export function sha256(value: string): string {
	return createHash("sha256").update(value, "utf8").digest("hex");
}

export function newToken(): string {
	return "bpa_" + randomBytes(32).toString("base64url");
}

function safeEqual(a: string, b: string): boolean {
	const ab = Buffer.from(a);
	const bb = Buffer.from(b);
	return ab.length === bb.length && timingSafeEqual(ab, bb);
}

function bearer(req: Request): string | null {
	const h = req.headers.authorization;
	if (!h || !h.toLowerCase().startsWith("bearer ")) return null;
	const t = h.slice(7).trim();
	return t.length ? t : null;
}

function deny(res: Response, status: number, code: string, message: string): void {
	res.status(status).json({ success: false, error: { code, message } });
}

// ── Администратор ────────────────────────────────────────────────────────

export function requireAdmin(adminKey: string) {
	return (req: Request, res: Response, next: NextFunction): void => {
		const given = String(req.headers["x-admin-key"] ?? "");
		if (!given || !safeEqual(given, adminKey)) {
			deny(res, 401, "NOT_AUTHORIZED", "Требуется X-Admin-Key");
			return;
		}
		next();
	};
}

// ── Агент ────────────────────────────────────────────────────────────────

export function requireAgent(db: Db) {
	return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
		const token = bearer(req);
		const agentId = String(req.headers["x-agent-id"] ?? "").trim();
		if (!token || !agentId) {
			deny(res, 401, "NOT_AUTHORIZED", "Требуются Authorization: Bearer и X-Agent-Id");
			return;
		}
		if (!/^[0-9a-f-]{36}$/i.test(agentId)) {
			deny(res, 401, "NOT_AUTHORIZED", "Некорректный X-Agent-Id");
			return;
		}
		const row = await db.query<{ token_hash: string; organization_uuid: string; disabled_at: Date | null }>(
			"SELECT token_hash, organization_uuid, disabled_at FROM agents WHERE id = $1",
			[agentId],
		);
		const agent = row.rows[0];
		if (!agent || !safeEqual(agent.token_hash, sha256(token))) {
			deny(res, 401, "NOT_AUTHORIZED", "Неверный токен агента");
			return;
		}
		if (agent.disabled_at) {
			deny(res, 403, "FORBIDDEN", "Агент отключён");
			return;
		}
		req.agent = { agentId: agentId.toLowerCase(), organizationUuid: agent.organization_uuid };
		next();
	};
}

// ── Пользователь ERP ─────────────────────────────────────────────────────

export function requireErpUser(erp: Db, jwtSecret: string) {
	return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
		const token = bearer(req) ?? (typeof req.query.token === "string" ? req.query.token : null);
		if (!token) {
			deny(res, 401, "NOT_AUTHORIZED", "Требуется авторизация");
			return;
		}
		let uuid: string | undefined;
		try {
			const decoded = jwt.verify(token, jwtSecret);
			uuid = typeof decoded === "object" && decoded && typeof decoded.uuid === "string" ? decoded.uuid : undefined;
		} catch {
			deny(res, 401, "NOT_AUTHORIZED", "Недействительный токен");
			return;
		}
		if (!uuid) {
			deny(res, 401, "NOT_AUTHORIZED", "Недействительный токен");
			return;
		}

		const user = await loadErpUser(erp, uuid);
		if (!user) {
			deny(res, 401, "NOT_AUTHORIZED", "Пользователь не найден");
			return;
		}
		req.erpUser = user;
		next();
	};
}

/** Пользователь ERP и его организации — те же правила, что в tenantMiddleware бэкенда. */
export async function loadErpUser(erp: Db, uuid: string): Promise<ErpUser | null> {
	const u = await erp.query<{ uuid: string; is_super_admin: boolean; organization_uuid: string | null }>(
		`SELECT uuid, "isSuperAdmin" AS is_super_admin, "organizationUuid" AS organization_uuid
		   FROM users WHERE uuid = $1 AND "deletedAt" IS NULL`,
		[uuid],
	);
	const row = u.rows[0];
	if (!row) return null;

	const rights = await erp.query<{ organization_uuid: string; role: string }>(
		`SELECT "organizationUuid" AS organization_uuid, role FROM access_rights WHERE "userUuid" = $1`,
		[uuid],
	);
	const allowed = rights.rows.map((r) => r.organization_uuid);

	// Право на администрирование 1С — в любой из организаций пользователя: активная
	// организация к серверу 1С отношения не имеет.
	const onec = await erp.query<{ n: string }>(
		`SELECT count(*)::text AS n FROM access_permissions
		  WHERE "userUuid" = $1 AND "modelName" = 'OneCAdmin'
		    AND "accessLevel" IN ('full', 'readonly') AND "deletedAt" IS NULL`,
		[uuid],
	);
	let active = row.organization_uuid;
	if (active && !row.is_super_admin && !allowed.includes(active)) active = null;
	const activeRole = rights.rows.find((r) => r.organization_uuid === active)?.role;

	return {
		uuid: row.uuid,
		isSuperAdmin: row.is_super_admin,
		organizationUuid: active,
		allowedOrgUuids: allowed,
		isOrgAdmin: activeRole === "admin",
		canOnecAdmin: row.is_super_admin || Number(onec.rows[0]?.n ?? 0) > 0,
	};
}

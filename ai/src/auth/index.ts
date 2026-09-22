// Четыре вида субъектов и четыре способа их проверить.
//
//   администратор — заголовок X-Admin-Key: регистрация агентов, служебные вызовы;
//   агент         — Authorization: Bearer <agent token> + X-Agent-Id;
//   пользователь  — Authorization: Bearer <JWT ERP>: тот же JWT_SECRET, что у бэкенда;
//   пользователь 1С — X-Base-Token (токен базы) + X-1C-User-Id (UUID пользователя ИБ): чат внутри 1С.
//
// Пользователь ERP проверяется в два шага: подпись JWT даёт uuid, а активная организация и
// список доступных читаются из базы ERP при КАЖДОМ запросе — как это делает tenantMiddleware
// бэкенда. Кэшировать нельзя: отзыв доступа должен действовать сразу.

import { buildOnecPermissions, type OnecPermissions } from "../onec/permissions.ts";
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
	 *
	 * Это право на ЧТЕНИЕ: списки баз и агентов, сеансы, состояние, журнал заданий.
	 */
	canOnecAdmin: boolean;
	/**
	 * ПРАВО НА РАЗРУШАЮЩИЕ ДЕЙСТВИЯ — уровень доступа `full` (или суперадмин).
	 *
	 * ЗАЧЕМ ОТДЕЛЬНО. Права было одно: посмотреть сеансы базы и удалить её регистрацию
	 * требовали ровно того же. А это разные вещи и разные люди: смотреть состояние нужно
	 * всем, кто обслуживает клиентов, а снимать публикацию, править пользователей ИБ и
	 * загружать базу поверх существующей — единицам. Уровень `readonly` у права OneCAdmin
	 * существовал и раньше, но ничего не значил: сервис его не различал.
	 */
	canOnecWrite: boolean;
	/** Вложенные разрешения: агенты, расширения, пользователи баз (onec/permissions.ts). */
	onec: OnecPermissions;
};

export type AgentIdentity = { agentId: string; organizationUuid: string };

/**
 * Пользователь 1С (канал «чат внутри 1С»). Имени здесь нет: заголовки — только ASCII, а имя пользователя
 * 1С кириллическое, поэтому оно приходит в теле хода (`user.name`).
 */
export type OnecChatUser = {
	tokenId: string; baseId: string; baseKey: string; baseName: string; organizationUuid: string; userId: string;
	/** Состояние смены токена (§3): подробности — в BaseTokenStore. Здесь они нужны роутеру канала. */
	rotateDue: boolean;
	pending: boolean;
	firstUse: boolean;
};

// Расширяем Request типами субъектов — без any.
declare module "express-serve-static-core" {
	interface Request {
		erpUser?: ErpUser;
		agent?: AgentIdentity;
		onecUser?: OnecChatUser;
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
			// Отказ по токену пишем в лог: агент при этом молча ретраит, и снаружи это
			// неотличимо от «служба не запущена» — а разница между «не подключается» и
			// «подключается, но не тем токеном» решает, где искать причину.
			console.warn(`[agent] отказ по токену: agentId=${agentId} known=${!!agent}`);
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

// ── Пользователь 1С ──────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Всё, что нужно проверке доступа от хранилища токенов: остальное (выпуск, смена) — не её дело. */
export type BaseTokenResolver = { resolve: (token: string) => Promise<{
	tokenId: string; baseId: string; baseKey: string; baseName: string; organizationUuid: string;
	revoked: boolean; baseDisabled: boolean;
	// Состояние смены токена (§3). Необязательны: хранилище без ротации (и стенд в тестах) их не заполняет.
	rotateDue?: boolean; pending?: boolean; firstUse?: boolean;
} | null> };

/**
 * Токен базы + пользователь ИБ. Порядок отказов — по контракту: сначала токен (401 BASE_TOKEN_INVALID —
 * нет, неверный или отозван), потом база (403 BASE_DISABLED), потом пользователь (400 VALIDATION_ERROR).
 * Значение токена в журнал не пишется — только признак отказа.
 */
export function requireOnecUser(tokens: BaseTokenResolver) {
	return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
		const token = String(req.headers["x-base-token"] ?? "").trim();
		const owner = token ? await tokens.resolve(token) : null;
		if (!owner || owner.revoked) {
			/*
			 * ОТКАЗ ДОЛЖЕН НАЗЫВАТЬ ВЫПОЛНИМОЕ ДЕЙСТВИЕ (22.09). Прежний текст звал «выпустить новый токен в
			 * панели» — а выпустить его там нечем: смена работает только с ДЕЙСТВУЮЩИМ токеном, а выдача по
			 * заявке одноразовая (`tokenDeliveredAt`). После отзыва путь ровно один: база подаёт заявку заново
			 * из 1С, администратор одобряет её в панели. Совет, которого нельзя выполнить, дороже молчания: по
			 * нему человек идёт искать несуществующую кнопку и возвращается в поддержку.
			 */
			deny(res, 401, "BASE_TOKEN_INVALID", owner
				? "Токен базы отозван. Новый выдаётся только по заявке: в 1С — «БухПроф AI» → «Подключение к BuhProf AI» → «Запросить подключение», затем администратор одобряет заявку в панели (Администрирование → Расширение БухПроф-AI → Подключение баз)"
				: "Нет или неверный токен базы (X-Base-Token)");
			return;
		}
		if (owner.baseDisabled) {
			deny(res, 403, "BASE_DISABLED", "База отключена в сервисе");
			return;
		}
		const userId = String(req.headers["x-1c-user-id"] ?? "").trim();
		if (!UUID_RE.test(userId)) {
			deny(res, 400, "VALIDATION_ERROR", "X-1C-User-Id: ожидается UUID пользователя информационной базы");
			return;
		}
		req.onecUser = {
			tokenId: owner.tokenId, baseId: owner.baseId, baseKey: owner.baseKey, baseName: owner.baseName,
			organizationUuid: owner.organizationUuid, userId: userId.toLowerCase(),
			rotateDue: !!owner.rotateDue, pending: !!owner.pending, firstUse: !!owner.firstUse,
		};
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
	//
	// Уровни СЧИТАЕМ ПОРОЗНЬ: `readonly` даёт чтение, `full` — ещё и разрушающие действия.
	// Берём максимум по организациям: право в одной из них — это право на сервер 1С, а
	// сервер один, и делить его по организациям нечем.
	const onec = await erp.query<{ full: string; any: string }>(
		`SELECT count(*) FILTER (WHERE "accessLevel" = 'full')::text AS full,
		        count(*)::text AS any
		   FROM access_permissions
		  WHERE "userUuid" = $1 AND "modelName" = 'OneCAdmin'
		    AND "accessLevel" IN ('full', 'readonly') AND "deletedAt" IS NULL`,
		[uuid],
	);
	// Вложенные разрешения «Администрирования 1С» — со всех организаций, как и общее право.
	const nested = await erp.query<{ model_name: string; access_level: string }>(
		`SELECT "modelName" AS model_name, "accessLevel" AS access_level
		   FROM access_permissions
		  WHERE "userUuid" = $1 AND "modelName" LIKE 'OneCAdmin.%' AND "deletedAt" IS NULL`,
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
		canOnecAdmin: row.is_super_admin || Number(onec.rows[0]?.any ?? 0) > 0,
		canOnecWrite: row.is_super_admin || Number(onec.rows[0]?.full ?? 0) > 0,
		onec: buildOnecPermissions(
			nested.rows.map((r) => ({ modelName: r.model_name, accessLevel: r.access_level })),
			{ isSuperAdmin: row.is_super_admin, hasSection: row.is_super_admin || Number(onec.rows[0]?.any ?? 0) > 0 },
		),
	};
}

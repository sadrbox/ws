// Реестр агентов.
//
// Агент создаётся администратором для организации ERP; ему выдаётся токен, который
// показывается ОДИН раз и хранится только хэшем. Дальше агент сам регистрируется
// (register) и шлёт heartbeat — по ним сервис знает состояние и доступность 1С.

import { randomUUID } from "node:crypto";
import type { Db } from "../db/pool.ts";
import { newToken, sha256 } from "../auth/index.ts";
import { DEFAULT_BASE_KEY } from "../bases/service.ts";

/**
 * Роль агента (E15 §3.1). Это НЕ уровень доступа внутри одной службы, а две разные службы на
 * сервере 1С под разными учётками ОС:
 *   business — документы и справочники внутри баз через расширение bpapi;
 *   admin    — кластер через rac и пользователи ИБ через COM.
 * Разделение нужно ради радиуса поражения: компрометация бизнес-пути не даёт прав
 * администратора кластера. Две роли в одном процессе дали бы разделение только на бумаге.
 */
export type AgentRole = "business" | "admin";

export type AgentRow = {
	id: string;
	organization_uuid: string;
	server_id: string | null;
	role: AgentRole;
	bases_synced_at: Date | null;
	name: string;
	version: string | null;
	os: string | null;
	capabilities: string[];
	status: string;
	onec_reachable: boolean;
	onec_version: string | null;
	last_seen_at: Date | null;
	registered_at: Date | null;
	disabled_at: Date | null;
	created_at: Date;
};

export type AgentView = {
	id: string;
	organizationUuid: string;
	serverId: string | null;
	role: AgentRole;
	basesSyncedAt: Date | null;
	name: string;
	version: string | null;
	os: string | null;
	capabilities: string[];
	status: string;
	online: boolean;
	onec: { reachable: boolean; version: string | null };
	lastSeenAt: string | null;
	registeredAt: string | null;
	disabled: boolean;
};

const COLS = `id, organization_uuid, server_id, role, bases_synced_at, name, version, os, capabilities,
	status, onec_reachable, onec_version, last_seen_at, registered_at, disabled_at, created_at`;

export class AgentService {
	private readonly db: Db;
	private readonly offlineAfterSecs: number;

	private readonly orgBinding: "strict" | "any";
	constructor(db: Db, offlineAfterSecs: number, orgBinding: "strict" | "any" = "strict") {
		this.orgBinding = orgBinding;
		this.db = db;
		this.offlineAfterSecs = offlineAfterSecs;
	}

	/** Создаёт агента и возвращает токен — единственный раз, когда он виден. */
	async create(organizationUuid: string, name: string): Promise<{ agent: AgentView; token: string }> {
		const id = randomUUID();
		const token = newToken();
		await this.db.query(
			`INSERT INTO agents (id, organization_uuid, name, token_hash) VALUES ($1, $2, $3, $4)`,
			[id, organizationUuid, name, sha256(token)],
		);
		const agent = await this.get(id);
		if (!agent) throw new Error("агент не создан");
		return { agent, token };
	}

	async rotateToken(id: string): Promise<string | null> {
		const token = newToken();
		const r = await this.db.query(`UPDATE agents SET token_hash = $2 WHERE id = $1`, [id, sha256(token)]);
		return r.rowCount ? token : null;
	}

	async setDisabled(id: string, disabled: boolean): Promise<boolean> {
		const r = await this.db.query(
			`UPDATE agents SET disabled_at = ${disabled ? "now()" : "NULL"} WHERE id = $1`,
			[id],
		);
		return (r.rowCount ?? 0) > 0;
	}

	async get(id: string): Promise<AgentView | null> {
		const r = await this.db.query<AgentRow>(`SELECT ${COLS} FROM agents WHERE id = $1`, [id]);
		return r.rows[0] ? this.view(r.rows[0]) : null;
	}

	async listByOrganization(organizationUuid: string): Promise<AgentView[]> {
		const r = await this.db.query<AgentRow>(
			`SELECT ${COLS} FROM agents WHERE organization_uuid = $1 ORDER BY created_at`,
			[organizationUuid],
		);
		return r.rows.map((row) => this.view(row));
	}

	async listAll(): Promise<AgentView[]> {
		const r = await this.db.query<AgentRow>(`SELECT ${COLS} FROM agents ORDER BY created_at`);
		return r.rows.map((row) => this.view(row));
	}

	/** Агент организации, которому можно отдать команду: не отключён и недавно был на связи. */
	async pickOnline(organizationUuid: string): Promise<AgentView | null> {
		return this.pickAgentFor(organizationUuid, null, "business");
	}

	/**
	 * Исполнитель команды: база даёт сервер, сервер плюс роль дают агента (E15/A1).
	 *
	 * Раньше выбор был «любой онлайн-агент этой организации» — при одной базе на организацию
	 * это работало. Со ста базами на одном сервере так нельзя: команда ушла бы в чужую базу,
	 * а админ-команда — бизнес-агенту, у которого нет ни rac, ни прав администратора кластера.
	 *
	 * Если подходящего агента нет, команда НЕ ставится вообще. Отдать её «хоть кому-то» —
	 * значит выполнить операцию не там, где просили; лучше честная ошибка «нет агента».
	 *
	 * baseKey = null или 'default' — обращение без указания базы: агент протокола v1, у которого
	 * база одна. Тогда сервер не проверяется, и выбор сводится к прежнему поведению.
	 */
	async pickAgentFor(organizationUuid: string, baseKey: string | null, role: AgentRole = "business"): Promise<AgentView | null> {
		const candidates = (await this.listByOrganization(organizationUuid))
			.filter((a) => !a.disabled && a.online && a.role === role);

		const key = baseKey && baseKey !== DEFAULT_BASE_KEY ? baseKey : null;
		if (!key) {
			if (candidates.length) return candidates[0];
			if (this.orgBinding === "strict") return null;
			// Режим разработки: один стенд 1С на все организации ERP.
			return (await this.listAll()).find((a) => !a.disabled && a.online && a.role === role) ?? null;
		}

		const server = await this.db.query<{ server_id: string }>(
			`SELECT b.server_id FROM bases b JOIN servers s ON s.id = b.server_id
			  WHERE s.organization_uuid = $1 AND b.key = $2 AND b.disabled_at IS NULL`,
			[organizationUuid, key],
		);
		const serverId = server.rows[0]?.server_id ?? null;
		if (!serverId) return null;
		return candidates.find((a) => a.serverId === serverId) ?? null;
	}

	/** Агенты, которые организация видит в интерфейсе: свои, а в режиме any — все, если своих нет. */
	async visibleTo(organizationUuid: string): Promise<AgentView[]> {
		const own = await this.listByOrganization(organizationUuid);
		if (own.length || this.orgBinding === "strict") return own;
		return this.listAll();
	}

	async register(id: string, info: { name?: string; version: string; os: string; capabilities: string[]; role?: AgentRole; serverId?: string | null }): Promise<void> {
		await this.db.query(
			`UPDATE agents
			    SET version = $2, os = $3, capabilities = $4::jsonb, status = 'ONLINE',
			        registered_at = now(), last_seen_at = now(),
			        role = COALESCE($6, role), server_id = COALESCE($7, server_id),
			        name = CASE WHEN $5 <> '' AND name = '' THEN $5 ELSE name END
			  WHERE id = $1`,
			[id, info.version, info.os, JSON.stringify(info.capabilities), info.name ?? "",
				info.role ?? null, info.serverId ?? null],
		);
	}

	/** Отметка «полный срез по базам получен» — от неё считается троттлинг (см. needsFullBases). */
	async markBasesSynced(id: string): Promise<void> {
		await this.db.query(`UPDATE agents SET bases_synced_at = now() WHERE id = $1`, [id]);
	}

	async heartbeat(id: string, hb: { status: string; version?: string; onecReachable: boolean; onecVersion: string | null }): Promise<void> {
		await this.db.query(
			`UPDATE agents
			    SET status = $2, onec_reachable = $3, onec_version = $4,
			        version = COALESCE($5, version), last_seen_at = now()
			  WHERE id = $1`,
			[id, hb.status, hb.onecReachable, hb.onecVersion, hb.version ?? null],
		);
	}

	private view(r: AgentRow): AgentView {
		const seen = r.last_seen_at ? r.last_seen_at.getTime() : 0;
		const online = seen > 0 && Date.now() - seen < this.offlineAfterSecs * 1000 && !r.disabled_at;
		return {
			id: r.id,
			organizationUuid: r.organization_uuid,
			serverId: r.server_id,
			role: r.role === "admin" ? "admin" : "business",
			basesSyncedAt: r.bases_synced_at,
			name: r.name,
			version: r.version,
			os: r.os,
			capabilities: Array.isArray(r.capabilities) ? r.capabilities : [],
			// Состояние, которое агент прислал сам, но если он давно молчит — OFFLINE.
			status: online ? r.status : "OFFLINE",
			online,
			onec: { reachable: online && r.onec_reachable, version: r.onec_version },
			lastSeenAt: r.last_seen_at?.toISOString() ?? null,
			registeredAt: r.registered_at?.toISOString() ?? null,
			disabled: !!r.disabled_at,
		};
	}
}

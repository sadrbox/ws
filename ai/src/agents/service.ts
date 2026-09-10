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
 * Сколько ждать новый long-poll после закрытия прежнего, прежде чем считать агента
 * остановленным. Живой агент переоткрывает опрос сразу же; пауза больше этого — либо
 * остановленная служба, либо оборванная сеть, и в обоих случаях команду выполнить некому.
 */
const POLL_GAP_MS = 10_000;


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
	/**
	 * Открытые long-poll'ы агентов — самый быстрый признак «служба жива».
	 *
	 * Heartbeat приходит раз в десятки секунд, поэтому остановленная служба ещё полторы
	 * минуты выглядит работающей: панель показывает «на связи», человек жмёт команду и
	 * ждёт ответа от того, кого уже нет. А long-poll рвётся В ТОТ ЖЕ МИГ, когда служба
	 * останавливается: сокет закрывается, и мы об этом узнаём сразу.
	 *
	 * Держим в памяти: это состояние живёт ровно столько, сколько живёт процесс сервиса,
	 * и переживать перезапуск ему незачем — после него всё равно ждём первого обращения.
	 */
	private readonly polls = new Map<string, { open: number; closedAt: number }>();

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

	/** Переименовать агента: имя — подпись для человека, агент присылает своё при регистрации. */
	async rename(id: string, name: string): Promise<boolean> {
		const r = await this.db.query(`UPDATE agents SET name = $2 WHERE id = $1`, [id, name.slice(0, 200)]);
		return (r.rowCount ?? 0) > 0;
	}

	/**
	 * Удалить агента вместе с его историей команд.
	 *
	 * Команды ссылаются на агента внешним ключом, поэтому удаляются здесь же и в одной
	 * транзакции: иначе удаление падало бы на первом же агенте, который хоть раз работал.
	 * История команд без агента бессмысленна — она вся про то, кто и что исполнял.
	 */
	async remove(id: string): Promise<boolean> {
		const client = await this.db.connect();
		try {
			await client.query("BEGIN");
			await client.query(`DELETE FROM commands WHERE agent_id = $1`, [id]);
			await client.query(`UPDATE audit_log SET agent_id = NULL WHERE agent_id = $1`, [id]);
			const r = await client.query(`DELETE FROM agents WHERE id = $1`, [id]);
			await client.query("COMMIT");
			return (r.rowCount ?? 0) > 0;
		} catch (e) {
			await client.query("ROLLBACK");
			throw e;
		} finally {
			client.release();
		}
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

	/** Агент по id — нужен, чтобы узнать, за каким сервером он уже закреплён. */
	async findById(id: string): Promise<AgentView | null> {
		const r = await this.db.query<AgentRow>(`SELECT ${COLS} FROM agents WHERE id = $1`, [id]);
		return r.rows[0] ? this.view(r.rows[0]) : null;
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

	/**
	 * Исполнитель АДМИНИСТРАТИВНОЙ команды — без привязки к организации ERP.
	 *
	 * Сервер 1С один на всю установку: у бухгалтерской компании это её сервер со всеми
	 * клиентскими базами, и активная организация пользователя к нему отношения не имеет.
	 * Привязка агента к организации осмысленна для БИЗНЕС-команд (документы конкретной
	 * организации), но для кластера она означала бы «администрирование работает, только
	 * если угадал организацию» — чего не бывает.
	 *
	 * Ограничение доступа даёт право OneCAdmin (проверяется в onecRouter), а не org.
	 */
	async pickAdminAgent(baseKey: string | null): Promise<AgentView | null> {
		const candidates = (await this.listAll()).filter((a) => !a.disabled && a.online && a.role === "admin");
		const key = baseKey && baseKey !== DEFAULT_BASE_KEY ? baseKey : null;
		if (!key) return candidates[0] ?? null;

		// Имя базы уникально в пределах сервера, но не глобально: берём тот сервер,
		// у которого есть агент на связи.
		const rows = await this.db.query<{ server_id: string }>(
			`SELECT b.server_id FROM bases b WHERE b.key = $1 AND b.disabled_at IS NULL`,
			[key],
		);
		const ids = new Set(rows.rows.map((r) => r.server_id));
		return candidates.find((a) => a.serverId && ids.has(a.serverId)) ?? null;
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

	/**
	 * Отметка «агент на связи» по ЛЮБОМУ его запросу.
	 *
	 * Раньше `last_seen_at` обновлял только heartbeat. Агент, который исправно забирает
	 * команды длинным опросом, но чей heartbeat отвалился (например, оборвался при
	 * перезапуске сервиса и не переподключился), считался офлайн — панель отвечала
	 * «не на связи», хотя служба работала и команды выполняла.
	 *
	 * «На связи» должно означать «мы от него что-то слышали», а не «он прислал один
	 * конкретный вид сообщения».
	 */
	/**
	 * Отметить экземпляр агента (процесс), приславший запрос.
	 *
	 * Экземпляр называет себя сам: pid + время старта. Нам важно не кто он, а СКОЛЬКО их:
	 * два процесса под одним токеном разбирают одну очередь, и разошедшиеся настройки дают
	 * плавающие отказы, необъяснимые ничем другим.
	 */
	/** Текущий владелец токена: единственный экземпляр, которому разрешено работать. */
	async owner(agentId: string): Promise<{ instanceId: string | null; seenAt: Date | null }> {
		const r = await this.db.query<{ owner_instance_id: string | null; owner_seen_at: Date | null }>(
			`SELECT owner_instance_id, owner_seen_at FROM agents WHERE id = $1`, [agentId],
		);
		const row = r.rows[0];
		return { instanceId: row?.owner_instance_id ?? null, seenAt: row?.owner_seen_at ?? null };
	}

	/**
	 * Занять владение (новый экземпляр) или продлить его (тот же).
	 *
	 * Условие в WHERE — не украшение: два процесса стартуют одновременно, и без него оба
	 * решат, что владельцы они. Побеждает тот, чей UPDATE прошёл первым; второй увидит
	 * чужой идентификатор и получит отказ.
	 */
	async claimOwnership(agentId: string, instanceId: string, offlineAfterSecs: number): Promise<boolean> {
		const r = await this.db.query(
			`UPDATE agents
			    SET owner_instance_id = $2,
			        owner_seen_at = now(),
			        owner_since = CASE WHEN owner_instance_id IS DISTINCT FROM $2 THEN now() ELSE owner_since END
			  WHERE id = $1
			    AND (owner_instance_id IS NULL
			         OR owner_instance_id = $2
			         OR owner_seen_at IS NULL
			         OR owner_seen_at < now() - ($3 || ' seconds')::interval)`,
			[agentId, instanceId, String(offlineAfterSecs)],
		);
		return (r.rowCount ?? 0) > 0;
	}

	/**
	 * Назначить владельца вручную — из панели.
	 *
	 * «Кто первым пришёл» — правило для машин, а не для людей: выиграть аренду может не тот
	 * компьютер (машина разработки вместо сервера 1С), и тогда боевой агент оказывается
	 * заблокирован. Явное назначение решает это одним нажатием, без гонок и перезапусков.
	 */
	async setOwnership(agentId: string, instanceId: string): Promise<boolean> {
		const r = await this.db.query(
			`UPDATE agents SET owner_instance_id = $2, owner_seen_at = now(), owner_since = now() WHERE id = $1`,
			[agentId, instanceId.slice(0, 200)],
		);
		return (r.rowCount ?? 0) > 0;
	}

	/** Снять владение вручную — из панели, когда экземпляр не отдаёт его сам. */
	async releaseOwnership(agentId: string): Promise<boolean> {
		const r = await this.db.query(
			`UPDATE agents SET owner_instance_id = NULL, owner_seen_at = NULL, owner_since = NULL WHERE id = $1`,
			[agentId],
		);
		return (r.rowCount ?? 0) > 0;
	}

	async touchInstance(agentId: string, instanceId: string, version: string | null, remoteAddr?: string | null): Promise<void> {
		await this.db.query(
			`INSERT INTO agent_instances (agent_id, instance_id, version, remote_addr)
			 VALUES ($1, $2, $3, $4)
			 ON CONFLICT (agent_id, instance_id)
			 DO UPDATE SET last_seen_at = now(),
			               version = COALESCE(EXCLUDED.version, agent_instances.version),
			               remote_addr = COALESCE(EXCLUDED.remote_addr, agent_instances.remote_addr)`,
			[agentId, instanceId.slice(0, 200), version, remoteAddr ?? null],
		);
	}

	/**
	 * Экземпляры за `secs` секунд, каждый с признаком «на связи сейчас».
	 *
	 * ЭТО ДВА РАЗНЫХ ВОПРОСА, и путать их нельзя. «Кто работает прямо сейчас» — это
	 * `live`: по нему считается число экземпляров и поднимается тревога о двойном запуске.
	 * «Какие процессы были» — вся выборка: идентификатор меняется при каждом перезапуске
	 * (pid + время старта), и за сутки их набирается десяток. Один раз я это уже смешал —
	 * панель показала «запущено 8 экземпляров» там, где работал один, а семь были историей.
	 *
	 * История нужна не для красоты: владельцем назначают и молчащий экземпляр, чтобы он
	 * занял аренду при старте.
	 */
	async liveInstances(agentId: string, secs: number, liveSecs: number): Promise<{
		instanceId: string; version: string | null; remoteAddr: string | null; lastSeenAt: Date; live: boolean;
	}[]> {
		const r = await this.db.query<{
			instance_id: string; version: string | null; remote_addr: string | null; last_seen_at: Date; live: boolean;
		}>(
			`SELECT instance_id, version, remote_addr, last_seen_at,
			        (last_seen_at > now() - ($3 || ' seconds')::interval) AS live
			   FROM agent_instances
			  WHERE agent_id = $1 AND last_seen_at > now() - ($2 || ' seconds')::interval
			  ORDER BY last_seen_at DESC`,
			[agentId, String(secs), String(liveSecs)],
		);
		return r.rows.map((x) => ({
			instanceId: x.instance_id, version: x.version, remoteAddr: x.remote_addr,
			lastSeenAt: x.last_seen_at, live: x.live,
		}));
	}

	/**
	 * Убрать давно замолчавшие экземпляры.
	 *
	 * Каждый перезапуск службы добавляет строку и не убирает прежнюю: за месяц работы это
	 * сотни записей, из которых полезны единицы. Неделя — запас, покрывающий выходные.
	 */
	async pruneInstances(olderThanDays = 7): Promise<void> {
		await this.db.query(
			`DELETE FROM agent_instances WHERE last_seen_at < now() - ($1 || ' days')::interval`,
			[String(olderThanDays)],
		);
	}

	/** Агент открыл long-poll: пока он открыт, агент точно жив. */
	notePollOpen(agentId: string): void {
		const p = this.polls.get(agentId) ?? { open: 0, closedAt: 0 };
		p.open += 1;
		this.polls.set(agentId, p);
	}

	/** Long-poll закрылся — сам собой по таймауту или потому, что служба остановлена. */
	notePollClosed(agentId: string): void {
		const p = this.polls.get(agentId) ?? { open: 0, closedAt: 0 };
		p.open = Math.max(0, p.open - 1);
		p.closedAt = Date.now();
		this.polls.set(agentId, p);
	}

	/**
	 * Живой ли агент ПО ОПРОСУ КОМАНД.
	 *
	 * `true`  — опрос открыт прямо сейчас;
	 * `false` — опрос закрылся и новый не пришёл дольше срока: работающий агент
	 *           переоткрывает его немедленно, так что пауза означает остановку;
	 * `null`  — про опрос ничего не известно (сервис перезапускали, агент только
	 *           зарегистрировался) — тогда решает heartbeat, как раньше.
	 */
	private pollAlive(agentId: string): boolean | null {
		const p = this.polls.get(agentId);
		if (!p) return null;
		if (p.open > 0) return true;
		if (!p.closedAt) return null;
		return Date.now() - p.closedAt < POLL_GAP_MS ? null : false;
	}

	async touch(id: string): Promise<void> {
		await this.db.query(`UPDATE agents SET last_seen_at = now() WHERE id = $1`, [id]);
	}

	private view(r: AgentRow): AgentView {
		const seen = r.last_seen_at ? r.last_seen_at.getTime() : 0;
		const byHeartbeat = seen > 0 && Date.now() - seen < this.offlineAfterSecs * 1000;
		// Опрос команд знает об остановке службы раньше heartbeat — и его ответ сильнее.
		const byPoll = this.pollAlive(r.id);
		const online = (byPoll ?? byHeartbeat) && !r.disabled_at;
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

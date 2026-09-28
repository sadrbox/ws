// Реестр агентов.
//
// Агент — установка BuhProf: его заводит (одобряет заявку) администратор BuhProf, и это одобрение — единственное,
// что даёт ему доверие. Организации у агента нет (docs/TASK_SERVICE_AGENT_OWNER_MODEL_2026-09-28.md, Р1): кого он
// обслуживает, говорят его базы. Токен показывается ОДИН раз и хранится только хэшем. Дальше агент сам
// регистрируется (register) и шлёт heartbeat — по ним сервис знает состояние и доступность 1С.

import { randomUUID } from "node:crypto";

import type { Db } from "../db/pool.ts";
import { newToken, sha256 } from "../auth/index.ts";
import { DEFAULT_BASE_KEY } from "../bases/service.ts";
import type { CommandStats, DurationStat } from "./commandStats.ts";
import {
	AgentBasesStore, ownedBasesOf, resolveBusinessTarget, type AgentBase, type AgentLimits, type TargetDecision,
} from "./agentBases.ts";

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

/** jsonb-объект из строки базы; не объект — пусто, а не падение представления. */
const asRecord = (v: unknown): Record<string, unknown> =>
	v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

export type AgentRow = {
	id: string;
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
	/** Снимок процессов агента из heartbeat (см. AgentProcess). */
	processes: unknown;
	processes_seen_at: Date | null;
	/** Снимок отказов и времени команд из heartbeat (S5). */
	failures_by_code: unknown;
	durations_by_type: unknown;
	command_stats_seen_at: Date | null;
	/** Лимит тарифа бизнес-агента (СВ3, миграция 034); NULL — без ограничения. */
	max_bases?: number | null;
	commands_done?: number | null;
	update_state?: Record<string, unknown> | null;
	commands_failed?: number | null;
};

/** Процесс, запущенный агентом на сервере 1С (TASK_SERVICE_PROCESSES). */
export type AgentProcess = {
	pid: number;
	tool: string;
	what?: string;
	base?: string | null;
	ageSecs?: number;
	orphan?: boolean;
	/** Номер команды сервиса, запустившей процесс (агент 01:06, С30). */
	commandId?: string;
};

export type AgentView = {
	/** Лимит тарифа (СВ3): сколько баз агент обслуживает; null — без ограничения. */
	limits: AgentLimits;
	id: string;
	serverId: string | null;
	role: AgentRole;
	basesSyncedAt: Date | null;
	name: string;
	version: string | null;
	os: string | null;
	capabilities: string[];
	status: string;
	online: boolean;
	/** Что агент запустил на сервере 1С прямо сейчас (снимок из heartbeat). */
	processes: AgentProcess[];
	processesSeenAt: string | null;
	/**
	 * Отказы по кодам и время команд с последнего запуска службы агента (S5). null — снимка
	 * не было: сборка агента старше 13.09 15:21.
	 */
	commandStats: {
		failuresByCode: Record<string, number>;
		durationsByType: Record<string, DurationStat>;
		seenAt: string | null;
	} | null;
	onec: { reachable: boolean; version: string | null };
	/**
	 * Агент ЗАБРАЛ команду и ещё не ответил.
	 *
	 * Отдельно от `online`, потому что это разные ответы: «на связи» значит «откликается»,
	 * а здесь агент как раз не откликается — он работает, и молчание ожидаемо. Пока эти два
	 * состояния показывались одним словом, человек, остановивший службу посреди команды,
	 * видел «на связи» и не понимал, почему ничего не происходит.
	 */
	busy: boolean;
	lastSeenAt: string | null;
	registeredAt: string | null;
	disabled: boolean;
	commandsDone: number | null;
	commandsFailed: number | null;
	/** Ход обновления службы (heartbeat): state, целевая сборка, ошибка, время. */
	update: { state?: string; build?: string; error?: string | null; at?: string } | null;
};

const COLS = `id, server_id, role, bases_synced_at, name, version, os, capabilities,
	status, onec_reachable, onec_version, last_seen_at, registered_at, disabled_at, created_at,
	processes, processes_seen_at, failures_by_code, durations_by_type, command_stats_seen_at, max_bases, commands_done, commands_failed, update_state`;

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
	private readonly polls = new Map<string, { open: number; closedAt: number; busyUntil?: number }>();

	constructor(db: Db, offlineAfterSecs: number) {
		this.db = db;
		this.offlineAfterSecs = offlineAfterSecs;
	}

	/** Создаёт агента и возвращает токен — единственный раз, когда он виден. */
	/** `role` — роль, о которой договорились при заведении (заявка по коду её называет); дальше её задаёт не агент. */
	async create(name: string, role: AgentRole = "business"): Promise<{ agent: AgentView; token: string }> {
		const id = randomUUID();
		const token = newToken();
		await this.db.query(
			`INSERT INTO agents (id, name, role, token_hash) VALUES ($1, $2, $3, $4)`,
			[id, name, role, sha256(token)],
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
	 *
	 * ЧТО УДАЛЯЕМ, А ЧТО ОТВЯЗЫВАЕМ. Удаляются только команды — они принадлежат агенту.
	 * Журнал аудита и ДИАЛОГИ остаются: журнал ведут ради разбирательств «кто это сделал»,
	 * а диалог — переписка человека с помощником, и стирать её заодно с удалением служебной
	 * записи никто не просил. У обоих ссылка просто обнуляется.
	 *
	 * Про диалоги здесь отдельная история: ссылку на них забыли, и удаление падало на
	 * внешнем ключе `conversations_agent_id_fkey` — молча, ответом «внутренняя ошибка».
	 * Со стороны панели это выглядело как «агент не удаляется» без единого объяснения.
	 */
	async remove(id: string): Promise<boolean> {
		const client = await this.db.connect();
		try {
			await client.query("BEGIN");
			await client.query(`DELETE FROM commands WHERE agent_id = $1`, [id]);
			await client.query(`UPDATE audit_log SET agent_id = NULL WHERE agent_id = $1`, [id]);
			await client.query(`UPDATE conversations SET agent_id = NULL WHERE agent_id = $1`, [id]);
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

	/**
	 * Лимит тарифа бизнес-агента (СВ3). Смена действует со следующего heartbeat: лимиты уходят агенту в его ответе,
	 * а сервис применяет новые сразу — к ближайшей команде.
	 */
	async setLimits(id: string, limits: AgentLimits): Promise<boolean> {
		const r = await this.db.query(`UPDATE agents SET max_bases = $2 WHERE id = $1`, [id, limits.maxBases]);
		return (r.rowCount ?? 0) > 0;
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

	/** Агент по id — нужен, чтобы узнать, за каким сервером он уже закреплён. */
	async findById(id: string): Promise<AgentView | null> {
		const r = await this.db.query<AgentRow>(`SELECT ${COLS} FROM agents WHERE id = $1`, [id]);
		return r.rows[0] ? this.view(r.rows[0]) : null;
	}

	async listAll(): Promise<AgentView[]> {
		const r = await this.db.query<AgentRow>(`SELECT ${COLS} FROM agents ORDER BY created_at`);
		return r.rows.map((row) => this.view(row));
	}

	/** Включённые бизнес-агенты и их срезы — кандидаты любой бизнес-команды (В2): у агента нет организации. */
	private async businessSlices(): Promise<{ agents: AgentView[]; bases: Map<string, AgentBase[]> }> {
		const agents = (await this.listAll()).filter((a) => !a.disabled && a.role === "business");
		const bases = await new AgentBasesStore(this.db).listMany(agents.map((a) => a.id), { cached: true });
		return { agents, bases };
	}

	/**
	 * ИСПОЛНИТЕЛЬ БИЗНЕС-КОМАНДЫ ОРГАНИЗАЦИИ — ЕДИНСТВЕННЫЙ ПУТЬ (В2, 28.09). Чат, карточка организации, «Долги и
	 * остатки» и самопроверка базы идут сюда; «свой агент организации» больше не существует (Р1).
	 *
	 * `orgBin` — БИН организации из ERP: по нему ищутся базы во срезах ВСЕХ бизнес-агентов. Своих баз организации
	 * (одобренная заявка базы, действующий токен чата) — правило выбора, когда БИН нашёлся в нескольких базах.
	 */
	async resolveBusiness(organizationUuid: string, orgBin: string | null, want: { baseKey?: string | null; preferAgentId?: string | null } = {}): Promise<
		| { kind: "agent"; agent: AgentView; baseKey: string; alsoIn: string[]; baseStatus: string | null; baseOrgs: AgentBase["organizations"] }
		| Extract<TargetDecision, { kind: "refused" }>
		| { kind: "ambiguous"; code: "BASE_AMBIGUOUS"; message: string; details: Record<string, unknown> }
		| { kind: "none" }
	> {
		if (!orgBin?.trim()) return { kind: "none" };
		const { agents, bases } = await this.businessSlices();
		const owned = ownedBasesOf(await this.ownedBaseRows(organizationUuid, orgBin));
		const d = resolveBusinessTarget(
			agents.map((a) => ({ agentId: a.id, online: a.online, bases: bases.get(a.id) ?? [], limits: a.limits })),
			{ bin: orgBin, ...want },
			owned,
		);
		if (d.kind === "base") {
			const agent = agents.find((a) => a.id === d.agentId);
			if (!agent) return { kind: "none" };
			const baseOrgs = (bases.get(d.agentId) ?? []).find((b) => b.key === d.baseKey)?.organizations ?? null;
			return { kind: "agent", agent, baseKey: d.baseKey, alsoIn: d.alsoIn, baseStatus: d.status, baseOrgs };
		}
		if (d.kind === "ambiguous") {
			const where = d.hits.map((h) => `«${h.baseKey}» (агент «${agents.find((a) => a.id === h.agentId)?.name || h.agentId.slice(0, 8)}»)`);
			return {
				kind: "ambiguous", code: d.code,
				message: `Организация с БИН ${orgBin} есть в нескольких базах 1С: ${where.join(", ")}, и какая из них её, не известно. `
					+ "Подключите нужную базу к BuhProf AI из самой 1С (раздел BuhProf AI — подключение базы) — дальше команды пойдут в неё.",
				details: { bin: orgBin, bases: d.hits.map((h) => ({ baseKey: h.baseKey, agentId: h.agentId, online: h.online })) },
			};
		}
		return d;
	}

	/**
	 * Базы, которые организация назвала своей (В2, п. 2): одобренные за её БИН в заявке базы и базы с её действующим
	 * токеном чата. Ключ и сервер — из реестра баз.
	 */
	private async ownedBaseRows(organizationUuid: string, bin: string): Promise<{ key: string; serverId: string | null }[]> {
		// base_organizations.base_id — text (миграция 040), bases.id — uuid: без приведения сравнения не будет.
		const r = await this.db.query<{ key: string; server_id: string | null }>(
			`SELECT b.key, b.server_id FROM base_organizations o JOIN bases b ON b.id::text = o.base_id
			  WHERE o.bin = $2 AND o.approved_at IS NOT NULL AND b.disabled_at IS NULL
			 UNION
			 SELECT b.key, b.server_id FROM base_tokens t JOIN bases b ON b.id = t.base_id
			  WHERE t.organization_uuid = $1 AND t.revoked_at IS NULL AND b.disabled_at IS NULL`,
			[organizationUuid, bin.trim()],
		);
		return r.rows.map((x) => ({ key: x.key, serverId: x.server_id }));
	}

	/**
	 * БИЗНЕС-АГЕНТ ДЛЯ БАЗЫ РЕЕСТРА (самопроверка базы из панели). У такой команды нет организации пользователя — есть
	 * база, поэтому БИН берётся из её одобренных организаций, а выбор — тем же правилом (В2), с базой, названной явно:
	 * агент должен видеть в базе с этим ключом организацию одобренного БИН. Ни одного одобренного БИН — `none`.
	 */
	async resolveForBase(baseId: string, baseKey: string): Promise<
		| { kind: "agent"; agent: AgentView } | Extract<TargetDecision, { kind: "refused" }> | { kind: "ambiguous" } | { kind: "none" }
	> {
		const bins = await this.db.query<{ bin: string }>(
			`SELECT bin FROM base_organizations WHERE base_id = $1 AND approved_at IS NOT NULL ORDER BY bin`, [baseId],
		);
		if (!bins.rows.length) return { kind: "none" };
		const { agents, bases } = await this.businessSlices();
		const slices = agents.map((a) => ({ agentId: a.id, online: a.online, bases: bases.get(a.id) ?? [], limits: a.limits }));
		// Сама база — «своя» (уровень 2): одноимённые базы разных агентов с тем же БИН различит только связь.
		const owned = ownedBasesOf([{ key: baseKey, serverId: null }]);
		let last: Awaited<ReturnType<AgentService["resolveForBase"]>> = { kind: "none" };
		for (const { bin } of bins.rows) {
			const d = resolveBusinessTarget(slices, { bin, baseKey }, owned);
			if (d.kind === "base") {
				const agent = agents.find((a) => a.id === d.agentId);
				if (agent) return { kind: "agent", agent };
			}
			if (d.kind === "refused" || (d.kind === "ambiguous" && last.kind === "none")) last = d.kind === "refused" ? d : { kind: "ambiguous" };
		}
		return last;
	}

	/**
	 * Агенты, у которых организация с этим БИН есть в срезе — «кто её обслуживает» для статуса чата и списка агентов
	 * пользователя. С базами, где этот БИН есть, и только с ними: остальные базы агента — чужие.
	 */
	async servingBin(bin: string | null): Promise<{ agent: AgentView; bases: AgentBase[] }[]> {
		const b = bin?.trim();
		if (!b) return [];
		const { agents, bases } = await this.businessSlices();
		return agents
			.map((agent) => ({ agent, bases: (bases.get(agent.id) ?? []).filter((x) => x.organizations?.some((o) => o.bin === b)) }))
			.filter((x) => x.bases.length > 0);
	}

	/**
	 * ПОЧЕМУ БАЗУ ОРГАНИЗАЦИИ НЕКОМУ СПРОСИТЬ — для отказа, когда resolveBusiness никого не нашёл (В2). Кандидаты — все
	 * бизнес-агенты, поэтому причины три: базы с этим БИН нет ни у одного агента (есть, но выключена или агент отключён —
	 * тоже сюда), агент базы не на связи, БИН в нескольких базах (это resolveBusiness говорит сам — `ambiguous`).
	 */
	async explainUnresolved(bin: string, orgLabel: string): Promise<{ code: string; message: string }> {
		const all = (await this.listAll()).filter((a) => a.role === "business");
		const bases = await new AgentBasesStore(this.db).listMany(all.map((a) => a.id), { cached: true });
		const holders = all.filter((a) => (bases.get(a.id) ?? []).some((x) => x.organizations?.some((o) => o.bin === bin)));
		const disabled = holders.find((a) => a.disabled);
		if (!holders.length) {
			return {
				code: "BASE_NOT_SERVED",
				message: `Организации «${orgLabel}» (БИН ${bin}) нет ни в одной базе агентов BuhProf: добавьте её базу в окне `
					+ "бизнес-агента на компьютере с 1С («Базы 1С») или проверьте БИН организации в самой 1С",
			};
		}
		if (disabled && holders.every((a) => a.disabled)) {
			return { code: "AGENT_DISABLED", message: `Базы организации «${orgLabel}» обслуживает агент «${disabled.name}», но он отключён в панели` };
		}
		return {
			code: "AGENT_OFFLINE",
			message: `Базы организации «${orgLabel}» обслуживает агент «${holders[0]!.name}», но он сейчас не на связи `
				+ "(служба на компьютере с 1С не запущена или нет сети)",
		};
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
	async pickAdminAgent(baseKey: string | null, opts: { serverId?: string | null } = {}): Promise<AgentView | null> {
		// Сервер (C9) — выбранный в панели. Видимость по организациям (C11) отменена (В5): панель внутренняя.
		const candidates = (await this.listAll()).filter((a) => !a.disabled && a.online && a.role === "admin"
			&& (!opts.serverId || a.serverId === opts.serverId));
		const key = baseKey && baseKey !== DEFAULT_BASE_KEY ? baseKey : null;
		if (!key) return candidates[0] ?? null;

		// Имя базы уникально в пределах сервера, но не глобально: берём тот сервер,
		// у которого есть агент на связи.
		//
		// Скрытые базы тоже (С44): исполнитель у скрытой базы есть — кластерные команды (удалить регистрацию,
		// закрыть вход) ей нужны. Команды внутрь скрытой базы отсекает правило команды до выбора агента.
		const rows = await this.db.query<{ server_id: string }>(
			`SELECT b.server_id FROM bases b WHERE b.key = $1`,
			[key],
		);
		const ids = new Set(rows.rows.map((r) => r.server_id));
		return candidates.find((a) => a.serverId && ids.has(a.serverId)) ?? null;
	}

	/**
	 * ПЕРЕЗАПУСК СЛУЖБЫ — ЭТО ДРУГОЙ ПРОЦЕСС, и всё, что мы знали о прежнем, недействительно.
	 *
	 * Снимок процессов принадлежит тому экземпляру, который его прислал: после перезапуска
	 * в нём чужие pid'ы. Панель показывала их как текущие, человек жал «Снять процесс» и
	 * получал от агента честный отказ — «процесса 10040 нет среди запущенных агентом».
	 * Ответ верный, вопрос был неверный: список принадлежал покойнику.
	 *
	 * Признак занятости — оттуда же: прежний экземпляр забрал команду и умер вместе с ней.
	 */
	private forgetInstanceState(id: string): void {
		const p = this.polls.get(id);
		if (p) this.polls.set(id, { open: p.open, closedAt: p.closedAt, busyUntil: 0 });
	}

	/**
	 * РОЛЬ НАЗНАЧАЕТ ТОТ, КТО ЗАВОДИТ АГЕНТА (аудит 21.09). Раньше она бралась из каждого register,
	 * то есть её объявлял сам агент. Владелец токена бизнес-агента мог назваться `admin` и получить то, что
	 * положено только агенту кластера: учётную запись администратора базы в payload команды (см. setAuthResolver
	 * в server.ts) и право быть источником истины о списке баз сервера. Теперь роль меняется только вместе с
	 * агентом (заведение в панели, одобрение заявки по коду, служебная команда с `--role`), а попытка
	 * представиться иначе видна в журнале и ничего не меняет.
	 *
	 * Возвращает роль, с которой агент записан, и роль, которую он назвал: их расхождение — повод для тревоги.
	 */
	async register(id: string, info: { name?: string; version: string; os: string; capabilities: string[]; role?: AgentRole; serverId?: string | null }): Promise<{ role: AgentRole; claimed: AgentRole | null; first: boolean }> {
		const before = await this.db.query<{ registered_at: Date | null }>(`SELECT registered_at FROM agents WHERE id = $1`, [id]);
		const first = !before.rows[0]?.registered_at;
		const r = await this.db.query<{ role: AgentRole }>(
			`UPDATE agents
			    SET version = $2, os = $3, capabilities = $4::jsonb, status = 'ONLINE',
			        registered_at = now(), last_seen_at = now(),
			        server_id = COALESCE($6, server_id),
			        name = CASE WHEN $5 <> '' AND name = '' THEN $5 ELSE name END
			  WHERE id = $1
			 RETURNING role`,
			[id, info.version, info.os, JSON.stringify(info.capabilities), info.name ?? "", info.serverId ?? null],
		);
		const role = r.rows[0]?.role ?? "business";
		return { role, claimed: info.role ?? null, first };
	}

	/** Отметка «полный срез по базам получен» — от неё считается троттлинг (см. needsFullBases). */
	async markBasesSynced(id: string): Promise<void> {
		await this.db.query(`UPDATE agents SET bases_synced_at = now() WHERE id = $1`, [id]);
	}

	async heartbeat(id: string, hb: { status: string; version?: string; onecReachable: boolean; onecVersion: string | null; commandsDone?: number; commandsFailed?: number }): Promise<void> {
		// Счётчики команд с запуска службы — «нет поля» не затирает прежние (старая сборка их не шлёт).
		await this.db.query(
			`UPDATE agents
			    SET status = $2, onec_reachable = $3, onec_version = $4,
			        version = COALESCE($5, version), last_seen_at = now(),
			        commands_done = COALESCE($6, commands_done), commands_failed = COALESCE($7, commands_failed)
			  WHERE id = $1`,
			[id, hb.status, hb.onecReachable, hb.onecVersion, hb.version ?? null, hb.commandsDone ?? null, hb.commandsFailed ?? null],
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

	/**
	 * Снять владение, ТОЛЬКО если им владеет этот экземпляр — для прощального heartbeat.
	 *
	 * Сравнение — в самом UPDATE, а не отдельным чтением перед ним: между «прочитали
	 * владельца» и «сняли» новый процесс успевает забрать аренду, и снятие по старому
	 * прочтению выбило бы уже его.
	 */
	async releaseOwnershipIf(agentId: string, instanceId: string): Promise<boolean> {
		const r = await this.db.query(
			`UPDATE agents SET owner_instance_id = NULL, owner_seen_at = NULL, owner_since = NULL
			  WHERE id = $1 AND owner_instance_id = $2`,
			[agentId, instanceId.slice(0, 200)],
		);
		return (r.rowCount ?? 0) > 0;
	}

	async touchInstance(agentId: string, instanceId: string, version: string | null, remoteAddr?: string | null): Promise<void> {
		const r = await this.db.query<{ inserted: boolean }>(
			`INSERT INTO agent_instances (agent_id, instance_id, version, remote_addr)
			 VALUES ($1, $2, $3, $4)
			 ON CONFLICT (agent_id, instance_id)
			 DO UPDATE SET last_seen_at = now(),
			               version = COALESCE(EXCLUDED.version, agent_instances.version),
			               remote_addr = COALESCE(EXCLUDED.remote_addr, agent_instances.remote_addr)
			 RETURNING (xmax = 0) AS inserted`,
			[agentId, instanceId.slice(0, 200), version, remoteAddr ?? null],
		);
		/*
		 * ПОЯВИЛСЯ НОВЫЙ ЭКЗЕМПЛЯР — значит, службу перезапустили, и всё, что мы знали о
		 * прежнем, недействительно. Снимок процессов принадлежал ему: после перезапуска в
		 * нём чужие pid'ы, и панель предлагала снять давно умерший процесс. Человек жал и
		 * получал от агента честный отказ — «процесса 10040 нет среди запущенных агентом».
		 * Ответ верный, вопрос неверный: список принадлежал покойнику.
		 */
		if (r.rows[0]?.inserted) {
			this.forgetInstanceState(agentId);
			await this.db.query(
				`UPDATE agents SET processes = '[]'::jsonb, processes_seen_at = NULL WHERE id = $1`,
				[agentId],
			);
		}
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
	 * Экземпляры и владельцы токена СРАЗУ ДЛЯ СПИСКА агентов (аудит 26.09): панель опрашивает список раз в 15 с, и
	 * по два запроса на каждого агента (liveInstances + owner) были классическим N+1.
	 */
	async instancesOf(agentIds: readonly string[], secs: number, liveSecs: number): Promise<Map<string, {
		instanceId: string; version: string | null; remoteAddr: string | null; lastSeenAt: Date; live: boolean;
	}[]>> {
		const out = new Map<string, { instanceId: string; version: string | null; remoteAddr: string | null; lastSeenAt: Date; live: boolean }[]>();
		if (!agentIds.length) return out;
		const r = await this.db.query<{
			agent_id: string; instance_id: string; version: string | null; remote_addr: string | null; last_seen_at: Date; live: boolean;
		}>(
			`SELECT agent_id::text AS agent_id, instance_id, version, remote_addr, last_seen_at,
			        (last_seen_at > now() - ($3 || ' seconds')::interval) AS live
			   FROM agent_instances
			  WHERE agent_id = ANY($1::uuid[]) AND last_seen_at > now() - ($2 || ' seconds')::interval
			  ORDER BY last_seen_at DESC`,
			[[...agentIds], String(secs), String(liveSecs)],
		);
		for (const x of r.rows) {
			const list = out.get(x.agent_id) ?? [];
			list.push({ instanceId: x.instance_id, version: x.version, remoteAddr: x.remote_addr, lastSeenAt: x.last_seen_at, live: x.live });
			out.set(x.agent_id, list);
		}
		return out;
	}

	async ownersOf(agentIds: readonly string[]): Promise<Map<string, { instanceId: string | null; seenAt: Date | null }>> {
		const out = new Map<string, { instanceId: string | null; seenAt: Date | null }>();
		if (!agentIds.length) return out;
		const r = await this.db.query<{ id: string; owner_instance_id: string | null; owner_seen_at: Date | null }>(
			`SELECT id::text AS id, owner_instance_id, owner_seen_at FROM agents WHERE id = ANY($1::uuid[])`, [[...agentIds]],
		);
		for (const x of r.rows) out.set(x.id, { instanceId: x.owner_instance_id, seenAt: x.owner_seen_at });
		return out;
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

	/**
	 * Long-poll закрылся. Три разные причины — и только одна из них означает беду:
	 *   • истёк срок ожидания (команд не было) — агент немедленно откроет новый опрос;
	 *   • АГЕНТ ЗАБРАЛ КОМАНДУ и ушёл её выполнять — молчание ожидаемо и длится столько,
	 *     сколько отведено самой команде;
	 *   • службу остановили — опрос не откроется никогда.
	 *
	 * `busyUntilMs` отличает второе от третьего. Без него агент, выполняющий чтение базы
	 * (минуты), объявлялся «не на связи» через десять секунд, и панель отказывала в новых
	 * командах: «Админ-агент 1С не на связи» — в тот момент, когда он делал ровно то, что
	 * ему поручили. Измерено: два чтения расширений подряд, отклика нет три минуты, третья
	 * команда отвергнута.
	 */
	notePollClosed(agentId: string, busyUntilMs = 0): void {
		const p = this.polls.get(agentId) ?? { open: 0, closedAt: 0, busyUntil: 0 };
		p.open = Math.max(0, p.open - 1);
		p.closedAt = Date.now();
		// Берём максимум: агент мог забрать несколько команд, и работает он до самой долгой.
		p.busyUntil = Math.max(p.busyUntil ?? 0, busyUntilMs);
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

		/*
		 * ОБОРВАННЫЙ ОПРОС СИЛЬНЕЕ ЗАНЯТОСТИ.
		 *
		 * Раньше «агент забрал команду» держало его в состоянии «на связи» до конца срока
		 * команды — до пятнадцати минут, а у выгрузки и дольше. Службу останавливали посреди
		 * работы, и панель все эти минуты показывала живого агента: кнопки активны, команды
		 * уходят в очередь и там же умирают по сроку. Проверено на живом сервере: именно так
		 * и выглядит «отключил агента, а панель не замечает».
		 *
		 * Но опрос молчит НЕ ТОЛЬКО когда агент умер: между двумя long-poll'ами всегда есть
		 * зазор. Поэтому: закрылся давно (больше POLL_GAP_MS) — это смерть, и занятость её
		 * не отменяет; закрылся только что — не знаем, и тогда занятость ещё говорит «жив».
		 */
		if (p.closedAt && Date.now() - p.closedAt >= POLL_GAP_MS) return false;
		// Забрал нашу команду и ещё не отчитался — это не молчание, это работа: мы сами
		// вручили ему дело и знаем, сколько оно длится.
		if ((p.busyUntil ?? 0) > Date.now()) return true;
		return p.closedAt ? null : null;
	}

	/** Снимок процессов агента из heartbeat: последнее известное состояние, без истории. */
	async setProcesses(id: string, processes: AgentProcess[]): Promise<void> {
		await this.db.query(
			`UPDATE agents SET processes = $2::jsonb, processes_seen_at = now() WHERE id = $1`,
			[id, JSON.stringify(processes)],
		);
	}

	/**
	 * Последний снимок отказов и времени команд (S5). Поле, которого в снимке нет, не
	 * затирается (COALESCE): сборка, шлющая только отказы, не должна стирать время команд.
	 */
	/** Ход обновления из heartbeat. `null` в поле — агент его не прислал: прежний снимок не затираем. */
	async setUpdateState(id: string, state: Record<string, unknown>): Promise<void> {
		await this.db.query(`UPDATE agents SET update_state = $2::jsonb WHERE id = $1`, [id, JSON.stringify(state)]);
	}

	async setCommandStats(id: string, stats: CommandStats): Promise<void> {
		await this.db.query(
			`UPDATE agents
			    SET failures_by_code = COALESCE($2::jsonb, failures_by_code),
			        durations_by_type = COALESCE($3::jsonb, durations_by_type),
			        command_stats_seen_at = now()
			  WHERE id = $1`,
			[
				id,
				stats.failuresByCode ? JSON.stringify(stats.failuresByCode) : null,
				stats.durationsByType ? JSON.stringify(stats.durationsByType) : null,
			],
		);
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
			limits: { maxBases: r.max_bases ?? null },
			id: r.id,
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
			busy: (this.polls.get(r.id)?.busyUntil ?? 0) > Date.now(),
			// Процессы показываем, только пока агент на связи: список остановленной службы
			// — это её прошлое, а не то, что сейчас происходит на сервере.
			processes: online && Array.isArray(r.processes) ? (r.processes as AgentProcess[]) : [],
			processesSeenAt: r.processes_seen_at?.toISOString() ?? null,
			// Статистику показываем и у молчащего агента: «что было до остановки» — тоже ответ.
			commandStats: r.command_stats_seen_at
				? {
					failuresByCode: asRecord(r.failures_by_code) as Record<string, number>,
					durationsByType: asRecord(r.durations_by_type) as Record<string, DurationStat>,
					seenAt: r.command_stats_seen_at.toISOString(),
				}
				: null,
			lastSeenAt: r.last_seen_at?.toISOString() ?? null,
			registeredAt: r.registered_at?.toISOString() ?? null,
			disabled: !!r.disabled_at,
			// Счётчики команд с запуска службы (heartbeat); null — агент их не присылает.
			commandsDone: r.commands_done ?? null,
			commandsFailed: r.commands_failed ?? null,
			// Ход обновления службы, как его прислал агент; null — не обновлялся (или сборка старее).
			update: (r.update_state ?? null) as AgentView["update"],
		};
	}
}

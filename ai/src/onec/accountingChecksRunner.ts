/**
 * НОЧНОЙ ПРОГОН ПРОВЕРОК УЧЁТА ПО БАЗАМ КЛИЕНТОВ (E17, СК2.2; docs/PLAN_QUALITY_STANDARD_2026-09-25.md).
 *
 * ЧТО ДЕЛАЕТ. Раз в сутки обходит базы бизнес-агентов на связи, спрашивает у каждой каталог проверок
 * (`LIST_ACCOUNTING_CHECKS`), прогоняет доступные проверки (`RUN_ACCOUNTING_CHECK`) и снимки
 * (`GET_ACCOUNTING_SNAPSHOT`) по её организациям и отправляет ответы в ERP (`POST /bpai/checks/results`) —
 * одной посылкой на организацию. Находки в задачи превращает ERP; сервис ничего не решает о сроках,
 * ответственных и пунктах стандарта — он только приносит «что не так в базе».
 *
 * ЧТО ПРОВЕРЯЕТСЯ. Организации баз из среза агента (`agent_bases.organizations`), чей БИН есть в ERP: без
 * организации ERP находку некому адресовать. БИН в нескольких базах проверяется один раз — в первой по порядку
 * среза, как агент и адресует команды этого БИН. Базы и БИНы сверх тарифа не трогаются: агент отказал бы им
 * всё равно.
 *
 * ТОЛЬКО ОБСЛУЖИВАЕМЫЕ (п. 10 реестра, решено 25.09). Обслуживаемые фирмой — клиенты групп сотрудников (не
 * удалённых) и клиенты действующих, не истёкших связей обслуживания (`service_links`). Если такие есть, проверяются
 * только они: находки по организации, которую фирма не ведёт, — задачи без ответственного и шум на панели. Если
 * нет ни одной (стандарт качества ещё не настроен), проверяются все организации, известные ERP, — как до E17, чтобы
 * включение групп не выглядело как «проверки пропали». Какое правило сработало — в логе и в сводке журнала.
 *
 * БАЗА НЕ ПРОВЕРЕНА (п. 21 реестра, решено 25.09). Каталог не получен (1С отказала, не ответила, срок истёк) или
 * сборка агента не знает команд проверок — ERP получает по каждой проверяемой организации базы короткую посылку:
 * `catalog: null` и одну строку `_catalog` с причиной. Иначе молчание базы на панели главбуха выглядело бы как
 * «находок нет». Одна посылка на организацию за прогон; агенту без команд проверок — ни одной команды.
 *
 * ПОРЯДОК. Базы — параллельно, не больше ACCOUNTING_CHECKS_PARALLEL; внутри базы команды строго по одной:
 * каждая занимает сеанс и лицензию клиента. Отказ одной проверки — строка `ok: false` в посылке, а не конец
 * прогона; только признаки пропавшего агента или повисшей базы (см. isUnresponsive) останавливают эту базу.
 *
 * ОДИН ИНСТАНС. Как и обслуживание по расписанию (maintenanceRunner.ts), сервис работает одним процессом.
 * От второго планового прогона за ту же ночь (перезапуск, второй процесс) защищает уникальный индекс журнала
 * (миграция 044), а вот «прогон идёт» знает только память процесса: при нескольких инстансах ручной запуск
 * мог бы пойти параллельно плановому в другом процессе. Незавершённые записи журнала при первом тике
 * считаются прерванными — это верно, пока процесс один.
 */
import { randomUUID } from "node:crypto";
import type { Db } from "../db/pool.ts";
import type { Logger } from "../logger.ts";
import type { AgentService, AgentView } from "../agents/service.ts";
import { evaluateLimits, type AgentBasesStore } from "../agents/agentBases.ts";
import type { CommandQueue } from "../commands/queue.ts";
import { agentKnowsType } from "../commands/admin.ts";
import { ErpRefused, ErpUnavailable, type ErpCheckResults, type ErpCheckRun, type ErpSnapshotRun, type ErpTasks } from "../erp/tasks.ts";
import {
	CAPABILITY_MISSING, CATALOG_CHECK, GET_SNAPSHOT, LIST_CHECKS, RUN_CHECK, checksWindowDate, isUnresponsive, localDate, parseCatalog,
	planOrganization, uncheckedReason, unwrapData, type CheckCatalog, type CommandFailure,
} from "./accountingChecks.ts";

// ── Журнал прогонов ────────────────────────────────────────────────────────

export type RunKind = "schedule" | "manual";

/** Строка журнала для панели. */
export type CheckRunView = {
	id: string; runDate: string; kind: RunKind; userUuid: string | null;
	startedAt: string; finishedAt: string | null;
	bases: number; orgs: number; commands: number; failures: number;
	summary: Record<string, unknown>; note: string | null;
};

type RunRow = {
	id: string; run_date: string | Date; kind: RunKind; user_uuid: string | null; started_at: Date; finished_at: Date | null;
	bases: number; orgs: number; commands: number; failures: number; summary: Record<string, unknown> | null; note: string | null;
};

/** Итог прогона — в журнал. */
export type RunTotals = { bases: number; orgs: number; commands: number; failures: number; summary: Record<string, unknown>; note: string | null };

/**
 * ЖУРНАЛ ПРОГОНОВ (`accounting_check_runs`). Две работы: не дать второму ПЛАНОВОМУ прогону начаться в ту же ночь
 * (уникальный индекс по дате окна — атомарно, без блокировок) и показать оператору, что было ночью.
 */
export class AccountingCheckRunStore {
	private readonly db: Pick<Db, "query">;
	constructor(db: Pick<Db, "query">) {
		this.db = db;
	}

	/**
	 * Занять прогон. Плановый — не больше одного за окно: `null`, если сегодняшний уже был (или идёт в другом
	 * процессе). Ручной — всегда новая строка.
	 */
	async claim(i: { kind: RunKind; runDate: string; userUuid: string | null; summary?: Record<string, unknown> }): Promise<string | null> {
		const id = randomUUID();
		const conflict = i.kind === "schedule" ? "ON CONFLICT (run_date) WHERE kind = 'schedule' DO NOTHING" : "";
		const r = await this.db.query<{ id: string }>(
			`INSERT INTO accounting_check_runs (id, run_date, kind, user_uuid, summary)
			 VALUES ($1, $2::date, $3, $4, $5::jsonb) ${conflict}
			 RETURNING id`,
			[id, i.runDate, i.kind, i.userUuid, JSON.stringify(i.summary ?? {})],
		);
		return r.rows[0]?.id ?? null;
	}

	async finish(id: string, t: RunTotals): Promise<void> {
		await this.db.query(
			`UPDATE accounting_check_runs
			    SET finished_at = now(), bases = $2, orgs = $3, commands = $4, failures = $5, summary = $6::jsonb, note = $7
			  WHERE id = $1`,
			[id, t.bases, t.orgs, t.commands, t.failures, JSON.stringify(t.summary), t.note],
		);
	}

	/**
	 * Незавершённые записи чужих (умерших) процессов — прерванными. Иначе журнал вечно показывал бы «идёт»
	 * прогон, который оборвал перезапуск сервиса. `keep` — прогон, идущий в этом процессе прямо сейчас.
	 */
	async interruptUnfinished(keep: string | null): Promise<number> {
		const r = await this.db.query(
			`UPDATE accounting_check_runs
			    SET finished_at = now(), note = COALESCE(note || '; ', '') || 'прервано: сервис перезапущен до окончания прогона'
			  WHERE finished_at IS NULL AND ($1::uuid IS NULL OR id <> $1::uuid)`,
			[keep],
		);
		return r.rowCount ?? 0;
	}

	async list(limit = 20): Promise<CheckRunView[]> {
		const r = await this.db.query<RunRow>(
			`SELECT id, run_date::text AS run_date, kind, user_uuid, started_at, finished_at, bases, orgs, commands, failures, summary, note
			   FROM accounting_check_runs ORDER BY started_at DESC LIMIT $1`,
			[Math.min(Math.max(limit, 1), 100)],
		);
		return r.rows.map((x) => ({
			id: x.id, runDate: typeof x.run_date === "string" ? x.run_date : localDate(x.run_date), kind: x.kind, userUuid: x.user_uuid,
			startedAt: new Date(x.started_at).toISOString(), finishedAt: x.finished_at ? new Date(x.finished_at).toISOString() : null,
			bases: x.bases, orgs: x.orgs, commands: x.commands, failures: x.failures, summary: x.summary ?? {}, note: x.note,
		}));
	}
}

// ── Прогонщик ──────────────────────────────────────────────────────────────

export type ChecksConfig = {
	/** Плановый прогон включён (ручной работает всегда). */
	enabled: boolean;
	/** «ЧЧ:ММ» по часам сервера. */
	at: string;
	/** Сколько баз одновременно. */
	parallel: number;
	/** Предел одной команды, секунды (как у агента). */
	commandTimeoutSecs: number;
	/** Сколько находок одной проверки просить у 1С. */
	limit: number;
};

export type ChecksDeps = {
	agents: Pick<AgentService, "listAll">;
	agentBases: Pick<AgentBasesStore, "listMany">;
	/** База ERP, только чтение: БИН → организация. */
	erp: Pick<Db, "query">;
	queue: Pick<CommandQueue, "enqueue" | "waitResult">;
	/** Куда отправлять результаты: служебный канал ERP. */
	sink: Pick<ErpTasks, "enabled" | "sendCheckResults">;
	store: Pick<AccountingCheckRunStore, "claim" | "finish" | "interruptUnfinished">;
	log: Pick<Logger, "info" | "warn" | "error">;
	/** Часы — подставляются тестом. */
	now?: () => Date;
	/** Пауза перед повтором отправки в ERP — тест ставит ноль. */
	retryDelayMs?: number;
};

type Outcome = { ok: true; data: unknown } | { ok: false; error: CommandFailure };

type Failure = CommandFailure;

/**
 * Организация базы, которую проверяем: БИН из среза агента, имя и uuid — из ERP. `served` — фирма её обслуживает
 * (клиент группы сотрудников или действующей связи обслуживания); по нему выбирается, кому отдать проверки базы.
 */
type TargetOrg = { bin: string; uuid: string; name: string | null; served: boolean };

/** База, которую проверяем: у кого спрашивать, какие её организации известны ERP. */
export type CheckTarget = {
	agentId: string;
	/** Организация агента — в строку очереди, как у всех бизнес-команд. */
	agentOrganizationUuid: string;
	baseKey: string;
	orgs: TargetOrg[];
	/** Знает ли сборка агента снимки: старая может уметь проверки, но не снимки. */
	snapshots: boolean;
	/**
	 * Почему базу нельзя проверить, не спрашивая её (сборка агента без команд проверок). Команд не ставим, ERP
	 * получает «база не проверена» по каждой организации. `null` — обычная база.
	 */
	blocked: Failure | null;
};

/**
 * ОБСЛУЖИВАЕМЫЕ ФИРМОЙ ОРГАНИЗАЦИИ (п. 10 реестра): клиенты групп сотрудников, кроме удалённых групп, и клиенты
 * действующих связей обслуживания со сроком, который не истёк. Связь в состоянии `requested` (клиент ещё не
 * подтвердил), `suspended` и `revoked` — не обслуживание: доступа к учёту клиента у фирмы нет. UNION снимает повторы.
 *
 * ПРОВЕРИТЬ ПОТОМ: связи обслуживания берутся от ЛЮБОЙ обслуживающей организации, а группы — любой фирмы. В установке
 * с одной фирмой это одно и то же; если в одной ERP заработают несколько фирм, отбор, вероятно, надо сузить до
 * «организации-фирмы» из настроек качества — и тогда решить, чьи клиенты проверяет общий агент.
 */
export const SERVED_ORGANIZATIONS_SQL = `
	SELECT c."clientOrganizationUuid" AS uuid
	  FROM staff_group_clients c
	  JOIN staff_groups g ON g.uuid = c."groupUuid" AND g."deletedAt" IS NULL
	UNION
	SELECT l."clientOrgUuid" AS uuid
	  FROM service_links l
	 WHERE l.state = 'active' AND (l."validUntil" IS NULL OR l."validUntil" > now())`;

/** Какие организации проверяем — правило отбора (п. 10 реестра); в лог и в сводку журнала. */
export type CheckScope = {
	/** `served` — только обслуживаемые фирмой; `all` — все, чей БИН знает ERP: обслуживание ещё не настроено. */
	rule: "served" | "all";
	/** Сколько организаций ERP считает обслуживаемыми (всего, а не только в базах агентов). */
	servedOrgs: number;
	/** Почему это правило — для человека, читающего журнал. */
	reason: string;
};

/** Что пропущено при сборе целей — в журнал: «почему эту базу ночью не проверяли». */
export type SkipReport = {
	/**
	 * Агенты, чья сборка не знает команд проверок. Их базам команд не ставим, но ERP узнаёт, что базы не
	 * проверены (строка `_catalog` с CAPABILITY_MISSING, см. BaseReport с этой ошибкой).
	 */
	agentsWithoutCapability: string[];
	basesOverLimit: string[];
	basesOffline: string[];
	basesWithoutOrganizations: string[];
	binsOverLimit: string[];
	binsInOtherBase: string[];
	binsNotInErp: string[];
	/** БИН известен ERP, но фирма эту организацию не обслуживает (действует правило `served`). */
	binsNotServed: string[];
};

/** Итог по одной базе — строка в сводке журнала. */
export type BaseReport = {
	agentId: string; baseKey: string; bins: string[];
	commands: number; failures: number; forwarded: number; forwardFailed: number;
	/** Почему базу не проверили или проверили не до конца — как её сказала 1С или сам сервис (ERP получает её же, см. uncheckedReason). */
	error?: Failure;
};

export type RunReport = {
	targets: number; orgs: number; commands: number; failures: number; skipped: SkipReport; bases: BaseReport[]; forward: { ok: number; failed: number };
	/** Правило отбора организаций; `null` — ни одной базы-кандидата, и ERP об обслуживании не спрашивали. */
	scope: CheckScope | null;
};

export type StartResult =
	| { ok: true; runId: string; done: Promise<RunReport | null> }
	| { ok: false; code: "RUN_IN_PROGRESS" | "ALREADY_RAN" | "ERP_DISABLED"; message: string; runId?: string };

const BIN_RE = /^\d{12}$/;

export class AccountingChecksRunner {
	private readonly d: ChecksDeps;
	private readonly cfg: ChecksConfig;
	private readonly clock: () => Date;
	/** Прогон, идущий в этом процессе. Ставится ДО первого await в start(): два запуска разом не пройдут оба. */
	private current: { id: string | null; kind: RunKind; startedAt: string } | null = null;
	/** Дата окна последнего планового прогона: чтобы не стучаться в журнал каждую минуту окна. */
	private lastRunDate: string | null = null;
	private cleanup: Promise<unknown> | null = null;

	constructor(deps: ChecksDeps, cfg: ChecksConfig) {
		this.d = deps;
		this.cfg = cfg;
		this.clock = deps.now ?? (() => new Date());
	}

	/** Идущий прогон — для панели; `null` — ничего не идёт. */
	get running(): { id: string; kind: RunKind; startedAt: string } | null {
		return this.current?.id ? { id: this.current.id, kind: this.current.kind, startedAt: this.current.startedAt } : null;
	}

	/**
	 * ТИК РАЗ В МИНУТУ (server.ts). Решает, пора ли, и запускает прогон ФОНОМ: сам тик короткий, а прогон длится
	 * часами. Идёт прогон — тик ничего не делает: второй поверх первого занял бы те же сеансы 1С.
	 */
	async tick(): Promise<"disabled" | "busy" | "not-due" | "started" | "already-ran" | "refused"> {
		if (!this.cfg.enabled) return "disabled";
		await this.cleanupOnce();
		if (this.current) return "busy";
		const now = this.clock();
		const day = checksWindowDate(now, this.cfg.at);
		if (!day || day === this.lastRunDate) return "not-due";
		const r = await this.start({ kind: "schedule", runDate: day, userUuid: null });
		// Отметку ставим и при отказе: иначе «ERP не настроена» писалась бы в журнал каждую минуту окна.
		this.lastRunDate = day;
		if (r.ok) return "started";
		if (r.code === "ALREADY_RAN") return "already-ran";
		this.d.log.warn({ code: r.code, reason: r.message }, "проверки учёта: плановый прогон не начат");
		return "refused";
	}

	/**
	 * Начать прогон (плановый или ручной). Возвращается сразу; `done` — окончание прогона (null — он упал, это
	 * уже в журнале и в логе). `baseKey` — только эта база: ручная обкатка на одной базе вместо всех клиентов.
	 */
	async start(opts: { kind: RunKind; userUuid: string | null; runDate?: string; baseKey?: string | null }): Promise<StartResult> {
		if (this.current) {
			return { ok: false, code: "RUN_IN_PROGRESS", message: "Прогон проверок учёта уже идёт — дождитесь его окончания", ...(this.current.id ? { runId: this.current.id } : {}) };
		}
		if (!this.d.sink.enabled) {
			return { ok: false, code: "ERP_DISABLED", message: "Служебный канал ERP не настроен (ERP_API_KEY): результатам проверок некуда идти" };
		}
		const startedAt = this.clock();
		const slot = { id: null as string | null, kind: opts.kind, startedAt: startedAt.toISOString() };
		this.current = slot;
		let id: string | null;
		try {
			await this.cleanupOnce();
			id = await this.d.store.claim({
				kind: opts.kind, runDate: opts.runDate ?? localDate(startedAt), userUuid: opts.userUuid,
				summary: opts.baseKey ? { baseKey: opts.baseKey } : {},
			});
		} catch (e) {
			this.current = null;
			throw e;
		}
		if (!id) {
			this.current = null;
			// Без номера остаётся только плановый — его не пустил уникальный индекс. Ручная запись вставляется
			// всегда, и её пропажа — сбой, а не «уже был»: отвечать оператору неправдой нельзя.
			if (opts.kind !== "schedule") throw new Error("журнал прогонов не вернул номер записи");
			return { ok: false, code: "ALREADY_RAN", message: "Плановый прогон за эту ночь уже был" };
		}
		slot.id = id;
		const runId = id;
		const done = this.execute(runId, opts.baseKey ?? null).finally(() => { this.current = null; });
		return { ok: true, runId, done };
	}

	/** Первый тик или запуск процесса: записи журнала, оборванные прежним процессом, — прерванными. */
	private cleanupOnce(): Promise<unknown> {
		this.cleanup ??= this.d.store.interruptUnfinished(this.current?.id ?? null)
			.then((n) => { if (n) this.d.log.warn({ n }, "проверки учёта: незавершённые прогоны прежнего процесса отмечены прерванными"); })
			.catch((e) => {
				this.cleanup = null;
				this.d.log.warn({ err: e instanceof Error ? e.message : String(e) }, "проверки учёта: журнал не прочитан");
			});
		return this.cleanup;
	}

	/** Прогон целиком и запись итога. Никогда не бросает: всё, что пошло не так, — в журнал и в лог. */
	private async execute(runId: string, baseKey: string | null): Promise<RunReport | null> {
		const t0 = Date.now();
		try {
			const report = await this.run(baseKey);
			await this.d.store.finish(runId, {
				bases: report.targets, orgs: report.orgs, commands: report.commands, failures: report.failures,
				summary: { ...(baseKey ? { baseKey } : {}), scope: report.scope, bases: report.bases, skipped: report.skipped, forward: report.forward },
				note: report.targets ? null : report.scope?.rule === "served"
					? "нечего проверять: нет баз на связи с организациями, которые обслуживает фирма"
					: "нечего проверять: нет баз на связи с организациями, известными ERP",
			});
			this.d.log.info({ runId, bases: report.targets, orgs: report.orgs, commands: report.commands, failures: report.failures,
				forward: report.forward, durationMs: Date.now() - t0 }, "проверки учёта: прогон окончен");
			return report;
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			this.d.log.error({ runId, err: message }, "проверки учёта: прогон упал");
			await this.d.store.finish(runId, { bases: 0, orgs: 0, commands: 0, failures: 0, summary: {}, note: `сбой прогона: ${message}` })
				.catch((err) => this.d.log.error({ runId, err: err instanceof Error ? err.message : String(err) }, "проверки учёта: итог не записан"));
			return null;
		}
	}

	/** Сам прогон: цели → базы параллельно → итог. Открыт для тестов. */
	async run(baseKey: string | null = null): Promise<RunReport> {
		const { targets, skipped, scope } = await this.collectTargets(baseKey);
		this.d.log.info({ targets: targets.length, orgs: targets.reduce((n, t) => n + t.orgs.length, 0), rule: scope?.rule ?? null, skipped }, "проверки учёта: прогон начат");
		const bases: BaseReport[] = [];
		let next = 0;
		const worker = async () => {
			while (next < targets.length) {
				const t = targets[next++];
				bases.push(await this.runBase(t));
			}
		};
		await Promise.all(Array.from({ length: Math.max(1, Math.min(this.cfg.parallel, targets.length)) }, worker));
		return {
			targets: targets.length,
			orgs: targets.reduce((n, t) => n + t.orgs.length, 0),
			commands: bases.reduce((n, b) => n + b.commands, 0),
			failures: bases.reduce((n, b) => n + b.failures, 0),
			skipped,
			bases,
			forward: { ok: bases.reduce((n, b) => n + b.forwarded, 0), failed: bases.reduce((n, b) => n + b.forwardFailed, 0) },
			scope,
		};
	}

	/**
	 * КОГО ПРОВЕРЯЕМ. Бизнес-агенты на связи; их базы — в пределах тарифа и не лежащие; организации баз — с БИН,
	 * в первой базе этого БИН, известные ERP и — если фирма уже назвала своих клиентов — обслуживаемые ею (п. 10
	 * реестра, см. loadScope). Базы агентов, чья сборка не знает команд проверок, тоже попадают в цели — с отметкой
	 * `blocked`: команд им не ставим, но ERP узнаёт, что базы не проверены (п. 21).
	 *
	 * ПРОВЕРИТЬ ПОТОМ: база агента не на связи и база, которую агент сам отметил лежащей (OFFLINE), остаются только
	 * в журнале сервиса — ERP о них посылки «база не проверена» не получает. Срез агента не на связи может быть
	 * устаревшим (базы переехали к другому агенту), и отметка по нему была бы ложной; решение — за владельцем
	 * вместе с тем, как ERP показывает давность последней проверки.
	 */
	async collectTargets(baseKey: string | null = null): Promise<{ targets: CheckTarget[]; skipped: SkipReport; scope: CheckScope | null }> {
		const skipped: SkipReport = {
			agentsWithoutCapability: [], basesOverLimit: [], basesOffline: [], basesWithoutOrganizations: [],
			binsOverLimit: [], binsInOtherBase: [], binsNotInErp: [], binsNotServed: [],
		};
		const wanted = baseKey?.trim().toLowerCase() || null;
		const agents = (await this.d.agents.listAll()).filter((a) => a.role === "business" && !a.disabled && a.online);
		const able: AgentView[] = [];
		const unable: AgentView[] = [];
		for (const a of agents) {
			/*
			 * Сборка агента без команд проверок — не повод гонять по ней отказы: одна строка в лог на прогон, ни одной
			 * команды, а ERP — отметка CAPABILITY_MISSING по организациям её баз. Агент, не перечисляющий типов вовсе
			 * (сборка старее перечня), проходит как умеющий: молчание не значит «не умеет», а отказ каталога обойдётся
			 * одной короткой командой на базу — и тоже дойдёт до ERP (см. runBase).
			 */
			if (!agentKnowsType(a, LIST_CHECKS) || !agentKnowsType(a, RUN_CHECK)) {
				skipped.agentsWithoutCapability.push(a.id);
				this.d.log.info({ agentId: a.id, name: a.name }, "проверки учёта: сборка агента не умеет команды проверок — его базы не проверяются, ERP получит отметку");
				unable.push(a);
				continue;
			}
			able.push(a);
		}
		/*
		 * УМЕЮЩИЕ — ПЕРВЫМИ. БИН проверяется в одной базе на весь прогон (`taken`), и кто первым его занял, тот и
		 * проверяет. Если бы неумеющая сборка шла раньше, организация, которую другой агент проверил бы по-настоящему,
		 * получила бы вместо проверок отметку «обновите агента».
		 */
		const ordered = [...able, ...unable];
		const slices = ordered.length ? await this.d.agentBases.listMany(ordered.map((a) => a.id)) : new Map();

		type Candidate = { agent: AgentView; baseKey: string; bins: { bin: string; name: string | null }[]; blocked: Failure | null };
		const candidates: Candidate[] = [];
		const taken = new Set<string>();
		for (const a of ordered) {
			const bases = slices.get(a.id) ?? [];
			const v = evaluateLimits(bases, a.limits);
			for (const b of bases) {
				if (wanted && b.key.toLowerCase() !== wanted) continue;
				const label = `${b.key}@${a.id}`;
				if (v.overBases.includes(b.key)) { skipped.basesOverLimit.push(label); continue; }
				if (b.status === "OFFLINE") { skipped.basesOffline.push(label); continue; }
				if (!b.organizations?.length) { skipped.basesWithoutOrganizations.push(label); continue; }
				const bins: Candidate["bins"] = [];
				for (const o of b.organizations) {
					const bin = o.bin?.trim() ?? "";
					if (!BIN_RE.test(bin) || bins.some((x) => x.bin === bin)) continue;
					if (v.overBins.includes(bin)) { skipped.binsOverLimit.push(bin); continue; }
					/*
					 * БИН В НЕСКОЛЬКИХ БАЗАХ — проверяется в первой базе в пределах тарифа по порядку среза, как агент и
					 * адресует его команды. Вторая база с тем же БИН — чаще всего копия или старая база, и её находки
					 * были бы шумом в задачах бухгалтера. Ручной запуск по конкретной базе это правило не применяет:
					 * оператор назвал базу сам.
					 *
					 * ПРОВЕРИТЬ ПОТОМ: если окажется, что организация ведётся в двух рабочих базах одновременно,
					 * проверять нужно обе, а ERP — различать находки по baseKey.
					 */
					const first = (v.binBases.get(bin) ?? []).find((k) => !v.overBases.includes(k));
					if (!wanted && ((first && first !== b.key) || taken.has(bin))) { skipped.binsInOtherBase.push(`${bin}@${b.key}`); continue; }
					taken.add(bin);
					bins.push({ bin, name: o.name });
				}
				if (bins.length) candidates.push({ agent: a, baseKey: b.key, bins, blocked: able.includes(a) ? null : { ...CAPABILITY_MISSING } });
			}
		}

		const all = [...new Set(candidates.flatMap((c) => c.bins.map((x) => x.bin)))];
		// Проверять некого — и об обслуживании ERP не спрашиваем: правило отбора ничего бы не решило.
		if (!all.length) return { targets: [], skipped, scope: null };
		const scope = await this.loadScope();
		this.d.log.info({ rule: scope.rule, servedOrgs: scope.servedOrgs }, `проверки учёта: отбор организаций — ${scope.reason}`);
		const known = new Map<string, { uuid: string; name: string | null; served: boolean }>();
		const r = await this.d.erp.query<{ uuid: string; bin: string; name: string | null }>(
			`SELECT uuid, bin, name FROM organizations WHERE bin = ANY($1::text[]) AND "deletedAt" IS NULL`, [all],
		);
		for (const row of r.rows) {
			const bin = String(row.bin).trim();
			const served = scope.served.has(String(row.uuid).toLowerCase());
			// Один БИН у двух живых организаций ERP (ошибка ввода) — берём обслуживаемую: её и ведёт фирма.
			const prev = known.get(bin);
			if (prev && (prev.served || !served)) continue;
			known.set(bin, { uuid: row.uuid, name: row.name, served });
		}
		const targets: CheckTarget[] = [];
		for (const c of candidates) {
			const orgs: TargetOrg[] = [];
			for (const x of c.bins) {
				const erpOrg = known.get(x.bin);
				if (!erpOrg) { skipped.binsNotInErp.push(x.bin); continue; }
				/*
				 * Правило `served` действует и в ручном запуске по одной базе: оператор выбирает базу, а не то, кого
				 * фирма ведёт, — находки по чужой организации остались бы задачами без ответственного.
				 */
				if (scope.rule === "served" && !erpOrg.served) { skipped.binsNotServed.push(x.bin); continue; }
				orgs.push({ bin: x.bin, uuid: erpOrg.uuid, name: erpOrg.name ?? x.name, served: erpOrg.served });
			}
			if (orgs.length) {
				targets.push({
					agentId: c.agent.id, agentOrganizationUuid: c.agent.organizationUuid, baseKey: c.baseKey, orgs,
					snapshots: agentKnowsType(c.agent, GET_SNAPSHOT), blocked: c.blocked,
				});
			}
		}
		return { targets, skipped, scope: { rule: scope.rule, servedOrgs: scope.servedOrgs, reason: scope.reason } };
	}

	/**
	 * ПРАВИЛО ОТБОРА (п. 10 реестра). Есть хоть одна обслуживаемая организация — проверяем только обслуживаемых; нет
	 * ни одной — стандарт качества ещё не настроен, и проверяются все известные ERP, как до E17.
	 *
	 * В базе ERP без таблиц групп и связей (схема старше E17) — то же «все известные» с предупреждением в лог: это
	 * честное «не настроено». Любой другой сбой запроса прогон останавливает (итог — в журнале): гадать об отборе по
	 * сбою нельзя — «все» разослали бы находки по чужим организациям, а «никто» молча выключил бы проверки.
	 */
	private async loadScope(): Promise<CheckScope & { served: Set<string> }> {
		let rows: { uuid: string }[];
		try {
			rows = (await this.d.erp.query<{ uuid: string }>(SERVED_ORGANIZATIONS_SQL)).rows;
		} catch (e) {
			const code = (e as { code?: unknown } | null)?.code;
			// 42P01 — нет таблицы, 42703 — нет колонки: ERP ещё без миграции E17.
			if (code !== "42P01" && code !== "42703") throw e;
			this.d.log.warn({ err: e instanceof Error ? e.message : String(e) }, "проверки учёта: в базе ERP нет групп сотрудников или связей обслуживания — проверяются все организации, известные ERP");
			return { rule: "all", servedOrgs: 0, served: new Set(), reason: "все известные ERP: в её базе нет групп сотрудников и связей обслуживания (схема старше E17)" };
		}
		const served = new Set(rows.map((x) => String(x.uuid).toLowerCase()).filter(Boolean));
		return served.size
			? { rule: "served", servedOrgs: served.size, served, reason: `только обслуживаемые фирмой (клиенты групп сотрудников и действующих связей обслуживания): ${served.size}` }
			: { rule: "all", servedOrgs: 0, served, reason: "все известные ERP: обслуживание не настроено (нет клиентов в группах сотрудников и действующих связей обслуживания)" };
	}

	/**
	 * ОДНА БАЗА: каталог, затем по организациям — проверки и снимки, и посылка в ERP после каждой организации.
	 * Каталога нет (или сборка агента не умеет проверки) — ERP получает «база не проверена» по каждой организации.
	 * Никогда не бросает: итог базы — строка сводки, а не падение прогона.
	 */
	async runBase(t: CheckTarget): Promise<BaseReport> {
		const report: BaseReport = { agentId: t.agentId, baseKey: t.baseKey, bins: t.orgs.map((o) => o.bin), commands: 0, failures: 0, forwarded: 0, forwardFailed: 0 };
		const startedAt = this.clock().toISOString();
		if (t.blocked) {
			// Сборка агента без команд проверок: спрашивать базу бессмысленно, отказ известен заранее.
			report.error = t.blocked;
			await this.forwardUnchecked(t, t.blocked, startedAt, report);
			return report;
		}
		/*
		 * Без каталога проверок не ставим: проверять вслепую — значит ставить команды, про которые 1С уже сказала бы
		 * «такой нет». Но и молчать нельзя — ERP получает «база не проверена» с причиной (п. 21 реестра).
		 */
		const got = await this.fetchCatalog(t, report);
		if (!got.ok) {
			report.failures++;
			report.error = got.error;
			this.d.log.warn({ agentId: t.agentId, baseKey: t.baseKey, code: got.error.code, reason: got.error.message }, "проверки учёта: каталог базы не получен — база не проверена");
			await this.forwardUnchecked(t, uncheckedReason(got.error), startedAt, report);
			return report;
		}
		const catalog = got.catalog;
		try {
			/*
			 * ПРОВЕРКИ БАЗЫ (справочники общие на всю базу) — один раз и одной организации (п. 11 реестра): первой
			 * ОБСЛУЖИВАЕМОЙ фирмой в порядке среза агента, а если обслуживание не настроено — первой известной ERP.
			 * У необслуживаемой организации нет ответственного, и сводная задача по дублям повисла бы без исполнителя.
			 */
			const owner = t.orgs.find((o) => o.served) ?? t.orgs[0];
			// Причина, по которой база перестала отвечать: остальные вызовы не ставим, а пишем «не выполнялась».
			let gone: Failure | null = null;
			for (const org of t.orgs) {
				const orgStartedAt = this.clock().toISOString();
				const calls = planOrganization(catalog, org.bin, {
					now: this.clock(), limit: this.cfg.limit, withBase: org === owner, withSnapshots: t.snapshots,
				});
				const runs: ErpCheckRun[] = [];
				const snapshots: ErpSnapshotRun[] = [];
				for (const c of calls) {
					let res: Outcome;
					if (gone) {
						res = { ok: false, error: { code: "NOT_RUN", message: `Не выполнялась: база перестала отвечать (${gone.code}: ${gone.message})` } };
					} else {
						res = await this.exec(t, c.kind === "check" ? RUN_CHECK : GET_SNAPSHOT, c.payload);
						report.commands++;
						if (!res.ok && isUnresponsive(res.error.code)) {
							gone = res.error;
							this.d.log.warn({ agentId: t.agentId, baseKey: t.baseKey, code: res.error.code }, "проверки учёта: база не отвечает — остальные проверки базы не ставятся");
						}
					}
					if (!res.ok) report.failures++;
					if (c.kind === "check") runs.push({ check: c.code, scope: c.scope, request: c.payload, ...res });
					else snapshots.push({ snapshot: c.code, request: c.payload, ...res });
				}
				await this.forward({
					bin: org.bin, baseKey: t.baseKey, agentId: t.agentId,
					startedAt: orgStartedAt, finishedAt: this.clock().toISOString(),
					catalog: catalog.wire, runs, snapshots,
				}, report);
			}
		} catch (e) {
			// Сбой своей стороны (БД очереди) — итог базы, а не всего прогона.
			const message = e instanceof Error ? e.message : String(e);
			report.failures++;
			report.error = { code: "INTERNAL", message };
			this.d.log.error({ agentId: t.agentId, baseKey: t.baseKey, err: message }, "проверки учёта: сбой при проверке базы");
		}
		this.d.log.info({ agentId: t.agentId, baseKey: t.baseKey, orgs: t.orgs.length, commands: report.commands, failures: report.failures }, "проверки учёта: база проверена");
		return report;
	}

	/**
	 * Каталог базы — или причина, по которой его нет. Сбой своей стороны (БД очереди) здесь тоже причина, а не
	 * исключение: база без каталога остаётся непроверенной, и ERP должна узнать об этом так же, как об отказе 1С.
	 */
	private async fetchCatalog(t: CheckTarget, report: BaseReport): Promise<{ ok: true; catalog: CheckCatalog } | { ok: false; error: Failure }> {
		let listed: Outcome;
		try {
			listed = await this.exec(t, LIST_CHECKS, {});
		} catch (e) {
			return { ok: false, error: { code: "INTERNAL", message: `Сбой сервиса BuhProf AI при запросе каталога проверок: ${e instanceof Error ? e.message : String(e)}` } };
		}
		report.commands++;
		if (!listed.ok) return listed;
		const catalog = parseCatalog(listed.data);
		return catalog ? { ok: true, catalog } : { ok: false, error: { code: "BAD_CATALOG", message: "1С вернула каталог проверок в незнакомой форме" } };
	}

	/**
	 * «БАЗА НЕ ПРОВЕРЕНА» — В ERP (п. 21 реестра). По каждой организации базы, которую проверили бы, — посылка без
	 * каталога с единственной строкой `_catalog`: ERP хранит её как прогон с отказом и показывает на панели главбуха.
	 * Строка на каждую проверку ничего бы не добавила: каталога нет, и какие проверки не прошли, неизвестно.
	 * Организации — те же, что попали в цели: известные ERP и обслуживаемые по правилу отбора.
	 */
	private async forwardUnchecked(t: CheckTarget, error: Failure, startedAt: string, report: BaseReport): Promise<void> {
		const finishedAt = this.clock().toISOString();
		for (const org of t.orgs) {
			await this.forward({
				bin: org.bin, baseKey: t.baseKey, agentId: t.agentId, startedAt, finishedAt, catalog: null,
				runs: [{ check: CATALOG_CHECK, scope: "base", request: {}, ok: false, error }],
				snapshots: [],
			}, report);
		}
		this.d.log.info({ agentId: t.agentId, baseKey: t.baseKey, orgs: t.orgs.length, code: error.code, forwarded: report.forwarded, forwardFailed: report.forwardFailed },
			"проверки учёта: база не проверена — отметка отправлена в ERP");
	}

	/**
	 * Команда агенту и ожидание ответа. Работа сервиса, а не человека: `userUuid` пуст, приоритет пакетный (10) —
	 * ночной прогон не должен загораживать того, кто в этот час всё-таки пишет в чат.
	 */
	private async exec(t: CheckTarget, type: string, payload: Record<string, unknown>): Promise<Outcome> {
		const ttl = this.cfg.commandTimeoutSecs;
		let id: string;
		try {
			const cmd = await this.d.queue.enqueue({
				agentId: t.agentId, organizationUuid: t.agentOrganizationUuid, baseKey: t.baseKey,
				type, payload, userUuid: null, ttlSeconds: ttl, priority: 10,
			});
			id = cmd.id;
		} catch (e) {
			return { ok: false, error: { code: "ENQUEUE_FAILED", message: `Команда не поставлена в очередь: ${e instanceof Error ? e.message : String(e)}` } };
		}
		// Ожидание очереди (по умолчанию — как срок выполнения) плюс само выполнение и запас на доставку ответа.
		const done = await this.d.queue.waitResult(id, (ttl * 2 + 30) * 1000);
		if (!done || done.state === "queued" || done.state === "dispatched") {
			return { ok: false, error: { code: "NO_ANSWER", message: `1С не ответила за ${ttl * 2 + 30} с — команда осталась в очереди` } };
		}
		if (done.state !== "done") {
			const e = done.error;
			const error: CommandFailure = { code: e?.code || "COMMAND_FAILED", message: e?.message || "1С не выполнила команду" };
			// HTTP-статус ответа 1С нужен, чтобы отличить «расширение не знает маршрута» (404) от сбоя — см. isCapabilityMissing.
			if (typeof done.onec_http_status === "number") error.onecHttpStatus = done.onec_http_status;
			return { ok: false, error };
		}
		return { ok: true, data: unwrapData(done.result) ?? null };
	}

	/**
	 * Посылка в ERP. Сбой не рвёт прогон: результат организации теряется, это видно в журнале и в логе. Сетевой сбой
	 * повторяется один раз — ответы 1С стоили минут работы базы клиента, терять их из-за мгновенного обрыва жалко;
	 * отказ ERP по существу не повторяется: тот же ответ придёт и второй раз.
	 *
	 * Размер посылки: до тысячи находок на каждую из ~20 проверок. Общий предел JSON бэкенда — 1 МБ, поэтому у
	 * /bpai/checks/results свой — 25 МБ (backend/server.js, разбор после проверки ключа канала). Проверено на
	 * посылке 1500 находок (≈0,6 МБ). ПРОВЕРИТЬ ПОТОМ: если живые базы дадут больше 25 МБ — делить посылку по проверкам.
	 */
	private async forward(body: ErpCheckResults, report: BaseReport): Promise<void> {
		const bytes = Buffer.byteLength(JSON.stringify(body));
		for (let attempt = 1; ; attempt++) {
			try {
				const counters = await this.d.sink.sendCheckResults(body);
				report.forwarded++;
				this.d.log.info({ bin: body.bin, baseKey: body.baseKey, runs: body.runs.length, snapshots: body.snapshots.length, bytes, erp: counters }, "проверки учёта: результаты отправлены в ERP");
				return;
			} catch (e) {
				const retry = e instanceof ErpUnavailable && attempt < 2;
				if (retry) {
					await new Promise((r) => setTimeout(r, this.d.retryDelayMs ?? 5_000));
					continue;
				}
				report.forwardFailed++;
				const status = e instanceof ErpRefused ? e.status : null;
				this.d.log.warn({ bin: body.bin, baseKey: body.baseKey, bytes, status, err: e instanceof Error ? e.message : String(e) }, "проверки учёта: ERP не приняла результаты");
				return;
			}
		}
	}
}

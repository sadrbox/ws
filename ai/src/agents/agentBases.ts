/**
 * БАЗЫ БИЗНЕС-АГЕНТА, ЛИМИТ ТАРИФА И ВЫБОР БАЗЫ ДЛЯ КОМАНДЫ (СВ3 19.09; модель без владельца 28.09).
 *
 * Одна служба бизнес-агента обслуживает сколько угодно баз одного компьютера — каждую по HTTP или по COM. Сколько
 * баз ей можно обслуживать, решает сервис (`maxBases`): лимит уходит агенту в ответах register и heartbeat, агент
 * его применяет сам — но ГЛАВНЫЙ контроль здесь. Команду в базу сверх лимита сервис не ставит в очередь вовсе.
 *
 * ПРАВИЛО ЛИМИТА — ТО ЖЕ, ЧТО У АГЕНТА: обслуживаются первые `maxBases` баз по порядку среза (порядок настроек агента).
 * Лимит и допуск БИН отменены (docs/TASK_SERVICE_AGENT_OWNER_MODEL_2026-09-28.md, Р2): агент обслуживает все
 * организации, которые видит в своих базах; `maxBins` агенту уходит как `null` — «без ограничения».
 *
 * У АГЕНТА НЕТ ОРГАНИЗАЦИИ (Р1). Кого он обслуживает, говорят только его базы: исполнитель бизнес-команды ищется
 * среди ВСЕХ бизнес-агентов по БИН организации в их срезах (resolveBusinessTarget).
 *
 * Чистые функции — отдельно от хранения: правило проверяется тестом без базы данных.
 */
import type { Db } from "../db/pool.ts";

/** Организация базы, как её назвал агент. */
export type AgentOrg = { id: string | null; name: string | null; bin: string | null };

/** Лимит тарифа агента: сколько баз он обслуживает; null — без ограничения. */
export type AgentLimits = { maxBases: number | null };

/**
 * Лимиты для ответа агенту. `maxBins: null` — «без ограничения» по контракту (допуск БИН отменён, Р2); без
 * `activeBins` агент активацию не показывает и обслуживает все БИН своих баз.
 */
export function limitsForAgent(l: AgentLimits): Record<string, unknown> {
	return { maxBases: l.maxBases, maxBins: null };
}

/** База в срезе бизнес-агента. */
export type AgentBase = {
	key: string;
	/** Позиция в срезе агента — по ней считается лимит баз. */
	pos: number;
	status: string | null;
	transport: "http" | "com" | null;
	extVersion: string | null;
	/** Сверх лимита по мнению самого агента; null — агент лимитов не применял. */
	overLimit: boolean | null;
	/** null — агент организаций не сообщил («не знаю»); [] — организаций нет. */
	organizations: AgentOrg[] | null;
	seenAt: string | null;
};

/** Строка среза, как её прислал агент (register, heartbeat). */
export type AgentBaseInput = {
	key: string;
	status?: string;
	extVersion?: string | null;
	transport?: string;
	overLimit?: boolean;
	/** Как прислал агент — разбирается мягко (см. applySlice). */
	organizations?: unknown[];
};

const cleanBin = (bin: unknown): string | null => {
	const s = typeof bin === "string" ? bin.trim() : "";
	return s ? s : null;
};

// ── Правило лимита ─────────────────────────────────────────────────────────

export type LimitsView = {
	limits: AgentLimits;
	usage: { bases: number; bins: number };
	/** Ключи баз сверх лимита баз — в порядке среза. */
	overBases: string[];
	/** БИН → базы, где он есть, в порядке среза. */
	binBases: Map<string, string[]>;
};

/** Применить лимит к срезу — тем же правилом, что агент. Базы должны идти в порядке среза. */
export function evaluateLimits(bases: readonly Pick<AgentBase, "key" | "organizations">[], limits: AgentLimits): LimitsView {
	const overBases = bases.slice(limits.maxBases ?? Infinity).map((b) => b.key);
	const binBases = new Map<string, string[]>();
	for (const b of bases) {
		for (const o of b.organizations ?? []) {
			const bin = cleanBin(o.bin);
			if (!bin) continue;
			const list = binBases.get(bin) ?? [];
			if (!list.includes(b.key)) list.push(b.key);
			binBases.set(bin, list);
		}
	}
	return { limits, usage: { bases: bases.length, bins: binBases.size }, overBases, binBases };
}

/** «5 баз», «1 база», «2 базы» — для текста про тариф. */
function plural(n: number, one: string, few: string, many: string): string {
	const m10 = n % 10;
	const m100 = n % 100;
	if (m10 === 1 && m100 !== 11) return one;
	if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
	return many;
}

const tariffBases = (v: LimitsView) =>
	`тариф: ${v.limits.maxBases} ${plural(v.limits.maxBases ?? 0, "база", "базы", "баз")}, подключено ${v.usage.bases}`;
const RAISE = "Увеличьте тариф или уберите лишнее из настроек агента.";

/** Срез одного бизнес-агента вместе с его лимитом. */
export type AgentSlice = { agentId: string; online: boolean; bases: AgentBase[]; limits: AgentLimits };

/** База, где нашлась организация: агент, ключ базы, состояние базы. */
export type BaseHit = { agentId: string; baseKey: string; online: boolean; status: string | null };

export type TargetDecision =
	/** База найдена: команда уходит этому агенту с этим `baseKey`. `alsoIn` — другие базы с тем же БИН. */
	| { kind: "base"; agentId: string; baseKey: string; alsoIn: string[]; status: string | null }
	/** База есть, но сверх лимита баз агента — в очередь не ставить. */
	| { kind: "refused"; code: "LICENSE_LIMIT"; message: string; details: Record<string, unknown> }
	/** БИН в нескольких базах, и правило не выбрало одну — команда не уходит никому (В2, п. 3). */
	| { kind: "ambiguous"; code: "BASE_AMBIGUOUS"; hits: BaseHit[] }
	/** Ни в одной базе агентов организации с этим БИН нет. */
	| { kind: "none" };

/**
 * Базы, которые организация назвала своей (В2, п. 2): одобренная заявка базы или действующий токен чата. Сопоставление
 * со срезом агента — ПО КЛЮЧУ базы: идентичности базы в срезе пока нет (задача агенту). Ключ уникален только в
 * пределах сервера, поэтому ключ, под которым своих баз несколько (разные серверы), в правило не идёт — лучше отказ,
 * чем догадка (`ambiguousKeys`).
 */
export type OwnedBases = { keys: ReadonlySet<string>; ambiguousKeys: ReadonlySet<string> };

/** Свои базы организации из строк реестра: ключ → серверы; ключ на нескольких серверах — неоднозначен. */
export function ownedBasesOf(rows: readonly { key: string; serverId: string | null }[]): OwnedBases {
	const servers = new Map<string, Set<string>>();
	for (const r of rows) {
		const key = r.key.trim().toLowerCase();
		if (!key) continue;
		const set = servers.get(key) ?? new Set<string>();
		set.add(r.serverId ?? "");
		servers.set(key, set);
	}
	return {
		keys: new Set(servers.keys()),
		ambiguousKeys: new Set([...servers].filter(([, s]) => s.size > 1).map(([k]) => k)),
	};
}

/**
 * КАКАЯ БАЗА ВЫПОЛНИТ БИЗНЕС-КОМАНДУ ОРГАНИЗАЦИИ — ЕДИНСТВЕННОЕ ПРАВИЛО (В2, 28.09).
 *
 * Кандидаты — базы ВСЕХ переданных агентов, в которых агент видит организацию с этим БИН, в пределах `maxBases`.
 * `bin` — БИН организации из ERP: из запроса он не берётся (вызов, назвавший чужой БИН, отсекается раньше).
 *
 * Если баз несколько, порядок такой:
 *   1. явно запрошенная база (`baseKey`) — дальше выбор только среди баз с этим ключом; агент диалога (`preferAgentId`)
 *      сужает выбор до своих баз, если они среди кандидатов;
 *   2. база, которую организация назвала своей (`owned`);
 *   3. иначе — `ambiguous`: команда не уходит никому.
 * Агент на связи выбирается только среди баз ОДНОГО уровня и не поднимает базу уровнем ниже: одна копия базы на
 * связи, а настоящая лежит — это не повод отдать команду копии.
 *
 * Агент старой сборки организаций не сообщает (`organizations: null`) — его базы кандидатами не бывают: у агента нет
 * ни организации, ни допуска, и кроме его слова о БИН верить не во что.
 */
export function resolveBusinessTarget(
	slices: readonly AgentSlice[],
	want: { bin: string | null | undefined; baseKey?: string | null; preferAgentId?: string | null },
	owned: OwnedBases = { keys: new Set(), ambiguousKeys: new Set() },
): TargetDecision {
	const bin = cleanBin(want.bin);
	if (!bin) return { kind: "none" };
	const wantKey = want.baseKey?.trim().toLowerCase() || null;

	let hits: BaseHit[] = [];
	let refused: Extract<TargetDecision, { kind: "refused" }> | null = null;
	for (const s of slices) {
		const v = evaluateLimits(s.bases, s.limits);
		for (const b of s.bases) {
			if (wantKey && b.key.toLowerCase() !== wantKey) continue;
			if (!b.organizations?.some((o) => o.bin === bin)) continue;
			if (v.overBases.includes(b.key)) {
				refused ??= {
					kind: "refused", code: "LICENSE_LIMIT",
					message: `База «${b.key}» сверх лимита (${tariffBases(v)}). ${RAISE}`,
					details: { agentId: s.agentId, baseKey: b.key, bin, limits: s.limits, usage: v.usage },
				};
				continue;
			}
			hits.push({ agentId: s.agentId, baseKey: b.key, online: s.online, status: b.status });
		}
	}
	if (!hits.length) return refused ?? { kind: "none" };

	const pick = (xs: BaseHit[]): TargetDecision | null => {
		const online = xs.filter((h) => h.online);
		const chosen = xs.length === 1 ? xs[0] : online.length === 1 ? online[0] : null;
		return chosen
			? { kind: "base", agentId: chosen.agentId, baseKey: chosen.baseKey, alsoIn: hits.filter((h) => h !== chosen).map((h) => h.baseKey), status: chosen.status }
			: null;
	};

	// 1. Агент диалога — среди своих баз, если они есть среди кандидатов.
	if (want.preferAgentId) {
		const own = hits.filter((h) => h.agentId === want.preferAgentId);
		if (own.length) hits = own;
	}
	if (hits.length === 1) return pick(hits)!;
	// 2. База, которую организация назвала своей; неоднозначный ключ не годится.
	const mine = hits.filter((h) => owned.keys.has(h.baseKey.toLowerCase()) && !owned.ambiguousKeys.has(h.baseKey.toLowerCase()));
	if (mine.length) {
		const d = pick(mine);
		if (d) return d;
		return { kind: "ambiguous", code: "BASE_AMBIGUOUS", hits: mine };
	}
	// 3. Не выбрать — отказ. Агент на связи здесь не решает: иначе команда ушла бы в копию базы.
	return { kind: "ambiguous", code: "BASE_AMBIGUOUS", hits };
}

/** Проверка лимита баз для служебной команды с явной базой: отказ или null. */
export function baseLimitRefusal(slice: AgentSlice, baseKey: string): Extract<TargetDecision, { kind: "refused" }> | null {
	const v = evaluateLimits(slice.bases, slice.limits);
	const base = slice.bases.find((b) => b.key.toLowerCase() === baseKey.trim().toLowerCase());
	if (!base || !v.overBases.includes(base.key)) return null;
	return {
		kind: "refused", code: "LICENSE_LIMIT",
		message: `База «${base.key}» сверх лимита (${tariffBases(v)}). ${RAISE}`,
		details: { agentId: slice.agentId, baseKey: base.key, limits: slice.limits, usage: v.usage },
	};
}

// ── Представление для панели ───────────────────────────────────────────────

export type AgentBasesView = {
	limits: AgentLimits;
	/** Подключено (всё, что агент видит) — «баз N из M», «БИНов N из M». */
	usage: { bases: number; bins: number };
	bases: (Omit<AgentBase, "organizations"> & {
		/** Сверх лимита по правилу сервиса (им сервис и отвергает команды). */
		overLimitService: boolean;
		/**
		 * Сервис и агент считают лимит по-разному (C15, C16): агент сообщил свою отметку, и она не совпала с правилом
		 * сервиса. Сразу после смены лимита это нормально — до следующего heartbeat агента.
		 */
		limitMismatch: boolean;
		organizations: (AgentOrg & {
			overLimit: boolean;
			/** БИН есть и в других базах этого агента: какая из них выполнит команду, решает resolveBusinessTarget. */
			alsoIn: string[];
		})[] | null;
	})[];
};

/** Базы агента с пометками лимита — тем же правилом, что при выборе базы для команды. */
export function describeAgentBases(bases: readonly AgentBase[], limits: AgentLimits): AgentBasesView {
	const v = evaluateLimits(bases, limits);
	return {
		limits,
		usage: v.usage,
		bases: bases.map((b) => ({
			...b,
			overLimitService: v.overBases.includes(b.key),
			limitMismatch: typeof b.overLimit === "boolean" && b.overLimit !== v.overBases.includes(b.key),
			organizations: b.organizations?.map((o) => ({
				...o,
				overLimit: v.overBases.includes(b.key),
				alsoIn: (o.bin ? v.binBases.get(o.bin) ?? [] : []).filter((k) => k !== b.key),
			})) ?? null,
		})),
	};
}

/**
 * Базы, где агент и сервис разошлись в «сверх лимита» (C15, C16) — ключи в порядке среза. Пусто — согласны или агент
 * своих отметок не прислал.
 */
export function limitMismatches(bases: readonly AgentBase[], limits: AgentLimits): string[] {
	return describeAgentBases(bases, limits).bases.filter((b) => b.limitMismatch).map((b) => b.key);
}

/** Лимит из запроса панели: целое ≥ 0 или пусто (без ограничения). `undefined` — значение негодное. */
export function parseLimit(v: unknown): number | null | undefined {
	if (v === null || v === undefined || v === "") return null;
	const n = typeof v === "number" ? v : typeof v === "string" && /^\s*\d+\s*$/.test(v) ? Number(v) : NaN;
	return Number.isInteger(n) && n >= 0 && n <= 100_000 ? n : undefined;
}

// ── Хранение среза ─────────────────────────────────────────────────────────

type Row = {
	agent_id: string; key: string; pos: number; status: string | null; transport: string | null;
	ext_version: string | null; over_limit: boolean | null; organizations: unknown; seen_at: Date | null;
};

const toOrgs = (v: unknown): AgentOrg[] | null => {
	if (!Array.isArray(v)) return null;
	return v.filter((o) => !!o && typeof o === "object").map((o) => {
		const r = (o && typeof o === "object" ? o : {}) as Record<string, unknown>;
		return {
			id: typeof r.id === "string" ? r.id : null,
			name: typeof r.name === "string" ? r.name : null,
			bin: cleanBin(r.bin),
		};
	});
};

const toView = (r: Row): AgentBase => ({
	key: r.key,
	pos: r.pos,
	status: r.status,
	transport: r.transport === "http" || r.transport === "com" ? r.transport : null,
	extVersion: r.ext_version,
	overLimit: r.over_limit,
	organizations: toOrgs(r.organizations),
	seenAt: r.seen_at?.toISOString() ?? null,
});

/**
 * КЭШ СРЕЗОВ ДЛЯ ВЫБОРА БАЗЫ (C18). Каждый вызов инструмента в чате выбирает базу по срезам агентов организации;
 * срез меняется heartbeat'ом (раз в полминуты), а вызовов в диалоге — десятки. Запись среза этим процессом
 * сбрасывает кэш сразу; в соседних процессах (кластер pm2) он доживает не дольше SLICE_CACHE_MS.
 */
const SLICE_CACHE_MS = 15_000;
const sliceCache = new Map<string, { at: number; bases: AgentBase[] }>();

export class AgentBasesStore {
	private readonly db: Db;
	constructor(db: Db) {
		this.db = db;
	}

	/**
	 * Применить срез. Полный (register, heartbeat с basesComplete) — ЗАМЕНЯЕТ список агента: порядок берётся из
	 * среза, пропавшие базы уходят. Частичный — правит только названные базы, их порядок не трогает (частичный
	 * срез не знает порядка), новые встают в конец.
	 *
	 * «Поля нет» — «агент не знает»: организации, транспорт и признак лимита в таком случае не затираются.
	 */
	async applySlice(agentId: string, states: readonly AgentBaseInput[], complete: boolean): Promise<void> {
		// Дубль ключа в одном срезе (одна база дважды в настройках агента) уронил бы весь запрос: ON CONFLICT не
		// правит строку дважды за оператор. Остаётся первая — по ней агент и считает порядок.
		const seen = new Set<string>();
		const rows = states
			.map((s) => ({ ...s, key: s.key.trim() }))
			.filter((s) => !!s.key && !seen.has(s.key) && !!seen.add(s.key));
		if (!rows.length && !complete) return;

		// Организации — только понятные строки: объект хотя бы с одним из id, name, bin. Непонятное отбрасывается
		// поштучно, а не роняет срез целиком.
		const orgs = rows.map((s) => (Array.isArray(s.organizations)
			? JSON.stringify((toOrgs(s.organizations) ?? []).filter((o) => o.id || o.name || o.bin))
			: null));
		const transport = rows.map((s) => (s.transport === "http" || s.transport === "com" ? s.transport : null));

		// Удаление пропавших и запись среза — одной транзакцией (C17): между ними список агента не бывает пустым
		// или половинчатым для выбора базы, а сбой не оставляет полусрез.
		sliceCache.delete(agentId);
		const client = await this.db.connect();
		try {
			await client.query("BEGIN");
			await this.write(client, agentId, rows, orgs, transport, complete);
			await client.query("COMMIT");
		} catch (e) {
			await client.query("ROLLBACK").catch(() => {});
			throw e;
		} finally {
			client.release();
		}
		sliceCache.delete(agentId);
	}

	private async write(
		db: Pick<Db, "query">, agentId: string, rows: (AgentBaseInput & { key: string })[],
		orgs: (string | null)[], transport: (string | null)[], complete: boolean,
	): Promise<void> {
		if (complete) {
			await db.query(`DELETE FROM agent_bases WHERE agent_id = $1 AND NOT (key = ANY($2::text[]))`, [agentId, rows.map((s) => s.key)]);
		}
		if (!rows.length) return;
		const base = complete ? 0 : await this.nextPos(db, agentId);
		await db.query(
			`INSERT INTO agent_bases (agent_id, key, pos, status, transport, ext_version, over_limit, organizations, seen_at)
			 SELECT $1, x.key, x.pos, x.status, x.transport, x.ext_version, x.over_limit, x.organizations::jsonb, now()
			   FROM unnest($2::text[], $3::int[], $4::text[], $5::text[], $6::text[], $7::boolean[], $8::text[])
			     AS x(key, pos, status, transport, ext_version, over_limit, organizations)
			 ON CONFLICT (agent_id, key) DO UPDATE
			    SET pos           = CASE WHEN $9 THEN EXCLUDED.pos ELSE agent_bases.pos END,
			        status        = COALESCE(EXCLUDED.status, agent_bases.status),
			        transport     = COALESCE(EXCLUDED.transport, agent_bases.transport),
			        ext_version   = COALESCE(EXCLUDED.ext_version, agent_bases.ext_version),
			        over_limit    = COALESCE(EXCLUDED.over_limit, agent_bases.over_limit),
			        organizations = COALESCE(EXCLUDED.organizations, agent_bases.organizations),
			        seen_at       = now()`,
			[
				agentId,
				rows.map((s) => s.key),
				rows.map((_, i) => base + i),
				rows.map((s) => s.status ?? null),
				transport,
				rows.map((s) => s.extVersion ?? null),
				rows.map((s) => (typeof s.overLimit === "boolean" ? s.overLimit : null)),
				orgs,
				complete,
			],
		);
	}

	private async nextPos(db: Pick<Db, "query">, agentId: string): Promise<number> {
		const r = await db.query<{ n: number | null }>(`SELECT max(pos) + 1 AS n FROM agent_bases WHERE agent_id = $1`, [agentId]);
		return Number(r.rows[0]?.n ?? 0);
	}

	/** Базы агента в порядке среза. */
	async list(agentId: string): Promise<AgentBase[]> {
		const r = await this.db.query<Row>(
			`SELECT agent_id, key, pos, status, transport, ext_version, over_limit, organizations, seen_at
			   FROM agent_bases WHERE agent_id = $1 ORDER BY pos, key`,
			[agentId],
		);
		return r.rows.map(toView);
	}

	/**
	 * Базы нескольких агентов — одним запросом, каждому свой список в порядке среза. `cached` — для выбора базы
	 * в чате (C18): свежие срезы берутся из памяти, в БД идут только недостающие.
	 */
	async listMany(agentIds: readonly string[], opts: { cached?: boolean } = {}): Promise<Map<string, AgentBase[]>> {
		const out = new Map<string, AgentBase[]>(agentIds.map((id) => [id, []]));
		const now = Date.now();
		const need = opts.cached
			? agentIds.filter((id) => {
				const hit = sliceCache.get(id);
				if (hit && now - hit.at < SLICE_CACHE_MS) { out.set(id, hit.bases); return false; }
				return true;
			})
			: [...agentIds];
		if (!need.length) return out;
		const r = await this.db.query<Row>(
			`SELECT agent_id, key, pos, status, transport, ext_version, over_limit, organizations, seen_at
			   FROM agent_bases WHERE agent_id = ANY($1::uuid[]) ORDER BY agent_id, pos, key`,
			[need],
		);
		for (const id of need) out.set(id, []);
		for (const row of r.rows) out.get(row.agent_id)?.push(toView(row));
		if (opts.cached) for (const id of need) sliceCache.set(id, { at: now, bases: out.get(id) ?? [] });
		return out;
	}
}

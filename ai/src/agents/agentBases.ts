/**
 * БАЗЫ БИЗНЕС-АГЕНТА И ЛИМИТ ТАРИФА (СВ3, 19.09.2026).
 *
 * Одна служба бизнес-агента обслуживает сколько угодно баз одного компьютера — каждую по HTTP или по COM. Сколько
 * баз и БИНов ей можно обслуживать, решает сервис: лимиты уходят агенту в ответах register и heartbeat, агент их
 * применяет сам — но ГЛАВНЫЙ контроль здесь. Команду в базу или по БИН сверх лимита сервис не ставит в очередь
 * вовсе: отказ приходит сразу, с понятным текстом про тариф, а не через круг к агенту.
 *
 * ПРАВИЛО — ТО ЖЕ, ЧТО У АГЕНТА (bpapi_agent/README.md, «Много баз на одном компьютере и лимит тарифа»):
 *   - обслуживаются первые `maxBases` баз по порядку среза (порядок настроек агента);
 *   - и первые `maxBins` РАЗНЫХ БИНов по порядку баз, а внутри базы — по порядку организаций; один БИН в двух
 *     базах — одна организация и считается один раз.
 * Разойтись с агентом нельзя: иначе сервис пропускал бы команды, которые агент отвергнет, или наоборот.
 *
 * Чистые функции — отдельно от хранения: правило проверяется тестом без базы данных.
 */
import type { Db } from "../db/pool.ts";

/** Организация базы, как её назвал агент. */
export type AgentOrg = { id: string | null; name: string | null; bin: string | null };

/**
 * Лимит тарифа агента; null в поле — без ограничения. `activeBins` (СВ4, часть 2 контракта) — явный список
 * обслуживаемых БИНов: есть — обслуживаются ровно они (`maxBins` для сведения), нет — «первые `maxBins` по порядку».
 */
export type AgentLimits = { maxBases: number | null; maxBins: number | null; activeBins?: string[] | null };

/** Лимиты для ответа агенту: `activeBins` — только когда список задан (нет поля — прежнее правило). */
export function limitsForAgent(l: AgentLimits): Record<string, unknown> {
	return { maxBases: l.maxBases, maxBins: l.maxBins, ...(l.activeBins ? { activeBins: l.activeBins } : {}) };
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
	/** БИНы сверх лимита БИНов. */
	overBins: string[];
	/** БИН → базы, где он есть, в порядке среза: по первой уходят команды, остальные показываются. */
	binBases: Map<string, string[]>;
};

/**
 * Применить лимит к срезу — тем же правилом, что агент. Базы должны идти в порядке среза.
 *
 * БИНы считаются по всем базам среза (подключено — это всё, что агент видит), но в лимит БИНов попадают только
 * обслуживаемые базы: база сверх лимита баз не должна занимать место организации.
 */
export function evaluateLimits(bases: readonly Pick<AgentBase, "key" | "organizations">[], limits: AgentLimits): LimitsView {
	const maxBases = limits.maxBases ?? Infinity;
	const maxBins = limits.maxBins ?? Infinity;
	const overBases = bases.slice(maxBases).map((b) => b.key);
	const served = bases.slice(0, maxBases);

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

	const allowedBins: string[] = [];
	for (const b of served) {
		for (const o of b.organizations ?? []) {
			const bin = cleanBin(o.bin);
			if (!bin || allowedBins.includes(bin)) continue;
			allowedBins.push(bin);
		}
	}
	// Явный список активных БИНов — главнее правила «первые N»: порядок баз в настройках агента больше не решает.
	const inLimit = new Set(limits.activeBins ? allowedBins.filter((b) => limits.activeBins!.includes(b)) : allowedBins.slice(0, maxBins));
	const overBins = [...binBases.keys()].filter((bin) => !inLimit.has(bin));

	return {
		limits,
		usage: { bases: bases.length, bins: binBases.size },
		overBases,
		overBins,
		binBases,
	};
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
/** Отказ по БИН: при списке активных — «не активирована», иначе — про тариф. */
const binRefusal = (bin: string, v: LimitsView) => (v.limits.activeBins && !v.limits.activeBins.includes(bin)
	? `Организация с БИН ${bin} не активирована для этого агента — запросите активацию (окно агента, вкладка «Базы и БИНы»).`
	: `Организация с БИН ${bin} сверх лимита (${tariffBins(v)}). ${RAISE}`);
const tariffBins = (v: LimitsView) =>
	`тариф: ${v.limits.maxBins} ${plural(v.limits.maxBins ?? 0, "БИН", "БИНа", "БИНов")}, подключено ${v.usage.bins}`;
const RAISE = "Увеличьте тариф или уберите лишнее из настроек агента.";

/** Срез одного бизнес-агента вместе с его лимитом. */
export type AgentSlice = { agentId: string; online: boolean; bases: AgentBase[]; limits: AgentLimits };

export type TargetDecision =
	/** База найдена в срезе: команда уходит этому агенту с этим `baseKey`. `alsoIn` — другие базы с тем же БИН. */
	| { kind: "base"; agentId: string; baseKey: string; alsoIn: string[]; status: string | null }
	/** Сверх лимита — в очередь не ставить. */
	| { kind: "refused"; code: "LICENSE_LIMIT"; message: string; details: Record<string, unknown> }
	/** Срез ничего не говорит (старая сборка без организаций, нет базы с таким БИН) — прежний путь. */
	| { kind: "none" };

/**
 * КАКАЯ БАЗА ВЫПОЛНИТ БИЗНЕС-КОМАНДУ — по тому же порядку, что у агента: явный `baseKey` → база, где есть
 * организация с БИН → иначе решать нечем. Агенты на связи — первыми: команда агенту, которого нет, повиснет.
 *
 * БИН есть в нескольких базах — берётся первая по порядку среза (так же сделает агент), а остальные возвращаются
 * в `alsoIn`, чтобы это можно было показать.
 */
export function resolveTarget(
	slices: readonly AgentSlice[],
	want: { baseKey?: string | null; bin?: string | null; preferAgentId?: string | null },
): TargetDecision {
	// Агент, из чьей базы пришли объекты диалога, — первым (C3); дальше агенты на связи. Порядок sort устойчив.
	const rank = (s: AgentSlice) => (s.agentId === want.preferAgentId ? 2 : 0) + (s.online ? 1 : 0);
	const ordered = [...slices].sort((a, b) => rank(b) - rank(a));
	// Отказ по лимиту у одного агента — не приговор (C3): та же база или БИН может обслуживаться другим агентом
	// организации в пределах его тарифа. Отказ — только если не нашлось никого.
	let refused: Extract<TargetDecision, { kind: "refused" }> | null = null;
	const baseKey = want.baseKey?.trim() || null;
	const bin = cleanBin(want.bin);

	for (const s of ordered) {
		const v = evaluateLimits(s.bases, s.limits);

		if (baseKey) {
			const base = s.bases.find((b) => b.key.toLowerCase() === baseKey.toLowerCase());
			if (!base) continue;
			if (v.overBases.includes(base.key)) {
				refused ??= {
					kind: "refused", code: "LICENSE_LIMIT",
					message: `База «${base.key}» сверх лимита (${tariffBases(v)}). ${RAISE}`,
					details: { agentId: s.agentId, baseKey: base.key, limits: s.limits, usage: v.usage },
				};
				continue;
			}
			if (bin && v.overBins.includes(bin)) {
				refused ??= {
					kind: "refused", code: "LICENSE_LIMIT",
					message: binRefusal(bin, v),
					details: { agentId: s.agentId, baseKey: base.key, bin, limits: s.limits, usage: v.usage },
				};
				continue;
			}
			return { kind: "base", agentId: s.agentId, baseKey: base.key, alsoIn: [], status: base.status };
		}

		if (bin) {
			const keys = v.binBases.get(bin);
			if (!keys?.length) continue;
			if (v.overBins.includes(bin)) {
				refused ??= {
					kind: "refused", code: "LICENSE_LIMIT",
					message: binRefusal(bin, v),
					details: { agentId: s.agentId, bin, limits: s.limits, usage: v.usage },
				};
				continue;
			}
			const served = keys.filter((k) => !v.overBases.includes(k));
			if (!served.length) {
				refused ??= {
					kind: "refused", code: "LICENSE_LIMIT",
					message: `Организация с БИН ${bin} есть только в базах сверх лимита (${tariffBases(v)}). ${RAISE}`,
					details: { agentId: s.agentId, bin, baseKeys: keys, limits: s.limits, usage: v.usage },
				};
				continue;
			}
			const status = s.bases.find((b) => b.key === served[0])?.status ?? null;
			return { kind: "base", agentId: s.agentId, baseKey: served[0], alsoIn: keys.filter((k) => k !== served[0]), status };
		}
	}
	return refused ?? { kind: "none" };
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
			/** БИН есть и в других базах: команды уходят в `usedBase` (первую обслуживаемую по порядку). */
			alsoIn: string[];
			usedBase: string | null;
			/** Активирован ли БИН (есть в `activeBins`); null — списка нет, действует правило «первые N». */
			active: boolean | null;
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
			organizations: b.organizations?.map((o) => {
				const active = limits.activeBins ? !!o.bin && limits.activeBins.includes(o.bin) : null;
				const keys = o.bin ? v.binBases.get(o.bin) ?? [] : [];
				const served = keys.filter((k) => !v.overBases.includes(k));
				const binOver = !!o.bin && v.overBins.includes(o.bin);
				return {
					...o,
					overLimit: v.overBases.includes(b.key) || binOver,
					alsoIn: keys.filter((k) => k !== b.key),
					usedBase: binOver ? null : served[0] ?? null,
					active,
				};
			}) ?? null,
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

/**
 * Базы, где стоит расширение `buhprof_api`, — сводка ПО ИСТОЧНИКАМ РАСШИРЕНИЯ (23.09).
 *
 * ПОЧЕМУ НЕ ИЗ РЕЕСТРА КЛАСТЕРА. Первая версия этой сводки брала список из `GET /v1/onec/bases`, то есть из
 * среза, который ведёт АДМИН-агент, да ещё и суженного до выбранного в панели кластера. Итог был пустой экран
 * там, где он нужнее всего: у клиента, где админ-агента нет вовсе, а расширение работает. Расширение к
 * кластеру не привязано — оно живёт в базе, и приводит её к нам заявка, а не обход сервера.
 *
 * ЧЕТЫРЕ ИСТОЧНИКА, И ВСЕ — ПРО РАСШИРЕНИЕ:
 *   1. ЗАЯВКА (`base_registrations`) — кто попросил подключение, что за база и какая версия расширения была
 *      на момент просьбы; одобрена или ещё ждёт.
 *   2. ТОКЕН (`base_tokens`) — состояние доступа к чату: действует, сменён (идёт перекрытие), отозван.
 *   3. СРЕЗ БИЗНЕС-АГЕНТА (`agent_bases`) — живая версия расширения и транспорт (HTTP или COM), то есть то,
 *      чем база отвечает СЕЙЧАС, а не чем отвечала при подключении.
 *   4. КАНАЛ ЧАТА (`bases.chat_*`, С2 аудита 23.09) — версия из заголовка `X-Ext-Version` и время запроса,
 *      то есть то, что база сказала о себе САМА. Для базы, у которой агента нет вовсе, это единственный
 *      источник: чатом она работает, а спросить её через агента некому.
 *
 * Соединяются по КЛЮЧУ базы: идентификаторы у источников разные (у заявки — свой `onecBaseId` из 1С, у
 * токена — запись реестра, у среза — только ключ), а ключ базы есть у всех и по нему же её называет человек.
 */

/** Срез базы у бизнес-агента — в том виде, в каком его читают ОБЕ витрины: сводка раздела и список баз. */
export type BusinessSlice = {
	agentId: string;
	agentName: string | null;
	key: string;
	status: string | null;
	transport: "http" | "com" | null;
	extVersion: string | null;
	seenAt: string | null;
};

/**
 * ОДНО ПРАВИЛО СВЕЖЕСТИ НА ВСЕ ВИТРИНЫ (Б1 аудита 23.09).
 *
 * Базу может обслуживать не один агент — это штатная работа: многобазовый агент на сервере и второй на машине
 * бухгалтера. Раньше сводка брала ПОСЛЕДНИЙ встреченный срез (порядок приходил из Map, то есть произвольный),
 * а список баз — самый свежий по `seenAt`: два экрана отвечали на один вопрос по-разному, и ответ сводки
 * менялся от обновления к обновлению.
 *
 * Правило: позже видели — главнее. При равенстве решает `agentId` — не потому, что он что-то значит, а чтобы
 * результат не зависел от порядка чтения: витрина, которая «иногда показывает другое», хуже неверной.
 */
export function freshestByBase<T extends { key: string; seenAt: string | null; agentId?: string }>(
	slices: readonly T[],
): Map<string, T> {
	const best = new Map<string, T>();
	for (const s of slices) {
		const k = norm(s.key);
		const has = best.get(k);
		if (!has) { best.set(k, s); continue; }
		const [a, b] = [s.seenAt ?? "", has.seenAt ?? ""];
		const newer = a !== b ? a > b : (s.agentId ?? "") < (has.agentId ?? "");
		if (newer) best.set(k, s);
	}
	return best;
}

/**
 * СРЕЗЫ БИЗНЕС-АГЕНТОВ — ОДНИМ КОДОМ НА ДВЕ ВИТРИНЫ (Б4 аудита 23.09). Сбор был написан дважды и успел
 * разойтись в двух местах: по фильтру отключённых агентов и по режиму кэша. Третий раз разошёлся бы на
 * чём-нибудь ещё.
 *
 * ОТКЛЮЧЁННЫЙ АГЕНТ МОЛЧИТ ВЕЗДЕ (Б2): его отключили в панели — значит ему больше не верят, и данные от него
 * не должны жить в одной витрине, пропав из другой. Строка базы в сводке при этом не исчезает: её держат
 * заявка и токен.
 *
 * `fresh` — читать мимо кэша срезов: его шлёт кнопка «Обновить», обычное открытие обходится кэшем.
 */
export async function collectBusinessSlices(
	agents: { listAll(): Promise<readonly { id: string; name: string; role: string; disabled: boolean }[]> },
	agentBases: { listMany(ids: readonly string[], opts?: { cached?: boolean }): Promise<Map<string, readonly {
		key: string; status: string | null; transport: "http" | "com" | null; extVersion: string | null; seenAt: string | null;
	}[]>> },
	opts: { fresh?: boolean } = {},
): Promise<BusinessSlice[]> {
	const business = (await agents.listAll()).filter((a) => a.role === "business" && !a.disabled);
	if (!business.length) return [];
	const names = new Map(business.map((a) => [a.id, a.name]));
	const byAgent = await agentBases.listMany(business.map((a) => a.id), { cached: !opts.fresh });
	return [...byAgent.entries()].flatMap(([agentId, list]) => list.map((b) => ({
		agentId, agentName: names.get(agentId) ?? null,
		key: b.key, status: b.status, transport: b.transport, extVersion: b.extVersion, seenAt: b.seenAt,
	})));
}

export type ExtensionBaseInput = {
	registrations: readonly {
		baseKey: string | null; baseName: string; state: string; organizationUuid: string | null;
		decidedAt: Date | string | null; extensionVersion?: string | null;
	}[];
	tokens: readonly {
		baseKey: string; organizationUuid: string;
		createdAt: Date | string; revokedAt: Date | string | null; replacedBy: string | null; acceptedUntil: Date | string | null;
	}[];
	slices: readonly BusinessSlice[];
	/**
	 * Канал чата из 1С (С2 аудита 23.09): что база сказала о себе САМА, в заголовке `X-Ext-Version` обычного
	 * запроса. Единственный источник о базе, которую не обслуживает ни один агент.
	 */
	chat?: readonly { baseKey: string; extVersion: string | null; seenAt: Date | string | null }[];
};

export type ExtensionBaseRow = {
	baseKey: string;
	name: string;
	organizationUuid: string | null;
	/** Живая версия расширения (из среза агента), иначе та, что база назвала в заявке. */
	extVersion: string;
	/**
	 * Откуда версия: `agent` — срез бизнес-агента, `chat` — заголовок запроса из самой базы, `registration` —
	 * только со слов заявки, `none` — не знаем. Порядок именно такой: агент говорит о базе целиком, чат — о том,
	 * что в ней работает прямо сейчас, заявку подавали однажды.
	 */
	extVersionSource: "agent" | "chat" | "registration" | "none";
	/** Доступ к чату 1С: действует, сменён (перекрытие), отозван, не выдавался. */
	access: "active" | "rotating" | "revoked" | "none";
	/** Чем база отвечает агенту; null — агент про неё не сообщал. */
	transport: "http" | "com" | null;
	agentId: string | null;
	agentName: string | null;
	/** Когда одобрили заявку — момент, с которого база наша. */
	approvedAt: string | null;
	/** Когда агент последний раз видел базу в срезе. */
	seenAt: string | null;
	/** Когда база сама последний раз обратилась к сервису по каналу чата. */
	chatSeenAt: string | null;
	/**
	 * ПОСЛЕДНИЙ ОБМЕН — одно число на две дороги: позднее из «видел агент» и «обратилась сама». Расширение
	 * считает его у себя и показывает ступень состояния; панель должна отвечать на тот же вопрос так же, иначе
	 * два окна об одной базе говорят разное.
	 */
	lastExchangeAt: string | null;
	/** Кто дал `lastExchangeAt`: срез агента или запрос из базы. */
	lastExchangeSource: "agent" | "chat" | "none";
	/** Заявка подана, но решения ещё нет: база уже просится, доступа пока нет. */
	pending: boolean;
};

const iso = (v: Date | string | null | undefined): string | null =>
	v instanceof Date ? v.toISOString() : typeof v === "string" && v ? v : null;

const norm = (key: string | null | undefined): string => (key ?? "").trim().toLowerCase();

/**
 * Состояние доступа по всем токенам базы. Порядок важен: действующий главнее отозванного, иначе база с
 * отозванным старым и выданным новым токеном выглядела бы отключённой.
 */
function accessOf(tokens: readonly ExtensionBaseInput["tokens"][number][]): ExtensionBaseRow["access"] {
	if (!tokens.length) return "none";
	if (tokens.some((t) => !t.revokedAt && !t.replacedBy)) return "active";
	// Сменённый и ещё принимаемый: преемник в этом же списке был бы «действующим», значит его тут нет —
	// база живёт на перекрытии и нового токена пока не подтвердила.
	if (tokens.some((t) => !t.revokedAt && t.replacedBy && (!t.acceptedUntil || new Date(t.acceptedUntil) > new Date()))) return "rotating";
	return "revoked";
}

export function extensionBaseRows(input: ExtensionBaseInput): ExtensionBaseRow[] {
	const rows = new Map<string, ExtensionBaseRow>();
	const ensure = (key: string, name: string): ExtensionBaseRow => {
		const k = norm(key);
		const has = rows.get(k);
		if (has) return has;
		const row: ExtensionBaseRow = {
			baseKey: key.trim(), name: name || key.trim(), organizationUuid: null,
			extVersion: "", extVersionSource: "none", access: "none", transport: null,
			agentId: null, agentName: null, approvedAt: null, seenAt: null, chatSeenAt: null,
			lastExchangeAt: null, lastExchangeSource: "none", pending: false,
		};
		rows.set(k, row);
		return row;
	};

	// 1. Заявки: они и заводят базу в этот список — даже ту, которую не видел ни один агент.
	for (const r of input.registrations) {
		if (!r.baseKey) {
			// Нерешённая заявка ключа ещё не имеет (его выбирают при одобрении): показываем по имени базы.
			if (r.state === "PENDING") {
				const row = ensure(r.baseName, r.baseName);
				row.pending = true;
				if (r.extensionVersion && !row.extVersion) { row.extVersion = r.extensionVersion; row.extVersionSource = "registration"; }
			}
			continue;
		}
		const row = ensure(r.baseKey, r.baseName);
		if (r.state === "PENDING") row.pending = true;
		if (r.organizationUuid) row.organizationUuid = r.organizationUuid;
		const at = iso(r.decidedAt);
		if (at && (!row.approvedAt || at > row.approvedAt)) row.approvedAt = at;
		if (r.extensionVersion && !row.extVersion) { row.extVersion = r.extensionVersion; row.extVersionSource = "registration"; }
	}

	// 2. Токены: состояние доступа к чату. База с токеном попадает в список, даже если заявка стёрлась уборкой.
	const byBase = new Map<string, ExtensionBaseInput["tokens"][number][]>();
	for (const t of input.tokens) {
		const k = norm(t.baseKey);
		byBase.set(k, [...(byBase.get(k) ?? []), t]);
	}
	for (const [k, list] of byBase) {
		const row = ensure(list[0]!.baseKey, list[0]!.baseKey);
		row.access = accessOf(list);
		if (!row.organizationUuid) row.organizationUuid = list[0]!.organizationUuid;
		void k;
	}

	/*
	 * 3. Срез бизнес-агента — ЖИВОЕ состояние: версия и транспорт. Версия отсюда главнее версии из заявки:
	 * заявку подавали однажды, а расширение с тех пор могли обновить. Когда базу знают несколько агентов,
	 * берём САМЫЙ СВЕЖИЙ срез — одним правилом со списком баз (freshestByBase), а не «последний в цикле».
	 */
	for (const s of freshestByBase(input.slices).values()) {
		const row = ensure(s.key, s.key);
		row.transport = s.transport;
		row.agentId = s.agentId;
		row.agentName = s.agentName ?? null;
		row.seenAt = s.seenAt;
		if (s.extVersion) { row.extVersion = s.extVersion; row.extVersionSource = "agent"; }
	}

	/*
	 * 4. КАНАЛ ЧАТА — база говорит о себе САМА (С2 аудита 23.09). Заголовок `X-Ext-Version` приходит в каждом
	 * её запросе, и для базы без агента это единственный источник: раньше в сводке у неё была пустая версия и
	 * пустое «Данные от», хотя она отвечала сегодня двадцать раз.
	 *
	 * ВЕРСИЯ ОТ АГЕНТА ГЛАВНЕЕ (порядок из задачи): агент говорит о самой базе, чат — о том, что в ней
	 * работает. Заявка уступает обоим.
	 */
	for (const c of input.chat ?? []) {
		const row = ensure(c.baseKey, c.baseKey);
		row.chatSeenAt = iso(c.seenAt);
		if (c.extVersion && row.extVersionSource !== "agent") { row.extVersion = c.extVersion; row.extVersionSource = "chat"; }
	}

	// Последний обмен — позднее из двух дорог; нет ни одной, значит про базу не сказал никто (и выдумывать нечего).
	for (const row of rows.values()) {
		const [agentAt, chatAt] = [row.seenAt, row.chatSeenAt];
		if (agentAt && (!chatAt || agentAt >= chatAt)) { row.lastExchangeAt = agentAt; row.lastExchangeSource = "agent"; }
		else if (chatAt) { row.lastExchangeAt = chatAt; row.lastExchangeSource = "chat"; }
	}

	return [...rows.values()].sort((a, b) => a.baseKey.localeCompare(b.baseKey, "ru"));
}


/**
 * Базы, где стоит расширение `buhprof_api`, — сводка ПО ИСТОЧНИКАМ РАСШИРЕНИЯ (23.09).
 *
 * ПОЧЕМУ НЕ ИЗ РЕЕСТРА КЛАСТЕРА. Первая версия этой сводки брала список из `GET /v1/onec/bases`, то есть из
 * среза, который ведёт АДМИН-агент, да ещё и суженного до выбранного в панели кластера. Итог был пустой экран
 * там, где он нужнее всего: у клиента, где админ-агента нет вовсе, а расширение работает. Расширение к
 * кластеру не привязано — оно живёт в базе, и приводит её к нам заявка, а не обход сервера.
 *
 * ТРИ ИСТОЧНИКА, И ВСЕ — ПРО РАСШИРЕНИЕ:
 *   1. ЗАЯВКА (`base_registrations`) — кто попросил подключение, что за база и какая версия расширения была
 *      на момент просьбы; одобрена или ещё ждёт.
 *   2. ТОКЕН (`base_tokens`) — состояние доступа к чату: действует, сменён (идёт перекрытие), отозван.
 *   3. СРЕЗ БИЗНЕС-АГЕНТА (`agent_bases`) — живая версия расширения и транспорт (HTTP или COM), то есть то,
 *      чем база отвечает СЕЙЧАС, а не чем отвечала при подключении.
 *
 * Соединяются по КЛЮЧУ базы: идентификаторы у трёх источников разные (у заявки — свой `onecBaseId` из 1С, у
 * токена — запись реестра, у среза — только ключ), а ключ базы есть у всех и по нему же её называет человек.
 */

export type ExtensionBaseInput = {
	registrations: readonly {
		baseKey: string | null; baseName: string; state: string; organizationUuid: string | null;
		decidedAt: Date | string | null; extensionVersion?: string | null;
	}[];
	tokens: readonly {
		baseKey: string; organizationUuid: string;
		createdAt: Date | string; revokedAt: Date | string | null; replacedBy: string | null; acceptedUntil: Date | string | null;
	}[];
	slices: readonly {
		agentId: string; agentName?: string | null;
		key: string; status: string | null; transport: "http" | "com" | null; extVersion: string | null; seenAt: string | null;
	}[];
};

export type ExtensionBaseRow = {
	baseKey: string;
	name: string;
	organizationUuid: string | null;
	/** Живая версия расширения (из среза агента), иначе та, что база назвала в заявке. */
	extVersion: string;
	/** `agent` — версию сейчас сообщает агент; `registration` — только со слов заявки; `none` — не знаем. */
	extVersionSource: "agent" | "registration" | "none";
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
			agentId: null, agentName: null, approvedAt: null, seenAt: null, pending: false,
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
	 * заявку подавали однажды, а расширение с тех пор могли обновить.
	 */
	for (const s of input.slices) {
		const row = ensure(s.key, s.key);
		row.transport = s.transport;
		row.agentId = s.agentId;
		row.agentName = s.agentName ?? null;
		row.seenAt = s.seenAt;
		if (s.extVersion) { row.extVersion = s.extVersion; row.extVersionSource = "agent"; }
	}

	return [...rows.values()].sort((a, b) => a.baseKey.localeCompare(b.baseKey, "ru"));
}

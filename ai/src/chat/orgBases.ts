/**
 * ОРГАНИЗАЦИЯ → БАЗА В ДИАЛОГЕ (СВ3, 19.09).
 *
 * У многобазового бизнес-агента `get_organizations` без адреса отдаёт организации ВСЕХ баз в пределах лимита, и у
 * каждой — поле `baseKey`: в какой базе она живёт. Модели его не показываем (для неё это шум, и она начнёт его
 * «передавать» по-своему), но сервис его запоминает в контексте диалога и сам кладёт `baseKey` в следующие вызовы —
 * так же, как модель передаёт `organizationBin` или `organizationId`. Иначе команда по выбранной организации ушла бы
 * без адреса, и агент с несколькими базами ответил бы BASE_REQUIRED.
 */

/** Организация из ответа GET_ORGANIZATIONS (поля, которые нам нужны). */
type OrgItem = { id?: unknown; bin?: unknown; baseKey?: unknown } & Record<string, unknown>;

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** Список организаций в ответе — массивом или полем `items`. */
function itemsOf(data: unknown): OrgItem[] | null {
	if (Array.isArray(data)) return data as OrgItem[];
	const items = (data as { items?: unknown } | null)?.items;
	return Array.isArray(items) ? (items as OrgItem[]) : null;
}

/**
 * Разобрать ответ GET_ORGANIZATIONS: что показать модели (без `baseKey`) и что запомнить (`id`/`bin` → `baseKey`).
 * Ответ другой формы или без `baseKey` — возвращается как есть, запоминать нечего.
 */
export function extractOrgBases(data: unknown): { visible: unknown; map: Record<string, string> } {
	const items = itemsOf(data);
	if (!items) return { visible: data, map: {} };
	const map: Record<string, string> = {};
	const cleaned = items.map((o) => {
		if (!o || typeof o !== "object") return o;
		const baseKey = text(o.baseKey);
		if (!baseKey) return o;
		const id = text(o.id);
		const bin = text(o.bin);
		// Один БИН в нескольких базах: первая строка — первая база по порядку агента, как и в resolveTarget.
		if (id && !(id in map)) map[id] = baseKey;
		if (bin && !(bin in map)) map[bin] = baseKey;
		const { baseKey: _hidden, ...rest } = o;
		return rest;
	});
	if (!Object.keys(map).length) return { visible: data, map: {} };
	return { visible: Array.isArray(data) ? cleaned : { ...(data as object), items: cleaned }, map };
}

/**
 * Какую базу назвал вызов: явный `baseKey` → по `organizationId` → по `organizationBin` из запомненного. `null` —
 * вызов базу не называет, и её выберет сервис по БИН организации ERP (agents/agentBases.resolveTarget).
 */
export function baseKeyOf(payload: Record<string, unknown>, remembered: Record<string, string> | undefined): string | null {
	const direct = text(payload.baseKey);
	if (direct) return direct;
	const map = remembered ?? {};
	const byOrg = map[text(payload.organizationId)];
	if (byOrg) return byOrg;
	const byBin = map[text(payload.organizationBin)];
	return byBin || null;
}

/**
 * БАЗЫ ОБЪЕКТОВ ДИАЛОГА (C0). id объекта 1С живёт только в своей базе: контрагент из «Альфы» в «Бете» — чужой или
 * вовсе не найден. Поэтому сервис помнит, из какой базы пришёл каждый id, и вызов, ссылающийся на объекты, уходит
 * в их базу. Первая запись выигрывает: id, пришедший повторно из другой базы, — совпадение, а не переезд.
 */
export function rememberIdBases(data: unknown, baseKey: string, into: Record<string, string>, collect: (v: unknown, s: Set<string>) => void): void {
	const ids = new Set<string>();
	collect(data, ids);
	for (const id of ids) if (!(id in into)) into[id] = baseKey;
}

/**
 * В какие базы ведут объекты, на которые ссылается вызов: организация (`organizationId`/`organizationBin` по ответу
 * get_organizations) и любые id объектов по памяти диалога. Несколько баз — вызов смешивает объекты разных баз.
 */
export function referencedBases(
	payload: Record<string, unknown>,
	orgBases: Record<string, string> | undefined,
	idBases: Record<string, string> | undefined,
): string[] {
	const found = new Set<string>();
	const orgs = orgBases ?? {};
	const ids = idBases ?? {};
	const org = orgs[text(payload.organizationId)] ?? orgs[text(payload.organizationBin)];
	if (org) found.add(org);
	const walk = (v: unknown, depth: number): void => {
		if (depth > 6 || v === null || v === undefined) return;
		if (typeof v === "string") {
			const b = ids[v.trim()];
			if (b) found.add(b);
			return;
		}
		if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return; }
		if (typeof v === "object") for (const x of Object.values(v as Record<string, unknown>)) walk(x, depth + 1);
	};
	for (const [k, v] of Object.entries(payload)) if (k !== "baseKey") walk(v, 0);
	return [...found];
}

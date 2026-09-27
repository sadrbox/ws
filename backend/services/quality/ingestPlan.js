// Приём итогов проверок учёта (E17 СК2) — чистая часть: что из «увиденного снова» реально
// изменилось (Н6 аудита 26.09). Без базы — проверяется headless-тестом.
//
// Раньше каждая увиденная снова находка обновлялась отдельным UPDATE с её JSON: до тысячи находок
// на проверку × два десятка проверок — около 20 тыс. построчных записей за один HTTP-запрос, хотя
// почти все находки приходят ровно такими же, как вчера. Теперь неизменённые отмечаются одним
// updateMany (lastSeenAt, lastRunUuid), а полный UPDATE — только у изменившихся и вернувшихся.

/** JSON с упорядоченными ключами: jsonb в Postgres хранит ключи в своём порядке. */
export function canonicalJson(v) {
	if (v === undefined) return "null";
	if (v === null || typeof v !== "object") return JSON.stringify(v);
	if (v instanceof Date) return JSON.stringify(v.toISOString());
	if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
	return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(",")}}`;
}

const time = (d) => (d ? new Date(d).getTime() : null);
/** Сумма как её сохранит колонка Decimal(18,2). */
const money = (x) => (x === null || x === undefined || x === "" ? null : Math.round(Number(x) * 100) / 100);

/**
 * Изменилась ли находка по сравнению с записанной.
 * @param {{severity:string,title:string,factDate:Date|null,amount:unknown,data:unknown}} stored
 * @param {{severity:string,title:string,factDate:Date|null,amount:number|null,data:object}} incoming
 */
export function findingChanged(stored, incoming) {
	if (!stored) return true;
	if (stored.severity !== incoming.severity) return true;
	if (stored.title !== incoming.title) return true;
	if (time(stored.factDate) !== time(incoming.factDate)) return true;
	if (money(stored.amount) !== money(incoming.amount)) return true;
	return canonicalJson(stored.data ?? null) !== canonicalJson(incoming.data ?? null);
}

/**
 * Разделить plan.update (planFindingsSync) на «только отметить» и «записать целиком».
 * @param {{uuid:string,value:object,reopened:boolean}[]} updates
 * @param {Map<string, object>} storedByUuid
 * @returns {{ touch: string[], full: {uuid:string,value:object,reopened:boolean}[] }}
 */
export function splitSeenUpdates(updates, storedByUuid) {
	const touch = [];
	const full = [];
	for (const u of updates) {
		if (!u.reopened && !findingChanged(storedByUuid.get(u.uuid), u.value)) touch.push(u.uuid);
		else full.push(u);
	}
	return { touch, full };
}

export default { canonicalJson, findingChanged, splitSeenUpdates };

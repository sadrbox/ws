/**
 * «ФОНОВЫЕ ЗАПРОСЫ» — ЧТО ИМЕННО ЖДЁМ И ЖДЁТ ЛИ ЭТОГО ЧЕЛОВЕК.
 *
 * Строка «Фоновые запросы: N» в «Прогрессе» считала ВСЕ запросы данных приложения, включая
 * опрос по расписанию (агенты раз в 15 с, процессы, статистика очереди, чат). Такой опрос
 * человек не запускал, и строка мелькала сама по себе; а число без имён не говорило, чего
 * ждём. Теперь опрос не считается, а ждущие разделы названы.
 */
import { translate } from "src/i18";
import { getByEndpoint } from "src/registry/modelRegistry";

/** Разделы панели 1С по второму элементу ключа `["onec", …]`. */
const ONEC_SECTIONS: Record<string, string> = {
	bases: "onecTabBases",
	agents: "onecTabAgents",
	sessions: "onecTabSessions",
	connections: "onecTabConnections",
	locks: "onecLocks",
	licenses: "onecLicenses",
	servers: "onecTabServer",
	"agent-processes": "onecTabProcesses",
	schedules: "onecTabSchedules",
	batches: "onecTabBatches",
	"base-users-cached": "onecTabUsers",
	"user-summary": "onecTabUsers",
	"user-where": "onecTabUsers",
	"ext-summary": "onecTabExtensions",
	"base-ext": "onecTabExtensions",
};

/** Имя раздела по ключу запроса: словарь панели 1С → реестр моделей → сам ключ. */
export function queryLabel(key: readonly unknown[]): string {
	const [head, second] = key;
	if (head === "onec" && typeof second === "string") {
		return ONEC_SECTIONS[second] ? translate(ONEC_SECTIONS[second]) : second;
	}
	if (head === "onec-bases") return translate("onecTabBases");
	if (typeof head !== "string") return "";
	return getByEndpoint(head)?.label ?? head;
}

/** То, что нужно знать о запросе: ключ, meta, наличие данных и опрос по расписанию. */
export type QueryLike = {
	queryKey: readonly unknown[];
	meta?: Record<string, unknown>;
	state: { dataUpdatedAt: number };
	observers?: { options: { refetchInterval?: unknown } }[];
};

/**
 * Фоновый — не запускал человек: опрос по расписанию у запроса, данные которого уже есть,
 * или явно помеченный `meta: { background: true }`. Первая загрузка опрашиваемого списка —
 * не фон: экран пуст и ждёт именно её.
 */
export function isBackgroundQuery(q: QueryLike): boolean {
	if (q.meta?.background === true) return true;
	return q.state.dataUpdatedAt > 0 && (q.observers ?? []).some((o) => !!o.options.refetchInterval);
}

/** Сколько ждём и чего: только не фоновые запросы, имена без повторов, не больше трёх. */
export function waitingSummary(queries: QueryLike[]): { count: number; names: string[] } {
	const mine = queries.filter((q) => !isBackgroundQuery(q));
	const names = [...new Set(mine.map((q) => queryLabel(q.queryKey)).filter(Boolean))];
	return { count: mine.length, names: names.length > 3 ? [...names.slice(0, 3), "…"] : names };
}

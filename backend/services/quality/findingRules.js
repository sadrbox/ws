// Правила находок проверок учёта (E17 СК2) — чистые функции без Prisma.
//
// Контракт с 1С: docs/TASK_EXTENSION_ACCOUNTING_CHECKS_2026-09-25.md. Находка живёт по
// fingerprint: пришла впервые → создаём; пришла снова → обновляем «видели последний раз»;
// не пришла в ПОЛНОМ прогоне (без обрезки) → устранена. Обрезанный (truncated) и
// пропущенный (skipped) прогоны ничего не закрывают: отсутствие находки там ничего не значит.
//
// Соответствие «проверка → пункт стандарта» живёт ЗДЕСЬ, в ERP, а не в 1С: расширение не
// знает о стандарте БухПроф и знать не должно.

/**
 * Каталог известных проверок: подпись, участок панели главбуха, пункт стандарта.
 * Проверка, которой здесь нет (1С добавила новую), работает с подписью-кодом и без пункта.
 */
export const CHECK_CATALOG = Object.freeze({
	"documents.unposted": { title: "Непроведённые документы", area: "documents", item: 14 },
	"documents.deletion_marked": { title: "Документы, помеченные на удаление", area: "documents", item: 14 },
	"documents.duplicates": { title: "Задвоенные документы", area: "documents", item: 14 },
	"documents.anomalies": { title: "Ошибочные документы", area: "documents", item: 14 },
	"stock.negative": { title: "Отрицательные остатки ТМЗ", area: "stock", item: 12 },
	"stock.chronology": { title: "Реализация раньше поступления", area: "stock", item: 12 },
	"stock.stale": { title: "Залежалые ТМЗ", area: "stock", item: 16 },
	"cash.negative": { title: "Касса и банк в минусе", area: "bank", item: 12 },
	"accounts.unnatural_balance": { title: "Сальдо не той стороны", area: "documents", item: 12 },
	"settlements.aging": { title: "Застарелая задолженность", area: "debts", item: 9 },
	"settlements.advances_offset": { title: "Незачтённые авансы", area: "debts", item: 9 },
	"catalogs.duplicate_counterparties": { title: "Дубли контрагентов", area: "catalogs", item: 13 },
	"catalogs.counterparty_requisites": { title: "Реквизиты контрагентов", area: "catalogs", item: 13 },
	"catalogs.duplicate_contracts": { title: "Дубли договоров", area: "catalogs", item: 13 },
	"catalogs.duplicate_products": { title: "Дубли номенклатуры", area: "catalogs", item: 13 },
	"ledger.empty_analytics": { title: "Проводки без аналитики", area: "catalogs", item: 13 },
	"counterparties.contacts": { title: "Контакты контрагентов", area: "catalogs", item: 10 },
	"fixed_assets.zero_residual": { title: "ОС с нулевой остаточной стоимостью", area: "fixedAssets", item: 17 },
	"fixed_assets.not_depreciating": { title: "ОС без амортизации", area: "fixedAssets", item: 17 },
	"bank.stale_accounts": { title: "Выписки не загружаются", area: "bank", item: 18 },
	"reconciliation.status": { title: "Акты сверки", area: "reconciliation", item: 7 },
	"esf.sales_without_esf": { title: "Реализации без ЭСФ", area: "taxes", item: 15 },
	"esf.mismatch": { title: "ЭСФ не сходится с учётом", area: "taxes", item: 15 },
	"classification.hints": { title: "Подсказки по классификации", area: "documents", item: null },
	// Служебная «проверка»: база не проверена — нет каталога (агент не ответил или не умеет проверки).
	"_catalog": { title: "База не проверена", area: "documents", item: null },
});

/** Участки панели главбуха (п. 29) — порядок колонок. */
export const AREAS = ["reconciliation", "debts", "bank", "documents", "catalogs", "taxes", "stock", "fixedAssets"];

export const SEVERITIES = ["error", "warning", "info"];
const SEVERITY_RANK = { error: 0, warning: 1, info: 2 };

export function checkTitle(code) {
	return CHECK_CATALOG[code]?.title || String(code || "");
}

export function areaOf(code) {
	if (CHECK_CATALOG[code]) return CHECK_CATALOG[code].area;
	const prefix = String(code || "").split(".")[0];
	return { documents: "documents", stock: "stock", cash: "bank", bank: "bank", settlements: "debts", catalogs: "catalogs", fixed_assets: "fixedAssets", esf: "taxes", reconciliation: "reconciliation" }[prefix] || "documents";
}

/**
 * Пункт стандарта по находке. Акт сверки особый: формальная сверка, расхождение и устаревший
 * акт — п. 8 («формальная сверка»), нет акта или не согласован — п. 7 («сверки не закрыты»).
 * Подсказки (info) пунктом не бывают.
 */
export function standardItemFor(code, finding) {
	if (finding?.severity === "info") return null;
	if (code === "reconciliation.status") {
		const status = finding?.data?.details?.status || String(finding?.fingerprint || "").split(":").pop();
		return ["formal", "discrepancy", "outdated"].includes(status) ? 8 : 7;
	}
	return CHECK_CATALOG[code]?.item ?? null;
}

/** Срок отработки находки: общий или свой у проверки. */
export function findingDeadlineDays(code, settings) {
	const own = settings?.findings?.perCheckDeadlineDays?.[code];
	if (Number.isFinite(own) && own >= 0) return own;
	const d = settings?.findings?.deadlineDays;
	return Number.isFinite(d) && d >= 0 ? d : 5;
}

const MAX_FINGERPRINT = 300;

/**
 * Привести находку из ответа 1С к записи ERP. Кривую (без fingerprint или title) отбрасываем
 * с причиной — одна испорченная строка не должна ронять весь прогон.
 * @returns {{ok:true, value:object} | {ok:false, reason:string}}
 */
export function normalizeFinding(raw) {
	if (!raw || typeof raw !== "object") return { ok: false, reason: "не объект" };
	const fingerprint = String(raw.fingerprint ?? "").trim();
	if (!fingerprint) return { ok: false, reason: "нет fingerprint" };
	if (fingerprint.length > MAX_FINGERPRINT) return { ok: false, reason: `fingerprint длиннее ${MAX_FINGERPRINT}` };
	const severity = SEVERITIES.includes(raw.severity) ? raw.severity : "warning";
	const title = String(raw.title ?? "").trim() || fingerprint;
	const factDate = raw.date && !Number.isNaN(new Date(raw.date).getTime()) ? new Date(raw.date) : null;
	const amount = Number.isFinite(Number(raw.amount)) && raw.amount !== null && raw.amount !== "" ? Number(raw.amount) : null;
	const data = {
		account: raw.account ?? null,
		quantity: raw.quantity ?? null,
		objects: Array.isArray(raw.objects) ? raw.objects : [],
		documents: Array.isArray(raw.documents) ? raw.documents : [],
		details: raw.details && typeof raw.details === "object" ? raw.details : {},
	};
	return { ok: true, value: { fingerprint, severity, title: title.slice(0, 500), factDate, amount, data } };
}

/**
 * План синхронизации находок одной проверки одной организации.
 * @param {{existing:{uuid:string,fingerprint:string,resolvedAt:Date|null}[], incoming:{fingerprint:string}[], complete:boolean}} p
 *   complete — прогон полный: статус ok/findings и не обрезан. Только такой закрывает находки.
 * @returns {{create:object[], update:{uuid:string,value:object,reopened:boolean}[], resolve:string[]}}
 */
export function planFindingsSync({ existing, incoming, complete }) {
	const byFp = new Map(existing.map((e) => [e.fingerprint, e]));
	const seen = new Set();
	const create = [];
	const update = [];
	for (const f of incoming) {
		if (seen.has(f.fingerprint)) continue; // дубль внутри ответа — считаем один раз
		seen.add(f.fingerprint);
		const ex = byFp.get(f.fingerprint);
		if (!ex) create.push(f);
		else update.push({ uuid: ex.uuid, value: f, reopened: !!ex.resolvedAt });
	}
	const resolve = complete
		? existing.filter((e) => !e.resolvedAt && !seen.has(e.fingerprint)).map((e) => e.uuid)
		: [];
	return { create, update, resolve };
}

/** Порядок находок в списках и сводной задаче: важность, затем сумма по модулю. */
export function compareFindings(a, b) {
	const s = (SEVERITY_RANK[a.severity] ?? 3) - (SEVERITY_RANK[b.severity] ?? 3);
	if (s) return s;
	return Math.abs(Number(b.amount) || 0) - Math.abs(Number(a.amount) || 0);
}

/** Исключение действует: поставлено и не истекло. */
export function exceptionActive(f, now = new Date()) {
	if (!f?.exceptionAt) return false;
	return !f.exceptionUntil || new Date(f.exceptionUntil).getTime() > now.getTime();
}

/**
 * Состояние участка на панели главбуха: red — ошибки или просрочки, yellow — предупреждения
 * или открытые задачи, green — чисто, none — данных нет (проверки не приходили).
 */
export function areaState({ errors = 0, warnings = 0, overdue = 0, openTasks = 0, hasData = true }) {
	if (errors > 0 || overdue > 0) return "red";
	if (warnings > 0 || openTasks > 0) return "yellow";
	return hasData ? "green" : "none";
}

// ── Сверка с лицевым счётом КН (п. 11) ──────────────────────────────────────────────

const normKbk = (v) => String(v ?? "").replace(/\D/g, "");

/**
 * Сравнить строки выписки лицевого счёта (КБК → сальдо) со снимком `taxes` из 1С.
 * Знак: в выписке КН «+» — переплата, «−» — задолженность; в 1С по счетам 3100/3200 кредитовое
 * сальдо — долг перед бюджетом, по 1400 дебетовое — переплата/актив. Приводим 1С к знаку КН:
 * сальдо = дебет − кредит.
 * ПРОВЕРИТЬ ПОТОМ: формат выписки из КНП (нужен образец файла) и есть ли в аналитике 1С КБК —
 * без КБК строки сопоставляются только по наименованию налога.
 */
export function compareKn(knRows, snapshotRows) {
	const byKbk = new Map();
	const byName = new Map();
	for (const r of snapshotRows || []) {
		const kbk = normKbk(r?.tax?.kbk);
		const bal = (Number(r.closingDebit) || 0) - (Number(r.closingCredit) || 0);
		const name = String(r?.tax?.name || r.accountName || "").trim().toLowerCase();
		if (kbk) byKbk.set(kbk, (byKbk.get(kbk) || 0) + bal);
		if (name) byName.set(name, (byName.get(name) || 0) + bal);
	}
	const rows = [];
	for (const k of knRows || []) {
		const kbk = normKbk(k.kbk);
		const name = String(k.name || "").trim().toLowerCase();
		const knBalance = Number(k.balance) || 0;
		const has1c = kbk && byKbk.has(kbk) ? true : name && byName.has(name);
		const onecBalance = kbk && byKbk.has(kbk) ? byKbk.get(kbk) : name && byName.has(name) ? byName.get(name) : null;
		const diff = onecBalance === null ? null : Math.round((knBalance - onecBalance) * 100) / 100;
		rows.push({ kbk: k.kbk ?? null, name: k.name ?? null, knBalance, onecBalance, diff, matched: !!has1c, ok: diff !== null && Math.abs(diff) < 0.01 });
	}
	const mismatches = rows.filter((r) => !r.ok).length;
	return { rows, mismatches, total: rows.length };
}

export default {
	CHECK_CATALOG, AREAS, SEVERITIES, checkTitle, areaOf, standardItemFor, findingDeadlineDays,
	normalizeFinding, planFindingsSync, compareFindings, exceptionActive, areaState, compareKn,
};

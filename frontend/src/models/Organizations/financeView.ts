/**
 * Разбор чисел из 1С для карточки организации (ПН9) — без JSX, ради тестов и Fast Refresh.
 *
 * ПОЧЕМУ РАЗБОР МЯГКИЙ. Форму ответа задаёт расширение в базе, и она будет меняться: строки могут
 * приехать в `rows`, `items` или просто массивом, суммы — числом или строкой «12 500,00». Панель, знающая
 * одну-единственную форму, на первой же правке покажет пустоту вместо долгов. Поэтому читаем то, что
 * похоже на данные, а чего не поняли — не выдумываем: `null` честнее нуля, потому что ноль означает
 * «долга нет», а это совсем другой ответ.
 *
 * НИЧЕГО НЕ КЭШИРУЕМ. Числа читаются из базы по кнопке и живут ровно до следующего открытия карточки:
 * кэш здесь означал бы третью версию правды рядом с 1С и панелью (решение владельца, 22.09).
 */
import type { TDataItem } from "src/components/Table/types";
import { withStableIds } from "src/utils/stableRowId";

export type DebtRow = {
	name: string;
	bin: string;
	/** Нам должны. */
	receivable: number | null;
	/** Мы должны. */
	payable: number | null;
	/** Просрочено (из того, что нам должны). */
	overdue: number | null;
};

export type BalanceRow = {
	account: string;
	name: string;
	balance: number | null;
};

const asRecord = (v: unknown): Record<string, unknown> | null =>
	v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;

/**
 * Строки ответа: массивом, либо в `rows`/`items`/`list`. Больше нигде их не ищем — угадывание по любому
 * массиву в ответе однажды покажет служебный список как долги.
 */
export function rowsOf(data: unknown): Record<string, unknown>[] {
	if (Array.isArray(data)) return data.filter((x): x is Record<string, unknown> => !!asRecord(x));
	const o = asRecord(data);
	if (!o) return [];
	for (const key of ["rows", "items", "list"]) {
		const v = o[key];
		if (Array.isArray(v)) return v.filter((x): x is Record<string, unknown> => !!asRecord(x));
	}
	return [];
}

/** Число из 1С: числом или строкой («12 500,00», «1 234.5»). Пустое и нечитаемое — null, а не 0. */
export function money(v: unknown): number | null {
	if (typeof v === "number") return Number.isFinite(v) ? v : null;
	if (typeof v !== "string") return null;
	// `\s` в JS покрывает и неразрывные пробелы (U+00A0, U+202F), которыми 1С и ru-RU разделяют разряды.
	const cleaned = v.replace(/\s/g, "").replace(",", ".");
	if (!cleaned || !/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
	const n = Number(cleaned);
	return Number.isFinite(n) ? n : null;
}

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");

/** Имя контрагента: вложенным объектом или полем рядом — обе формы встречаются в ответах 1С. */
const nameOf = (r: Record<string, unknown>): string => {
	const nested = asRecord(r.counterparty);
	return text(nested?.name) || text(r.name) || text(r.counterpartyName) || "";
};

const binOf = (r: Record<string, unknown>): string => {
	const nested = asRecord(r.counterparty);
	return text(nested?.bin) || text(r.bin) || "";
};

export function debtRows(data: unknown): DebtRow[] {
	return rowsOf(data).map((r) => ({
		name: nameOf(r),
		bin: binOf(r),
		receivable: money(r.receivable ?? r.debit ?? r.theyOwe),
		payable: money(r.payable ?? r.credit ?? r.weOwe),
		overdue: money(r.overdue),
	}));
}

export function balanceRows(data: unknown): BalanceRow[] {
	return rowsOf(data).map((r) => ({
		account: text(r.account) || text(r.code),
		name: text(r.name) || text(r.title),
		balance: money(r.balance ?? r.amount ?? r.sum),
	}));
}

/**
 * Итоги считаем САМИ по показанным строкам — но только если 1С не прислала свои: складывать сотню строк,
 * из которых показаны 50, значит показать сумму, не сходящуюся ни с чем.
 */
export type DebtTotals = { receivable: number | null; payable: number | null; overdue: number | null };

/** Итоги, присланные самой 1С (по всем строкам, а не по показанным), — или null, если она их не прислала. */
export function sourceDebtTotals(data: unknown): DebtTotals | null {
	const totals = asRecord(asRecord(data)?.totals);
	if (!totals) return null;
	return {
		receivable: money(totals.receivable ?? totals.debit),
		payable: money(totals.payable ?? totals.credit),
		overdue: money(totals.overdue),
	};
}

export function debtTotals(data: unknown, rows: readonly DebtRow[]): DebtTotals {
	const own = sourceDebtTotals(data);
	if (own) return own;
	const sum = (pick: (r: DebtRow) => number | null): number | null => {
		const values = rows.map(pick).filter((n): n is number => n !== null);
		return values.length ? values.reduce((a, b) => a + b, 0) : null;
	};
	return { receivable: sum((r) => r.receivable), payable: sum((r) => r.payable), overdue: sum((r) => r.overdue) };
}

/** Сколько строк всего по данным 1С: показано может быть меньше — об этом карточка и скажет. */
export function totalOf(data: unknown): number | null {
	const o = asRecord(data);
	const n = o ? money(o.total) : null;
	return n === null ? null : Math.trunc(n);
}

/** Деньги для показа: без копеек, если их нет, и с разрядами — иначе «12500000» не прочитать. */
export const showMoney = (n: number | null): string =>
	n === null ? "—" : n.toLocaleString("ru-RU", { maximumFractionDigits: 2 });

/*
 * СТРОКИ ДЛЯ ОБЩЕГО Table (28.09). Имена полей — идентификаторы колонок, они же ключи перевода заголовков
 * (getTranslateColumn). Суммы остаются числами: сортировка сравнивает их как числа, а итог в подвале складывает;
 * вид «12 500» накладывает renderCell (showMoney). Пустые имя и БИН — «—», как было в карточке.
 */

export type DebtTableRow = TDataItem & {
	counterparty: string;
	binIin: string;
	onecOrgDebtReceivable: number | null;
	onecOrgDebtPayable: number | null;
	onecOrgDebtOverdue: number | null;
};

export function debtTableRows(rows: readonly DebtRow[]): DebtTableRow[] {
	return withStableIds(rows, (d) => `${d.bin}/${d.name}`).map((d) => ({
		id: d.id,
		uuid: String(d.id),
		counterparty: d.name || "—",
		binIin: d.bin || "—",
		onecOrgDebtReceivable: d.receivable,
		onecOrgDebtPayable: d.payable,
		onecOrgDebtOverdue: d.overdue,
	}));
}

export type BalanceTableRow = TDataItem & { account: string; name: string; onecOrgBalance: number | null };

export function balanceTableRows(rows: readonly BalanceRow[]): BalanceTableRow[] {
	return withStableIds(rows, (b) => `${b.account}/${b.name}`).map((b) => ({
		id: b.id,
		uuid: String(b.id),
		account: b.account || "—",
		name: b.name || "—",
		onecOrgBalance: b.balance,
	}));
}

/**
 * Подвал таблицы долгов: подпись «Итого» и — если 1С прислала свои итоги — они. Без итогов 1С суммы считает сам
 * Table (`footer: "sum"`) по показанным строкам, и тогда быстрый поиск сужает итог вместе со списком. Итоги 1С
 * поиск не меняет: это сумма по ВСЕМ контрагентам базы, включая не попавших в список.
 */
export function debtFooterValues(data: unknown, totalLabel: string): Record<string, string | null> {
	const own = sourceDebtTotals(data);
	return own
		? {
			counterparty: totalLabel,
			onecOrgDebtReceivable: showMoney(own.receivable),
			onecOrgDebtPayable: showMoney(own.payable),
			onecOrgDebtOverdue: showMoney(own.overdue),
		}
		: { counterparty: totalLabel };
}

// Модель банковской выписки — единая для любого банка.
//
// PDF трёх банков выглядят по-разному (таблицы БЦК, «карточные» Kaspi, многостраничные
// Halyk), но содержат одно и то же: владельца счёта, счёт, период, остатки и список операций,
// у каждой — дата, сумма, направление, вторая сторона, КНП и назначение. Именно это и есть
// контракт: извлечение приводит любой формат к этой структуре, дальше банк не важен.
//
// АРИФМЕТИЧЕСКАЯ СВЕРКА — ЗАЩИТА ОТ ГАЛЛЮЦИНАЦИЙ. Модель может пропустить строку или
// ошибиться в сумме; сумма распознанных операций против итогов и остатков выписки ловит это
// без участия человека. Несведённая выписка не запрещена к загрузке (итоги в PDF тоже бывают
// нестандартными), но пользователь увидит расхождение до подтверждения.

import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "дата в формате YYYY-MM-DD");
const money = z.number().finite().nonnegative();

export const CounterpartySchema = z.object({
	name: z.string().trim().min(1),
	// Формат БИН не проверяется здесь: неверный БИН — замечание сверки, а не отказ всей выписки.
	bin: z.string().trim().optional(),
	iik: z.string().trim().optional(),
	bik: z.string().trim().optional(),
	bankName: z.string().trim().optional(),
});

export const StatementLineSchema = z.object({
	date: isoDate,
	number: z.string().trim().optional(),
	direction: z.enum(["in", "out"]),
	amount: money,
	counterparty: CounterpartySchema,
	knp: z.string().trim().optional(),
	purpose: z.string().trim().optional(),
});

export const StatementSchema = z.object({
	bank: z.string().trim().min(1),
	owner: z.object({ name: z.string().trim().min(1), bin: z.string().trim().optional() }),
	account: z.object({
		iik: z.string().trim().min(1),
		bik: z.string().trim().optional(),
		bankName: z.string().trim().optional(),
		currency: z.string().trim().default("KZT"),
	}),
	period: z.object({ from: isoDate, to: isoDate }),
	openingBalance: z.number().finite().nullable().optional(),
	closingBalance: z.number().finite().nullable().optional(),
	totalIn: z.number().finite().nullable().optional(),
	totalOut: z.number().finite().nullable().optional(),
	lines: z.array(StatementLineSchema),
});

export type Counterparty = z.infer<typeof CounterpartySchema>;
export type StatementLine = z.infer<typeof StatementLineSchema>;
export type Statement = z.infer<typeof StatementSchema>;

/** JSON Schema для инструмента извлечения — то же, что StatementSchema, словами для модели. */
export const STATEMENT_JSON_SCHEMA: Record<string, unknown> = {
	type: "object",
	properties: {
		bank: { type: "string", description: "Банк, выдавший выписку (как напечатано)" },
		owner: {
			type: "object",
			properties: {
				name: { type: "string", description: "Владелец счёта — наименование клиента банка" },
				bin: { type: "string", description: "БИН/ИИН владельца, 12 цифр; пусто, если не напечатан" },
			},
			required: ["name"],
		},
		account: {
			type: "object",
			properties: {
				iik: { type: "string", description: "Номер счёта владельца (ИИК, KZ…)" },
				bik: { type: "string", description: "БИК банка владельца" },
				bankName: { type: "string", description: "Наименование банка владельца" },
				currency: { type: "string", description: "Валюта счёта, код ISO (KZT)" },
			},
			required: ["iik", "currency"],
		},
		period: {
			type: "object",
			properties: { from: { type: "string", description: "YYYY-MM-DD" }, to: { type: "string", description: "YYYY-MM-DD" } },
			required: ["from", "to"],
		},
		openingBalance: { type: ["number", "null"], description: "Входящий остаток на начало периода; null, если не напечатан" },
		closingBalance: { type: ["number", "null"], description: "Исходящий остаток на конец периода; null, если не напечатан" },
		totalIn: { type: ["number", "null"], description: "Итого поступлений (кредитовый оборот) по данным выписки; null, если не напечатан" },
		totalOut: { type: ["number", "null"], description: "Итого списаний (дебетовый оборот) по данным выписки; null, если не напечатан" },
		lines: {
			type: "array",
			description: "ВСЕ операции выписки по порядку, без пропусков и без итоговых строк",
			items: {
				type: "object",
				properties: {
					date: { type: "string", description: "Дата операции YYYY-MM-DD" },
					number: { type: "string", description: "Номер документа/референс из выписки; пусто, если нет" },
					direction: { type: "string", enum: ["in", "out"], description: "in — поступление на счёт владельца, out — списание со счёта владельца" },
					amount: { type: "number", description: "Сумма операции, положительное число, точка как разделитель" },
					counterparty: {
						type: "object",
						description: "Вторая сторона операции: для поступления — плательщик, для списания — получатель",
						properties: {
							name: { type: "string" },
							bin: { type: "string", description: "БИН/ИИН второй стороны, 12 цифр; пусто, если не напечатан" },
							iik: { type: "string", description: "Счёт второй стороны" },
							bik: { type: "string", description: "БИК банка второй стороны" },
							bankName: { type: "string" },
						},
						required: ["name"],
					},
					knp: { type: "string", description: "Код назначения платежа (КНП), 3 цифры; пусто, если нет" },
					purpose: { type: "string", description: "Назначение платежа как напечатано" },
				},
				required: ["date", "direction", "amount", "counterparty"],
			},
		},
	},
	required: ["bank", "owner", "account", "period", "lines"],
};

export type ReconciliationCheck = { name: string; expected: number; actual: number; ok: boolean };
export type Reconciliation = { ok: boolean; checks: ReconciliationCheck[]; problems: string[]; countIn: number; countOut: number; sumIn: number; sumOut: number };

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Арифметическая сверка распознанных строк с итогами и остатками выписки. */
export function reconcile(s: Statement): Reconciliation {
	const sumIn = round2(s.lines.filter((l) => l.direction === "in").reduce((a, l) => a + l.amount, 0));
	const sumOut = round2(s.lines.filter((l) => l.direction === "out").reduce((a, l) => a + l.amount, 0));
	const checks: ReconciliationCheck[] = [];
	const problems: string[] = [];
	const near = (a: number, b: number) => Math.abs(a - b) < 0.011;

	if (typeof s.totalIn === "number") checks.push({ name: "поступления", expected: round2(s.totalIn), actual: sumIn, ok: near(s.totalIn, sumIn) });
	if (typeof s.totalOut === "number") checks.push({ name: "списания", expected: round2(s.totalOut), actual: sumOut, ok: near(s.totalOut, sumOut) });
	if (typeof s.openingBalance === "number" && typeof s.closingBalance === "number") {
		const expected = round2(s.closingBalance);
		const actual = round2(s.openingBalance + sumIn - sumOut);
		checks.push({ name: "остаток на конец", expected, actual, ok: near(expected, actual) });
	}
	if (!checks.length) problems.push("В выписке нет итогов и остатков — сверить суммы не с чем.");
	for (const c of checks) if (!c.ok) problems.push(`${c.name}: по выписке ${fmt(c.expected)}, по распознанным строкам ${fmt(c.actual)} (разница ${fmt(round2(c.actual - c.expected))})`);
	if (!s.lines.length) problems.push("Не распознано ни одной операции.");
	for (const [i, l] of s.lines.entries()) {
		if (l.counterparty.bin && !/^\d{12}$/.test(l.counterparty.bin)) problems.push(`строка ${i + 1}: БИН «${l.counterparty.bin}» не из 12 цифр`);
		if (l.date < s.period.from || l.date > s.period.to) problems.push(`строка ${i + 1}: дата ${l.date} вне периода выписки`);
	}
	return { ok: checks.length > 0 && checks.every((c) => c.ok) && s.lines.length > 0, checks, problems, countIn: s.lines.filter((l) => l.direction === "in").length, countOut: s.lines.filter((l) => l.direction === "out").length, sumIn, sumOut };
}

export function fmt(n: number): string {
	return n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/ /g, " ");
}

/** Короткая сводка выписки — для сообщения модели и карточки подтверждения. */
export function summarize(s: Statement, r: Reconciliation): string {
	const rec = r.ok ? "сверка сошлась" : `СВЕРКА НЕ СОШЛАСЬ: ${r.problems.slice(0, 3).join("; ")}`;
	return [
		`Банк: ${s.bank}; счёт ${s.account.iik} (${s.account.currency})`,
		`Владелец: ${s.owner.name}${s.owner.bin ? `, БИН ${s.owner.bin}` : ""}`,
		`Период: ${s.period.from} — ${s.period.to}`,
		`Операций: ${s.lines.length} (поступлений ${r.countIn} на ${fmt(r.sumIn)}, списаний ${r.countOut} на ${fmt(r.sumOut)})`,
		typeof s.openingBalance === "number" || typeof s.closingBalance === "number"
			? `Остатки: начало ${s.openingBalance == null ? "—" : fmt(s.openingBalance)}, конец ${s.closingBalance == null ? "—" : fmt(s.closingBalance)}`
			: null,
		`Сверка: ${rec}`,
	].filter(Boolean).join("\n");
}

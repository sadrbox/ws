// Модель первичного документа поставщика (И2, docs/TASK_SERVICE_PURCHASE_FROM_PDF_2026-09-24.md):
// счёт-фактура, накладная или акт — то, по чему бухгалтер делает поступление.
//
// Как и выписка, документ разбирает модель по PDF, а дальше с ним работает 1С: сопоставляет строки
// со своим справочником (MATCH_PURCHASE_DOCUMENT) и по решению человека создаёт непроведённое
// поступление (CREATE_PURCHASE_FROM_DOCUMENT). Поля payload для 1С собирает сервис из этой записи —
// модель диалога не пересказывает строки и не может их «поправить».
//
// АРИФМЕТИЧЕСКАЯ ПРОВЕРКА — та же защита от галлюцинаций, что у выписки: количество × цена против
// суммы строки и сумма строк против итога документа. Несошедшийся документ не запрещён (скидки,
// округления, итог с НДС сверху), но человек увидит расхождение до подтверждения.

import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "дата в формате YYYY-MM-DD");

export const DOCUMENT_KINDS = ["invoice", "waybill", "act"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const PurchaseLineSchema = z.object({
	index: z.number().int().positive(),
	name: z.string().trim().min(1),
	article: z.string().trim().optional(),
	unit: z.string().trim().optional(),
	quantity: z.number().finite().positive(),
	price: z.number().finite().nonnegative(),
	amount: z.number().finite().nonnegative(),
	vatRate: z.string().trim().optional(),
	vatAmount: z.number().finite().nonnegative().optional(),
});

export const PurchaseDocumentSchema = z.object({
	documentKind: z.enum(DOCUMENT_KINDS),
	supplier: z.object({
		name: z.string().trim().min(1),
		// Формат БИН не проверяется здесь: неверный БИН — замечание проверки, а не отказ всего документа.
		bin: z.string().trim().optional(),
		iik: z.string().trim().optional(),
		bik: z.string().trim().optional(),
	}),
	buyer: z.object({ name: z.string().trim().optional(), bin: z.string().trim().optional() }).optional(),
	number: z.string().trim().optional(),
	date: isoDate.optional(),
	currency: z.string().trim().default("KZT"),
	totals: z.object({
		amount: z.number().finite().nonnegative().nullable().optional(),
		vat: z.number().finite().nonnegative().nullable().optional(),
	}).default({}),
	lines: z.array(PurchaseLineSchema),
});

export type PurchaseLine = z.infer<typeof PurchaseLineSchema>;
export type PurchaseDocument = z.infer<typeof PurchaseDocumentSchema>;

/** JSON Schema для инструмента извлечения — то же, что PurchaseDocumentSchema, словами для модели. */
export const PURCHASE_JSON_SCHEMA: Record<string, unknown> = {
	type: "object",
	properties: {
		documentKind: { type: "string", enum: [...DOCUMENT_KINDS], description: "invoice — счёт-фактура; waybill — накладная на отпуск запасов (З-2) или товарная накладная; act — акт выполненных работ (оказанных услуг)" },
		supplier: {
			type: "object",
			description: "Поставщик — тот, кто отпустил товар или оказал услугу",
			properties: {
				name: { type: "string", description: "Наименование поставщика как напечатано" },
				bin: { type: "string", description: "БИН/ИИН поставщика, 12 цифр; пусто, если не напечатан" },
				iik: { type: "string", description: "ИИК (счёт) поставщика, KZ…" },
				bik: { type: "string", description: "БИК банка поставщика" },
			},
			required: ["name"],
		},
		buyer: {
			type: "object",
			description: "Покупатель (получатель) по документу",
			properties: { name: { type: "string" }, bin: { type: "string", description: "БИН/ИИН покупателя, 12 цифр" } },
		},
		number: { type: "string", description: "Номер документа как напечатан" },
		date: { type: "string", description: "Дата документа YYYY-MM-DD" },
		currency: { type: "string", description: "Валюта, код ISO (KZT)" },
		totals: {
			type: "object",
			properties: {
				amount: { type: ["number", "null"], description: "Итого по документу С НДС; null, если не напечатан" },
				vat: { type: ["number", "null"], description: "Итого НДС по документу; null, если не напечатан" },
			},
		},
		lines: {
			type: "array",
			description: "ВСЕ товарные строки документа по порядку, без пропусков и без итоговых строк",
			items: {
				type: "object",
				properties: {
					index: { type: "integer", description: "Порядковый номер строки, сквозной с 1" },
					name: { type: "string", description: "Наименование товара/услуги как напечатано" },
					article: { type: "string", description: "Артикул или код товара, если есть отдельная колонка; пусто, если нет" },
					unit: { type: "string", description: "Единица измерения как напечатана (шт, пачка, кг, услуга)" },
					quantity: { type: "number", description: "Количество" },
					price: { type: "number", description: "Цена за единицу, как в колонке цены документа" },
					amount: { type: "number", description: "Стоимость строки С НДС (если в документе есть колонка «с НДС»); иначе — как напечатана" },
					vatRate: { type: "string", description: "Ставка НДС строки: «НДС12», «Без НДС», «НДС0»; пусто, если не указана" },
					vatAmount: { type: "number", description: "Сумма НДС строки; не указывай, если колонки нет" },
				},
				required: ["index", "name", "quantity", "price", "amount"],
			},
		},
	},
	required: ["documentKind", "supplier", "lines"],
};

/** sumsOk — сошлась ли арифметика (строки и итоги); ok — ещё и реквизиты (формат БИН). */
export type PurchaseCheck = { ok: boolean; sumsOk: boolean; problems: string[]; sumLines: number; sumVat: number | null };

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Арифметическая проверка распознанного документа. Строка сходится, если сумма равна количеству × цене —
 * с НДС сверху или без (в документах РК цена бывает и такой, и такой).
 */
export function checkPurchase(d: PurchaseDocument): PurchaseCheck {
	const problems: string[] = [];
	const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, Math.abs(b) * 0.001);
	const sumLines = round2(d.lines.reduce((a, l) => a + l.amount, 0));
	const vats = d.lines.map((l) => l.vatAmount);
	const sumVat = vats.every((v) => typeof v === "number") ? round2(vats.reduce((a: number, v) => a + (v as number), 0)) : null;

	if (!d.lines.length) problems.push("Не распознано ни одной строки.");
	const seen = new Set<number>();
	for (const l of d.lines) {
		if (seen.has(l.index)) problems.push(`строка ${l.index}: номер строки повторяется`);
		seen.add(l.index);
		const base = round2(l.quantity * l.price);
		const withVat = typeof l.vatAmount === "number" ? round2(base + l.vatAmount) : null;
		if (!near(l.amount, base) && !(withVat !== null && near(l.amount, withVat))) {
			problems.push(`строка ${l.index}: ${fmt(l.quantity)} × ${fmt(l.price)} = ${fmt(base)}, а в сумме строки ${fmt(l.amount)}`);
		}
	}
	if (typeof d.totals.amount === "number" && !near(d.totals.amount, sumLines)) {
		// Итог бывает без НДС в строках и с НДС внизу: сходится с НДС — не расхождение.
		const withVat = sumVat !== null ? round2(sumLines + sumVat) : null;
		if (!(withVat !== null && near(d.totals.amount, withVat))) problems.push(`итог по документу ${fmt(d.totals.amount)}, по строкам ${fmt(sumLines)}`);
	}
	if (typeof d.totals.vat === "number" && sumVat !== null && !near(d.totals.vat, sumVat)) problems.push(`НДС по документу ${fmt(d.totals.vat)}, по строкам ${fmt(sumVat)}`);
	const sumsOk = problems.length === 0;
	if (d.supplier.bin && !/^\d{12}$/.test(d.supplier.bin)) problems.push(`БИН поставщика «${d.supplier.bin}» не из 12 цифр`);
	return { ok: problems.length === 0, sumsOk, problems, sumLines, sumVat };
}

export function fmt(n: number): string {
	return n.toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).replace(/ /g, " ");
}

export const KIND_LABEL: Record<DocumentKind, string> = { invoice: "Счёт-фактура", waybill: "Накладная", act: "Акт выполненных работ" };

/**
 * Строка из PDF в сообщении модели. Текст чужого документа — ДАННЫЕ (И4): переводы строк и квадратные
 * скобки убираем, чтобы наименование не могло закрыть блок вложения и начать «свой» абзац.
 */
export function clean(s: string | undefined, max = 200): string {
	return String(s ?? "").replace(/[\r\n\t]+/g, " ").replace(/[[\]]/g, "").replace(/\s{2,}/g, " ").trim().slice(0, max);
}

/** Короткая сводка документа — для сообщения модели и карточки подтверждения. */
export function summarizePurchase(d: PurchaseDocument, c: PurchaseCheck): string {
	return [
		`${KIND_LABEL[d.documentKind]}${d.number ? ` № ${clean(d.number, 50)}` : ""}${d.date ? ` от ${d.date}` : ""}`,
		`Поставщик: ${clean(d.supplier.name)}${d.supplier.bin ? `, БИН ${d.supplier.bin}` : ""}`,
		d.buyer?.bin || d.buyer?.name ? `Покупатель: ${clean(d.buyer?.name) || "—"}${d.buyer?.bin ? `, БИН ${d.buyer.bin}` : ""}` : null,
		`Строк: ${d.lines.length}; итого ${typeof d.totals.amount === "number" ? fmt(d.totals.amount) : fmt(c.sumLines)} ${d.currency}${typeof d.totals.vat === "number" ? `, НДС ${fmt(d.totals.vat)}` : ""}`,
		`Проверка: ${c.ok ? "суммы сошлись" : `РАСХОЖДЕНИЕ: ${c.problems.slice(0, 3).join("; ")}`}`,
	].filter(Boolean).join("\n");
}

/** Строки документа для модели — все: без них ей нечего сопоставлять с ответом 1С. */
export function purchaseLinesText(d: PurchaseDocument, limit = 60): string {
	const rows = d.lines.slice(0, limit).map((l) =>
		`${l.index}. ${clean(l.name)}${l.article ? ` (арт. ${clean(l.article, 50)})` : ""} — ${fmt(l.quantity)} ${clean(l.unit, 20) || ""} × ${fmt(l.price)} = ${fmt(l.amount)}${l.vatRate ? `, ${clean(l.vatRate, 20)}` : ""}`.replace(/\s{2,}/g, " "));
	return rows.join("\n") + (d.lines.length > limit ? `\n… всего строк ${d.lines.length}` : "");
}

/**
 * Payload MATCH_PURCHASE_DOCUMENT / CREATE_PURCHASE_FROM_DOCUMENT для 1С — ровно поля задачи.
 * Необязательные поля, которых нет в документе, не передаются вовсе: пустая строка для 1С — значение.
 */
export function purchasePayload(d: PurchaseDocument, organizationBin: string | null): Record<string, unknown> {
	const opt = <T>(k: string, v: T | undefined | null) => (v === undefined || v === null || v === "" ? {} : { [k]: v });
	return {
		documentKind: d.documentKind,
		...opt("organizationBin", organizationBin),
		supplier: { name: d.supplier.name, ...opt("bin", d.supplier.bin), ...opt("iik", d.supplier.iik), ...opt("bik", d.supplier.bik) },
		...opt("number", d.number),
		...opt("date", d.date),
		currency: d.currency,
		totals: { ...opt("amount", d.totals.amount), ...opt("vat", d.totals.vat) },
		lines: d.lines.map((l) => ({
			index: l.index, name: l.name, ...opt("article", l.article), ...opt("unit", l.unit),
			quantity: l.quantity, price: l.price, amount: l.amount, ...opt("vatRate", l.vatRate), ...opt("vatAmount", l.vatAmount),
		})),
	};
}

// Реестр инструментов LLM (§13 ТЗ) — закрытый список.
//
// Каждый инструмент описывает: схему входа для модели, класс операции (§17) и превращение
// вызова модели в команду агенту. Ничего исполняющего произвольный код здесь нет и быть
// не может: инструмент — это ровно один тип команды из whitelist'а агента.
//
// ЗАЩИТА ОТ ВЫДУМАННЫХ ИДЕНТИФИКАТОРОВ (§14). Модель не знает GUID объектов 1С и не должна
// их сочинять. Всякий id, который она передаёт в create_sale/get_sale/…, обязан ранее
// прийти в ЭТОТ диалог из результата поиска или чтения. Реестр проверяет это по множеству
// «виденных» id в контексте диалога; чужой id отклоняется до постановки команды.

import { z } from "zod";
import type { ToolDefinition } from "../llm/provider.ts";

export type OperationClass = "READ" | "WRITE" | "CRITICAL";

export type ToolSpec = {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	operation: OperationClass;
	/** Тип команды агента (whitelist bpapi-agent). */
	commandType: string;
	/** Проверка и нормализация входа; возвращает payload для агента. */
	buildPayload: (input: Record<string, unknown>, ctx: ToolContext) => Record<string, unknown>;
	/** Нужен ли requestId (изменяющие операции). */
	mutating: boolean;
};

export type ToolContext = {
	/** Идентификаторы объектов 1С, уже показанные в этом диалоге. */
	seenIds: Set<string>;
};

export class ToolInputError extends Error {
	readonly field: string;
	constructor(field: string, message: string) {
		super(message);
		this.field = field;
	}
}

const uuid = z.string().uuid();

function known(ctx: ToolContext, field: string, value: unknown): string {
	const p = uuid.safeParse(value);
	if (!p.success) throw new ToolInputError(field, `${field}: ожидается идентификатор объекта из результатов поиска`);
	if (!ctx.seenIds.has(p.data)) {
		throw new ToolInputError(field, `${field}: этот идентификатор не встречался в диалоге — сначала найдите объект инструментом поиска`);
	}
	return p.data;
}

const searchSchema = {
	type: "object",
	properties: {
		q: { type: "string", description: "Строка поиска: часть наименования, код, артикул или БИН" },
		limit: { type: "integer", minimum: 1, maximum: 20, description: "Сколько вернуть, по умолчанию 10" },
	},
	required: ["q"],
	additionalProperties: false,
};

export const TOOLS: ToolSpec[] = [
	{
		name: "search_counterparties",
		description: "Найти контрагентов (покупателей) в 1С по части названия или БИН. Возвращает список с id — только эти id можно использовать дальше.",
		inputSchema: searchSchema,
		operation: "READ",
		commandType: "SEARCH_COUNTERPARTIES",
		mutating: false,
		buildPayload: (i) => ({ q: str(i.q, "q"), limit: num(i.limit, 10) }),
	},
	{
		name: "search_products",
		description: "Найти номенклатуру (товары или услуги) в 1С по части названия, артикулу или коду. Возвращает список с id, признаком isService и ставкой НДС.",
		inputSchema: {
			...searchSchema,
			properties: { ...searchSchema.properties, kind: { type: "string", enum: ["goods", "services", "any"], description: "Только товары, только услуги или всё" } },
		},
		operation: "READ",
		commandType: "SEARCH_PRODUCTS",
		mutating: false,
		buildPayload: (i) => ({ q: str(i.q, "q"), limit: num(i.limit, 10), ...(i.kind ? { kind: str(i.kind, "kind") } : {}) }),
	},
	{
		name: "get_organizations",
		description: "Список организаций (наших юрлиц) в базе 1С. Нужен, только если организаций несколько.",
		inputSchema: { type: "object", properties: {}, additionalProperties: false },
		operation: "READ",
		commandType: "GET_ORGANIZATIONS",
		mutating: false,
		buildPayload: () => ({}),
	},
	{
		name: "get_warehouses",
		description: "Список складов в базе 1С. Для реализации товаров склад обязателен; для услуг — нет.",
		inputSchema: { type: "object", properties: {}, additionalProperties: false },
		operation: "READ",
		commandType: "GET_WAREHOUSES",
		mutating: false,
		buildPayload: () => ({}),
	},
	{
		name: "create_sale",
		description:
			"Создать документ «Реализация товаров и услуг» в 1С (НЕ проведённый). Все id — только из результатов search_*/get_* этого диалога. " +
			"Если 1С вернёт CONTRACT_AMBIGUOUS — покажите пользователю кандидатов и спросите, какой договор выбрать, затем повторите с contractId.",
		inputSchema: {
			type: "object",
			properties: {
				customerId: { type: "string", description: "id контрагента из search_counterparties" },
				warehouseId: { type: "string", description: "id склада из get_warehouses (обязателен для товаров)" },
				organizationId: { type: "string", description: "id организации из get_organizations (если их несколько)" },
				contractId: { type: "string", description: "id договора из кандидатов CONTRACT_AMBIGUOUS" },
				priceIncludesVat: { type: "boolean", description: "Цена включает НДС (если пользователь сказал явно)" },
				date: { type: "string", description: "Дата документа YYYY-MM-DD, если пользователь назвал; иначе не передавать" },
				comment: { type: "string" },
				items: {
					type: "array",
					minItems: 1,
					items: {
						type: "object",
						properties: {
							productId: { type: "string", description: "id номенклатуры из search_products" },
							quantity: { type: "number", exclusiveMinimum: 0 },
							price: { type: "number", minimum: 0, description: "Цена за единицу" },
						},
						required: ["productId", "quantity", "price"],
						additionalProperties: false,
					},
				},
			},
			required: ["customerId", "items"],
			additionalProperties: false,
		},
		operation: "WRITE",
		commandType: "CREATE_SALE",
		mutating: true,
		buildPayload: (i, ctx) => {
			const items = Array.isArray(i.items) ? i.items : [];
			if (!items.length) throw new ToolInputError("items", "items: нужна хотя бы одна позиция");
			return {
				customerId: known(ctx, "customerId", i.customerId),
				...(i.warehouseId ? { warehouseId: known(ctx, "warehouseId", i.warehouseId) } : {}),
				...(i.organizationId ? { organizationId: known(ctx, "organizationId", i.organizationId) } : {}),
				...(i.contractId ? { contractId: known(ctx, "contractId", i.contractId) } : {}),
				...(typeof i.priceIncludesVat === "boolean" ? { priceIncludesVat: i.priceIncludesVat } : {}),
				...(i.date ? { date: str(i.date, "date") } : {}),
				comment: typeof i.comment === "string" && i.comment ? i.comment : "Создано BuhProf AI",
				items: items.map((it: Record<string, unknown>, n: number) => ({
					productId: known(ctx, `items[${n}].productId`, it.productId),
					quantity: num(it.quantity, NaN, `items[${n}].quantity`),
					price: num(it.price, NaN, `items[${n}].price`),
				})),
			};
		},
	},
	{
		name: "get_sale",
		description: "Прочитать документ реализации по id (номер, суммы, проведён ли).",
		inputSchema: { type: "object", properties: { documentId: { type: "string" } }, required: ["documentId"], additionalProperties: false },
		operation: "READ",
		commandType: "GET_SALE",
		mutating: false,
		buildPayload: (i, ctx) => ({ documentId: known(ctx, "documentId", i.documentId) }),
	},
	{
		name: "post_sale",
		description: "Провести документ реализации. Только по явной просьбе пользователя.",
		inputSchema: { type: "object", properties: { documentId: { type: "string" } }, required: ["documentId"], additionalProperties: false },
		operation: "CRITICAL",
		commandType: "POST_SALE",
		mutating: true,
		buildPayload: (i, ctx) => ({ documentId: known(ctx, "documentId", i.documentId) }),
	},
	{
		name: "unpost_sale",
		description: "Отменить проведение документа реализации. Только по явной просьбе пользователя.",
		inputSchema: { type: "object", properties: { documentId: { type: "string" } }, required: ["documentId"], additionalProperties: false },
		operation: "CRITICAL",
		commandType: "UNPOST_SALE",
		mutating: true,
		buildPayload: (i, ctx) => ({ documentId: known(ctx, "documentId", i.documentId) }),
	},
	{
		name: "get_print_forms",
		description: "Список доступных печатных форм документа реализации.",
		inputSchema: { type: "object", properties: { documentId: { type: "string" } }, required: ["documentId"], additionalProperties: false },
		operation: "READ",
		commandType: "GET_PRINT_FORMS",
		mutating: false,
		buildPayload: (i, ctx) => ({ documentId: known(ctx, "documentId", i.documentId) }),
	},
	{
		name: "import_bank_statement",
		description:
			"Загрузить в 1С распознанную банковскую выписку (statementId из сообщения о вложении PDF): по каждой операции создаётся НЕ проведённое платёжное поручение " +
			"(входящее/исходящее), контрагенты подбираются по БИН, отсутствующие создаются автоматически. Уже загруженные строки повторно не создаются. " +
			"Организацию 1С определяет по БИН владельца счёта из выписки.",
		inputSchema: { type: "object", properties: { statementId: { type: "string", description: "id распознанной выписки из сообщения о вложении" } }, required: ["statementId"], additionalProperties: false },
		operation: "WRITE",
		commandType: "IMPORT_BANK_STATEMENT",
		mutating: true,
		buildPayload: (i, ctx) => ({ statementId: known(ctx, "statementId", i.statementId) }),
	},
	{
		name: "post_bank_documents",
		description: "Провести платёжные поручения, созданные из выписки. Только по явной просьбе пользователя. Предпочтительно передавать statementIds (все документы выписки) — это короче и надёжнее; documents (id и type из результата import_bank_statement) — только для выборочного проведения.",
		inputSchema: {
			type: "object",
			properties: {
				statementIds: { type: "array", items: { type: "string" }, description: "id выписок из сообщений о вложениях — провести все созданные по ним документы" },
				documents: {
					type: "array",
					minItems: 1,
					items: {
						type: "object",
						properties: { id: { type: "string" }, type: { type: "string", enum: ["incoming", "outgoing"] } },
						required: ["id", "type"],
						additionalProperties: false,
					},
				},
			},
			additionalProperties: false,
		},
		operation: "CRITICAL",
		commandType: "POST_BANK_DOCUMENTS",
		mutating: true,
		buildPayload: (i, ctx) => {
			const statementIds = Array.isArray(i.statementIds) ? i.statementIds : [];
			const docs = Array.isArray(i.documents) ? i.documents : [];
			if (statementIds.length) {
				return { statementIds: statementIds.map((id, n) => known(ctx, `statementIds[${n}]`, id)), ...(docs.length ? { documents: [] } : {}) };
			}
			if (!docs.length) throw new ToolInputError("documents", "нужен statementIds или хотя бы один документ в documents");
			if (docs.length > 200) throw new ToolInputError("documents", "documents: не более 200 за один раз");
			return {
				documents: docs.map((d: Record<string, unknown>, n: number) => {
					const type = str(d.type, `documents[${n}].type`);
					if (type !== "incoming" && type !== "outgoing") throw new ToolInputError(`documents[${n}].type`, "type: incoming или outgoing");
					return { id: known(ctx, `documents[${n}].id`, d.id), type };
				}),
			};
		},
	},
	{
		name: "print_sale",
		description: "Сформировать печатную форму документа (PDF). form — из get_print_forms: для товаров обычно РасходнаяНакладная, для услуг — АктОбОказанииУслуг.",
		inputSchema: {
			type: "object",
			properties: { documentId: { type: "string" }, form: { type: "string" } },
			required: ["documentId", "form"],
			additionalProperties: false,
		},
		operation: "READ",
		commandType: "PRINT_SALE",
		mutating: false,
		buildPayload: (i, ctx) => ({ documentId: known(ctx, "documentId", i.documentId), form: str(i.form, "form") }),
	},
];

export const TOOLS_BY_NAME: ReadonlyMap<string, ToolSpec> = new Map(TOOLS.map((t) => [t.name, t]));

export function toolDefinitions(): ToolDefinition[] {
	return TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
}

/** Собирает все id из результата 1С — чтобы модель могла ссылаться на них дальше. */
export function collectIds(value: unknown, into: Set<string>): void {
	if (!value || typeof value !== "object") return;
	if (Array.isArray(value)) {
		for (const v of value) collectIds(v, into);
		return;
	}
	for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
		if (k === "id" && typeof v === "string" && uuid.safeParse(v).success) into.add(v);
		else collectIds(v, into);
	}
}

function str(v: unknown, field: string): string {
	if (typeof v !== "string" || !v.trim()) throw new ToolInputError(field, `${field}: ожидается непустая строка`);
	return v.trim();
}

function num(v: unknown, dflt: number, field = "limit"): number {
	if (v === undefined || v === null) {
		if (Number.isNaN(dflt)) throw new ToolInputError(field, `${field}: обязательное число`);
		return dflt;
	}
	const n = typeof v === "number" ? v : Number(v);
	if (!Number.isFinite(n)) throw new ToolInputError(field, `${field}: ожидается число`);
	return n;
}

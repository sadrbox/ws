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

/** Типы документов, которые 1С печатает через универсальный endpoint (белый список расширения). */
const DOCUMENT_TYPES = ["sale", "incoming", "outgoing", "purchase", "invoice", "taxInvoice", "cashIn", "cashOut", "reconciliationAct"];
const FORMATS = ["pdf", "xlsx", "docx", "txt", "html"];

function docType(v: unknown): string {
	if (typeof v !== "string" || !DOCUMENT_TYPES.includes(v)) throw new ToolInputError("documentType", `documentType: один из ${DOCUMENT_TYPES.join(", ")}`);
	return v;
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
		description: "Найти контрагентов (покупателей и поставщиков) в 1С по части названия или БИН. Возвращает список с id — только эти id можно использовать дальше.",
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
		name: "create_invoice",
		description:
			"Создать «Счёт на оплату покупателю» в 1С (проведения у счёта нет). customerId — из search_counterparties, productId — из search_products; товары и услуги можно в одном счёте. " +
			"organizationBin — БИН нашей организации, если их несколько. При CONTRACT_AMBIGUOUS — покажите кандидатов и повторите с contractId. Печать: print_document(documentType=invoice, form=СчетЗаказНаОплату).",
		inputSchema: {
			type: "object",
			properties: {
				customerId: { type: "string", description: "id покупателя из search_counterparties" },
				organizationId: { type: "string", description: "id организации из get_organizations" },
				organizationBin: { type: "string", description: "БИН организации (12 цифр), если их несколько" },
				contractId: { type: "string", description: "id договора из кандидатов CONTRACT_AMBIGUOUS" },
				warehouseId: { type: "string", description: "id склада (необязательно)" },
				priceIncludesVat: { type: "boolean", description: "Цена включает НДС (если пользователь сказал явно)" },
				date: { type: "string", description: "Дата документа YYYY-MM-DD, если названа" },
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
		commandType: "CREATE_INVOICE",
		mutating: true,
		buildPayload: (i, ctx) => {
			const items = Array.isArray(i.items) ? i.items : [];
			if (!items.length) throw new ToolInputError("items", "items: нужна хотя бы одна позиция");
			const bin = typeof i.organizationBin === "string" ? i.organizationBin.trim() : "";
			if (bin && !/^\d{12}$/.test(bin)) throw new ToolInputError("organizationBin", "organizationBin: 12 цифр");
			return {
				customerId: known(ctx, "customerId", i.customerId),
				...(i.organizationId ? { organizationId: known(ctx, "organizationId", i.organizationId) } : {}),
				...(bin ? { organizationBin: bin } : {}),
				...(i.contractId ? { contractId: known(ctx, "contractId", i.contractId) } : {}),
				...(i.warehouseId ? { warehouseId: known(ctx, "warehouseId", i.warehouseId) } : {}),
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
		name: "get_invoice",
		description: "Прочитать счёт на оплату по id (номер, суммы).",
		inputSchema: { type: "object", properties: { documentId: { type: "string" } }, required: ["documentId"], additionalProperties: false },
		operation: "READ",
		commandType: "GET_INVOICE",
		mutating: false,
		buildPayload: (i, ctx) => ({ documentId: known(ctx, "documentId", i.documentId) }),
	},
	{
		name: "create_purchase",
		description:
			"Создать документ «Поступление товаров и услуг» от поставщика в 1С (НЕ проведённый). supplierId — из search_counterparties, productId — из search_products (этого диалога). " +
			"Для товаров склад обязателен (get_warehouses); для услуг — нет. incomingNumber/incomingDate — номер и дата накладной (счёта-фактуры) поставщика, если пользователь их назвал. " +
			"organizationBin — БИН нашей организации, если их несколько. Если 1С вернёт CONTRACT_AMBIGUOUS — покажите кандидатов и повторите с contractId. Печать: print_document(documentType=purchase, form=ПриходнаяНакладная).",
		inputSchema: {
			type: "object",
			properties: {
				supplierId: { type: "string", description: "id поставщика из search_counterparties" },
				warehouseId: { type: "string", description: "id склада из get_warehouses (обязателен для товаров)" },
				organizationId: { type: "string", description: "id организации из get_organizations" },
				organizationBin: { type: "string", description: "БИН организации (12 цифр), если их несколько" },
				contractId: { type: "string", description: "id договора из кандидатов CONTRACT_AMBIGUOUS" },
				priceIncludesVat: { type: "boolean", description: "Цена включает НДС (если пользователь сказал явно)" },
				date: { type: "string", description: "Дата документа YYYY-MM-DD, если названа" },
				incomingNumber: { type: "string", description: "Номер накладной поставщика" },
				incomingDate: { type: "string", description: "Дата накладной поставщика YYYY-MM-DD" },
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
			required: ["supplierId", "items"],
			additionalProperties: false,
		},
		operation: "WRITE",
		commandType: "CREATE_PURCHASE",
		mutating: true,
		buildPayload: (i, ctx) => {
			const items = Array.isArray(i.items) ? i.items : [];
			if (!items.length) throw new ToolInputError("items", "items: нужна хотя бы одна позиция");
			const date = (v: unknown, f: string) => { const d = str(v, f); if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new ToolInputError(f, `${f}: дата YYYY-MM-DD`); return d; };
			const bin = typeof i.organizationBin === "string" ? i.organizationBin.trim() : "";
			if (bin && !/^\d{12}$/.test(bin)) throw new ToolInputError("organizationBin", "organizationBin: 12 цифр");
			return {
				supplierId: known(ctx, "supplierId", i.supplierId),
				...(i.warehouseId ? { warehouseId: known(ctx, "warehouseId", i.warehouseId) } : {}),
				...(i.organizationId ? { organizationId: known(ctx, "organizationId", i.organizationId) } : {}),
				...(bin ? { organizationBin: bin } : {}),
				...(i.contractId ? { contractId: known(ctx, "contractId", i.contractId) } : {}),
				...(typeof i.priceIncludesVat === "boolean" ? { priceIncludesVat: i.priceIncludesVat } : {}),
				...(i.date ? { date: date(i.date, "date") } : {}),
				...(typeof i.incomingNumber === "string" && i.incomingNumber ? { incomingNumber: i.incomingNumber } : {}),
				...(i.incomingDate ? { incomingDate: date(i.incomingDate, "incomingDate") } : {}),
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
		name: "get_purchase",
		description: "Прочитать документ поступления по id (номер, суммы, проведён ли).",
		inputSchema: { type: "object", properties: { documentId: { type: "string" } }, required: ["documentId"], additionalProperties: false },
		operation: "READ",
		commandType: "GET_PURCHASE",
		mutating: false,
		buildPayload: (i, ctx) => ({ documentId: known(ctx, "documentId", i.documentId) }),
	},
	{
		name: "post_purchase",
		description: "Провести документ поступления. Только по явной просьбе пользователя.",
		inputSchema: { type: "object", properties: { documentId: { type: "string" } }, required: ["documentId"], additionalProperties: false },
		operation: "CRITICAL",
		commandType: "POST_PURCHASE",
		mutating: true,
		buildPayload: (i, ctx) => ({ documentId: known(ctx, "documentId", i.documentId) }),
	},
	{
		name: "unpost_purchase",
		description: "Отменить проведение документа поступления. Только по явной просьбе пользователя.",
		inputSchema: { type: "object", properties: { documentId: { type: "string" } }, required: ["documentId"], additionalProperties: false },
		operation: "CRITICAL",
		commandType: "UNPOST_PURCHASE",
		mutating: true,
		buildPayload: (i, ctx) => ({ documentId: known(ctx, "documentId", i.documentId) }),
	},
	{
		name: "create_reconciliation_act",
		description:
			"Создать в 1С документ «Акт сверки взаиморасчётов» с контрагентом за период, заполненный по данным учёта (обороты и остатки по счетам расчётов; " +
			"данные контрагента заполняются зеркально). counterpartyId — только из search_counterparties этого диалога. from/to — период YYYY-MM-DD. " +
			"organizationBin — БИН нашей организации, если их несколько. post — провести (по умолчанию нет). Печать: print_document(documentType=reconciliationAct, form=АктСверки).",
		inputSchema: {
			type: "object",
			properties: {
				counterpartyId: { type: "string", description: "id контрагента из search_counterparties" },
				from: { type: "string", description: "YYYY-MM-DD" },
				to: { type: "string", description: "YYYY-MM-DD" },
				organizationBin: { type: "string", description: "БИН организации (12 цифр), если их несколько" },
				contractId: { type: "string", description: "id договора, если пользователь просит акт по одному договору" },
				post: { type: "boolean", description: "Провести документ (только если пользователь просил)" },
				comment: { type: "string" },
			},
			required: ["counterpartyId", "from", "to"],
			additionalProperties: false,
		},
		operation: "WRITE",
		commandType: "CREATE_RECONCILIATION_ACT",
		mutating: true,
		buildPayload: (i, ctx) => {
			const date = (v: unknown, f: string) => { const d = str(v, f); if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new ToolInputError(f, `${f}: дата YYYY-MM-DD`); return d; };
			const bin = typeof i.organizationBin === "string" ? i.organizationBin.trim() : "";
			if (bin && !/^\d{12}$/.test(bin)) throw new ToolInputError("organizationBin", "organizationBin: 12 цифр");
			return {
				counterpartyId: known(ctx, "counterpartyId", i.counterpartyId),
				from: date(i.from, "from"),
				to: date(i.to, "to"),
				...(bin ? { organizationBin: bin } : {}),
				...(i.contractId ? { contractId: known(ctx, "contractId", i.contractId) } : {}),
				...(typeof i.post === "boolean" ? { post: i.post } : {}),
				comment: typeof i.comment === "string" && i.comment ? i.comment : "Создано BuhProf AI",
			};
		},
	},
	{
		name: "reconcile_statement",
		description:
			"Сверить распознанную выписку (statementId) с учётом в 1С по счёту 1030: остатки и обороты 1С против остатков выписки, каждая операция выписки — против проводок. " +
			"Ничего не меняет. По строкам статус: matched (проводка есть), unposted (документ есть, но не проведён), missing (в 1С нет); onlyIn1C — проводки и документы 1С без операции в выписке. " +
			"Вызывай, когда просят сверить выписку/банк с 1С, проверить остаток по 1030, найти расхождения.",
		inputSchema: { type: "object", properties: { statementId: { type: "string", description: "id распознанной выписки из сообщения о вложении" } }, required: ["statementId"], additionalProperties: false },
		operation: "READ",
		commandType: "RECONCILE_STATEMENT",
		mutating: false,
		buildPayload: (i, ctx) => ({ statementId: known(ctx, "statementId", i.statementId) }),
	},
	{
		name: "list_print_forms",
		description: "Печатные формы документа 1С — как в кнопке «Печать». documentType: sale (реализация), incoming/outgoing (платёжное поручение входящее/исходящее), purchase (поступление ТиУ), invoice (счёт на оплату), taxInvoice (счёт-фактура), cashIn/cashOut (кассовые ордера). documentId — только из результатов этого диалога (в отчёте о выписке — documentId и documentType строки).",
		inputSchema: {
			type: "object",
			properties: { documentType: { type: "string", enum: DOCUMENT_TYPES }, documentId: { type: "string" } },
			required: ["documentType", "documentId"],
			additionalProperties: false,
		},
		operation: "READ",
		commandType: "LIST_PRINT_FORMS",
		mutating: false,
		buildPayload: (i, ctx) => ({ documentType: docType(i.documentType), documentId: known(ctx, "documentId", i.documentId) }),
	},
	{
		name: "print_document",
		description: "Сформировать печатную форму документа 1С файлом: format pdf (по умолчанию), xlsx, docx, txt, html. form — идентификатор из list_print_forms; если пользователь не уточнял форму, для платёжного поручения бери «ПлатежноеПоручение», для реализации — как в print_sale. Файл уходит пользователю вложением; в результате — только имя и размер.",
		inputSchema: {
			type: "object",
			properties: {
				documentType: { type: "string", enum: DOCUMENT_TYPES },
				documentId: { type: "string" },
				form: { type: "string", description: "идентификатор печатной формы из list_print_forms" },
				format: { type: "string", enum: ["pdf", "xlsx", "docx", "txt", "html"] },
			},
			required: ["documentType", "documentId", "form"],
			additionalProperties: false,
		},
		operation: "READ",
		commandType: "PRINT_DOCUMENT",
		mutating: false,
		buildPayload: (i, ctx) => ({
			documentType: docType(i.documentType), documentId: known(ctx, "documentId", i.documentId), form: str(i.form, "form"),
			format: typeof i.format === "string" && FORMATS.includes(i.format) ? i.format : "pdf",
		}),
	},
	{
		name: "run_report",
		description:
			"Сформировать штатный бухгалтерский отчёт 1С файлом. report: osv (оборотно-сальдовая ведомость по всем счетам), osvAccount (ОСВ по счёту — нужен account), accountCard (карточка счёта — нужен account), accountAnalysis (анализ счёта — нужен account), " +
			"subcontoAnalysis (анализ субконто — нужен subconto, например [\"counterparties\"]; счёт не нужен), subcontoCard (карточка субконто — нужен subconto). " +
			"counterpartyId (id из search_counterparties) — отбор по контрагенту: только для отчётов по счёту с аналитикой по контрагентам (1210, 3310, 1610, 3510…) и отчётов по субконто counterparties. " +
			"from/to — период YYYY-MM-DD (если пользователь не назвал, спроси или возьми период выписки/текущий месяц из контекста). account — код счёта плана счетов, например 1030 (банк), 1010 (касса), 1210 (покупатели), 3310 (поставщики). " +
			"organizationBin — БИН организации, если в базе их несколько (например владелец выписки). format: pdf по умолчанию, xlsx — если просят Excel/таблицу, docx, txt, html. Файл уходит пользователю вложением.",
		inputSchema: {
			type: "object",
			properties: {
				report: { type: "string", enum: ["osv", "osvAccount", "accountCard", "accountAnalysis", "subcontoAnalysis", "subcontoCard"] },
				from: { type: "string", description: "YYYY-MM-DD" },
				to: { type: "string", description: "YYYY-MM-DD" },
				account: { type: "string", description: "код счёта, обязателен для osvAccount/accountCard/accountAnalysis" },
				organizationBin: { type: "string", description: "БИН организации (12 цифр), если их несколько" },
				bySubaccounts: { type: "boolean" },
				counterpartyId: { type: "string", description: "id контрагента из search_counterparties — отбор по контрагенту" },
				subconto: { type: "array", items: { type: "string", enum: ["counterparties", "contracts", "products", "employees", "warehouses", "cashFlowItems", "costItems", "taxes", "fixedAssets"] }, description: "виды субконто для subcontoAnalysis/subcontoCard (1–3, в порядке разрезов)" },
				format: { type: "string", enum: ["pdf", "xlsx", "docx", "txt", "html"] },
			},
			required: ["report", "from", "to"],
			additionalProperties: false,
		},
		operation: "READ",
		commandType: "RUN_REPORT",
		mutating: false,
		buildPayload: (i, ctx) => {
			const report = str(i.report, "report");
			if (!["osv", "osvAccount", "accountCard", "accountAnalysis", "subcontoAnalysis", "subcontoCard"].includes(report)) throw new ToolInputError("report", "report: osv | osvAccount | accountCard | accountAnalysis | subcontoAnalysis | subcontoCard");
			const subconto = Array.isArray(i.subconto) ? i.subconto.filter((x): x is string => typeof x === "string").slice(0, 3) : [];
			if ((report === "subcontoAnalysis" || report === "subcontoCard") && !subconto.length && !i.counterpartyId) throw new ToolInputError("subconto", "subconto: для отчёта по субконто нужен хотя бы один вид, например [\"counterparties\"]");
			if (report === "osv" && i.counterpartyId) throw new ToolInputError("counterpartyId", "counterpartyId: для отбора по контрагенту используйте osvAccount/accountCard/accountAnalysis со счётом расчётов или subcontoAnalysis");
			const date = (v: unknown, f: string) => { const d = str(v, f); if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new ToolInputError(f, `${f}: дата YYYY-MM-DD`); return d; };
			const account = typeof i.account === "string" && i.account.trim() ? i.account.trim() : "";
			if (!["osv", "subcontoAnalysis", "subcontoCard"].includes(report) && !account) throw new ToolInputError("account", "account: для этого отчёта нужен код счёта");
			const bin = typeof i.organizationBin === "string" && /^\d{12}$/.test(i.organizationBin) ? i.organizationBin : "";
			return {
				report, from: date(i.from, "from"), to: date(i.to, "to"),
				...(account ? { account } : {}), ...(bin ? { organizationBin: bin } : {}),
				...(typeof i.bySubaccounts === "boolean" ? { bySubaccounts: i.bySubaccounts } : {}),
				...(i.counterpartyId ? { counterpartyId: known(ctx, "counterpartyId", i.counterpartyId) } : {}),
				...(subconto.length ? { subconto } : {}),
				format: typeof i.format === "string" && FORMATS.includes(i.format) ? i.format : "pdf",
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

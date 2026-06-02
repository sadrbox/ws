/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FC } from "react";
import type { TPane } from "src/app/types";
import { translate } from "src/i18";
import { api } from "src/services/api/client";
import { getFormatDateOnly } from "src/utils/datetime";
import { unwrapItem, unwrapList } from "src/utils/apiUnwrap";
import type { PermissionDefaultsMap } from "src/hooks/useUserPermissionDefaults";

export interface BasisFromTarget {
	/** Название создаваемого документа, напр. "Счёт-фактуру исходящую" */
	docLabel: string;
	/** Компонент формы создаваемого документа */
	FormComponent: FC<Partial<TPane>>;
	/** Значение basisDocumentType, которое будет записано в новый документ */
	basisType: string;
	/** Эндпоинт позиций исходного документа */
	sourceItemsEndpoint: string;
	/** Имя FK-поля для фильтрации позиций исходника */
	sourceItemsParentField: string;
	/** Маппинг полей шапки исходного документа в поля нового */
	mapFields: (source: any) => Record<string, any>;
	/**
	 * Эндпоинт для проверки уже существующего зависимого документа.
	 * Если указан, при нажатии «На основании» система сначала ищет
	 * документ с basisDocumentUuid === sourceFields.uuid. Если найден —
	 * открывает его вместо создания нового.
	 */
	existingCheckEndpoint?: string;
}

interface BasisSourceConfig {
	docEndpoint: (uuid: string) => string;
	itemsEndpoint: string;
	itemsParentField: string;
}

/** Карта конфигураций источников для «Перезаполнить по основанию». */
const BASIS_SOURCE_CONFIGS: Record<string, BasisSourceConfig> = {
	sale: {
		docEndpoint: (uuid) => `sales/${uuid}`,
		itemsEndpoint: "saleitems",
		itemsParentField: "saleUuid",
	},
	purchase: {
		docEndpoint: (uuid) => `purchases/${uuid}`,
		itemsEndpoint: "purchaseitems",
		itemsParentField: "purchaseUuid",
	},
	purchase_requisition: {
		docEndpoint: (uuid) => `purchase-requisitions/${uuid}`,
		itemsEndpoint: "purchase-requisition-items",
		itemsParentField: "purchaseRequisitionUuid",
	},
	incoming_invoice: {
		docEndpoint: (uuid) => `incoming-invoices/${uuid}`,
		itemsEndpoint: "incominginvoiceitems",
		itemsParentField: "incomingInvoiceUuid",
	},
	payment_invoice: {
		docEndpoint: (uuid) => `payment-invoices/${uuid}`,
		itemsEndpoint: "paymentinvoiceitems",
		itemsParentField: "paymentInvoiceUuid",
	},
	outgoing_invoice: {
		docEndpoint: (uuid) => `outgoing-invoices/${uuid}`,
		itemsEndpoint: "outgoinginvoiceitems",
		itemsParentField: "outgoingInvoiceUuid",
	},
	commercial_offer: {
		docEndpoint: (uuid) => `commercial-offers/${uuid}`,
		itemsEndpoint: "commercial-offer-items",
		itemsParentField: "commercialOfferUuid",
	},
	sales_order: {
		docEndpoint: (uuid) => `sales-orders/${uuid}`,
		itemsEndpoint: "sales-order-items",
		itemsParentField: "salesOrderUuid",
	},
	reservation: {
		docEndpoint: (uuid) => `reservations/${uuid}`,
		itemsEndpoint: "reservation-items",
		itemsParentField: "reservationUuid",
	},
	purchase_order: {
		docEndpoint: (uuid) => `purchase-orders/${uuid}`,
		itemsEndpoint: "purchase-order-items",
		itemsParentField: "purchaseOrderUuid",
	},
};

/** Конвертирует позиции исходного документа в pending-строки для нового. */
export function mapItemsForBasis(sourceItems: any[]): any[] {
	const ts = Date.now();
	return sourceItems.map((r: any, i: number) => ({
		id: -(i + 1),
		uuid: `tmp-basis-${ts}-${i}`,
		_pendingAction: "create",
		// uuid строки документа-основания — ключ идемпотентного «Перезаполнить
		// по основанию» (см. buildRefillBasisItems): повторный refill не плодит
		// строки, а обновляет/удаляет существующие по этому ключу.
		sourceRowId: r.uuid ?? null,
		productUuid: r.productUuid ?? null,
		product: r.product ?? null,
		unitOfMeasureUuid: r.unitOfMeasureUuid ?? null,
		unitOfMeasure: r.unitOfMeasure ?? null,
		quantity: Number(r.quantity ?? 0),
		price: Number(r.price ?? 0),
		vatRate: Number(r.vatRate ?? 0),
		exciseRate: Number(r.exciseRate ?? 0),
		discountPercent: Number(r.discountPercent ?? 0),
	}));
}

/** Поля строки, сравниваемые при определении «строка основания изменилась». */
const REFILL_COMPARE_KEYS = [
	"productUuid",
	"unitOfMeasureUuid",
	"quantity",
	"price",
	"vatRate",
	"exciseRate",
	"discountPercent",
] as const;

/** Является ли строка серверной (сохранена в БД), а не локальным tmp-черновиком. */
function isServerRow(r: any): boolean {
	return (
		!(typeof r.uuid === "string" && r.uuid.startsWith("tmp-")) &&
		!(typeof r.id === "number" && r.id < 0)
	);
}

/** Значения строки-основания, которыми обновляется/создаётся строка документа. */
function basisRowValues(b: any): Record<string, any> {
	return {
		productUuid: b.productUuid ?? null,
		product: b.product ?? null,
		unitOfMeasureUuid: b.unitOfMeasureUuid ?? null,
		unitOfMeasure: b.unitOfMeasure ?? null,
		quantity: b.quantity,
		price: b.price,
		vatRate: b.vatRate,
		exciseRate: b.exciseRate,
		discountPercent: b.discountPercent,
	};
}

/**
 * Строит идемпотентный набор pending-маркеров для «Перезаполнить по основанию».
 *
 * Сопоставляет текущие строки документа со строками основания по `sourceRowId`:
 *   • строка-основание ↔ серверная строка, значения совпали → НЕ трогаем
 *     (строка сама подгрузится с сервера при пересборке таблицы);
 *   • строка-основание ↔ серверная строка, значения изменились → update;
 *   • строка-основание ↔ несохранённый черновик → create с тем же uuid
 *     (переинъекция: при remount таблицы черновик иначе пропадёт), без дубля;
 *   • строка-основание новая → create новой tmp-строкой;
 *   • серверная строка БЫЛА из основания, но в основании её больше нет → delete;
 *   • ручные строки (без sourceRowId): серверные сохраняются автоматически,
 *     несохранённые черновики переинъектируются, чтобы пережить remount.
 *
 * Таблица перемонтируется (key=itemsTableKey) и заново мержит initialPendingRows
 * с серверными данными, поэтому ВСЕ несохранённые черновики обязаны попасть в
 * результат. Если фактических изменений нет — возвращаем [] (без remount/Dirty).
 *
 * @param displayed  текущие отображаемые строки (сервер + pending, без delete)
 * @param basisRows  строки основания после mapItemsForBasis (несут sourceRowId)
 */
export function buildRefillBasisItems(displayed: any[], basisRows: any[]): any[] {
	const currentBySource = new Map<string, any>();
	for (const r of displayed) {
		if (r?.sourceRowId != null && r.sourceRowId !== "") {
			currentBySource.set(String(r.sourceRowId), r);
		}
	}

	const result: any[] = [];
	const basisSourceIds = new Set<string>();
	let changed = false;

	for (const b of basisRows) {
		const srcId = b.sourceRowId != null ? String(b.sourceRowId) : "";
		if (srcId) basisSourceIds.add(srcId);
		const existing = srcId ? currentBySource.get(srcId) : undefined;
		const newValues = basisRowValues(b);

		if (!existing) {
			// Новая строка основания — добавляем как есть (create с tmp uuid).
			result.push(b);
			changed = true;
			continue;
		}

		const rowChanged = REFILL_COMPARE_KEYS.some(
			(k) => String(existing[k] ?? "") !== String((newValues as any)[k] ?? ""),
		);

		if (isServerRow(existing)) {
			// Серверная строка: меняем только при расхождении (иначе подгрузится сама).
			if (rowChanged) {
				result.push({ ...existing, ...newValues, sourceRowId: srcId, _pendingAction: "update" });
				changed = true;
			}
		} else {
			// Несохранённый черновик: переинъектируем всегда (переживёт remount),
			// но «изменением» считаем только реальное расхождение значений.
			result.push({ ...existing, ...newValues, sourceRowId: srcId, _pendingAction: "create" });
			if (rowChanged) changed = true;
		}
	}

	// Серверные строки, ранее пришедшие из основания, но исчезнувшие из него → delete.
	for (const r of displayed) {
		const srcId = r?.sourceRowId != null ? String(r.sourceRowId) : "";
		if (srcId && !basisSourceIds.has(srcId) && isServerRow(r)) {
			result.push({ ...r, _pendingAction: "delete" });
			changed = true;
		}
	}

	// Ручные несохранённые черновики (без sourceRowId) — переинъектируем, чтобы
	// они не потерялись при remount таблицы (серверные ручные строки — сами).
	for (const r of displayed) {
		const srcId = r?.sourceRowId != null ? String(r.sourceRowId) : "";
		if (!srcId && !isServerRow(r) && r?._pendingAction !== "delete") {
			result.push({ ...r, _pendingAction: "create" });
		}
	}

	// Фактических изменений нет — не трогаем таблицу (без лишнего remount/Dirty).
	if (!changed) return [];
	return result;
}

/**
 * Загружает актуальные данные документа-основания и его позиций.
 * Используется кнопкой «Перезаполнить по основанию» в зависимом документе.
 */
export async function refillFromBasisSource(
	basisType: string,
	basisUuid: string,
	mapFields: (src: any) => Record<string, any>,
): Promise<{ fields: Record<string, any>; items: any[] } | null> {
	const config = BASIS_SOURCE_CONFIGS[basisType];
	if (!config) {
		// Тип основания не настроен в BASIS_SOURCE_CONFIGS → refill невозможен.
		// Логируем, чтобы не было «тихого» отсутствия перезаполнения.
		console.warn(`[refill] нет конфигурации источника для типа основания "${basisType}"`);
		return null;
	}
	if (!basisUuid) return null;

	const [docResp, itemsResp] = await Promise.all([
		api.get(`/${config.docEndpoint(basisUuid)}`),
		api.get(`/${config.itemsEndpoint}`, {
			params: { [config.itemsParentField]: basisUuid, limit: 1000 },
		}),
	]);

	return {
		fields: mapFields(unwrapItem(docResp)),
		items: mapItemsForBasis(unwrapList(itemsResp)),
	};
}

/**
 * Загружает текущие позиции документа с сервера.
 * Используется для сравнения «текущие строки vs строки основания» при
 * «Перезаполнить по основанию», когда вкладка с таблицей ещё не открыта
 * (строки не отрендерены) — чтобы не ставить ложный Dirty при идентичных данных.
 */
export async function fetchDocumentItems(
	itemsEndpoint: string,
	parentField: string,
	parentUuid: string,
): Promise<any[]> {
	if (!parentUuid) return [];
	const resp = await api.get(`/${itemsEndpoint}`, {
		params: { [parentField]: parentUuid, limit: 1000 },
	});
	return unwrapList(resp);
}

/**
 * Загружает позиции исходного документа, формирует initialFields + initialItems
 * и открывает новую панель с целевой формой, предзаполненной данными основания.
 * Если задан existingCheckEndpoint и зависимый документ уже существует —
 * открывает его вместо создания нового.
 */
export async function openDocumentFromBasis(
	sourceFields: Record<string, any>,
	sourceTypeLabel: string,
	target: BasisFromTarget,
	addPane: (pane: any) => void,
): Promise<void> {
	// Проверка: уже есть зависимый документ этого типа?
	if (target.existingCheckEndpoint && sourceFields.uuid) {
		try {
			const resp: any = await api.get(`/${target.existingCheckEndpoint}`, {
				params: {
					filter: { basisDocumentUuid: { equals: sourceFields.uuid } },
					limit: 1,
				},
			});
			const existing = unwrapList(resp);
			if (existing.length > 0) {
				const existingDoc = existing[0];
				const existingDate = existingDoc.date
					? " · " + getFormatDateOnly(String(existingDoc.date))
					: "";
				addPane({
					component: target.FormComponent,
					label: `${target.docLabel}: ID ${existingDoc.id ?? "?"}${existingDate}`,
					data: { uuid: existingDoc.uuid },
				});
				return;
			}
		} catch (e) {
			console.error("[createFromBasis] не удалось проверить существующий документ", e);
		}
	}

	let sourceItems: any[] = [];
	if (sourceFields.uuid) {
		try {
			const resp: any = await api.get(`/${target.sourceItemsEndpoint}`, {
				params: {
					[target.sourceItemsParentField]: sourceFields.uuid,
					limit: 1000,
				},
			});
			sourceItems = unwrapList(resp);
		} catch (e) {
			console.error("[createFromBasis] не удалось загрузить позиции", e);
		}
	}

	const dateStr = sourceFields.date ? getFormatDateOnly(sourceFields.date) : "";
	const basisLabel = dateStr
		? `${sourceTypeLabel}: ID ${sourceFields.id ?? "?"} · ${dateStr}`
		: `${sourceTypeLabel}: ID ${sourceFields.id ?? "?"}`;

	const initialFields = {
		...target.mapFields(sourceFields),
		date: new Date().toISOString().slice(0, 10),
		basisDocumentType: target.basisType,
		basisDocumentUuid: sourceFields.uuid ?? "",
		basisDocumentLabel: basisLabel,
	};

	addPane({
		component: target.FormComponent,
		label: `${target.docLabel}: ${translate("new")}`,
		data: {
			_paneToken: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
			fromBasisFields: initialFields,
			fromBasisItems: mapItemsForBasis(sourceItems),
		},
	});
}

/** Загружает основные значения пользователя (permissionDefaults) для организации. */
async function fetchOrgPermissionDefaults(
	userUuid: string,
	organizationUuid: string,
): Promise<PermissionDefaultsMap> {
	if (!userUuid || !organizationUuid) return {};
	try {
		const resp = await api.get<any>("/user-permission-defaults", {
			params: { userUuid, organizationUuid, limit: 100 },
		});
		const items: any[] = Array.isArray(resp) ? resp : (resp?.items ?? []);
		const map: PermissionDefaultsMap = {};
		for (const it of items) {
			if (it.valueType && it.valueUuid) {
				(map as any)[it.valueType] = { uuid: it.valueUuid, name: it.valueName ?? "" };
			}
		}
		return map;
	} catch {
		return {};
	}
}

/**
 * Дополняет patch перезаполнения по основанию полями, зависящими от организации
 * (склад/договор), которых НЕТ у документа-основания.
 *
 * Если основание сменило организацию:
 *   • есть основное значение пользователя (permissionDefaults целевой орг) — берём его;
 *   • иначе — очищаем поле (оно принадлежало прежней организации).
 * Если организация НЕ менялась — поле не трогаем (сохраняем текущее).
 *
 * Дефолты целевой орг догружаются с сервера только при смене организации
 * (для текущей организации используются уже загруженные currentOrgDefaults).
 */
export async function resolveOrgDependentRefill(
	basisFields: Record<string, any>,
	currentFields: Record<string, any>,
	userUuid: string,
	currentOrgDefaults: PermissionDefaultsMap,
	orgFields: Array<{ valueType: keyof PermissionDefaultsMap; uuidKey: string; nameKey: string }>,
): Promise<Record<string, any>> {
	const targetOrg = basisFields.organizationUuid ?? currentFields.organizationUuid ?? "";
	const orgChanged = !!basisFields.organizationUuid && basisFields.organizationUuid !== currentFields.organizationUuid;

	// Поля, зависящие от орг, которые основание НЕ предоставило.
	const missing = orgFields.filter((f) => !basisFields[f.uuidKey]);
	if (!missing.length) return {};

	const defaults = orgChanged ? await fetchOrgPermissionDefaults(userUuid, targetOrg) : currentOrgDefaults;

	const patch: Record<string, any> = {};
	for (const f of missing) {
		const def = defaults[f.valueType];
		if (def) {
			patch[f.uuidKey] = def.uuid;
			patch[f.nameKey] = def.name;
		} else if (orgChanged) {
			patch[f.uuidKey] = "";
			patch[f.nameKey] = "";
		}
		// орг не менялась и нет дефолта → поле не трогаем (сохраняем текущее).
	}
	return patch;
}

/**
 * Пересчитывает зависящие от организации поля при ПРЯМОЙ смене организации
 * в форме (пользователь выбрал другую орг в автокомплите «Организация»).
 *
 * Для каждого зависимого поля (склад/договор/касса/банк-счёт/ответственный):
 *   • есть основное значение пользователя (permissionDefaults новой орг) — берём его;
 *   • иначе — очищаем (значение принадлежало прежней организации и более не валидно).
 *
 * Возвращает patch для form.setFields. Всегда включает org-поля (имя+uuid).
 */
export async function resolveOrgChangeFields(
	newOrgUuid: string,
	userUuid: string,
	orgFields: Array<{ valueType: keyof PermissionDefaultsMap; uuidKey: string; nameKey: string }>,
): Promise<Record<string, any>> {
	const defaults = newOrgUuid ? await fetchOrgPermissionDefaults(userUuid, newOrgUuid) : {};
	const patch: Record<string, any> = {};
	for (const f of orgFields) {
		const def = defaults[f.valueType];
		if (def) {
			patch[f.uuidKey] = def.uuid;
			patch[f.nameKey] = def.name;
		} else {
			patch[f.uuidKey] = "";
			patch[f.nameKey] = "";
		}
	}
	return patch;
}

/**
 * Стандартный маппинг полей шапки для большинства торговых документов.
 *
 * Поле копируется ТОЛЬКО если оно реально есть у документа-основания. Если у
 * основания поля нет (напр. у счёт-фактуры нет склада), оно ОПУСКАЕТСЯ из
 * результата — тогда «Перезаполнить по основанию» (merge) не затирает значение
 * соответствующего поля в зависимом документе.
 */
export function mapCommonTradeFields(src: any): Record<string, any> {
	const out: Record<string, any> = {};
	if (src.organizationUuid) {
		out.organizationUuid = src.organizationUuid;
		out.organizationName = src.organization?.name ?? src.organizationName ?? "";
	}
	if (src.counterpartyUuid) {
		out.counterpartyUuid = src.counterpartyUuid;
		out.counterpartyName = src.counterparty?.name ?? src.counterpartyName ?? "";
	}
	if (src.contractUuid) {
		out.contractUuid = src.contractUuid;
		out.contractName = src.contract?.name ?? src.contractName ?? "";
	}
	if (src.warehouseUuid) {
		out.warehouseUuid = src.warehouseUuid;
		out.warehouseName = src.warehouse?.name ?? src.warehouseName ?? "";
	}
	return out;
}

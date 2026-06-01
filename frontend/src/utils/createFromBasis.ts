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

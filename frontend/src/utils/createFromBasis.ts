/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FC } from "react";
import type { TPane } from "src/app/types";
import { translate } from "src/i18";
import { api } from "src/services/api/client";
import { getFormatDateOnly } from "src/utils/main.module";

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
		itemsEndpoint: "purchaserequisitionitems",
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
	if (!config || !basisUuid) return null;

	const [docResp, itemsResp] = await Promise.all([
		api.get(`/${config.docEndpoint(basisUuid)}`),
		api.get(`/${config.itemsEndpoint}`, {
			params: { [config.itemsParentField]: basisUuid, limit: 1000 },
		}),
	]);

	const docData = (docResp as any)?.item ?? docResp;
	const sourceItems: any[] = Array.isArray(itemsResp)
		? itemsResp
		: ((itemsResp as any)?.data ?? (itemsResp as any)?.items ?? []);

	return {
		fields: mapFields(docData),
		items: mapItemsForBasis(sourceItems),
	};
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
			const existing: any[] = Array.isArray(resp)
				? resp
				: (resp?.data ?? resp?.items ?? []);
			if (existing.length > 0) {
				const existingDoc = existing[0];
				const existingDate = existingDoc.date
					? " · " + (getFormatDateOnly(String(existingDoc.date)) ?? "")
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
			sourceItems = Array.isArray(resp)
				? resp
				: Array.isArray(resp?.items) ? resp.items : Array.isArray(resp?.data) ? resp.data : [];
		} catch (e) {
			console.error("[createFromBasis] не удалось загрузить позиции", e);
		}
	}

	const dateStr = sourceFields.date
		? (getFormatDateOnly(sourceFields.date) ?? "")
		: "";
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

/** Стандартный маппинг полей шапки для большинства торговых документов. */
export function mapCommonTradeFields(src: any): Record<string, any> {
	return {
		organizationUuid: src.organizationUuid ?? "",
		organizationName: src.organization?.name ?? src.organizationName ?? "",
		counterpartyUuid: src.counterpartyUuid ?? "",
		counterpartyName: src.counterparty?.name ?? src.counterpartyName ?? "",
		contractUuid: src.contractUuid ?? "",
		contractName: src.contract?.name ?? src.contractName ?? "",
		warehouseUuid: src.warehouseUuid ?? "",
		warehouseName: src.warehouse?.name ?? src.warehouseName ?? "",
	};
}

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FC } from "react";
import type { TPane } from "src/app/types";
import type { TDataItem } from "src/components/Table/types";
import { translate } from "src/i18";
import { api } from "src/services/api/client";
import { getFormatDateOnly } from "src/utils/datetime";
import { unwrapItem, unwrapList } from "src/utils/apiUnwrap";
import type { UserDefaultsMap } from "src/hooks/useUserDefaults";
import { isEquivalent } from "src/utils/normalize";

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

// Числовые поля сравниваем по значению, а не по строке — иначе Decimal с сервера
// ("100.00") и число из основания (100) считаются разными → ложный changed → ложный Dirty.
const REFILL_NUMERIC_KEYS = new Set<string>([
	"quantity",
	"price",
	"vatRate",
	"exciseRate",
	"discountPercent",
]);

/** Эквивалентны ли значения поля строки для сравнения при refill. */
function refillFieldEqual(key: string, a: unknown, b: unknown): boolean {
	if (REFILL_NUMERIC_KEYS.has(key)) {
		const na = a == null || a === "" ? null : Number(a);
		const nb = b == null || b === "" ? null : Number(b);
		if (na === null && nb === null) return true;
		if (na === null || nb === null) return false;
		if (Number.isNaN(na) || Number.isNaN(nb)) return String(a) === String(b);
		return na === nb;
	}
	return String(a ?? "") === String(b ?? "");
}

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
 * Строит набор pending-маркеров для «Перезаполнить по основанию».
 *
 * Цель — привести табличную часть документа В ТОЧНОСТИ к строкам основания
 * (чтобы подсказка о несоответствии после перезаполнения гасла), но при этом:
 *   • идемпотентно — повторное нажатие не плодит дубли;
 *   • с переиспользованием существующих строк (по sourceRowId, иначе по товару)
 *     — сохраняем uuid/id строки, чтобы не плодить движения регистров и проводки.
 *
 * Алгоритм (для каждой строки основания, по порядку):
 *   1. ищем текущую строку с тем же sourceRowId;
 *   2. иначе «усыновляем» текущую строку с тем же товаром без sourceRowId
 *      (легаси-строки, созданные до появления sourceRowId);
 *   3. иначе — новая строка (create).
 *   Найденную строку обновляем значениями основания и проставляем sourceRowId
 *   (серверную — update, черновик — create с тем же uuid, переживёт remount).
 * Все текущие СЕРВЕРНЫЕ строки, не сопоставленные ни одной строке основания
 * (лишние/ручные/удалённые из основания), помечаются delete.
 *
 * Таблица перемонтируется (key=itemsTableKey) и заново мержит результат с
 * серверными данными. Если изменений нет — возвращаем [] (без remount/Dirty).
 *
 * @param displayed  текущие отображаемые строки (сервер + pending, без delete)
 * @param basisRows  строки основания после mapItemsForBasis (несут sourceRowId)
 */
export function buildRefillBasisItems(displayed: any[], basisRows: any[]): any[] {
	// Пулы для сопоставления. Усыновление по товару — только строки без sourceRowId.
	const bySource = new Map<string, any>();
	const legacyByProduct = new Map<string, any[]>();
	for (const r of displayed) {
		const srcId = r?.sourceRowId != null ? String(r.sourceRowId) : "";
		if (srcId) {
			if (!bySource.has(srcId)) bySource.set(srcId, r);
		} else {
			const pk = String(r?.productUuid ?? "");
			if (pk) (legacyByProduct.get(pk) ?? legacyByProduct.set(pk, []).get(pk)!).push(r);
		}
	}

	const consumed = new Set<any>();
	const result: any[] = [];
	let changed = false;

	for (const b of basisRows) {
		const srcId = b.sourceRowId != null ? String(b.sourceRowId) : "";
		const newValues = basisRowValues(b);

		// 1) по sourceRowId, 2) усыновление легаси-строки по товару, 3) новая.
		let existing = srcId ? bySource.get(srcId) : undefined;
		if (existing && consumed.has(existing)) existing = undefined;
		if (!existing) {
			const pool = legacyByProduct.get(String(b.productUuid ?? ""));
			while (pool && pool.length) {
				const cand = pool.shift();
				if (!consumed.has(cand)) { existing = cand; break; }
			}
		}

		if (!existing) {
			result.push(b); // новая строка основания
			changed = true;
			continue;
		}

		consumed.add(existing);
		// «Изменилась» — ТОЛЬКО по бизнес-значениям (кол-во/цена/ставки/товар/ед.).
		// Расхождение служебного sourceRowId само по себе НЕ считается изменением:
		// иначе «усыновление» строки по товару проставляло бы ключ и помечало форму
		// Dirty, хотя фактические значения не менялись (см. вопрос про ложный Dirty).
		const valuesChanged = REFILL_COMPARE_KEYS.some(
			(k) => !refillFieldEqual(k, existing[k], (newValues as any)[k]),
		);

		if (isServerRow(existing)) {
			// Серверная строка: трогаем только при реальном изменении значений.
			// sourceRowId при этом тоже проставляем (идемпотентность будущих refill),
			// но не ради него одного. Если значения совпали — строку не трогаем.
			if (valuesChanged) {
				result.push({ ...existing, ...newValues, sourceRowId: srcId || null, _pendingAction: "update" });
				changed = true;
			}
		} else {
			// Черновик: переинъектируем (create с тем же uuid) — переживёт remount.
			result.push({ ...existing, ...newValues, sourceRowId: srcId || null, _pendingAction: "create" });
			if (valuesChanged) changed = true;
		}
	}

	// Несопоставленные СЕРВЕРНЫЕ строки (лишние/ручные/убранные из основания) → delete.
	for (const r of displayed) {
		if (consumed.has(r)) continue;
		if (isServerRow(r) && r?._pendingAction !== "delete") {
			result.push({ ...r, _pendingAction: "delete" });
			changed = true;
		}
	}

	// Изменений нет — не трогаем таблицу (без лишнего remount/Dirty).
	if (!changed) return [];
	return result;
}

/** Поле, зависящее от организации, для resolveOrgDependentRefill/resolveOrgChangeFields. */
export interface OrgDependentField {
	valueType: keyof UserDefaultsMap;
	uuidKey: string;
	nameKey: string;
}

/**
 * Общий движок «Перезаполнить по основанию» для торговых форм (дедупликация).
 *
 * Инкапсулирует ВСЁ тело refill, ранее копировавшееся в Sales/Purchases/
 * SaleReturns/PurchaseReturns/createInvoiceLikeForm:
 *   • читает текущее основание из свежего снапшота стора;
 *   • грузит данные основания (refillFromBasisSource + mapCommonTradeFields);
 *   • при !skipFields — патчит шапку с учётом org-зависимых полей
 *     (resolveOrgDependentRefill), без ложного Dirty;
 *   • идемпотентно мержит строки (buildRefillBasisItems) и применяет их.
 *
 * Состояние (isRefilling, basisItems, itemsTableKey, allItemsRef) остаётся в
 * форме — сюда передаются сеттеры/ref, чтобы не ломать порядок объявления
 * (allItemsRef нужен в onBeforeSave ДО useFormStore).
 */
// uuid основания, по которому в последний раз перезаполнялась таблица данной формы.
// Ключ — стабильный store формы. Нужен, чтобы при СМЕНЕ основания делать ЧИСТОЕ
// перезаполнение из нового основания, не завися от устаревшего allItemsRef
// (из-за чего «Перезаполнить» иногда срабатывало только со второго клика).
const lastRefillBasis = new WeakMap<object, string>();

export async function runBasisRefill(opts: {
	form: any;
	skipFields: boolean;
	currentUserUuid: string;
	permDefaults: UserDefaultsMap;
	itemsEndpoint: string;
	itemsParentField: string;
	orgFields: OrgDependentField[];
	allItemsRef: { current: any[] };
	setBasisItems: (rows: any[]) => void;
	bumpItemsTableKey: () => void;
}): Promise<void> {
	const snap = opts.form.store.getSnapshot().fields as any;
	const basisType = snap.basisDocumentType;
	const basisUuid = snap.basisDocumentUuid;
	if (!basisUuid || !basisType) return;

	const result = await refillFromBasisSource(basisType, basisUuid, mapCommonTradeFields);
	if (!result) return;

	if (!opts.skipFields) {
		const cur = opts.form.store.getSnapshot().fields as any;
		// Org-зависимые поля (склад/договор), которых нет у основания: при смене
		// организации — дефолт пользователя для новой орг, иначе очистка.
		const orgPatch = await resolveOrgDependentRefill(
			result.fields, cur, opts.currentUserUuid, opts.permDefaults, opts.orgFields,
		);
		const rawPatch = { ...result.fields, ...orgPatch };
		// Только поля, существующие в форме (иначе лишние поля → ложный Dirty).
		const patch = Object.fromEntries(
			Object.keys(rawPatch).filter((k) => k in cur).map((k) => [k, rawPatch[k]]),
		);
		// Применяем только при реальном изменении — иначе ложный Dirty.
		if (Object.keys(patch).some((k) => !isEquivalent(cur[k], (patch as any)[k]))) {
			opts.form.setFields(patch);
		}
	}

	// Сменилось ли основание С ПРОШЛОГО перезаполнения этой формы. На ПЕРВОМ
	// перезаполнении (записи ещё нет) basisChanged=false — чтобы для сохранённого
	// документа сработал идемпотентный merge (а не delete+create серверных строк).
	const storeKey = opts.form.store as object;
	const basisChanged = lastRefillBasis.has(storeKey) && lastRefillBasis.get(storeKey) !== basisUuid;
	lastRefillBasis.set(storeKey, basisUuid);

	// Текущее отображаемое состояние таблицы (сервер + pending, без delete).
	const live = opts.allItemsRef.current.filter((r: any) => r._pendingAction !== "delete");

	let merged: any[];
	if (basisChanged) {
		// ОСНОВАНИЕ СМЕНИЛОСЬ → ЧИСТОЕ перезаполнение из НОВОГО основания: не мержим
		// со старыми строками (которые в allItemsRef могут быть устаревшими на 1 рендер
		// после remount — отсюда «нужен второй клик»). Старые серверные строки помечаем
		// на удаление, черновики заменяются строками нового основания.
		let serverRows = live.filter((r: any) => isServerRow(r));
		if (serverRows.length === 0 && snap.uuid) {
			const fetched = await fetchDocumentItems(opts.itemsEndpoint, opts.itemsParentField, snap.uuid);
			serverRows = fetched.filter((r: any) => isServerRow(r));
		}
		merged = [...result.items, ...serverRows.map((r: any) => ({ ...r, _pendingAction: "delete" }))];
	} else {
		// То же основание → идемпотентный merge по sourceRowId (без дублей, серверные
		// строки и ручные правки сохраняются). Если вкладка ещё не открывалась —
		// дозагружаем строки с сервера.
		let displayed = live;
		if (displayed.length === 0 && snap.uuid) {
			displayed = await fetchDocumentItems(opts.itemsEndpoint, opts.itemsParentField, snap.uuid);
		}
		merged = buildRefillBasisItems(displayed, result.items);
	}

	// При смене основания обновляем таблицу всегда (даже если merged пуст — основание
	// без позиций → очистить); при том же основании — только если есть изменения.
	if (merged.length || basisChanged) {
		opts.setBasisItems(merged);
		opts.bumpItemsTableKey();
	}
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
): Promise<TDataItem[]> {
	if (!parentUuid) return [];
	const resp = await api.get(`/${itemsEndpoint}`, {
		params: { [parentField]: parentUuid, limit: 1000 },
	});
	return unwrapList<TDataItem>(resp);
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

/** Загружает основные значения пользователя (userDefaults) для организации. */
async function fetchOrgUserDefaults(
	userUuid: string,
	organizationUuid: string,
): Promise<UserDefaultsMap> {
	if (!userUuid || !organizationUuid) return {};
	try {
		const resp = await api.get<any>("/user-defaults", {
			params: { userUuid, organizationUuid, limit: 100 },
		});
		const items: any[] = Array.isArray(resp) ? resp : (resp?.items ?? []);
		const map: UserDefaultsMap = {};
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
 *   • есть основное значение пользователя (userDefaults целевой орг) — берём его;
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
	currentOrgDefaults: UserDefaultsMap,
	orgFields: Array<{ valueType: keyof UserDefaultsMap; uuidKey: string; nameKey: string }>,
): Promise<Record<string, any>> {
	const targetOrg = basisFields.organizationUuid ?? currentFields.organizationUuid ?? "";
	const orgChanged = !!basisFields.organizationUuid && basisFields.organizationUuid !== currentFields.organizationUuid;

	// Поля, зависящие от орг, которые основание НЕ предоставило.
	const missing = orgFields.filter((f) => !basisFields[f.uuidKey]);
	if (!missing.length) return {};

	// Поля, которых нет в основании, трогаем ТОЛЬКО при смене организации
	// (текущее значение ссылается на старую орг → невалидно). Если организация
	// не менялась — НЕ заполняем и НЕ очищаем (сохраняем то, что выбрал пользователь:
	// «Склад» и пр.), т.к. их нет в документе-основании.
	if (!orgChanged) return {};

	const defaults = await fetchOrgUserDefaults(userUuid, targetOrg);
	const patch: Record<string, any> = {};
	for (const f of missing) {
		const def = defaults[f.valueType];
		// При смене орг: дефолт новой орг, иначе очищаем (нельзя оставлять ссылку на старую орг).
		patch[f.uuidKey] = def ? def.uuid : "";
		patch[f.nameKey] = def ? def.name : "";
	}
	return patch;
}

/**
 * Пересчитывает зависящие от организации поля при ПРЯМОЙ смене организации
 * в форме (пользователь выбрал другую орг в автокомплите «Организация»).
 *
 * Для каждого зависимого поля (склад/договор/касса/банк-счёт/ответственный):
 *   • есть основное значение пользователя (userDefaults новой орг) — берём его;
 *   • иначе — очищаем (значение принадлежало прежней организации и более не валидно).
 *
 * Возвращает patch для form.setFields. Всегда включает org-поля (имя+uuid).
 */
export async function resolveOrgChangeFields(
	newOrgUuid: string,
	userUuid: string,
	orgFields: Array<{ valueType: keyof UserDefaultsMap; uuidKey: string; nameKey: string }>,
): Promise<Record<string, any>> {
	const defaults = newOrgUuid ? await fetchOrgUserDefaults(userUuid, newOrgUuid) : {};
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

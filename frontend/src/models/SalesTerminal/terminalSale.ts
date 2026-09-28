/**
 * Общая логика оплаты терминала продаж — для SalesTerminal и SalesTerminalV2 (аудит 26.09,
 * И1–И6). Раньше она была скопирована в оба компонента, и ошибки жили в обоих: двойная
 * продажа, проглоченные отказы, потерянная скидка, черновики-дубли. Здесь — один раз и
 * под тестами (__tests__/salesTerminalSale.test.ts).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { api } from "src/services/api/client";
import { translate } from "src/i18";
import type { TDataItem } from "src/components/Table/types";
import { usePersistentState } from "src/hooks/usePersistentState";
import { useLateResponseGuard } from "src/models/_shared/lateResponseGuard";
import { resolveOrgChangeFields } from "src/utils/createFromBasis";
import { registerReloadBlocker } from "src/services/appUpdate";

// ── Офлайн-заглушка api-клиента ─────────────────────────────────────────────

/**
 * ОТВЕТ-ЗАГЛУШКА ВМЕСТО ОТВЕТА СЕРВЕРА (И2).
 *
 * Раньше при обрыве связи или таймауте перехватчик api-клиента (services/api/client.ts) отдавал
 * на любой POST/PUT «успех» 202 `{ _offline: true }`, и терминал считал его успехом: «Реализация
 * проведена», корзина очищена, а документа нет. По новому контракту «каркаса» (аудит 26.09)
 * заглушку получает только тот, кто попросил её флагом `offlineStub`; терминал не просит —
 * сетевой сбой приходит ему ошибкой. Проверка ниже — страховка на случай, если заглушка всё же
 * придёт: для терминала она всегда «не проведено» (в очередь ничего не ставится, а шаги продажи
 * зависят от uuid, который выдаёт сервер).
 */
export function isOfflineStub(resp: unknown): boolean {
	return !!resp && typeof resp === "object" && (resp as { _offline?: unknown })._offline === true;
}

/** Сервер не ответил на шаг продажи — продажа не завершена. Статуса нет: это системный сбой. */
export class TerminalOfflineError extends Error {
	constructor() {
		super(translate("terminalOffline"));
		this.name = "TerminalOfflineError";
	}
}

function online<T>(resp: T): T {
	if (isOfflineStub(resp)) throw new TerminalOfflineError();
	return resp;
}

// ── Строки корзины → строки документа ───────────────────────────────────────

/**
 * Данные строки для сервера. СКИДКА И АКЦИЗ ИДУТ ВМЕСТЕ С ЦЕНОЙ (И3): раньше в запросе были
 * только количество, цена и ставка НДС — корзина 2×1500 со скидкой 10 % давала 2 700 на
 * экране и в ПКО, а реализация — 3 000, и 300 ₸ висели долгом розничного покупателя.
 */
export function cartRowData(r: TDataItem, fallbackVatRate: number): Record<string, unknown> {
	const data: Record<string, unknown> = {
		productUuid: r.productUuid,
		quantity: Number(r.quantity) || 0,
		price: Number(r.price) || 0,
		vatRate: r.vatRate != null ? Number(r.vatRate) : fallbackVatRate,
		discountPercent: Number(r.discountPercent) || 0,
		exciseRate: Number(r.exciseRate) || 0,
		unitOfMeasureUuid: r.unitOfMeasureUuid || null,
	};
	if (Array.isArray(r.taxes)) data.taxes = r.taxes;
	if (r.batchUuid) data.batchUuid = r.batchUuid;
	if (r.sourceRowId) data.sourceRowId = r.sourceRowId;
	return data;
}

/** Пакет операций: удалить прежние строки черновика и создать строки корзины. */
export function replaceItemsOps(
	existingItemUuids: string[],
	rows: TDataItem[],
	parentField: string,
	docUuid: string,
	fallbackVatRate: number,
): Array<Record<string, unknown>> {
	return [
		...existingItemUuids.map((uuid) => ({ action: "delete", uuid })),
		...rows.map((r) => ({ action: "create", data: { [parentField]: docUuid, ...cartRowData(r, fallbackVatRate) } })),
	];
}

// ── Проведение продажи/возврата ─────────────────────────────────────────────

export interface TerminalSaleInput {
	isReturn: boolean;
	/** Шапка документа (дата, организация, покупатель, договор, склад…), без posted. */
	header: Record<string, unknown>;
	rows: TDataItem[];
	vatRate: number;
	/**
	 * Черновик прошлой неудачной попытки (И4). Продажа идёт несколькими запросами, и отказ
	 * проведения раньше оставлял черновик, а каждый повтор — ещё один. Теперь повтор берёт
	 * тот же документ: шапку обновляет, строки заменяет, проводит.
	 */
	draftUuid: string | null;
	/** Черновик создан — сообщается сразу, до строк и проведения: если дальше будет отказ, повтор возьмёт его. */
	onDraft: (uuid: string) => void;
}

export interface TerminalSaleResult {
	docUuid: string;
	docNumber: string;
	/** Итог документа, как его посчитал сервер (null — сервер не вернул). */
	amount: number | null;
}

interface DocResponse { item?: { uuid?: string; number?: string | null; amount?: unknown; posted?: boolean } }

export function terminalEndpoints(isReturn: boolean) {
	return isReturn
		? { doc: "sale-returns", items: "sale-return-items", parentField: "saleReturnUuid" }
		: { doc: "sales", items: "saleitems", parentField: "saleUuid" };
}

function resultOf(docUuid: string, resp: DocResponse | undefined, fallbackNumber = ""): TerminalSaleResult {
	const amount = Number(resp?.item?.amount);
	return {
		docUuid,
		docNumber: resp?.item?.number ?? fallbackNumber,
		amount: resp?.item?.amount != null && Number.isFinite(amount) ? amount : null,
	};
}

/**
 * Провести продажу (возврат): шапка → строки → проведение. Бросает ошибку сервера как есть
 * (её разбирает routeError) либо TerminalOfflineError.
 */
export async function performTerminalSale(input: TerminalSaleInput): Promise<TerminalSaleResult> {
	const ep = terminalEndpoints(input.isReturn);
	let docUuid = input.draftUuid;
	let existingItemUuids: string[] = [];
	let number = "";

	if (docUuid) {
		// Повтор. Сначала — что с черновиком: прошлый ответ мог потеряться уже после проведения.
		let current: DocResponse | undefined;
		try {
			current = await api.get<DocResponse>(`${ep.doc}/${docUuid}`);
		} catch (e) {
			if ((e as { response?: { status?: number } })?.response?.status !== 404) throw e;
			current = undefined; // черновик удалили — начнём заново
		}
		if (!current?.item) docUuid = null;
		else if (current.item.posted === true) return resultOf(docUuid, current);
		else {
			number = current.item.number ?? "";
			online(await api.put(`${ep.doc}/${docUuid}`, { ...input.header, posted: false }));
			const items = await api.get<{ items?: Array<{ uuid?: string }> }>(ep.items, {
				params: { [ep.parentField]: docUuid, limit: 1000 },
			});
			existingItemUuids = (items?.items ?? []).map((i) => String(i.uuid ?? "")).filter(Boolean);
		}
	}

	if (!docUuid) {
		const created = online(await api.post<DocResponse>(ep.doc, { ...input.header, posted: false }));
		docUuid = created?.item?.uuid ?? null;
		if (!docUuid) throw new Error(translate("serverError"));
		number = created?.item?.number ?? "";
		input.onDraft(docUuid);
	}

	online(await api.post(`${ep.items}/batch`, {
		operations: replaceItemsOps(existingItemUuids, input.rows, ep.parentField, docUuid, input.vatRate),
	}));

	const posted = online(await api.put<DocResponse>(`${ep.doc}/${docUuid}`, { posted: true }));
	return resultOf(docUuid, posted, number);
}

/**
 * Убрать брошенный черновик (корзину очистили или сменили режим после неудачной оплаты).
 * Удаляем ТОЛЬКО непроведённый: ответ проведения мог потеряться, и документ уже проведён.
 * Возвращает номер проведённого документа, если черновик оказался проведён, иначе null.
 */
export async function discardTerminalDraft(isReturn: boolean, uuid: string): Promise<string | null> {
	const ep = terminalEndpoints(isReturn);
	try {
		const cur = await api.get<DocResponse>(`${ep.doc}/${uuid}`);
		if (!cur?.item) return null;
		if (cur.item.posted === true) return cur.item.number ?? "";
		await api.delete(`${ep.doc}/${uuid}`);
	} catch {
		/* не удалось — останется черновиком; мешать кассиру из-за этого не будем */
	}
	return null;
}

// ── Проверки корзины ────────────────────────────────────────────────────────

/** Товары корзины без цены (И6) — по 0 ₸ без явного согласия кассира не продаём. */
export function unpricedRowNames(rows: TDataItem[]): string[] {
	return rows
		.filter((r) => !!r.productUuid && !(Number(r.price) > 0))
		.map((r) => (r.product as { name?: string } | undefined)?.name || String(r.productUuid));
}

/**
 * Товар, который терминал продать не может (И4): учёт по серийным номерам или партиям
 * требует выбрать серии/партию, а у корзины терминала таких ячеек нет — проведение
 * получало 422. Говорим об этом сразу, при добавлении, и отправляем в «Реализацию».
 */
export function terminalBlockedReason(item: Record<string, unknown> | null | undefined): string {
	if (!item) return "";
	if (item.trackSerialNumbers === true) return translate("terminalSerialTracked");
	if (item.trackBatches === true) return translate("terminalBatchTracked");
	return "";
}

// ── Реквизиты терминала ─────────────────────────────────────────────────────

/** Реквизиты, которые подставляются по организации и покупателю. */
export interface TerminalRequisites {
	orgUuid: string; orgName: string;
	buyerUuid: string; buyerName: string;
	contractUuid: string; contractName: string;
	warehouseUuid: string; warehouseName: string;
	cashboxUuid: string; cashboxName: string;
	priceTypeUuid: string; priceTypeName: string;
}

/**
 * РЕКВИЗИТЫ СО СНИМКОМ ДЛЯ СВЕРКИ ПОСЛЕ AWAIT (И13). Склад, касса и тип цен подставляются по
 * организации, договор — по покупателю, и оба запроса асинхронные. Состояние React в
 * async-обработчике устаревает, а ref, обновляемый рендером, отстаёт внутри того же
 * обработчика, — поэтому эти поля меняются только через setRequisites: он обновляет снимок
 * синхронно и уже потом состояние. getRequisites/setRequisites — пара для useLateResponseGuard.
 * Склад, касса и тип цен запоминаются между сеансами (usePersistentState), как и раньше.
 */
export function useTerminalRequisites(init: { orgUuid: string; orgName: string }) {
	const [orgUuid, setOrgUuid] = useState(init.orgUuid);
	const [orgName, setOrgName] = useState(init.orgName);
	const [buyerUuid, setBuyerUuid] = useState("");
	const [buyerName, setBuyerName] = useState("");
	const [contractUuid, setContractUuid] = useState("");
	const [contractName, setContractName] = useState("");
	const [warehouseUuid, setWarehouseUuid] = usePersistentState("terminal.warehouseUuid", "");
	const [warehouseName, setWarehouseName] = usePersistentState("terminal.warehouseName", "");
	const [cashboxUuid, setCashboxUuid] = usePersistentState("terminal.cashboxUuid", "");
	const [cashboxName, setCashboxName] = usePersistentState("terminal.cashboxName", "");
	const [priceTypeUuid, setPriceTypeUuid] = usePersistentState("terminal.priceTypeUuid", "");
	const [priceTypeName, setPriceTypeName] = usePersistentState("terminal.priceTypeName", "");
	const setters = useMemo(() => ({
		orgUuid: setOrgUuid, orgName: setOrgName, buyerUuid: setBuyerUuid, buyerName: setBuyerName,
		contractUuid: setContractUuid, contractName: setContractName,
		warehouseUuid: setWarehouseUuid, warehouseName: setWarehouseName,
		cashboxUuid: setCashboxUuid, cashboxName: setCashboxName,
		priceTypeUuid: setPriceTypeUuid, priceTypeName: setPriceTypeName,
	}), [setWarehouseUuid, setWarehouseName, setCashboxUuid, setCashboxName, setPriceTypeUuid, setPriceTypeName]);
	// Начальный снимок совпадает с состоянием: usePersistentState читает хранилище синхронно.
	const snapshotRef = useRef<TerminalRequisites>({
		orgUuid, orgName, buyerUuid, buyerName, contractUuid, contractName,
		warehouseUuid, warehouseName, cashboxUuid, cashboxName, priceTypeUuid, priceTypeName,
	});
	const setRequisites = useCallback((patch: Partial<TerminalRequisites>) => {
		const next = { ...snapshotRef.current };
		for (const key of Object.keys(patch) as Array<keyof TerminalRequisites>) {
			const value = patch[key];
			if (value === undefined) continue;
			next[key] = value;
			setters[key](value);
		}
		snapshotRef.current = next;
	}, [setters]);
	const getRequisites = useCallback(() => snapshotRef.current, []);
	return {
		orgUuid, orgName, buyerUuid, buyerName, contractUuid, contractName,
		warehouseUuid, warehouseName, cashboxUuid, cashboxName, priceTypeUuid, priceTypeName,
		setRequisites, getRequisites,
	};
}

// ── Смена организации и покупателя ──────────────────────────────────────────

/** Реквизиты, подставляемые по организации (дефолты пользователя). */
const TERMINAL_ORG_FIELDS: Array<{ valueType: "warehouse" | "cashbox" | "salePriceType"; uuidKey: string; nameKey: string }> = [
	{ valueType: "warehouse", uuidKey: "warehouseUuid", nameKey: "warehouseName" },
	{ valueType: "cashbox", uuidKey: "cashboxUuid", nameKey: "cashboxName" },
	{ valueType: "salePriceType", uuidKey: "priceTypeUuid", nameKey: "priceTypeName" },
];

/** Основной договор покупателя (useContractSync); null — договор не менять. */
export type TerminalContractLookup = (opts: {
	counterpartyUuid: string;
	organizationUuid?: string | null;
	currentContractUuid: string;
}) => Promise<{ contractUuid: string; contractName: string } | null>;

/**
 * СМЕНА ОРГАНИЗАЦИИ И ПОКУПАТЕЛЯ (КР-6 аудита 27.09). У каждого обработчика — свой guard: с общим
 * выбор покупателя, пока грузились дефолты новой организации, отбрасывал их как «поздние» — склад,
 * касса и тип цен оставались от прежней организации, а прайс не перечитывался, и новые товары
 * вставали по её ценам. Теперь реквизиты прежней организации чистятся сразу, а прайс новой
 * перечитывается всегда, когда её дефолты подставлены (onOrgApplied): с типом цен из дефолтов,
 * выбранным вручную за время запроса или пустым — тогда тип цен выберет сервер.
 */
export function useTerminalOrgBuyer(opts: {
	getRequisites: () => TerminalRequisites;
	setRequisites: (patch: Partial<TerminalRequisites>) => void;
	userUuid: string;
	syncContract: TerminalContractLookup;
	/** Сразу после смены организации, до ответа: сбросить менеджера, забыть прайс прежней. */
	onOrgReset: () => void;
	/** Организация установлена, дефолты подставлены: перечитать прайс (реквизиты — снимок). */
	onOrgApplied: (req: TerminalRequisites) => void;
}) {
	const { getRequisites, setRequisites, userUuid, syncContract, onOrgReset, onOrgApplied } = opts;
	const guardOrg = useLateResponseGuard<TerminalRequisites>(getRequisites, setRequisites);
	const guardBuyer = useLateResponseGuard<TerminalRequisites>(getRequisites, setRequisites);

	const handleOrgChange = useCallback(async (u: string, d: string) => {
		setRequisites({
			orgUuid: u, orgName: d, buyerUuid: "", buyerName: "", contractUuid: "", contractName: "",
			warehouseUuid: "", warehouseName: "", cashboxUuid: "", cashboxName: "", priceTypeUuid: "", priceTypeName: "",
		});
		onOrgReset();
		// Склад, касса или тип цен, выбранные вручную за время запроса, ответ не перетирает (И13).
		const applied = await guardOrg(() => resolveOrgChangeFields(u, userUuid, TERMINAL_ORG_FIELDS), ["orgUuid"]);
		// null — организацию успели сменить ещё раз: прайс перечитает её обработчик.
		if (applied === null) return;
		onOrgApplied(getRequisites());
	}, [guardOrg, setRequisites, getRequisites, userUuid, onOrgReset, onOrgApplied]);

	/*
	 * Именной покупатель — со СВОИМ основным договором (И5). Пока грузился договор, кассир мог
	 * сменить покупателя или организацию — поздний ответ мимо (И13).
	 */
	const selectBuyer = useCallback(async (u: string, d: string) => {
		setRequisites({ buyerUuid: u, buyerName: d, contractUuid: "", contractName: "" });
		if (!u) return;
		await guardBuyer(async (cur) => {
			const p = await syncContract({ counterpartyUuid: u, organizationUuid: cur.orgUuid || null, currentContractUuid: "" });
			return p?.contractUuid ? { contractUuid: p.contractUuid, contractName: p.contractName } : null;
		}, ["buyerUuid", "orgUuid"]);
	}, [guardBuyer, setRequisites, syncContract]);

	return { handleOrgChange, selectBuyer };
}

// ── Новая версия приложения ─────────────────────────────────────────────────

/**
 * ТЕРМИНАЛ С ТОВАРАМИ НЕ ПЕРЕЗАГРУЖАЕТСЯ САМ (КР-10 аудита 27.09). Корзина нигде не хранится, а
 * перезагрузка во время оплаты теряет её ответ. Пока в корзине товары или идёт оплата, новая
 * версия приложения ждёт кнопки «Обновить» (services/appUpdate).
 */
export function useTerminalReloadBlock(blocking: boolean): void {
	const blockingRef = useRef(blocking);
	blockingRef.current = blocking;
	useEffect(() => registerReloadBlocker(() => blockingRef.current), []);
}

// ── Замок оплаты ────────────────────────────────────────────────────────────

/**
 * ЗАМОК ОПЛАТЫ (И1). Флаг «идёт оплата» в состоянии до следующего рендера не виден: раньше он
 * ставился после await проверки остатков, и двойной клик «Оплатить» или двойной F9 создавал
 * две реализации, два ПКО и два чека. Ref ставится синхронно, первым делом; `busy` — для
 * кнопки. Повторный вызов, пока идёт первый, ничего не делает.
 */
export function useSubmitLock() {
	const lockRef = useRef(false);
	const [busy, setBusy] = useState(false);
	const run = useCallback(async (fn: () => Promise<void>): Promise<void> => {
		if (lockRef.current) return;
		lockRef.current = true;
		setBusy(true);
		try {
			await fn();
		} finally {
			lockRef.current = false;
			setBusy(false);
		}
	}, []);
	return { busy, run };
}

// ── Горячие клавиши ─────────────────────────────────────────────────────────

/**
 * F9 — провести, F4 — очистить: ТОЛЬКО В СВОЕЙ ПАНЕЛИ (И5).
 *
 * Раньше клавиши слушались на window, а панели приложения не размонтируются: в любой
 * другой вкладке F4 очищал корзину терминала, F9 проводил фоновую продажу, а при открытых
 * V1 и V2 проводились обе. Теперь обработчик висит на корне терминала (событие приходит,
 * только когда фокус внутри), и дополнительно сверяется, что панель активна.
 */
export function useTerminalHotkeys(opts: {
	uniqId?: string;
	/** Активная панель на момент нажатия (useAppActions().windows.getActivePane) — без подписки на панели. */
	getActivePane: () => string | null | undefined;
	onSubmit: () => void;
	onClear: () => void;
}) {
	const latest = useRef(opts);
	useEffect(() => { latest.current = opts; });
	return useCallback((e: ReactKeyboardEvent<HTMLElement>) => {
		if (e.key !== "F9" && e.key !== "F4") return;
		const { uniqId, getActivePane, onSubmit, onClear } = latest.current;
		const activePane = getActivePane();
		if (uniqId && activePane && activePane !== uniqId) return;
		e.preventDefault();
		if (e.key === "F9") onSubmit(); else onClear();
	}, []);
}

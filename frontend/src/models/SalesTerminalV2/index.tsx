/**
 * Терминал продаж — ВАРИАНТ 2 (SalesTerminalV2).
 *
 * Отдельный компонент, а не правка существующего: рабочий терминал остаётся нетронутым,
 * а этот можно открыть рядом и сравнить вживую. Бизнес-логика скопирована один в один —
 * различается только оформление; расхождений в поведении быть не должно.
 *
 * Отступы и радиусы здесь КРУПНЕЕ общей шкалы проекта (3/6/12 и 3/6): это витринный
 * экран с большими зонами, и на форменной шкале он выглядит тесным. Отклонение
 * намеренное и ограничено этой папкой — общие Button/Field/Table не тронуты.
 *
 */
import { FC, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { translate } from "src/i18";
import { api } from "src/services/api/client";
import { reportError, routeError } from "src/services/errors/route";
import { notify } from "src/components/TechMessages/store";
import Notice, { type NoticeItem } from "src/components/Notice";
import LookupField from "src/components/Field/LookupField";
import { Field } from "src/components/Field";
import FieldActionButton from "src/components/Field/FieldActionButton";
import { Button } from "src/components/Button";
import TradeDocumentItemsTable from "src/components/DocumentItemsTable/TradeDocumentItemsTable";
import type { SubTableApi } from "src/components/SubTable";
import type { TDataItem } from "src/components/Table/types";
import { useDefaultOrganization } from "src/hooks/useDefaultOrganization";
import { resolveOrgChangeFields } from "src/utils/createFromBasis";
import { useOrgAccountingSettings } from "src/hooks/useOrgAccountingSettings";
import { useAppActions, useAppAuth } from "src/app/context";
import { recalcSaleItemAmounts } from "src/models/Sales/saleItemDraft";
import FiscalReceiptPane from "src/models/FiscalReceipts/FiscalReceiptPane";
import { getFormatDateOnly } from "src/utils/datetime";
import { checkStockAvailability, formatStockShortages } from "src/utils/stockControl";
import { openFormByRef } from "src/utils/openFormByRef";
import { useContractSync } from "src/hooks/useContractSync";
import {
  performTerminalSale, discardTerminalDraft, isOfflineStub, TerminalOfflineError,
  unpricedRowNames, terminalBlockedReason, useTerminalHotkeys, useSubmitLock, useTerminalRequisites, type TerminalRequisites,
} from "src/models/SalesTerminal/terminalSale";
import { useLateResponseGuard } from "src/models/_shared/lateResponseGuard";
import { isNetworkError } from "src/services/networkUtils";
import Tabs from "src/components/Tabs";
import type { TPane } from "src/app/types";
import styles from "./SalesTerminalV2.module.scss";

const EMPTY_ROWS: TDataItem[] = []; // стабильная ссылка для initialPendingRows

const fmt = (n: number) =>
  Number(n || 0).toLocaleString("ru-KZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface RetailRef { counterpartyUuid: string; counterpartyName: string; contractUuid: string }
interface RecentSale { uuid: string; number?: string | null; date?: string | null; amount?: number | null; posted?: boolean | null; counterparty?: { name?: string } | null }
interface ViewItem { name: string; quantity: number; price: number; amount: number }
interface ViewSale { uuid: string; number: string; date?: string | null; amount: number; posted: boolean; items: ViewItem[]; rawItems: TDataItem[] }

const SalesTerminalV2: FC<Partial<TPane>> = ({ uniqId }) => {
  const { organizationUuid: defOrgUuid, organizationName: defOrgName } = useDefaultOrganization();
  // Стабильные части контекста (О3): useAppContext() перерисовывал терминал при любом переключении
  // вкладки. Активную панель читаем в момент нажатия клавиши (getActivePane), а не подпиской.
  const { windows: { addPane, getActivePane }, actions: { confirm } } = useAppActions();
  const { user } = useAppAuth();

  /*
   * Склад, касса, тип цен и договор подставляются по организации и покупателю асинхронно —
   * реквизиты живут в useTerminalRequisites со снимком для сверки после await: без него поздний
   * ответ по прежней организации ставил её склад и кассу в продажу новой (И13).
   */
  const {
    orgUuid, orgName, buyerUuid, buyerName, contractUuid, contractName,
    warehouseUuid, warehouseName, cashboxUuid, cashboxName, priceTypeUuid, priceTypeName,
    setRequisites, getRequisites,
  } = useTerminalRequisites({ orgUuid: defOrgUuid || "", orgName: defOrgName || "" });
  const guardRequisites = useLateResponseGuard<TerminalRequisites>(getRequisites, setRequisites);
  const [managerUuid, setManagerUuid] = useState((user as { employee?: { uuid?: string } })?.employee?.uuid ?? "");
  const [managerName, setManagerName] = useState((user as { employee?: { fullName?: string } })?.employee?.fullName ?? "");
  /*
   * Именной покупатель — со СВОИМ основным договором (И5). Раньше в продажу уходил договор
   * «Розничная продажа» розничного покупателя, и сервер отвечал 409 «договор другого
   * контрагента» (а из-за проглоченных ошибок кассир этого не видел).
   */
  const syncContract = useContractSync();
  const selectBuyer = useCallback(async (u: string, d: string) => {
    setRequisites({ buyerUuid: u, buyerName: d, contractUuid: "", contractName: "" });
    if (!u) return;
    // Пока грузился договор, кассир мог сменить покупателя или организацию — поздний ответ мимо (И13).
    await guardRequisites(async (cur) => {
      const p = await syncContract({ counterpartyUuid: u, organizationUuid: cur.orgUuid || null, currentContractUuid: "" });
      return p?.contractUuid ? { contractUuid: p.contractUuid, contractName: p.contractName } : null;
    }, ["buyerUuid", "orgUuid"]);
  }, [guardRequisites, setRequisites, syncContract]);

  // Розничный покупатель + договор по умолчанию (для submit; имя не отображаем).
  const retailRef = useRef<RetailRef | null>(null);
  // Готов ли розничный покупатель — состоянием, а не только ссылкой: от него зависит,
  // можно ли оплатить, и кнопка должна узнать об этом без нажатия.
  const [retailReady, setRetailReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    api.get<{ counterparty?: { uuid: string; name: string }; contract?: { uuid: string } }>("counterparties/retail")
      .then((r) => {
        if (cancelled || !r?.counterparty) return;
        retailRef.current = { counterpartyUuid: r.counterparty.uuid, counterpartyName: r.counterparty.name, contractUuid: r.contract?.uuid ?? "" };
        setRetailReady(true);
      })
      // Без розничного покупателя оплатить нельзя — причину покажет подпись под кнопкой,
      // а сам сбой (нет связи, 5xx) — тост и журнал.
      .catch((e) => { if (!cancelled) reportError(e, { source: translate("salesTerminal"), fallback: translate("retailBuyerNotReady") }); });
    return () => { cancelled = true; };
  }, []);

  const [mode, setMode] = useState<"sale" | "return">("sale");
  const isReturn = mode === "return";
  const [payment, setPayment] = useState<"cash" | "card" | "kaspi">("cash");
  // Замок оплаты (И1): повторный клик или F9, пока идёт оплата, ничего не делает (terminalSale.ts).
  const { busy: submitting, run: runLocked } = useSubmitLock();
  /** Отказ оплаты по существу (409/422/423…) — над кнопкой, пока корзину не поправят (И2). */
  const [payError, setPayError] = useState<NoticeItem[]>([]);
  /** Товар, который терминал не продаёт (серии/партии), — под полем поиска (И4). */
  const [addError, setAddError] = useState("");
  /** Прайс-лист не загрузился — цены не подставляются (И6). */
  const [priceListFailed, setPriceListFailed] = useState(false);
  /**
   * Черновик неудачной оплаты (И4): повтор проводит его же, а не создаёт ещё один. Ref — для
   * submit, состояние — для подсказки кассиру.
   */
  const draftRef = useRef<{ uuid: string; isReturn: boolean } | null>(null);
  const [draftPending, setDraftPending] = useState(false);
  /** Комментарий к продаже — уходит в документ; после проведения сбрасывается. */
  const [comment, setComment] = useState("");
  /** Карточка «Информация о продаже» сворачивается: кассиру она нужна не в каждом чеке. */
  const [saleInfoOpen, setSaleInfoOpen] = useState(true);

  const [total, setTotal] = useState(0);
  const [cartCount, setCartCount] = useState(0);

  // Возврат на основании конкретной продажи (связь basisDocumentUuid → sale).
  const [basisSale, setBasisSale] = useState<{ uuid: string; label: string } | null>(null);
  // Просмотр выбранной недавней продажи (read-only в левой области).
  const [viewSale, setViewSale] = useState<ViewSale | null>(null);
  const [recent, setRecent] = useState<RecentSale[]>([]);
  // Inline-баннер успеха (best practice: понятный итог + быстрый доступ к документу).
  const [banner, setBanner] = useState<{ number: string; total: number; isReturn: boolean; uuid: string; endpoint: string } | null>(null);
  const bannerTimer = useRef<number | null>(null);

  const acct = useOrgAccountingSettings(orgUuid);
  const vatRate = acct.vatRate;
  const vatMethod = acct.vatCalculationMethod;
  const userUuid = (user as { uuid?: string })?.uuid ?? "";

  const cartApiRef = useRef<SubTableApi | null>(null);
  const searchWrapRef = useRef<HTMLDivElement>(null);

  const priceMapRef = useRef<Map<string, number>>(new Map());
  const priceLoadSeqRef = useRef(0);
  const priceTypeUuidRef = useRef(priceTypeUuid);
  priceTypeUuidRef.current = priceTypeUuid;

  // ── Недавние продажи ─────────────────────────────────────────────────────
  const loadRecent = useCallback(async () => {
    try {
      const params: Record<string, string> = { limit: "20" };
      if (orgUuid) params["filter[organizationUuid][equals]"] = orgUuid;
      const resp = await api.get<{ items?: RecentSale[] }>("sales", { params });
      setRecent(resp?.items ?? []);
    } catch (e) {
      // Раньше — пустой catch «покажет перехватчик», а перехватчик показывает только 403.
      reportError(e, { source: translate("terminalRecentSales"), fallback: translate("terminalRecentFailed") });
    }
  }, [orgUuid]);
  useEffect(() => { void loadRecent(); }, [loadRecent]);

  const loadPriceMap = useCallback(async (typeUuid: string, reprice: boolean) => {
    // Организация — из снимка, а не из замыкания: после смены организации обработчик держал
    // прежнюю, и прайс грузился по ней. Поздний ответ (успели сменить тип цен или организацию) — мимо (И13).
    const seq = ++priceLoadSeqRef.current;
    try {
      const orgNow = getRequisites().orgUuid;
      const params: Record<string, string> = {};
      if (orgNow) params.organizationUuid = orgNow;
      if (typeUuid) params.priceTypeUuid = typeUuid;
      const resp = await api.get<{ priceTypeUuid: string | null; priceTypeName: string | null; items: Array<{ productUuid: string; price: number | null }> }>(
        "product-prices/price-list", { params },
      );
      if (seq !== priceLoadSeqRef.current) return;
      const map = new Map<string, number>();
      for (const it of resp?.items ?? []) if (it.price != null) map.set(it.productUuid, Number(it.price));
      priceMapRef.current = map;
      setPriceListFailed(false);
      if (!typeUuid && resp?.priceTypeUuid) setRequisites({ priceTypeUuid: resp.priceTypeUuid, priceTypeName: resp.priceTypeName ?? "" });
      if (reprice && cartApiRef.current) {
        for (const r of cartApiRef.current.getRows()) {
          const p = map.get(String(r.productUuid));
          if (p != null) {
            // Скидку и акциз строки сохраняем: переоценка меняет только цену.
            const calc = recalcSaleItemAmounts(Number(r.quantity) || 0, p, vatRate, r.discountPercent, vatMethod, r.exciseRate);
            cartApiRef.current.updateRow(r, { price: p, ...calc });
          }
        }
      }
    } catch (e) {
      if (seq !== priceLoadSeqRef.current) return;
      // Раньше сбой молча оставлял пустой прайс, и вся корзина шла по 0 ₸ (И6).
      setPriceListFailed(true);
      reportError(e, { source: translate("salesTerminal"), fallback: translate("terminalPriceListFailed") });
    }
  }, [vatRate, vatMethod, getRequisites, setRequisites]);

  useEffect(() => { void loadPriceMap(priceTypeUuidRef.current, false); }, [loadPriceMap]);

  const handleOrgChange = useCallback(async (u: string, d: string) => {
    setRequisites({ orgUuid: u, orgName: d, buyerUuid: "", buyerName: "", contractUuid: "", contractName: "" });
    setManagerUuid(""); setManagerName("");
    // Дефолты новой организации. Поздний ответ по прежней — мимо; склад, касса или тип цен,
    // выбранные вручную за время запроса, не перетираются (И13).
    const applied = await guardRequisites(() => resolveOrgChangeFields(u, userUuid, [
      { valueType: "warehouse", uuidKey: "warehouseUuid", nameKey: "warehouseName" },
      { valueType: "cashbox", uuidKey: "cashboxUuid", nameKey: "cashboxName" },
      { valueType: "salePriceType", uuidKey: "priceTypeUuid", nameKey: "priceTypeName" },
    ]), ["orgUuid"]);
    // Прайс — по применённому типу цен; выбранный вручную за время запроса уже грузит свой.
    if (applied && applied.priceTypeUuid !== undefined) void loadPriceMap(applied.priceTypeUuid, true);
  }, [guardRequisites, setRequisites, userUuid, loadPriceMap]);

  const addProduct = useCallback((uuid: string, name: string, item: Record<string, unknown>) => {
    if (!uuid) return;
    const cart = cartApiRef.current;
    if (!cart) return;
    // Серии и партии через терминал не продать — говорим сразу, а не отказом при оплате (И4).
    const blocked = terminalBlockedReason(item);
    if (blocked) { setAddError(`«${name || (item?.name as string) || ""}»: ${blocked}`); return; }
    setAddError("");
    const existing = cart.getRows().find((r) => r.productUuid === uuid);
    if (existing) {
      const q = (Number(existing.quantity) || 0) + 1;
      const calc = recalcSaleItemAmounts(q, Number(existing.price) || 0, vatRate, existing.discountPercent, vatMethod, existing.exciseRate);
      cart.updateRow(existing, { quantity: q, ...calc });
      return;
    }
    // Товара нет в прайсе — цена 0; оплата по 0 ₸ потребует подтверждения (И6).
    const price = priceMapRef.current.get(uuid) ?? 0;
    const calc = recalcSaleItemAmounts(1, price, vatRate, 0, vatMethod, 0);
    const umUuid = (item?.unitOfMeasureUuid as string) ?? null;
    const um = item?.unitOfMeasure as { name?: string } | undefined;
    cart.addRow({
      productUuid: uuid,
      // isService — услуга не проверяется на остаток (utils/stockControl).
      product: { uuid, name: name || (item?.name as string) || "", isService: item?.isService === true },
      quantity: 1,
      price,
      unitOfMeasureUuid: umUuid,
      unitOfMeasure: umUuid ? { uuid: umUuid, name: um?.name ?? "" } : null,
      vatRate: vatRate || 0,
      ...calc,
    });
  }, [vatRate, vatMethod]);

  /*
   * Брошенный черновик неудачной оплаты убираем, когда корзину очищают или меняют режим:
   * иначе он так и висел бы в «Реализациях». Если он всё же проведён (ответ потерялся) —
   * не удаляем, а говорим об этом.
   */
  const dropDraft = useCallback(() => {
    const d = draftRef.current;
    if (!d) return;
    draftRef.current = null;
    setDraftPending(false);
    void discardTerminalDraft(d.isReturn, d.uuid).then((postedNumber) => {
      if (postedNumber === null) return;
      notify({
        severity: "warning", source: translate("salesTerminal"),
        text: `${translate(d.isReturn ? "terminalReturnDone" : "terminalDone")}${postedNumber ? ` № ${postedNumber}` : ""}`,
        ref: { endpoint: d.isReturn ? "sale-returns" : "sales", uuid: d.uuid },
      });
    });
  }, []);

  const clearCart = useCallback(() => {
    cartApiRef.current?.clear(); setBasisSale(null);
    setPayError([]); setAddError("");
    dropDraft();
  }, [dropDraft]);

  /*
   * Нулевое количество держит кнопку выключенной; нехватка остатка висит над кнопкой, пока
   * корзину не поправят. Снимаем нехватку только при РЕАЛЬНОЙ смене содержимого: итог
   * пересчитывается и без правок, и сообщение исчезало бы раньше, чем его прочтут.
   */
  const [badQty, setBadQty] = useState(false);
  const [shortage, setShortage] = useState<string[]>([]);
  /** Товары без цены — предупреждение над кнопкой (И6). */
  const [unpriced, setUnpriced] = useState<string[]>([]);
  const cartKeyRef = useRef("");
  const handleTableTotal = useCallback((t: number, items?: TDataItem[]) => {
    setTotal(t);
    setCartCount((items ?? []).length);
    setBadQty((items ?? []).some((r) => !!r.productUuid && !(Number(r.quantity) > 0)));
    const names = unpricedRowNames(items ?? []);
    setUnpriced((prev) => (prev.join("\n") === names.join("\n") ? prev : names));
    const key = JSON.stringify((items ?? []).map((r) => [r.productUuid, r.quantity, r.price]));
    if (key !== cartKeyRef.current) { cartKeyRef.current = key; setShortage([]); setPayError([]); }
  }, []);

  // ── Просмотр недавней продажи (activeRow) ────────────────────────────────
  const openSaleView = useCallback(async (s: RecentSale) => {
    try {
      const resp = await api.get<{ items?: TDataItem[] }>("saleitems", { params: { saleUuid: s.uuid } });
      const raw = resp?.items ?? [];
      const items: ViewItem[] = raw.map((r) => ({
        name: (r.product as { name?: string } | undefined)?.name ?? "",
        quantity: Number(r.quantity) || 0,
        price: Number(r.price) || 0,
        amount: Number(r.amount) || (Number(r.quantity) || 0) * (Number(r.price) || 0),
      }));
      const num = s.number ?? "";
      setViewSale({ uuid: s.uuid, number: num, date: s.date, amount: Number(s.amount) || 0, posted: s.posted !== false, items, rawItems: raw });
    } catch (e) {
      reportError(e, { source: translate("terminalRecentSales"), fallback: translate("terminalRecentFailed") });
    }
  }, []);
  const closeSaleView = useCallback(() => setViewSale(null), []);

  const saleLabel = useCallback((v: { number?: string | null; date?: string | null }) => {
    const ref = v.number ? `№ ${v.number}` : translate("docNoNumber");
    return `${translate("SalesList")}: ${ref}${v.date ? ` - ${getFormatDateOnly(String(v.date))}` : ""}`;
  }, []);

  // «Возврат на основании»: грузим товары продажи в корзину, режим = возврат,
  // связываем будущий возврат с продажей (basisDocumentUuid).
  const returnFromSale = useCallback((v: ViewSale) => {
    const cart = cartApiRef.current;
    if (!cart) return;
    cart.clear();
    dropDraft();
    for (const r of v.rawItems) {
      // Скидку и акциз исходной строки переносим — раньше возврат шёл по полной цене.
      const calc = recalcSaleItemAmounts(Number(r.quantity) || 0, Number(r.price) || 0, vatRate, r.discountPercent, vatMethod, r.exciseRate);
      cart.addRow({
        productUuid: r.productUuid,
        product: r.product ?? { uuid: r.productUuid, name: (r.product as { name?: string } | undefined)?.name ?? "" },
        quantity: Number(r.quantity) || 0,
        price: Number(r.price) || 0,
        unitOfMeasureUuid: r.unitOfMeasureUuid ?? null,
        unitOfMeasure: r.unitOfMeasure ?? null,
        vatRate: r.vatRate != null ? Number(r.vatRate) : (vatRate || 0),
        discountPercent: Number(r.discountPercent) || 0,
        exciseRate: Number(r.exciseRate) || 0,
        batchUuid: r.batchUuid ?? null,
        sourceRowId: r.uuid ?? null,
        ...calc,
      });
    }
    setMode("return");
    setBasisSale({ uuid: v.uuid, label: saleLabel(v) });
    setViewSale(null);
  }, [vatRate, vatMethod, saleLabel, dropDraft]);

  const printReceipt = useCallback(async (v: ViewSale) => {
    // Чек — только по проведённой продаже: черновик фискализировать нельзя (И4).
    if (!v.posted) return;
    try {
      const fr = await api.post<{ item?: Record<string, unknown> }>("fiscal-receipts", {
        documentType: "sale", documentUuid: v.uuid, paymentMethod: "cash",
      });
      if (isOfflineStub(fr)) throw new TerminalOfflineError();
      if (fr?.item) {
        addPane({
          component: FiscalReceiptPane,
          label: translate("fiscalReceiptTitle"),
          data: { receipt: fr.item, items: v.items.map((i) => ({ name: i.name, quantity: i.quantity, price: i.price })), organizationName: orgName },
        });
      }
    } catch (e) {
      reportError(e, { source: translate("salesTerminal"), fallback: translate("terminalReceiptFailed") });
    }
  }, [addPane, orgName]);

  const showBanner = useCallback((number: string, tot: number, ret: boolean, uuid: string, endpoint: string) => {
    setBanner({ number, total: tot, isReturn: ret, uuid, endpoint });
    if (bannerTimer.current) window.clearTimeout(bannerTimer.current);
    bannerTimer.current = window.setTimeout(() => setBanner(null), 9000);
  }, []);
  useEffect(() => () => { if (bannerTimer.current) window.clearTimeout(bannerTimer.current); }, []);

  // Открыть созданный/выбранный документ в полной форме для РЕДАКТИРОВАНИЯ (best
  // practice: из терминала → в обычную форму документа через реестр форм).
  const openDoc = useCallback((endpoint: string, uuid: string, label: string) => {
    void openFormByRef({ endpoint, uuid }, addPane, label);
  }, [addPane]);

  /*
   * ПОЧЕМУ НЕЛЬЗЯ ОПЛАТИТЬ — заранее и словами под кнопкой (M11).
   *
   * Раньше каждая недостача была тостом ПОСЛЕ нажатия: кассир жал F9, тост мигал четыре
   * секунды, и что именно не так, приходилось ловить глазами. Всё это известно до нажатия,
   * поэтому кнопка выключена, пока причина есть, и причина написана рядом с ней. Пустая
   * корзина причиной не считается: подсказка об этом уже стоит в самой корзине.
   */
  const blockReason = useMemo((): string => {
    if (!orgUuid) return `${translate("organization")} — ${translate("required")}`;
    if (!warehouseUuid) return `${translate("warehouse")} — ${translate("required")}`;
    if (!buyerUuid && !retailReady) return translate("retailBuyerNotReady");
    if (!isReturn && payment === "cash" && !cashboxUuid) return `${translate("cashbox")} — ${translate("terminalPickInRequisites")}`;
    if (badQty) return translate("terminalBadQty");
    return "";
  }, [orgUuid, warehouseUuid, buyerUuid, retailReady, isReturn, payment, cashboxUuid, badQty]);
  const payReasonId = useId();

  const submit = useCallback(() => runLocked(async () => {
    try {
      const rows = (cartApiRef.current?.getRows() ?? []).filter((r) => r.productUuid);
      const cpUuid = buyerUuid || retailRef.current?.counterpartyUuid || "";
      // Договор «Розничная продажа» — только розничному покупателю. Именному — его договор
      // (основной подставляется при выборе) или без договора: чужой договор сервер отклонял 409 (И5).
      const ctUuid = buyerUuid ? contractUuid : (retailRef.current?.contractUuid || "");
      // Страховка для F9: он зовёт submit в обход выключенной кнопки. Сказать ничего не нужно —
      // причина уже написана под кнопкой.
      if (blockReason || !cpUuid || rows.length === 0 || rows.some((r) => !(Number(r.quantity) > 0))) return;
      setShortage([]);
      setPayError([]);

      // Товар без цены по 0 ₸ — только с явного согласия кассира (И6).
      const zero = unpricedRowNames(rows);
      if (zero.length && !(await confirm(translate("terminalZeroPriceConfirm").replace("{items}", zero.join(", "))))) return;

      // Best practice: контроль остатка ДО создания документа — не оставляем «висящий»
      // непроведённый черновик, а сразу показываем, каких товаров не хватает.
      if (!isReturn) {
        const shortages = await checkStockAvailability({
          organizationUuid: orgUuid || null,
          documentType: "sale",
          warehouseUuid: warehouseUuid || null,
          items: rows.map((r) => ({
            productUuid: String(r.productUuid), quantity: Number(r.quantity) || 0,
            isService: (r.product as { isService?: boolean } | undefined)?.isService === true,
          })),
        });
        // Нехватка — списком над кнопкой, пока корзину не поправят: за 9 секунд тоста не прочитать.
        if (shortages.length) { setShortage(formatStockShortages(shortages).split("\n").filter(Boolean)); return; }
      }

      // Черновик прошлой неудачной попытки — того же режима; иначе он брошен (И4).
      const draft = draftRef.current && draftRef.current.isReturn === isReturn ? draftRef.current.uuid : null;
      const sale = await performTerminalSale({
        isReturn,
        vatRate,
        rows,
        draftUuid: draft,
        onDraft: (uuid) => { draftRef.current = { uuid, isReturn }; setDraftPending(true); },
        header: {
          date: new Date().toISOString(),
          organizationUuid: orgUuid,
          counterpartyUuid: cpUuid,
          contractUuid: ctUuid || null,
          warehouseUuid,
          managerUuid: managerUuid || null,
          ...(isReturn ? {} : { priceTypeUuid: priceTypeUuid || null }),
          // Связь возврата с продажей (basis) — цепочка «Реализация → Возврат».
          ...(isReturn && basisSale ? { basisDocumentType: "sale", basisDocumentUuid: basisSale.uuid, basisDocumentLabel: basisSale.label } : {}),
          ...(comment.trim() ? { comment: comment.trim() } : {}),
        },
      });
      // Проведено: черновика больше нет.
      draftRef.current = null;
      setDraftPending(false);
      const { docUuid, docNumber } = sale;
      const docEndpoint = isReturn ? "sale-returns" : "sales";
      // Итог — как его посчитал сервер (скидка, акциз, НДС сверху), а не как показывала корзина.
      const docTotal = sale.amount ?? total;

      // Нал при ПРОДАЖЕ → проведённый ПКО, СВЯЗАННЫЙ с продажей (basis) → цепочка.
      if (!isReturn && payment === "cash" && docTotal > 0) {
        try {
          const cash = await api.post("cash-receipt-orders", {
            date: new Date().toISOString(),
            organizationUuid: orgUuid,
            counterpartyUuid: cpUuid,
            contractUuid: ctUuid || null,
            cashboxUuid: cashboxUuid || null,
            amount: docTotal,
            posted: true,
            comment: translate("terminalPaymentForSale"),
            basisDocumentType: "sale",
            basisDocumentUuid: docUuid,
            basisDocumentLabel: saleLabel({ number: docNumber, date: new Date().toISOString() }),
          });
          if (isOfflineStub(cash)) throw new TerminalOfflineError();
        } catch (e) {
          reportError(e, { source: translate("salesTerminal"), fallback: translate("terminalCashOrderFailed") });
        }
      }

      // Фискальный чек (продажа) — только по проведённой продаже, а она проведена выше.
      if (!isReturn) {
        try {
          const fr = await api.post<{ item?: Record<string, unknown> }>("fiscal-receipts", {
            documentType: "sale", documentUuid: docUuid, paymentMethod: payment,
          });
          if (isOfflineStub(fr)) throw new TerminalOfflineError();
          if (fr?.item) {
            addPane({
              component: FiscalReceiptPane,
              label: translate("fiscalReceiptTitle"),
              data: {
                receipt: fr.item,
                items: rows.map((r) => ({ name: (r.product as { name?: string })?.name ?? "", quantity: Number(r.quantity) || 0, price: Number(r.price) || 0 })),
                organizationName: orgName,
              },
            });
          }
        } catch (e) {
          // Раньше — пустой catch: QR Kaspi не открывался, а баннер писал «проведена» (И2).
          reportError(e, { source: translate("salesTerminal"), fallback: translate("terminalReceiptFailed") });
        }
      }

      // Inline-баннер успеха (понятно кассиру) + очистка корзины + фокус в поиск.
      showBanner(docNumber, docTotal, isReturn, docUuid, docEndpoint);
      cartApiRef.current?.clear();
      setBasisSale(null);
      setComment("");
      void loadRecent();
      requestAnimationFrame(() => searchWrapRef.current?.querySelector("input")?.focus());
    } catch (e) {
      /*
       * ОТКАЗ ВИДЕН (И2). Раньше — пустой catch «тосты покажет перехватчик», а перехватчик
       * показывает только 403: кассир жал «Оплатить» и не видел ничего. Отказ по существу
       * (остаток, закрытый период, договор) — над кнопкой; нет связи и 5xx — тост и журнал.
       * Корзина остаётся, черновик (если создан) повтор проведёт тот же.
       */
      // Обрыв связи по контракту api-клиента — reject без статуса: routeError отдаёт его тостом и в
      // журнал (над кнопкой остаётся только отказ по существу), а подпись говорит, что продажа не
      // завершена и корзина цела.
      const fallback = isNetworkError(e) ? translate("terminalOffline") : translate("terminalSaleFailed");
      setPayError(routeError(e, { source: translate("salesTerminal"), fallback }));
      void loadRecent();
    }
  }), [runLocked, orgUuid, warehouseUuid, buyerUuid, contractUuid, managerUuid, priceTypeUuid, total, vatRate, payment, cashboxUuid, isReturn, basisSale, addPane, orgName, saleLabel, showBanner, loadRecent, comment, blockReason, confirm]);

  // Горячие клавиши: F9 — провести, F4 — очистить. Только в своей активной панели (И5).
  const handleHotkey = useTerminalHotkeys({ uniqId, getActivePane, onSubmit: () => void submit(), onClear: clearCart });

  const orgParams = useMemo(() => (orgUuid ? { organizationUuid: orgUuid } : undefined), [orgUuid]);

  // Часы в шапке: кассир сверяет время чека, поэтому минуты обновляем сами.
  // Раз в 20 с — секунд в интерфейсе нет, чаще незачем.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 20_000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className={styles.Terminal} tabIndex={-1} onKeyDown={handleHotkey}>
      {/* Шапка: что это за экран, дата-время смены и напоминание про горячие клавиши.
          Раньше экран начинался сразу с поля поиска — кассир не видел ни назначения
          окна, ни времени, по которому сверяет чек. */}
      <header className={styles.Head}>
        <div className={styles.HeadMain}>
          <h1 className={styles.HeadTitle}>{translate("salesTerminal")}</h1>
          <p className={styles.HeadSub}>{translate("terminalSubtitle")}</p>
        </div>
        <div className={styles.HeadMeta}>
          <div className={styles.MetaCard}>
            <span className={styles.MetaLabel}>{getFormatDateOnly(now.toISOString())}</span>
            <span className={styles.MetaValue}>{now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
          </div>
          <div className={styles.MetaCard}>
            <span className={styles.MetaLabel}>{translate("terminalHotkeys")}</span>
            <span className={styles.MetaHint}>F9 · F4</span>
          </div>
        </div>
      </header>

      <div className={styles.Body}>
      {/* ЛЕВО: поиск + корзина, ИЛИ просмотр выбранной продажи */}
      <div className={styles.Left}>
        {viewSale ? (
          <div className={styles.ViewPane}>
            <div className={styles.ViewHead}>
              <div className={styles.ViewTitle}>
                {saleLabel(viewSale)} · <b>{fmt(viewSale.amount)} ₸</b>
              </div>
              <div className={styles.ViewActions}>
                <Button size="sm" onClick={() => void printReceipt(viewSale)} disabled={!viewSale.posted}
                  title={viewSale.posted ? undefined : translate("terminalDraftNoReceipt")}>🧾 {translate("terminalPrintReceipt")}</Button>
                <Button size="sm" variant="secondary" onClick={() => openDoc("sales", viewSale.uuid, saleLabel(viewSale))}>✎ {translate("edit")}</Button>
                <Button size="sm" variant="secondary" onClick={() => returnFromSale(viewSale)}>↩ {translate("terminalReturnBased")}</Button>
                <Button size="sm" variant="secondary" onClick={closeSaleView}>✕ {translate("close")}</Button>
              </div>
            </div>
            <div className={styles.ViewTable}>
              <div className={[styles.ViewRow, styles.ViewRowHead].join(" ")}>
                <span>{translate("product")}</span><span>{translate("quantity")}</span><span>{translate("price")}</span><span>{translate("amount")}</span>
              </div>
              {viewSale.items.map((it, i) => (
                <div key={i} className={styles.ViewRow}>
                  <span className={styles.ViewName}>{it.name}</span>
                  <span>{fmt(it.quantity)}</span><span>{fmt(it.price)}</span><span>{fmt(it.amount)}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <>
            <div ref={searchWrapRef} className={styles.Search}>
              <LookupField
                label={translate("terminalAddProduct")}
                name="terminal_product"
                placeholder={translate("terminalSearchPlaceholder")}
                value="" displayValue="" endpoint="products" displayField="name" autoFocus
                onSelect={(u, d, item) => addProduct(u, d, (item as Record<string, unknown>) ?? {})}
                extraParams={orgParams}
              />
              {addError && <Notice inline wide items={[{ type: "warning", text: addError }]} />}
            </div>
            <div className={styles.CartWrap}>
              {cartCount === 0 && (
                <div className={styles.Empty} aria-hidden>
                  <div className={styles.EmptyIcon}>🛒</div>
                  <div className={styles.EmptyTitle}>{translate("terminalEmptyTitle")}</div>
                  <div className={styles.EmptyText}>{translate("terminalEmptyHint")}</div>
                  <div className={styles.EmptyCards}>
                    <div className={styles.EmptyCard}>
                      <span className={styles.EmptyCardIcon}>🔍</span>
                      <span className={styles.EmptyCardTitle}>{translate("terminalHintSearch")}</span>
                      <span className={styles.EmptyCardText}>{translate("terminalHintSearchText")}</span>
                    </div>
                    <div className={styles.EmptyCard}>
                      <span className={styles.EmptyCardIcon}>▥</span>
                      <span className={styles.EmptyCardTitle}>{translate("terminalHintScan")}</span>
                      <span className={styles.EmptyCardText}>{translate("terminalHintScanText")}</span>
                    </div>
                    <div className={styles.EmptyCard}>
                      <span className={styles.EmptyCardIcon}>＋</span>
                      <span className={styles.EmptyCardTitle}>{translate("terminalHintManual")}</span>
                      <span className={styles.EmptyCardText}>{translate("terminalHintManualText")}</span>
                    </div>
                  </div>
                </div>
              )}
              <TradeDocumentItemsTable
                parentUuid="" parentField="saleUuid" endpoint="saleitems" componentName="TerminalCart"
                organizationUuid={orgUuid} priceTypeUuid={priceTypeUuid}
                deferRemoteChanges initialPendingRows={EMPTY_ROWS} apiRef={cartApiRef} quantityStepper
                onTotalChange={handleTableTotal} emptyMessage={translate("terminalEmptyHint")}
                rowActions={(row, ctx) => (
                  <FieldActionButton icon="trash" label={translate("delete")} onClick={() => void ctx.removeRow(row)} />
                )}
              />
            </div>
          </>
        )}
      </div>

      {/* ПРАВО: все элементы распределены по вкладкам <Tabs/> (Оплата / Реквизиты / Продажи) */}
      <div className={styles.Right}>
        <Tabs
          tabs={[
            {
              id: "checkout",
              label: translate("terminalTabCheckout"),
              component: (
                <div className={styles.TabBody}>
                  {/* Режим */}
                  <div className={styles.FieldLabel}>{translate("terminalOperationType")}</div>
                  <div className={styles.Segmented}>
                    <button type="button" className={[styles.Seg, !isReturn && styles.SegOn].filter(Boolean).join(" ")} onClick={() => { if (isReturn) dropDraft(); setMode("sale"); setBasisSale(null); }}>🛒 {translate("terminalModeSale")}</button>
                    <button type="button" className={[styles.Seg, isReturn && styles.SegReturnOn].filter(Boolean).join(" ")} onClick={() => { if (!isReturn) dropDraft(); setMode("return"); }}>↩ {translate("terminalModeReturn")}</button>
                  </div>
                  {basisSale && isReturn && (
                    <div className={styles.BasisChip}>{translate("basisDocument")}: {basisSale.label}</div>
                  )}
                  {/* Оплата (только продажа) */}
                  {!isReturn && (
                    <>
                    <div className={styles.FieldLabel}>{translate("terminalPaymentMethod")}</div>
                    <div className={styles.Segmented}>
                      <button type="button" className={[styles.Seg, payment === "cash" && styles.SegOn].filter(Boolean).join(" ")} onClick={() => setPayment("cash")}>💵 {translate("paymentCash")}</button>
                      <button type="button" className={[styles.Seg, payment === "card" && styles.SegOn].filter(Boolean).join(" ")} onClick={() => setPayment("card")}>💳 {translate("paymentCard")}</button>
                      <button type="button" className={[styles.Seg, payment === "kaspi" && styles.SegOn].filter(Boolean).join(" ")} onClick={() => setPayment("kaspi")}>🔴 {translate("paymentKaspi")}</button>
                    </div>
                    </>
                  )}

                  {/* Покупатель и комментарий — прямо в оформлении: раньше за покупателем
                      нужно было уходить во вкладку «Реквизиты», а комментарий к продаже
                      вписать было негде вовсе. Поле то же самое — состояние одно. */}
                  {saleInfoOpen && (
                  <section className={styles.Card}>
                    <div className={styles.CardHead}>
                      <span>{translate("terminalSaleInfo")}</span>
                      <button type="button" className={styles.CardClose} aria-label={translate("close")}
                        onClick={() => setSaleInfoOpen(false)}>✕</button>
                    </div>
                    <div className={styles.CardBody}>
                      <LookupField
                        label={translate("terminalNamedBuyer")} name="t_buyer_checkout"
                        placeholder={translate("terminalBuyerOptional")}
                        value={buyerUuid} displayValue={buyerName}
                        endpoint="counterparties" displayField="name"
                        onSelect={(u, d) => { void selectBuyer(u, d); }}
                        onClear={() => { void selectBuyer("", ""); }}
                      />
                      <Field
                        label={translate("Comment")} name="t_comment" value={comment}
                        placeholder={translate("terminalCommentPlaceholder")}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setComment(e.target.value)}
                      />
                    </div>
                  </section>
                  )}
                  {!saleInfoOpen && (
                    // Закрытую карточку можно вернуть: покупатель и комментарий из неё уходят в продажу,
                    // и работать с ними вслепую нельзя.
                    <button type="button" className={styles.CardReopen} onClick={() => setSaleInfoOpen(true)}>
                      {translate("terminalSaleInfo")}{buyerName || comment.trim() ? ` · ${[buyerName, comment.trim()].filter(Boolean).join(" · ")}` : ""}
                    </button>
                  )}

                  <div className={styles.InfoNote}>{translate("terminalRequisitesNote")}</div>

                  <div className={styles.Summary}>
                    <div className={styles.SummaryRow}><span>{translate("terminalItemsInReceipt")}</span><span>{cartCount}</span></div>
                    <div className={styles.TotalRow}><span>{translate("total")}</span><span className={styles.TotalAmount}>{fmt(total)} ₸</span></div>
                  </div>

                  {banner && (
                    <div className={[styles.Banner, banner.isReturn && styles.BannerReturn].filter(Boolean).join(" ")} role="status">
                      <span className={styles.BannerCheck}>✓</span>
                      <span className={styles.BannerText}>
                        {translate(banner.isReturn ? "terminalReturnDone" : "terminalDone")}{banner.number ? ` № ${banner.number}` : ""} — {fmt(banner.total)} ₸
                      </span>
                      <button type="button" className={styles.BannerLink} onClick={() => openDoc(banner.endpoint, banner.uuid, saleLabel({ number: banner.number }))}>{translate("open")}</button>
                      <button type="button" className={styles.BannerClose} aria-label={translate("close")} onClick={() => setBanner(null)}>✕</button>
                    </div>
                  )}

                  <Notice inline wide items={shortage.map((text) => ({ type: "error" as const, text }))} />
                  {/* Отказ оплаты по существу, незавершённая продажа, цены (И2, И4, И6). */}
                  <Notice inline wide items={[
                    ...payError,
                    ...(draftPending ? [{ type: "warning" as const, text: translate("terminalDraftPending") }] : []),
                    ...(priceListFailed ? [{ type: "warning" as const, text: translate("terminalPriceListFailed") }] : []),
                    ...(unpriced.length ? [{ type: "warning" as const, text: `${translate("terminalNoPrice")}: ${unpriced.join(", ")}` }] : []),
                  ]} />

                  <div className={styles.Actions}>
                    <Button variant="secondary" onClick={clearCart} disabled={submitting || cartCount === 0}>{translate("terminalClear")} (F4)</Button>
                    <button type="button" className={[styles.PayBtn, isReturn && styles.PayBtnReturn].filter(Boolean).join(" ")} onClick={() => void submit()}
                      disabled={submitting || cartCount === 0 || !!blockReason}
                      title={blockReason || undefined} aria-describedby={blockReason ? payReasonId : undefined}>
                      {submitting ? translate("loading") : `${translate(isReturn ? "terminalCheckoutReturn" : "terminalCheckout")} (F9)`}
                    </button>
                  </div>
                  {blockReason && <div id={payReasonId} className={styles.PayBlockReason}>{blockReason}</div>}
                </div>
              ),
            },
            {
              id: "requisites",
              label: translate("terminalTabRequisites"),
              component: (
                <div className={[styles.TabBody, styles.Fields].join(" ")}>
                  <LookupField label={translate("organization")} name="t_org" value={orgUuid} displayValue={orgName}
                    endpoint="organizations" displayField="name"
                    onSelect={(u, d) => { void handleOrgChange(u, d); }} onClear={() => { void handleOrgChange("", ""); }} />
                  <LookupField label={translate("warehouse")} name="t_wh" value={warehouseUuid} displayValue={warehouseName}
                    endpoint="warehouses" displayField="name" extraParams={orgParams}
                    onSelect={(u, d) => setRequisites({ warehouseUuid: u, warehouseName: d })} onClear={() => setRequisites({ warehouseUuid: "", warehouseName: "" })} />
                  <LookupField label={translate("manager")} name="t_mgr" value={managerUuid} displayValue={managerName}
                    endpoint="employees" displayField="fullName" extraParams={orgParams}
                    onSelect={(u, d) => { setManagerUuid(u); setManagerName(d); }} onClear={() => { setManagerUuid(""); setManagerName(""); }} />
                  <LookupField label={translate("priceType")} name="t_pt" value={priceTypeUuid} displayValue={priceTypeName}
                    endpoint="price-types" displayField="name"
                    onSelect={(u, d) => { setRequisites({ priceTypeUuid: u, priceTypeName: d }); void loadPriceMap(u, true); }}
                    onClear={() => { setRequisites({ priceTypeUuid: "", priceTypeName: "" }); void loadPriceMap("", true); }} />
                  <LookupField label={translate("terminalNamedBuyer")} name="t_buyer" value={buyerUuid} displayValue={buyerName}
                    endpoint="counterparties" displayField="name"
                    onSelect={(u, d) => { void selectBuyer(u, d); }}
                    onClear={() => { void selectBuyer("", ""); }} />
                  {buyerUuid && (
                    <LookupField label={translate("contract")} name="t_contract" value={contractUuid} displayValue={contractName}
                      endpoint="contracts" displayField="name"
                      onSelect={(u, d) => setRequisites({ contractUuid: u, contractName: d })}
                      onClear={() => setRequisites({ contractUuid: "", contractName: "" })}
                      extraParams={{ ...(orgParams ?? {}), counterpartyUuid: buyerUuid }} />
                  )}
                  <LookupField label={translate("cashbox")} name="t_cashbox" value={cashboxUuid} displayValue={cashboxName}
                    endpoint="cashboxes" displayField="name" extraParams={orgParams}
                    onSelect={(u, d) => setRequisites({ cashboxUuid: u, cashboxName: d })} onClear={() => setRequisites({ cashboxUuid: "", cashboxName: "" })} />
                </div>
              ),
            },
            {
              id: "recent",
              label: translate("terminalRecentSales"),
              component: (
                <div className={[styles.TabBody, styles.Recent].join(" ")}>
                  <div className={styles.RecentList}>
                    {recent.length === 0 && <div className={styles.RecentEmpty}>—</div>}
                    {recent.map((s) => (
                      <button
                        key={s.uuid} type="button"
                        className={[styles.RecentItem, viewSale?.uuid === s.uuid && styles.RecentItemOn].filter(Boolean).join(" ")}
                        onClick={() => void openSaleView(s)}
                      >
                        <span className={styles.RecentNum}>{s.number ? `№ ${s.number}` : translate("docNoNumber")}{s.posted === false ? ` · ${translate("draft")}` : ""}</span>
                        <span className={styles.RecentDate}>{s.date ? getFormatDateOnly(String(s.date)) : ""}</span>
                        <span className={styles.RecentAmt}>{fmt(Number(s.amount) || 0)} ₸</span>
                      </button>
                    ))}
                  </div>
                </div>
              ),
            },
          ]}
        />
      </div>
      </div>
    </div>
  );
};

SalesTerminalV2.displayName = "SalesTerminalV2";
export { SalesTerminalV2 };
export default SalesTerminalV2;

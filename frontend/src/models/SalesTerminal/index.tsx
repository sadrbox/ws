/**
 * SalesTerminal — терминал кассира для быстрой розничной продажи.
 *
 * Сценарий: продавец ищет/сканирует товары → корзина → одной кнопкой создаёт
 * ПРОВЕДЁННУЮ реализацию + оплату (ПКО для налички, СВЯЗАННЫЙ с продажей) +
 * фискальный чек. Продажа населению: по умолчанию «Розничный покупатель».
 *
 * Связь документов (best practice, DOC_REGISTRY): платёж (ПКО) и возврат ссылаются
 * на продажу через basisDocumentType/Uuid — цепочка «Реализация → ПКО / Возврат»
 * прослеживается кнопкой «Цепочка».
 *
 * Область «Недавние продажи»: клик (activeRow) → товары продажи в левой таблице
 * (просмотр) + «Печать чека» / «Возврат на основании».
 */
import { FC, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { translate } from "src/i18";
import { api } from "src/services/api/client";
import { showToast } from "src/components/UIToast";
import LookupField from "src/components/Field/LookupField";
import FieldActionButton from "src/components/Field/FieldActionButton";
import { Button } from "src/components/Button";
import TradeDocumentItemsTable from "src/components/DocumentItemsTable/TradeDocumentItemsTable";
import type { SubTableApi } from "src/components/SubTable";
import type { TDataItem } from "src/components/Table/types";
import { usePersistentState } from "src/hooks/usePersistentState";
import { useDefaultOrganization } from "src/hooks/useDefaultOrganization";
import { resolveOrgChangeFields } from "src/utils/createFromBasis";
import { useOrgAccountingSettings } from "src/hooks/useOrgAccountingSettings";
import { useAppContext } from "src/app/context";
import { recalcSaleItemAmounts } from "src/models/Sales/saleItemDraft";
import FiscalReceiptPane from "src/models/FiscalReceipts/FiscalReceiptPane";
import { getFormatDateOnly } from "src/utils/datetime";
import { checkStockAvailability, formatStockShortages } from "src/utils/stockControl";
import { openFormByRef } from "src/utils/openFormByRef";
import Tabs from "src/components/Tabs";
import type { TPane } from "src/app/types";
import styles from "./SalesTerminal.module.scss";

const EMPTY_ROWS: TDataItem[] = []; // стабильная ссылка для initialPendingRows

const fmt = (n: number) =>
  Number(n || 0).toLocaleString("ru-KZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface RetailRef { counterpartyUuid: string; counterpartyName: string; contractUuid: string }
interface RecentSale { uuid: string; number?: string | null; date?: string | null; amount?: number | null; counterparty?: { name?: string } | null }
interface ViewItem { name: string; quantity: number; price: number; amount: number }
interface ViewSale { uuid: string; number: string; date?: string | null; amount: number; items: ViewItem[]; rawItems: TDataItem[] }

const SalesTerminal: FC<Partial<TPane>> = () => {
  const { organizationUuid: defOrgUuid, organizationName: defOrgName } = useDefaultOrganization();
  const { auth: { user }, windows: { addPane } } = useAppContext();

  const [orgUuid, setOrgUuid] = useState(defOrgUuid || "");
  const [orgName, setOrgName] = useState(defOrgName || "");
  const [warehouseUuid, setWarehouseUuid] = usePersistentState("terminal.warehouseUuid", "");
  const [warehouseName, setWarehouseName] = usePersistentState("terminal.warehouseName", "");
  const [managerUuid, setManagerUuid] = useState((user as { employee?: { uuid?: string } })?.employee?.uuid ?? "");
  const [managerName, setManagerName] = useState((user as { employee?: { fullName?: string } })?.employee?.fullName ?? "");
  const [priceTypeUuid, setPriceTypeUuid] = usePersistentState("terminal.priceTypeUuid", "");
  const [priceTypeName, setPriceTypeName] = usePersistentState("terminal.priceTypeName", "");
  const [cashboxUuid, setCashboxUuid] = usePersistentState("terminal.cashboxUuid", "");
  const [cashboxName, setCashboxName] = usePersistentState("terminal.cashboxName", "");

  const [buyerUuid, setBuyerUuid] = useState("");
  const [buyerName, setBuyerName] = useState("");
  const [contractUuid, setContractUuid] = useState("");
  const [contractName, setContractName] = useState("");

  // Розничный покупатель + договор по умолчанию (для submit; имя не отображаем).
  const retailRef = useRef<RetailRef | null>(null);
  useEffect(() => {
    let cancelled = false;
    api.get<{ counterparty?: { uuid: string; name: string }; contract?: { uuid: string } }>("counterparties/retail")
      .then((r) => {
        if (cancelled || !r?.counterparty) return;
        retailRef.current = { counterpartyUuid: r.counterparty.uuid, counterpartyName: r.counterparty.name, contractUuid: r.contract?.uuid ?? "" };
      })
      .catch(() => { });
    return () => { cancelled = true; };
  }, []);

  const [mode, setMode] = useState<"sale" | "return">("sale");
  const isReturn = mode === "return";
  const [payment, setPayment] = useState<"cash" | "card" | "kaspi">("cash");
  const [submitting, setSubmitting] = useState(false);

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
  const priceTypeUuidRef = useRef(priceTypeUuid);
  priceTypeUuidRef.current = priceTypeUuid;

  // ── Недавние продажи ─────────────────────────────────────────────────────
  const loadRecent = useCallback(async () => {
    try {
      const params: Record<string, string> = { limit: "20" };
      if (orgUuid) params["filter[organizationUuid][equals]"] = orgUuid;
      const resp = await api.get<{ items?: RecentSale[] }>("sales", { params });
      setRecent(resp?.items ?? []);
    } catch { /* перехватчик api покажет ошибку */ }
  }, [orgUuid]);
  useEffect(() => { void loadRecent(); }, [loadRecent]);

  const loadPriceMap = useCallback(async (typeUuid: string, reprice: boolean) => {
    try {
      const params: Record<string, string> = {};
      if (orgUuid) params.organizationUuid = orgUuid;
      if (typeUuid) params.priceTypeUuid = typeUuid;
      const resp = await api.get<{ priceTypeUuid: string | null; priceTypeName: string | null; items: Array<{ productUuid: string; price: number | null }> }>(
        "product-prices/price-list", { params },
      );
      const map = new Map<string, number>();
      for (const it of resp?.items ?? []) if (it.price != null) map.set(it.productUuid, Number(it.price));
      priceMapRef.current = map;
      if (!typeUuid && resp?.priceTypeUuid) { setPriceTypeUuid(resp.priceTypeUuid); setPriceTypeName(resp.priceTypeName ?? ""); }
      if (reprice && cartApiRef.current) {
        for (const r of cartApiRef.current.getRows()) {
          const p = map.get(String(r.productUuid));
          if (p != null) {
            const calc = recalcSaleItemAmounts(Number(r.quantity) || 0, p, vatRate, 0, vatMethod, 0);
            cartApiRef.current.updateRow(r, { price: p, ...calc });
          }
        }
      }
    } catch { /* перехватчик api покажет ошибку */ }
  }, [orgUuid, vatRate, vatMethod, setPriceTypeUuid, setPriceTypeName]);

  useEffect(() => { void loadPriceMap(priceTypeUuidRef.current, false); }, [loadPriceMap]);

  const handleOrgChange = useCallback(async (u: string, d: string) => {
    setOrgUuid(u);
    setOrgName(d);
    setManagerUuid(""); setManagerName("");
    setBuyerUuid(""); setBuyerName("");
    setContractUuid(""); setContractName("");
    const patch = await resolveOrgChangeFields(u, userUuid, [
      { valueType: "warehouse", uuidKey: "warehouseUuid", nameKey: "warehouseName" },
      { valueType: "cashbox", uuidKey: "cashboxUuid", nameKey: "cashboxName" },
      { valueType: "salePriceType", uuidKey: "priceTypeUuid", nameKey: "priceTypeName" },
    ]);
    setWarehouseUuid(patch.warehouseUuid ?? ""); setWarehouseName(patch.warehouseName ?? "");
    setCashboxUuid(patch.cashboxUuid ?? ""); setCashboxName(patch.cashboxName ?? "");
    setPriceTypeUuid(patch.priceTypeUuid ?? ""); setPriceTypeName(patch.priceTypeName ?? "");
    void loadPriceMap(patch.priceTypeUuid ?? "", true);
  }, [userUuid, loadPriceMap, setWarehouseUuid, setWarehouseName, setCashboxUuid, setCashboxName, setPriceTypeUuid, setPriceTypeName]);

  const addProduct = useCallback((uuid: string, name: string, item: Record<string, unknown>) => {
    if (!uuid) return;
    const cart = cartApiRef.current;
    if (!cart) return;
    const existing = cart.getRows().find((r) => r.productUuid === uuid);
    if (existing) {
      const q = (Number(existing.quantity) || 0) + 1;
      const calc = recalcSaleItemAmounts(q, Number(existing.price) || 0, vatRate, 0, vatMethod, 0);
      cart.updateRow(existing, { quantity: q, ...calc });
      return;
    }
    const price = priceMapRef.current.get(uuid) ?? 0;
    const calc = recalcSaleItemAmounts(1, price, vatRate, 0, vatMethod, 0);
    const umUuid = (item?.unitOfMeasureUuid as string) ?? null;
    const um = item?.unitOfMeasure as { name?: string } | undefined;
    cart.addRow({
      productUuid: uuid,
      product: { uuid, name: name || (item?.name as string) || "" },
      quantity: 1,
      price,
      unitOfMeasureUuid: umUuid,
      unitOfMeasure: umUuid ? { uuid: umUuid, name: um?.name ?? "" } : null,
      vatRate: vatRate || 0,
      ...calc,
    });
  }, [vatRate, vatMethod]);

  const clearCart = useCallback(() => { cartApiRef.current?.clear(); setBasisSale(null); }, []);

  const handleTableTotal = useCallback((t: number, items?: TDataItem[]) => {
    setTotal(t);
    setCartCount((items ?? []).length);
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
      setViewSale({ uuid: s.uuid, number: num, date: s.date, amount: Number(s.amount) || 0, items, rawItems: raw });
    } catch { /* перехватчик api */ }
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
    for (const r of v.rawItems) {
      const calc = recalcSaleItemAmounts(Number(r.quantity) || 0, Number(r.price) || 0, vatRate, 0, vatMethod, 0);
      cart.addRow({
        productUuid: r.productUuid,
        product: r.product ?? { uuid: r.productUuid, name: (r.product as { name?: string } | undefined)?.name ?? "" },
        quantity: Number(r.quantity) || 0,
        price: Number(r.price) || 0,
        unitOfMeasureUuid: r.unitOfMeasureUuid ?? null,
        unitOfMeasure: r.unitOfMeasure ?? null,
        vatRate: r.vatRate != null ? Number(r.vatRate) : (vatRate || 0),
        ...calc,
      });
    }
    setMode("return");
    setBasisSale({ uuid: v.uuid, label: saleLabel(v) });
    setViewSale(null);
  }, [vatRate, vatMethod, saleLabel]);

  const printReceipt = useCallback(async (v: ViewSale) => {
    try {
      const fr = await api.post<{ item?: Record<string, unknown> }>("fiscal-receipts", {
        documentType: "sale", documentUuid: v.uuid, paymentMethod: "cash",
      });
      if (fr?.item) {
        addPane({
          component: FiscalReceiptPane,
          label: translate("fiscalReceiptTitle"),
          data: { receipt: fr.item, items: v.items.map((i) => ({ name: i.name, quantity: i.quantity, price: i.price })), organizationName: orgName },
        });
      }
    } catch { /* перехватчик api */ }
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

  const submit = useCallback(async () => {
    const rows = (cartApiRef.current?.getRows() ?? []).filter((r) => r.productUuid);
    const cpUuid = buyerUuid || retailRef.current?.counterpartyUuid || "";
    const ctUuid = contractUuid || retailRef.current?.contractUuid || "";
    if (!orgUuid) { showToast(translate("organization") + " — " + translate("required"), "error"); return; }
    if (!warehouseUuid) { showToast(translate("warehouse") + " — " + translate("required"), "error"); return; }
    if (!cpUuid) { showToast(translate("retailBuyerNotReady"), "error"); return; }
    if (!isReturn && payment === "cash" && !cashboxUuid) { showToast(translate("cashbox") + " — " + translate("terminalPickInRequisites"), "error"); return; }
    if (rows.length === 0) { showToast(translate("terminalEmptyCart"), "error"); return; }
    if (rows.some((r) => !(Number(r.quantity) > 0))) { showToast(translate("terminalBadQty"), "error"); return; }

    // Best practice: контроль остатка ДО создания документа — не оставляем «висящий»
    // непроведённый черновик, а сразу показываем, каких товаров не хватает.
    if (!isReturn) {
      const shortages = await checkStockAvailability({
        organizationUuid: orgUuid || null,
        documentType: "sale",
        warehouseUuid: warehouseUuid || null,
        items: rows.map((r) => ({ productUuid: String(r.productUuid), quantity: Number(r.quantity) || 0 })),
      });
      if (shortages.length) { showToast(formatStockShortages(shortages), "error", 9000); return; }
    }

    const docEndpoint = isReturn ? "sale-returns" : "sales";
    const itemsEndpoint = isReturn ? "sale-return-items/batch" : "saleitems/batch";
    const parentField = isReturn ? "saleReturnUuid" : "saleUuid";

    setSubmitting(true);
    try {
      const resp = await api.post<{ item?: { uuid?: string; number?: string } }>(docEndpoint, {
        date: new Date().toISOString(),
        organizationUuid: orgUuid,
        counterpartyUuid: cpUuid,
        contractUuid: ctUuid || null,
        warehouseUuid,
        managerUuid: managerUuid || null,
        ...(isReturn ? {} : { priceTypeUuid: priceTypeUuid || null }),
        // Связь возврата с продажей (basis) — цепочка «Реализация → Возврат».
        ...(isReturn && basisSale ? { basisDocumentType: "sale", basisDocumentUuid: basisSale.uuid, basisDocumentLabel: basisSale.label } : {}),
        posted: false,
      });
      const docUuid = resp?.item?.uuid;
      if (!docUuid) throw new Error(translate("serverError"));

      await api.post(itemsEndpoint, {
        operations: rows.map((r) => ({
          action: "create",
          data: {
            [parentField]: docUuid,
            productUuid: r.productUuid,
            quantity: Number(r.quantity) || 0,
            price: Number(r.price) || 0,
            vatRate: r.vatRate != null ? Number(r.vatRate) : vatRate,
            unitOfMeasureUuid: r.unitOfMeasureUuid || null,
          },
        })),
      });

      const posted = await api.put<{ item?: { number?: string } }>(`${docEndpoint}/${docUuid}`, { posted: true });
      const docNumber = posted?.item?.number ?? resp?.item?.number ?? "";

      // Нал при ПРОДАЖЕ → проведённый ПКО, СВЯЗАННЫЙ с продажей (basis) → цепочка.
      if (!isReturn && payment === "cash" && total > 0) {
        try {
          await api.post("cash-receipt-orders", {
            date: new Date().toISOString(),
            organizationUuid: orgUuid,
            counterpartyUuid: cpUuid,
            cashboxUuid: cashboxUuid || null,
            amount: total,
            posted: true,
            comment: translate("terminalPaymentForSale"),
            basisDocumentType: "sale",
            basisDocumentUuid: docUuid,
            basisDocumentLabel: saleLabel({ number: docNumber, date: new Date().toISOString() }),
          });
        } catch {
          showToast(translate("terminalCashOrderFailed"), "error", 6000);
        }
      }

      // Фискальный чек (продажа).
      if (!isReturn) {
        try {
          const fr = await api.post<{ item?: Record<string, unknown> }>("fiscal-receipts", {
            documentType: "sale", documentUuid: docUuid, paymentMethod: payment,
          });
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
        } catch { /* перехватчик api */ }
      }

      // Inline-баннер успеха (понятно кассиру) + очистка корзины + фокус в поиск.
      showBanner(docNumber, total, isReturn, docUuid, docEndpoint);
      cartApiRef.current?.clear();
      setBasisSale(null);
      void loadRecent();
      requestAnimationFrame(() => searchWrapRef.current?.querySelector("input")?.focus());
    } catch {
      // Тосты ошибок (422/409/500) показывает перехватчик api-клиента.
    } finally {
      setSubmitting(false);
    }
  }, [orgUuid, warehouseUuid, buyerUuid, contractUuid, managerUuid, priceTypeUuid, total, vatRate, payment, cashboxUuid, isReturn, basisSale, addPane, orgName, saleLabel, showBanner, loadRecent]);

  // Горячие клавиши: F9 — провести, F4 — очистить.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F9") { e.preventDefault(); void submit(); }
      else if (e.key === "F4") { e.preventDefault(); clearCart(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [submit, clearCart]);

  const orgParams = useMemo(() => (orgUuid ? { organizationUuid: orgUuid } : undefined), [orgUuid]);

  return (
    <div className={styles.Terminal}>
      {/* ЛЕВО: поиск + корзина, ИЛИ просмотр выбранной продажи */}
      <div className={styles.Left}>
        {viewSale ? (
          <div className={styles.ViewPane}>
            <div className={styles.ViewHead}>
              <div className={styles.ViewTitle}>
                {saleLabel(viewSale)} · <b>{fmt(viewSale.amount)} ₸</b>
              </div>
              <div className={styles.ViewActions}>
                <Button size="sm" onClick={() => void printReceipt(viewSale)}>🧾 {translate("terminalPrintReceipt")}</Button>
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
            <div ref={searchWrapRef}>
              <LookupField
                label={translate("terminalAddProduct")}
                name="terminal_product"
                value="" displayValue="" endpoint="products" displayField="name" autoFocus
                onSelect={(u, d, item) => addProduct(u, d, (item as Record<string, unknown>) ?? {})}
                extraParams={orgParams}
              />
            </div>
            <div className={styles.CartWrap}>
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
                  <div className={styles.Segmented}>
                    <button type="button" className={[styles.Seg, !isReturn && styles.SegOn].filter(Boolean).join(" ")} onClick={() => { setMode("sale"); setBasisSale(null); }}>🛒 {translate("terminalModeSale")}</button>
                    <button type="button" className={[styles.Seg, isReturn && styles.SegReturnOn].filter(Boolean).join(" ")} onClick={() => setMode("return")}>↩ {translate("terminalModeReturn")}</button>
                  </div>
                  {basisSale && isReturn && (
                    <div className={styles.BasisChip}>{translate("basisDocument")}: {basisSale.label}</div>
                  )}
                  {/* Оплата (только продажа) */}
                  {!isReturn && (
                    <div className={styles.Segmented}>
                      <button type="button" className={[styles.Seg, payment === "cash" && styles.SegOn].filter(Boolean).join(" ")} onClick={() => setPayment("cash")}>💵 {translate("paymentCash")}</button>
                      <button type="button" className={[styles.Seg, payment === "card" && styles.SegOn].filter(Boolean).join(" ")} onClick={() => setPayment("card")}>💳 {translate("paymentCard")}</button>
                      <button type="button" className={[styles.Seg, payment === "kaspi" && styles.SegOn].filter(Boolean).join(" ")} onClick={() => setPayment("kaspi")}>🔴 {translate("paymentKaspi")}</button>
                    </div>
                  )}

                  <div className={styles.Summary}>
                    <div className={styles.SummaryRow}><span>{translate("terminalPositions")}</span><span>{cartCount}</span></div>
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

                  <div className={styles.Actions}>
                    <Button variant="secondary" onClick={clearCart} disabled={submitting || cartCount === 0}>{translate("terminalClear")} (F4)</Button>
                    <button type="button" className={[styles.PayBtn, isReturn && styles.PayBtnReturn].filter(Boolean).join(" ")} onClick={() => void submit()} disabled={submitting || cartCount === 0}>
                      {submitting ? translate("loading") : `${translate(isReturn ? "terminalCheckoutReturn" : "terminalCheckout")} (F9)`}
                    </button>
                  </div>
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
                    onSelect={(u, d) => { setWarehouseUuid(u); setWarehouseName(d); }} onClear={() => { setWarehouseUuid(""); setWarehouseName(""); }} />
                  <LookupField label={translate("manager")} name="t_mgr" value={managerUuid} displayValue={managerName}
                    endpoint="employees" displayField="fullName" extraParams={orgParams}
                    onSelect={(u, d) => { setManagerUuid(u); setManagerName(d); }} onClear={() => { setManagerUuid(""); setManagerName(""); }} />
                  <LookupField label={translate("priceType")} name="t_pt" value={priceTypeUuid} displayValue={priceTypeName}
                    endpoint="price-types" displayField="name"
                    onSelect={(u, d) => { setPriceTypeUuid(u); setPriceTypeName(d); void loadPriceMap(u, true); }}
                    onClear={() => { setPriceTypeUuid(""); setPriceTypeName(""); void loadPriceMap("", true); }} />
                  <LookupField label={translate("terminalNamedBuyer")} name="t_buyer" value={buyerUuid} displayValue={buyerName}
                    endpoint="counterparties" displayField="name"
                    onSelect={(u, d) => { setBuyerUuid(u); setBuyerName(d); setContractUuid(""); setContractName(""); }}
                    onClear={() => { setBuyerUuid(""); setBuyerName(""); setContractUuid(""); setContractName(""); }} />
                  {buyerUuid && (
                    <LookupField label={translate("contract")} name="t_contract" value={contractUuid} displayValue={contractName}
                      endpoint="contracts" displayField="name"
                      onSelect={(u, d) => { setContractUuid(u); setContractName(d); }}
                      onClear={() => { setContractUuid(""); setContractName(""); }}
                      extraParams={{ ...(orgParams ?? {}), counterpartyUuid: buyerUuid }} />
                  )}
                  <LookupField label={translate("cashbox")} name="t_cashbox" value={cashboxUuid} displayValue={cashboxName}
                    endpoint="cashboxes" displayField="name" extraParams={orgParams}
                    onSelect={(u, d) => { setCashboxUuid(u); setCashboxName(d); }} onClear={() => { setCashboxUuid(""); setCashboxName(""); }} />
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
                        <span className={styles.RecentNum}>{s.number ? `№ ${s.number}` : translate("docNoNumber")}</span>
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
  );
};

SalesTerminal.displayName = "SalesTerminal";
export { SalesTerminal };
export default SalesTerminal;

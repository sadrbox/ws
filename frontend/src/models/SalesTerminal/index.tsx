/**
 * SalesTerminal — терминал кассира для быстрой розничной продажи.
 *
 * Сценарий: продавец сканирует/ищет товары → корзина (SubTable с контролами) →
 * одной кнопкой создаёт ПРОВЕДЁННУЮ реализацию + ПКО (нал) + фискальный чек.
 * Продажа НАСЕЛЕНИЮ: по умолчанию контрагент «Розничный покупатель» (договор по
 * умолчанию) — выбирать не нужно; при необходимости можно указать именного покупателя.
 *
 * Поток: POST /sales (черновик) → POST /saleitems/batch → PUT posted:true → ПКО → чек.
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
import { useOrgAccountingSettings } from "src/hooks/useOrgAccountingSettings";
import { useAppContext } from "src/app";
import { recalcSaleItemAmounts } from "src/models/Sales/saleItemDraft";
import FiscalReceiptPane from "src/models/FiscalReceipts/FiscalReceiptPane";
import type { TPane } from "src/app/types";
import styles from "./SalesTerminal.module.scss";

const EMPTY_ROWS: TDataItem[] = []; // стабильная ссылка для initialPendingRows

const fmt = (n: number) =>
  Number(n || 0).toLocaleString("ru-KZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface RetailRef { counterpartyUuid: string; counterpartyName: string; contractUuid: string }

const SalesTerminal: FC<Partial<TPane>> = () => {
  const { organizationUuid: defOrgUuid, organizationName: defOrgName } = useDefaultOrganization();
  const { auth: { user }, windows: { addPane } } = useAppContext();

  // Организация — основная организация пользователя (значение по умолчанию).
  const [orgUuid, setOrgUuid] = useState(defOrgUuid || "");
  const [orgName, setOrgName] = useState(defOrgName || "");
  // Реквизиты запоминаются между сменами (по умолчанию для кассы).
  const [warehouseUuid, setWarehouseUuid] = usePersistentState("terminal.warehouseUuid", "");
  const [warehouseName, setWarehouseName] = usePersistentState("terminal.warehouseName", "");
  const [managerUuid, setManagerUuid] = useState((user as { employee?: { uuid?: string } })?.employee?.uuid ?? "");
  const [managerName, setManagerName] = useState((user as { employee?: { fullName?: string } })?.employee?.fullName ?? "");
  const [priceTypeUuid, setPriceTypeUuid] = usePersistentState("terminal.priceTypeUuid", "");
  const [priceTypeName, setPriceTypeName] = usePersistentState("terminal.priceTypeName", "");
  const [cashboxUuid, setCashboxUuid] = usePersistentState("terminal.cashboxUuid", "");
  const [cashboxName, setCashboxName] = usePersistentState("terminal.cashboxName", "");

  // Именной покупатель (необязательно): пусто → «Розничный покупатель».
  const [buyerUuid, setBuyerUuid] = useState("");
  const [buyerName, setBuyerName] = useState("");
  const [contractUuid, setContractUuid] = useState("");
  const [contractName, setContractName] = useState("");

  // Розничный покупатель + договор по умолчанию (загружается с бэкенда).
  const retailRef = useRef<RetailRef | null>(null);
  const [retailName, setRetailName] = useState("Розничный покупатель");
  useEffect(() => {
    let cancelled = false;
    api.get<{ counterparty?: { uuid: string; name: string }; contract?: { uuid: string } }>("counterparties/retail")
      .then((r) => {
        if (cancelled || !r?.counterparty) return;
        retailRef.current = { counterpartyUuid: r.counterparty.uuid, counterpartyName: r.counterparty.name, contractUuid: r.contract?.uuid ?? "" };
        setRetailName(r.counterparty.name);
      })
      .catch(() => { });
    return () => { cancelled = true; };
  }, []);

  const [mode, setMode] = useState<"sale" | "return">("sale");
  const isReturn = mode === "return";
  const [payment, setPayment] = useState<"cash" | "card" | "kaspi">("cash");
  const [submitting, setSubmitting] = useState(false);
  const [reqOpen, setReqOpen] = useState(false); // свёрнутая панель «Реквизиты»

  // Итог и количество позиций приходят из таблицы-корзины.
  const [total, setTotal] = useState(0);
  const [cartCount, setCartCount] = useState(0);

  // Параметры НДС организации — для предрасчёта сумм добавляемых строк.
  const acct = useOrgAccountingSettings(orgUuid);
  const vatRate = acct.vatRate;
  const vatMethod = acct.vatCalculationMethod;

  // Императивный API корзины (SubTable) — скан/лукап добавляют строки сюда.
  const cartApiRef = useRef<SubTableApi | null>(null);

  // ── Автоподстановка цен по выбранному типу цены ──────────────────────────
  const priceMapRef = useRef<Map<string, number>>(new Map());
  const priceTypeUuidRef = useRef(priceTypeUuid);
  priceTypeUuidRef.current = priceTypeUuid;

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

  // ── Добавление товара (скан/лукап). Повтор — увеличивает количество. ──────
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
    const price = priceMapRef.current.get(uuid) ?? (Number(item?.price) || 0);
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

  const clearCart = useCallback(() => { cartApiRef.current?.clear(); }, []);

  const handleTableTotal = useCallback((t: number, items?: TDataItem[]) => {
    setTotal(t);
    setCartCount((items ?? []).length);
  }, []);

  const submit = useCallback(async () => {
    const rows = (cartApiRef.current?.getRows() ?? []).filter((r) => r.productUuid);
    const cpUuid = buyerUuid || retailRef.current?.counterpartyUuid || "";
    const ctUuid = contractUuid || retailRef.current?.contractUuid || "";
    if (!orgUuid) { showToast(translate("organization") + " — " + translate("required"), "error"); return; }
    if (!warehouseUuid) { showToast(translate("warehouse") + " — " + translate("required"), "error"); return; }
    if (!cpUuid) { showToast(translate("retailBuyerNotReady"), "error"); return; }
    // Наличные → ПКО в конкретную кассу: касса обязательна (иначе не идентифицировать,
    // в какую кассу поступили деньги). Карта/Kaspi — без кассы (поступление в банк/эквайринг).
    if (!isReturn && payment === "cash" && !cashboxUuid) { showToast(translate("cashbox") + " — " + translate("required"), "error"); setReqOpen(true); return; }
    if (rows.length === 0) { showToast(translate("terminalEmptyCart"), "error"); return; }
    if (rows.some((r) => !(Number(r.quantity) > 0))) { showToast(translate("terminalBadQty"), "error"); return; }

    const docEndpoint = isReturn ? "sale-returns" : "sales";
    const itemsEndpoint = isReturn ? "sale-return-items/batch" : "saleitems/batch";
    const parentField = isReturn ? "saleReturnUuid" : "saleUuid";

    setSubmitting(true);
    try {
      const resp = await api.post<{ item?: { uuid?: string } }>(docEndpoint, {
        date: new Date().toISOString(),
        organizationUuid: orgUuid,
        counterpartyUuid: cpUuid,
        contractUuid: ctUuid || null,
        warehouseUuid,
        managerUuid: managerUuid || null,
        ...(isReturn ? {} : { priceTypeUuid: priceTypeUuid || null }),
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

      await api.put(`${docEndpoint}/${docUuid}`, { posted: true });

      // Нал при ПРОДАЖЕ → проведённый ПКО (Дт1010 Кт1210).
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
          });
        } catch {
          showToast(translate("terminalCashOrderFailed"), "error", 6000);
        }
      }

      // Фискальный чек (ОФД/Kaspi) для продажи (Kaspi → оплата/фискализация в Pane).
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
        } catch { /* перехватчик api покажет ошибку */ }
      }

      showToast(`${translate(isReturn ? "terminalReturnDone" : "terminalDone")} — ${fmt(total)}`, "success", 4000);
      cartApiRef.current?.clear();
    } catch {
      // Тосты ошибок (422/409/500) показывает перехватчик api-клиента.
    } finally {
      setSubmitting(false);
    }
  }, [orgUuid, warehouseUuid, buyerUuid, contractUuid, managerUuid, priceTypeUuid, total, vatRate, payment, cashboxUuid, isReturn, addPane, orgName]);

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
  const buyerLabel = buyerName || retailName;

  return (
    <div className={styles.Terminal}>
      {/* ЛЕВО: поиск (он же скан) + корзина (SubTable) */}
      <div className={styles.Left}>
        <LookupField
          label={translate("terminalAddProduct")}
          name="terminal_product"
          value=""
          displayValue=""
          endpoint="products"
          displayField="name"
          autoFocus
          onSelect={(u, d, item) => addProduct(u, d, (item as Record<string, unknown>) ?? {})}
          extraParams={orgParams}
        />
        {/* Структурный контейнер (flex-размер для таблицы); своя рамка у SubTable. */}
        <div className={styles.CartWrap}>
          <TradeDocumentItemsTable
            parentUuid=""
            parentField="saleUuid"
            endpoint="saleitems"
            componentName="TerminalCart"
            organizationUuid={orgUuid}
            priceTypeUuid={priceTypeUuid}
            deferRemoteChanges
            initialPendingRows={EMPTY_ROWS}
            apiRef={cartApiRef}
            quantityStepper
            onTotalChange={handleTableTotal}
            emptyMessage={translate("terminalEmptyHint")}
            rowActions={(row, ctx) => (
              <FieldActionButton icon="trash" label={translate("delete")} onClick={() => void ctx.removeRow(row)} />
            )}
          />
        </div>
      </div>

      {/* ПРАВО: режим, реквизиты (свёрнуто), итог, оплата, действия */}
      <div className={styles.Right}>
        <div className={styles.PayMethods}>
          <button type="button"
            className={[styles.PayMethod, !isReturn && styles.PayMethodActive].filter(Boolean).join(" ")}
            onClick={() => setMode("sale")}>🛒 {translate("terminalModeSale")}</button>
          <button type="button"
            className={[styles.PayMethod, isReturn && styles.ModeReturnActive].filter(Boolean).join(" ")}
            onClick={() => setMode("return")}>↩ {translate("terminalModeReturn")}</button>
        </div>

        {/* Реквизиты — свёрнуты по умолчанию (лёгкий вид). Сводка → раскрытие. */}
        <button type="button" className={styles.PayMethod} style={{ width: "100%", justifyContent: "space-between", display: "flex" }} onClick={() => setReqOpen((v) => !v)}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {orgName || translate("organization")} - {warehouseName || translate("warehouse")} - {buyerLabel}{priceTypeName ? ` - ${priceTypeName}` : ""}
          </span>
          <span>{reqOpen ? "▲" : "▼"}</span>
        </button>
        {reqOpen && (
          <div className={styles.Fields}>
            <LookupField label={translate("organization")} name="t_org" value={orgUuid} displayValue={orgName}
              endpoint="organizations" displayField="name"
              onSelect={(u, d) => { setOrgUuid(u); setOrgName(d); }} onClear={() => { setOrgUuid(""); setOrgName(""); }} />
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
            {/* Именной покупатель (необязательно). Пусто → «Розничный покупатель». */}
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
          </div>
        )}

        {/* Способ оплаты */}
        <div className={styles.PayMethods}>
          <button type="button"
            className={[styles.PayMethod, payment === "cash" && styles.PayMethodActive].filter(Boolean).join(" ")}
            onClick={() => setPayment("cash")}>💵 {translate("paymentCash")}</button>
          <button type="button"
            className={[styles.PayMethod, payment === "card" && styles.PayMethodActive].filter(Boolean).join(" ")}
            onClick={() => setPayment("card")}>💳 {translate("paymentCard")}</button>
          <button type="button"
            className={[styles.PayMethod, payment === "kaspi" && styles.PayMethodActive].filter(Boolean).join(" ")}
            onClick={() => setPayment("kaspi")}>🔴 {translate("paymentKaspi")}</button>
        </div>
        {payment === "cash" && reqOpen && (
          <div className={styles.Fields}>
            <LookupField label={translate("cashbox")} name="t_cashbox" value={cashboxUuid} displayValue={cashboxName}
              endpoint="cashboxes" displayField="name" extraParams={orgParams}
              onSelect={(u, d) => { setCashboxUuid(u); setCashboxName(d); }} onClear={() => { setCashboxUuid(""); setCashboxName(""); }} />
          </div>
        )}

        <div className={styles.Summary}>
          <div className={styles.SummaryRow}>
            <span>{translate("terminalPositions")}</span>
            <span>{cartCount}</span>
          </div>
          <div className={styles.TotalRow}>
            <span>{translate("total")}</span>
            <span className={styles.TotalAmount}>{fmt(total)} ₸</span>
          </div>
        </div>

        <div className={styles.Actions}>
          <Button variant="secondary" onClick={clearCart} disabled={submitting || cartCount === 0}>{translate("terminalClear")} (F4)</Button>
          <button type="button" className={[styles.PayBtn, isReturn && styles.PayBtnReturn].filter(Boolean).join(" ")} onClick={() => void submit()} disabled={submitting || cartCount === 0}>
            {submitting ? translate("loading") : `${translate(isReturn ? "terminalCheckoutReturn" : "terminalCheckout")} (F9)`}
          </button>
        </div>
      </div>
    </div>
  );
};

SalesTerminal.displayName = "SalesTerminal";
export { SalesTerminal };
export default SalesTerminal;

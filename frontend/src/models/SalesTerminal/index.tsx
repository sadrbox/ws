/**
 * SalesTerminal — терминал кассира/продавца для быстрого создания реализации.
 *
 * Сценарий: продавец быстро набирает товары (поиск по названию/штрих-коду),
 * правит количество и цену, выбирает покупателя/склад/менеджера и одной кнопкой
 * создаёт ПРОВЕДЁННУЮ реализацию. Суммы строк считаются на сервере; терминал
 * показывает предварительный расчёт (НДС включён в цену, ставка 12%).
 *
 * Поток сохранения: POST /sales (черновик) → POST /saleitems/batch →
 * PUT /sales/:uuid { posted:true } (проводка + проводки учёта).
 */
import { FC, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { translate } from "src/i18";
import { api } from "src/services/api/client";
import { showToast } from "src/components/UIToast";
import { FieldNumber } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import { Button } from "src/components/Button";
import { usePersistentState } from "src/hooks/usePersistentState";
import { useDefaultOrganization } from "src/hooks/useDefaultOrganization";
import { useOrgAccountingSettings } from "src/hooks/useOrgAccountingSettings";
import { useAppContext } from "src/app";
import { recalcSaleItemAmounts } from "src/models/Sales/saleItemDraft";
import FiscalReceiptPane from "src/models/FiscalReceipts/FiscalReceiptPane";
import type { TPane } from "src/app/types";
import styles from "./SalesTerminal.module.scss";

interface CartLine {
  key: string;
  productUuid: string;
  productName: string;
  unitOfMeasureUuid: string | null;
  quantity: number;
  price: number;
}

const fmt = (n: number) =>
  Number(n || 0).toLocaleString("ru-KZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const SalesTerminal: FC<Partial<TPane>> = () => {
  const { organizationUuid: defOrgUuid, organizationName: defOrgName } = useDefaultOrganization();
  const { auth: { user }, windows: { addPane } } = useAppContext();

  const [orgUuid, setOrgUuid] = useState(defOrgUuid || "");
  const [orgName, setOrgName] = useState(defOrgName || "");
  // Реквизиты запоминаются между сменами (розничный покупатель/склад/касса
  // по умолчанию — продавцу не нужно выбирать их каждый раз).
  const [warehouseUuid, setWarehouseUuid] = usePersistentState("terminal.warehouseUuid", "");
  const [warehouseName, setWarehouseName] = usePersistentState("terminal.warehouseName", "");
  const [counterpartyUuid, setCounterpartyUuid] = usePersistentState("terminal.counterpartyUuid", "");
  const [counterpartyName, setCounterpartyName] = usePersistentState("terminal.counterpartyName", "");
  const [managerUuid, setManagerUuid] = useState((user as any)?.employee?.uuid ?? "");
  const [managerName, setManagerName] = useState((user as any)?.employee?.fullName ?? "");
  // Тип цены: определяет, какие цены подставляются при добавлении товара.
  const [priceTypeUuid, setPriceTypeUuid] = usePersistentState("terminal.priceTypeUuid", "");
  const [priceTypeName, setPriceTypeName] = usePersistentState("terminal.priceTypeName", "");

  // Режим: продажа или возврат от покупателя.
  const [mode, setMode] = useState<"sale" | "return">("sale");
  const isReturn = mode === "return";

  // Оплата: наличные → автосоздание проведённого ПКО (Дт1010 Кт1210); карта/
  // безнал → только реализация (поступление денег отражается банк-выпиской).
  const [payment, setPayment] = useState<"cash" | "card" | "kaspi">("cash");
  const [cashboxUuid, setCashboxUuid] = usePersistentState("terminal.cashboxUuid", "");
  const [cashboxName, setCashboxName] = usePersistentState("terminal.cashboxName", "");

  const [cart, setCart] = useState<CartLine[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Поле сканера: ввод штрих-кода + Enter → добавить товар (автофокус).
  const [scan, setScan] = useState("");
  const scanRef = useRef<HTMLInputElement>(null);
  const focusScan = useCallback(() => { scanRef.current?.focus(); scanRef.current?.select?.(); }, []);

  // Ставка/метод НДС берём из «Параметров учёта» организации (0%, если не
  // плательщик НДС) — суммы строк считаем так же, как обычная реализация.
  const acct = useOrgAccountingSettings(orgUuid);
  const vatRate = acct.vatRate;
  const vatMethod = acct.vatCalculationMethod;
  const lineAmount = useCallback(
    (l: CartLine) => recalcSaleItemAmounts(l.quantity, l.price, vatRate, 0, vatMethod, 0).amount,
    [vatRate, vatMethod],
  );

  const total = useMemo(() => cart.reduce((s, l) => s + lineAmount(l), 0), [cart, lineAmount]);
  const itemsCount = useMemo(() => cart.reduce((s, l) => s + (Number(l.quantity) || 0), 0), [cart]);

  // ── Автоподстановка цен по выбранному типу цены ──────────────────────────
  // Карта productUuid→цена для выбранного типа (последняя цена из ProductPrice).
  const priceMapRef = useRef<Map<string, number>>(new Map());
  const priceTypeUuidRef = useRef(priceTypeUuid);
  priceTypeUuidRef.current = priceTypeUuid;

  // Загружает цены типа в Map одним запросом. reprice=true — переоценивает корзину.
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
      // Тип не задан → подставляем дефолтный (резолвится бэкендом).
      if (!typeUuid && resp?.priceTypeUuid) { setPriceTypeUuid(resp.priceTypeUuid); setPriceTypeName(resp.priceTypeName ?? ""); }
      if (reprice) setCart((prev) => prev.map((l) => { const p = map.get(l.productUuid); return p != null ? { ...l, price: p } : l; }));
    } catch { /* перехватчик api покажет ошибку */ }
  }, [orgUuid, setPriceTypeUuid, setPriceTypeName]);

  // Загрузка карты цен при открытии и смене организации (тип — из ref, без переоценки).
  useEffect(() => { void loadPriceMap(priceTypeUuidRef.current, false); }, [loadPriceMap]);

  // ── Добавление товара (из LookupField). Повтор — увеличивает количество. ──
  const addProduct = useCallback((uuid: string, name: string, item: Record<string, any>) => {
    if (!uuid) return;
    setCart((prev) => {
      const idx = prev.findIndex((l) => l.productUuid === uuid);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 };
        return next;
      }
      return [
        ...prev,
        {
          key: `${uuid}-${Date.now().toString(36)}`,
          productUuid: uuid,
          productName: name || item?.name || "—",
          unitOfMeasureUuid: item?.unitOfMeasureUuid ?? null,
          quantity: 1,
          // Цена выбранного типа (если есть), иначе — дефолтная цена товара.
          price: priceMapRef.current.get(uuid) ?? (Number(item?.price) || 0),
        },
      ];
    });
  }, []);

  const patchLine = useCallback((key: string, patch: Partial<CartLine>) => {
    setCart((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }, []);
  const removeLine = useCallback((key: string) => {
    setCart((prev) => prev.filter((l) => l.key !== key));
  }, []);
  const clearCart = useCallback(() => setCart([]), []);

  // Сканер: добавление товара по штрих-коду (Enter). Берём первый точный
  // результат поиска products (поиск ищет и по штрих-кодам номенклатуры).
  const handleScan = useCallback(async () => {
    const code = scan.trim();
    if (!code) return;
    setScan("");
    try {
      const resp = await api.get<any>("products", { params: { search: code, limit: 1 } });
      const prod = resp?.items?.[0];
      if (prod?.uuid) addProduct(prod.uuid, prod.name, prod);
      else showToast(translate("terminalProductNotFound"), "error", 2200);
    } catch { /* перехватчик api покажет ошибку */ }
    focusScan();
  }, [scan, addProduct, focusScan]);

  const submit = useCallback(async () => {
    if (!orgUuid) { showToast(translate("organization") + " — " + translate("required"), "error"); return; }
    if (!warehouseUuid) { showToast(translate("warehouse") + " — " + translate("required"), "error"); return; }
    if (!counterpartyUuid) { showToast(translate("counterparty") + " — " + translate("required"), "error"); return; }
    if (cart.length === 0) { showToast(translate("terminalEmptyCart"), "error"); return; }
    if (cart.some((l) => !(Number(l.quantity) > 0))) { showToast(translate("terminalBadQty"), "error"); return; }

    // Продажа → sales/saleitems; возврат → sale-returns/salereturnitems.
    const docEndpoint = isReturn ? "sale-returns" : "sales";
    const itemsEndpoint = isReturn ? "sale-return-items/batch" : "saleitems/batch";
    const parentField = isReturn ? "saleReturnUuid" : "saleUuid";

    setSubmitting(true);
    try {
      const resp = await api.post<any>(docEndpoint, {
        date: new Date().toISOString(),
        organizationUuid: orgUuid,
        counterpartyUuid,
        warehouseUuid,
        managerUuid: managerUuid || null,
        // Реализация фиксирует использованный тип цены (возврат поля не имеет — игнор).
        ...(isReturn ? {} : { priceTypeUuid: priceTypeUuid || null }),
        posted: false,
      });
      const docUuid = resp?.item?.uuid;
      if (!docUuid) throw new Error(translate("serverError"));

      await api.post(itemsEndpoint, {
        operations: cart.map((l) => ({
          action: "create",
          data: {
            [parentField]: docUuid,
            productUuid: l.productUuid,
            quantity: l.quantity,
            price: l.price,
            vatRate,
            unitOfMeasureUuid: l.unitOfMeasureUuid || null,
          },
        })),
      });

      await api.put(`${docEndpoint}/${docUuid}`, { posted: true });

      // Оплата наличными при ПРОДАЖЕ → проведённый ПКО (Дт1010 Кт1210).
      // Для возврата деньги покупателю возвращаются отдельно (РКО оформляется
      // вручную — авто-проводка РКО под возврат покупателю некорректна).
      if (!isReturn && payment === "cash" && total > 0) {
        try {
          await api.post("cash-receipt-orders", {
            date: new Date().toISOString(),
            organizationUuid: orgUuid,
            counterpartyUuid,
            cashboxUuid: cashboxUuid || null,
            amount: total,
            posted: true,
            comment: translate("terminalPaymentForSale"),
          });
        } catch {
          showToast(translate("terminalCashOrderFailed"), "error", 6000);
        }
      }

      // Фискальный чек (ОФД/Kaspi) для продажи. Для Kaspi — оплата по QR и
      // фискализация выполняются в FiscalReceiptPane (поллинг статуса).
      if (!isReturn) {
        try {
          const fr = await api.post<any>("fiscal-receipts", {
            documentType: "sale", documentUuid: docUuid, paymentMethod: payment,
          });
          if (fr?.item) {
            addPane({
              component: FiscalReceiptPane,
              label: translate("fiscalReceiptTitle"),
              data: {
                receipt: fr.item,
                items: cart.map((l) => ({ name: l.productName, quantity: l.quantity, price: l.price })),
                organizationName: orgName,
              },
            });
          }
        } catch { /* перехватчик api покажет ошибку */ }
      }

      showToast(`${translate(isReturn ? "terminalReturnDone" : "terminalDone")} — ${fmt(total)}`, "success", 4000);
      setCart([]);
      focusScan();
    } catch {
      // Тосты ошибок (422/409/500) показывает перехватчик api-клиента.
    } finally {
      setSubmitting(false);
    }
  }, [orgUuid, warehouseUuid, counterpartyUuid, managerUuid, priceTypeUuid, cart, total, vatRate, payment, cashboxUuid, isReturn, focusScan, addPane, orgName]);

  // Горячие клавиши: F9 — провести, F4 — очистить, F2 — фокус на сканер.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F9") { e.preventDefault(); submit(); }
      else if (e.key === "F4") { e.preventDefault(); clearCart(); }
      else if (e.key === "F2") { e.preventDefault(); focusScan(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [submit, clearCart, focusScan]);

  // Автофокус на поле сканера при открытии.
  useEffect(() => { focusScan(); }, [focusScan]);

  const orgParams = orgUuid ? { organizationUuid: orgUuid } : undefined;

  return (
    <div className={styles.Terminal}>
      {/* ЛЕВО: поиск + корзина */}
      <div className={styles.Left}>
        <div className={styles.SearchBar}>
          {/* Поле сканера: штрих-код + Enter (автофокус, F2). */}
          <div className={styles.ScanBox}>
            <label className={styles.ScanLabel}>{translate("terminalScan")}</label>
            <input
              ref={scanRef}
              className={styles.ScanInput}
              value={scan}
              onChange={(e) => setScan(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleScan(); } }}
              placeholder={translate("terminalScanHint")}
              autoFocus
            />
          </div>
          <LookupField
            label={translate("terminalAddProduct")}
            name="terminal_product"
            value=""
            displayValue=""
            endpoint="products"
            displayField="name"
            onSelect={addProduct}
            extraParams={orgParams}
          />
        </div>

        <div className={styles.CartWrap}>
          {cart.length === 0 ? (
            <div className={styles.EmptyCart}>{translate("terminalEmptyHint")}</div>
          ) : (
            <table className={styles.Cart}>
              <thead>
                <tr>
                  <th className={styles.cN}>№</th>
                  <th className={styles.cName}>{translate("reportProduct")}</th>
                  <th className={styles.cQty}>{translate("quantity")}</th>
                  <th className={styles.cPrice}>{translate("price")}</th>
                  <th className={styles.cSum}>{translate("amount")}</th>
                  <th className={styles.cDel}></th>
                </tr>
              </thead>
              <tbody>
                {cart.map((l, i) => (
                  <tr key={l.key}>
                    <td className={styles.cN}>{i + 1}</td>
                    <td className={styles.cName}>{l.productName}</td>
                    <td className={styles.cQty}>
                      <div className={styles.Stepper}>
                        <button type="button" onClick={() => patchLine(l.key, { quantity: Math.max(1, l.quantity - 1) })}>−</button>
                        <FieldNumber name={`q_${l.key}`} value={String(l.quantity)} onChange={(e) => patchLine(l.key, { quantity: Number(e.target.value) || 0 })} variant="table" />
                        <button type="button" onClick={() => patchLine(l.key, { quantity: l.quantity + 1 })}>+</button>
                      </div>
                    </td>
                    <td className={styles.cPrice}>
                      <FieldNumber name={`p_${l.key}`} value={String(l.price)} onChange={(e) => patchLine(l.key, { price: Number(e.target.value) || 0 })} variant="table" />
                    </td>
                    <td className={styles.cSum}>{fmt(lineAmount(l))}</td>
                    <td className={styles.cDel}>
                      <button type="button" className={styles.DelBtn} onClick={() => removeLine(l.key)} title={translate("delete")}>×</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ПРАВО: реквизиты + итог + оплата */}
      <div className={styles.Right}>
        {/* Режим: продажа / возврат */}
        <div className={styles.PayMethods}>
          <button type="button"
            className={[styles.PayMethod, !isReturn && styles.PayMethodActive].filter(Boolean).join(" ")}
            onClick={() => setMode("sale")}>🛒 {translate("terminalModeSale")}</button>
          <button type="button"
            className={[styles.PayMethod, isReturn && styles.ModeReturnActive].filter(Boolean).join(" ")}
            onClick={() => setMode("return")}>↩ {translate("terminalModeReturn")}</button>
        </div>
        <div className={styles.Fields}>
          <LookupField label={translate("organization")} name="t_org" value={orgUuid} displayValue={orgName}
            endpoint="organizations" displayField="name"
            onSelect={(u, d) => { setOrgUuid(u); setOrgName(d); }} onClear={() => { setOrgUuid(""); setOrgName(""); }} />
          <LookupField label={translate("warehouse")} name="t_wh" value={warehouseUuid} displayValue={warehouseName}
            endpoint="warehouses" displayField="name" extraParams={orgParams}
            onSelect={(u, d) => { setWarehouseUuid(u); setWarehouseName(d); }} onClear={() => { setWarehouseUuid(""); setWarehouseName(""); }} />
          <LookupField label={translate("counterparty")} name="t_cp" value={counterpartyUuid} displayValue={counterpartyName}
            endpoint="counterparties" displayField="name"
            onSelect={(u, d) => { setCounterpartyUuid(u); setCounterpartyName(d); }} onClear={() => { setCounterpartyUuid(""); setCounterpartyName(""); }} />
          <LookupField label={translate("manager")} name="t_mgr" value={managerUuid} displayValue={managerName}
            endpoint="employees" displayField="fullName" extraParams={orgParams}
            onSelect={(u, d) => { setManagerUuid(u); setManagerName(d); }} onClear={() => { setManagerUuid(""); setManagerName(""); }} />
          <LookupField label={translate("priceType")} name="t_pt" value={priceTypeUuid} displayValue={priceTypeName}
            endpoint="price-types" displayField="name"
            onSelect={(u, d) => { setPriceTypeUuid(u); setPriceTypeName(d); void loadPriceMap(u, true); }}
            onClear={() => { setPriceTypeUuid(""); setPriceTypeName(""); void loadPriceMap("", true); }} />

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
          {payment === "cash" && (
            <LookupField label={translate("cashbox")} name="t_cashbox" value={cashboxUuid} displayValue={cashboxName}
              endpoint="cashboxes" displayField="name" extraParams={orgParams}
              onSelect={(u, d) => { setCashboxUuid(u); setCashboxName(d); }} onClear={() => { setCashboxUuid(""); setCashboxName(""); }} />
          )}
        </div>

        <div className={styles.Summary}>
          <div className={styles.SummaryRow}>
            <span>{translate("terminalPositions")}</span>
            <span>{cart.length} / {fmt(itemsCount).replace(/,00$/, "")}</span>
          </div>
          <div className={styles.TotalRow}>
            <span>{translate("total")}</span>
            <span className={styles.TotalAmount}>{fmt(total)} ₸</span>
          </div>
        </div>

        <div className={styles.Actions}>
          <Button variant="secondary" onClick={clearCart} disabled={submitting || cart.length === 0}>{translate("terminalClear")} (F4)</Button>
          <button type="button" className={[styles.PayBtn, isReturn && styles.PayBtnReturn].filter(Boolean).join(" ")} onClick={submit} disabled={submitting || cart.length === 0}>
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

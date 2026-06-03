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
import { FC, useCallback, useMemo, useState } from "react";
import { translate } from "src/i18";
import { api } from "src/services/api/client";
import { showToast } from "src/components/UIToast";
import { FieldNumber } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import { Button } from "src/components/Button";
import { useDefaultOrganization } from "src/hooks/useDefaultOrganization";
import { useAppContext } from "src/app";
import { recalcSaleItemAmounts } from "src/models/Sales/saleItemDraft";
import type { TPane } from "src/app/types";
import styles from "./SalesTerminal.module.scss";

const DEFAULT_VAT = 12;

interface CartLine {
  key: string;
  productUuid: string;
  productName: string;
  unitOfMeasureUuid: string | null;
  quantity: number;
  price: number;
  vatRate: number;
}

const fmt = (n: number) =>
  Number(n || 0).toLocaleString("ru-KZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const lineAmount = (l: CartLine) =>
  recalcSaleItemAmounts(l.quantity, l.price, l.vatRate, 0, "INCLUDED", 0).amount;

const SalesTerminal: FC<Partial<TPane>> = () => {
  const { organizationUuid: defOrgUuid, organizationName: defOrgName } = useDefaultOrganization();
  const { auth: { user } } = useAppContext();

  const [orgUuid, setOrgUuid] = useState(defOrgUuid || "");
  const [orgName, setOrgName] = useState(defOrgName || "");
  const [warehouseUuid, setWarehouseUuid] = useState("");
  const [warehouseName, setWarehouseName] = useState("");
  const [counterpartyUuid, setCounterpartyUuid] = useState("");
  const [counterpartyName, setCounterpartyName] = useState("");
  const [managerUuid, setManagerUuid] = useState((user as any)?.employee?.uuid ?? "");
  const [managerName, setManagerName] = useState((user as any)?.employee?.fullName ?? "");

  const [cart, setCart] = useState<CartLine[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const total = useMemo(() => cart.reduce((s, l) => s + lineAmount(l), 0), [cart]);
  const itemsCount = useMemo(() => cart.reduce((s, l) => s + (Number(l.quantity) || 0), 0), [cart]);

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
          price: Number(item?.price) || 0,
          vatRate: DEFAULT_VAT,
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

  const submit = useCallback(async () => {
    if (!orgUuid) { showToast(translate("organization") + " — " + translate("required"), "error"); return; }
    if (!warehouseUuid) { showToast(translate("warehouse") + " — " + translate("required"), "error"); return; }
    if (!counterpartyUuid) { showToast(translate("counterparty") + " — " + translate("required"), "error"); return; }
    if (cart.length === 0) { showToast(translate("terminalEmptyCart"), "error"); return; }
    if (cart.some((l) => !(Number(l.quantity) > 0))) { showToast(translate("terminalBadQty"), "error"); return; }

    setSubmitting(true);
    try {
      const saleResp = await api.post<any>("sales", {
        date: new Date().toISOString(),
        organizationUuid: orgUuid,
        counterpartyUuid,
        warehouseUuid,
        managerUuid: managerUuid || null,
        posted: false,
      });
      const saleUuid = saleResp?.item?.uuid;
      if (!saleUuid) throw new Error(translate("serverError"));

      await api.post("saleitems/batch", {
        operations: cart.map((l) => ({
          action: "create",
          data: {
            saleUuid,
            productUuid: l.productUuid,
            quantity: l.quantity,
            price: l.price,
            vatRate: l.vatRate,
            unitOfMeasureUuid: l.unitOfMeasureUuid || null,
          },
        })),
      });

      // Проводим: assertPostable (контрагент/субконто) + контроль остатка + проводки.
      await api.put(`sales/${saleUuid}`, { posted: true });

      showToast(`${translate("terminalDone")} — ${fmt(total)}`, "success", 4000);
      setCart([]);
    } catch {
      // Тосты ошибок (422/409/500) показывает перехватчик api-клиента.
      // Документ остаётся черновиком — кассир может исправить причину.
    } finally {
      setSubmitting(false);
    }
  }, [orgUuid, warehouseUuid, counterpartyUuid, managerUuid, cart, total]);

  const orgParams = orgUuid ? { organizationUuid: orgUuid } : undefined;

  return (
    <div className={styles.Terminal}>
      {/* ЛЕВО: поиск + корзина */}
      <div className={styles.Left}>
        <div className={styles.SearchBar}>
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
          <Button variant="secondary" onClick={clearCart} disabled={submitting || cart.length === 0}>{translate("terminalClear")}</Button>
          <button type="button" className={styles.PayBtn} onClick={submit} disabled={submitting || cart.length === 0}>
            {submitting ? translate("loading") : translate("terminalCheckout")}
          </button>
        </div>
      </div>
    </div>
  );
};

SalesTerminal.displayName = "SalesTerminal";
export { SalesTerminal };
export default SalesTerminal;

/**
 * OrphanRefs — «Контроль удалённых ссылок».
 *
 * Находит все активные записи, у которых FK-поле ссылается на
 * мягко удалённую (deletedAt IS NOT NULL) запись справочника.
 * По каждой найденной записи можно открыть форму редактирования.
 */
import { FC, useState, useCallback } from "react";
import { Button } from "src/components/Button";
import { GroupCol } from "src/components/UI";
import { useAppContext } from "src/app/context";
import apiClient from "src/services/api/client";
import mainStyles from "src/styles/main.module.scss";
import type { TPane } from "src/app/types";
import { getFormatDateOnly } from "src/utils/datetime";

// ── Types ─────────────────────────────────────────────────────────────────────

interface OrphanRecord {
  uuid: string;
  id: number;
  label: string;
  refUuid: string;
  refLabel: string;
  refDeletedAt: string;
}

interface OrphanGroup {
  table: string;
  column: string;
  columnLabel: string;
  tableLabel: string;
  refTable: string;
  refTableLabel: string;
  totalFound: number;
  hasMore: boolean;
  records: OrphanRecord[];
}

// ── Table → form lazy-import map ──────────────────────────────────────────────
// Для каждой таблицы: функция динамического импорта и имя экспортируемого Form-компонента.

type FormLoader = { load: () => Promise<Record<string, FC<any>>>; key: string };

const TABLE_FORM_MAP: Record<string, FormLoader> = {
  products:             { load: () => import("src/models/Products")            as any, key: "ProductsForm" },
  sales:                { load: () => import("src/models/Sales")               as any, key: "SalesForm" },
  purchases:            { load: () => import("src/models/Purchases")           as any, key: "PurchasesForm" },
  outgoing_invoices:    { load: () => import("src/models/OutgoingInvoices")    as any, key: "OutgoingInvoicesForm" },
  incoming_invoices:    { load: () => import("src/models/IncomingInvoices")    as any, key: "IncomingInvoicesForm" },
  payment_invoices:     { load: () => import("src/models/PaymentInvoices")     as any, key: "PaymentInvoicesForm" },
  inventory_transfers:  { load: () => import("src/models/InventoryTransfers")  as any, key: "InventoryTransfersForm" },
  cash_receipt_orders:  { load: () => import("src/models/CashReceiptOrders")   as any, key: "CashReceiptOrdersForm" },
  cash_expense_orders:  { load: () => import("src/models/CashExpenseOrders")   as any, key: "CashExpenseOrdersForm" },
  payroll_calculations: { load: () => import("src/models/PayrollCalculations") as any, key: "PayrollCalculationsForm" },
  payroll_payments:     { load: () => import("src/models/PayrollPayments")     as any, key: "PayrollPaymentsForm" },
  employees:            { load: () => import("src/models/Employees")           as any, key: "EmployeesForm" },
  contracts:            { load: () => import("src/models/Contracts")           as any, key: "ContractsForm" },
  counterparties:       { load: () => import("src/models/Counterparties")      as any, key: "CounterpartiesForm" },
  contacts:             { load: () => import("src/models/Contacts")            as any, key: "ContactsForm" },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  return getFormatDateOnly(iso) || iso;
}

// ── OrphanGroup component ─────────────────────────────────────────────────────

const OrphanGroupBlock: FC<{
  group: OrphanGroup;
  onOpen: (table: string, uuid: string, label: string) => void;
  opening: string | null;
}> = ({ group, onOpen, opening }) => {
  const canOpen = !!TABLE_FORM_MAP[group.table];
  return (
    <div style={{ border: "1px solid #f0c0c0", borderRadius: 4, overflow: "hidden" }}>
      {/* Group header */}
      <div style={{
        background: "var(--danger-bg)", padding: "6px 12px",
        display: "flex", alignItems: "center", gap: 8,
        borderBottom: "1px solid #f0c0c0",
      }}>
        <span style={{ fontWeight: 600, fontSize: 13, color: "var(--danger-fg)" }}>{group.tableLabel}</span>
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>→ поле «{group.columnLabel}»</span>
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>→ удалено из «{group.refTableLabel}»</span>
        <span style={{
          marginLeft: "auto", background: "var(--danger)", color: "#fff",
          borderRadius: 10, fontSize: 11, fontWeight: 600,
          padding: "1px 7px", whiteSpace: "nowrap",
        }}>
          {group.totalFound}{group.hasMore ? "+" : ""} {group.totalFound === 1 ? "запись" : "записей"}
        </span>
      </div>

      {/* Records table */}
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ background: "#fdf0f0", borderBottom: "1px solid #f0e0e0" }}>
            <th style={{ textAlign: "left", padding: "3px 12px", fontWeight: 500, color: "var(--text-secondary)" }}>
              Запись ({group.tableLabel})
            </th>
            <th style={{ textAlign: "left", padding: "3px 12px", fontWeight: 500, color: "var(--text-secondary)" }}>
              Удалённое значение ({group.refTableLabel})
            </th>
            <th style={{ textAlign: "left", padding: "3px 12px", fontWeight: 400, color: "var(--text-muted)", fontSize: 10 }}>
              Удалено
            </th>
            <th style={{ width: 70 }} />
          </tr>
        </thead>
        <tbody>
          {group.records.map((rec, i) => (
            <tr key={i} style={{ borderBottom: "1px solid #f8f0f0" }}>
              <td style={{ padding: "4px 12px" }}>
                <span style={{ fontWeight: 500 }}>{rec.label || rec.uuid}</span>
                <span style={{ color: "var(--text-faint)", fontSize: 10, marginLeft: 6, fontFamily: "monospace" }}>
                  #{rec.id}
                </span>
              </td>
              <td style={{ padding: "4px 12px" }}>
                <span style={{ color: "var(--danger)", textDecoration: "line-through" }}>
                  {rec.refLabel || rec.refUuid}
                </span>
              </td>
              <td style={{ padding: "4px 12px", color: "var(--text-muted)", fontSize: 10, whiteSpace: "nowrap" }}>
                {rec.refDeletedAt ? fmtDate(rec.refDeletedAt) : "—"}
              </td>
              <td style={{ padding: "4px 8px", textAlign: "right" }}>
                {canOpen ? (
                  <Button
                    variant="secondary"
                    disabled={opening === rec.uuid}
                    onClick={() => onOpen(group.table, rec.uuid, rec.label)}
                    style={{ fontSize: 11, padding: "1px 8px" }}
                  >
                    {opening === rec.uuid ? "…" : "Открыть"}
                  </Button>
                ) : (
                  <span style={{ fontSize: 10, color: "var(--text-faint)" }}>н/д</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {group.hasMore && (
        <div style={{ background: "#fdf8f8", padding: "4px 12px", fontSize: 11, color: "var(--text-muted)", borderTop: "1px solid #f0e0e0" }}>
          Показаны первые {group.totalFound}+. Используйте «Поиск и замена ссылок» для исправления.
        </div>
      )}
    </div>
  );
};

// ── Main ──────────────────────────────────────────────────────────────────────

const OrphanRefsForm: FC<Partial<TPane>> = () => {
  const { addPane } = useAppContext().windows;
  const [groups, setGroups] = useState<OrphanGroup[] | null>(null);
  const [totalViolations, setTotalViolations] = useState(0);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  const handleScan = useCallback(async () => {
    setIsScanning(true);
    setError(null);
    setGroups(null);
    try {
      const r = await apiClient.get("/ref-replace/orphans");
      setGroups(r.data.groups ?? []);
      setTotalViolations(r.data.totalViolations ?? 0);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
        ?? "Ошибка при сканировании";
      setError(msg);
    } finally {
      setIsScanning(false);
    }
  }, []);

  const handleOpen = useCallback(async (table: string, uuid: string, label: string) => {
    const loader = TABLE_FORM_MAP[table];
    if (!loader) return;
    setOpening(uuid);
    try {
      const mod = await loader.load();
      const FormComponent = mod[loader.key];
      if (!FormComponent) {
        alert(`Компонент ${loader.key} не найден`);
        return;
      }
      addPane({
        component: FormComponent,
        data: { uuid },
        label,
      });
    } catch (err: unknown) {
      alert(`Ошибка загрузки формы: ${(err as Error)?.message ?? "неизвестная ошибка"}`);
    } finally {
      setOpening(null);
    }
  }, [addPane]);

  const hasViolations = groups !== null && groups.length > 0;
  const isClean = groups !== null && groups.length === 0;

  return (
    <div className={mainStyles.FormWrapper}>
      <div className={mainStyles.Form} style={{ maxWidth: 900 }}>
        <GroupCol style={{ gap: 12 }}>

          {/* Description + scan button */}
          <div style={{
            display: "flex", alignItems: "center", gap: 12,
            border: "1px solid #e0e0e0", borderRadius: 4,
            background: "#fafafa", padding: "10px 14px",
          }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 3 }}>
                Контроль удалённых ссылок
              </div>
              <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                Находит активные записи, у которых поле ссылается на удалённую запись справочника.
                Для исправления откройте запись и замените значение, либо используйте обработку
                «Поиск и замена ссылок».
              </div>
            </div>
            <Button
              variant="secondary"
              onClick={handleScan}
              disabled={isScanning}
            >
              {isScanning ? "Сканирование…" : "Найти нарушения"}
            </Button>
          </div>

          {/* Error */}
          {error && (
            <div style={{ color: "var(--danger)", fontSize: 12, padding: "2px 4px" }}>{error}</div>
          )}

          {/* Loading */}
          {isScanning && (
            <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "8px 4px" }}>
              Сканирование всех таблиц, это может занять несколько секунд…
            </div>
          )}

          {/* Clean */}
          {isClean && (
            <div style={{
              border: "1px solid #c8e6c9", borderRadius: 4,
              background: "var(--success-bg)", padding: "10px 14px",
              fontSize: 13, color: "var(--success-fg)", fontWeight: 500,
            }}>
              Нарушений не найдено — все ссылки корректны.
            </div>
          )}

          {/* Results summary + groups */}
          {hasViolations && (
            <>
              <div style={{
                border: "1px solid #f0c0c0", borderRadius: 4,
                background: "var(--danger-bg)", padding: "8px 14px",
                display: "flex", alignItems: "center", gap: 10,
              }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--danger-fg)" }}>
                  Найдено нарушений: {totalViolations}
                </span>
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  в {groups.length} {groups.length === 1 ? "группе" : "группах"}
                </span>
                <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--text-muted)" }}>
                  Откройте запись чтобы исправить ссылку вручную,
                  или используйте «Поиск и замена ссылок» для массовой замены.
                </span>
              </div>

              <GroupCol style={{ gap: 8 }}>
                {groups.map((g, i) => (
                  <OrphanGroupBlock
                    key={i}
                    group={g}
                    onOpen={handleOpen}
                    opening={opening}
                  />
                ))}
              </GroupCol>
            </>
          )}

        </GroupCol>
      </div>
    </div>
  );
};

OrphanRefsForm.displayName = "OrphanRefsForm";
export { OrphanRefsForm };

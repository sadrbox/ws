import { FC } from "react";
import { translate } from "src/i18";
import styles from "./DocumentTotals.module.scss";

const fmt = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 9 });

type TBasisItem = {
  amount?: number | string | null;
  vatAmount?: number | string | null;
  discountAmount?: number | string | null;
  _pendingAction?: string;
};

export interface DocumentTotalsProps {
  amount: number;
  vatAmount: number;
  discountAmount: number;
  amountWithoutVat: number;
  isVatEnabled: boolean;
  useDiscount: boolean;
  /** Items pre-populated from a basis document. When amount===0 and these are
   *  present (Tab 2 hasn't rendered yet), totals are derived from items so
   *  Tab 1 shows correct values without requiring the user to open Tab 2. */
  basisItems?: TBasisItem[];
}

const DocumentTotals: FC<DocumentTotalsProps> = ({
  amount,
  vatAmount,
  discountAmount,
  amountWithoutVat,
  isVatEnabled,
  useDiscount,
  basisItems,
}) => {
  // If amount is still 0 but basisItems are available (form just opened from
  // basis, items tab not yet rendered), derive totals directly from the items.
  const activeItems = basisItems?.filter((r) => r._pendingAction !== "delete") ?? [];
  const useBasis = amount === 0 && activeItems.length > 0;

  const displayAmount = useBasis
    ? Math.round(activeItems.reduce((s, r) => s + (Number(r.amount) || 0), 0) * 100) / 100
    : amount;
  const displayVatAmount = useBasis
    ? Math.round(activeItems.reduce((s, r) => s + (Number(r.vatAmount) || 0), 0) * 100) / 100
    : vatAmount;
  const displayDiscountAmount = useBasis
    ? Math.round(activeItems.reduce((s, r) => s + (Number(r.discountAmount) || 0), 0) * 100) / 100
    : discountAmount;
  const displayAmountWithoutVat = useBasis
    ? Math.round((displayAmount - displayVatAmount) * 100) / 100
    : amountWithoutVat;

  const rows: Array<{ label: string; value: number }> = [
    ...(isVatEnabled
      ? [
          { label: translate("amountWithoutVatLabel"), value: displayAmountWithoutVat },
          { label: translate("vatLabel"), value: displayVatAmount },
        ]
      : []),
    ...(useDiscount ? [{ label: translate("discount"), value: displayDiscountAmount }] : []),
  ];

  return (
    <div className={styles.container}>
      {rows.map(({ label, value }) => (
        <div key={label} className={styles.row}>
          <span>{label}</span>
          <span className={styles.value}>{fmt.format(value)}</span>
        </div>
      ))}
      <div className={styles.divider} />
      <div className={styles.total}>
        <span>{translate("total")}</span>
        <span className={styles.totalValue}>{fmt.format(displayAmount)}</span>
      </div>
    </div>
  );
};

export default DocumentTotals;

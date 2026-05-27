import { FC } from "react";
import { translate } from "src/i18";
import styles from "./DocumentTotals.module.scss";

const fmt = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 9 });

export interface DocumentTotalsProps {
  amount: number;
  vatAmount: number;
  discountAmount: number;
  amountWithoutVat: number;
  isVatEnabled: boolean;
  useDiscount: boolean;
}

const DocumentTotals: FC<DocumentTotalsProps> = ({
  amount,
  vatAmount,
  discountAmount,
  amountWithoutVat,
  isVatEnabled,
  useDiscount,
}) => {
  const rows: Array<{ label: string; value: number }> = [
    ...(isVatEnabled
      ? [
          { label: translate("amountWithoutVatLabel"), value: amountWithoutVat },
          { label: translate("vatLabel"), value: vatAmount },
        ]
      : []),
    ...(useDiscount ? [{ label: translate("discount"), value: discountAmount }] : []),
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
        <span className={styles.totalValue}>{fmt.format(amount)}</span>
      </div>
    </div>
  );
};

export default DocumentTotals;

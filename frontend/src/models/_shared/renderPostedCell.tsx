import type { ReactNode } from "react";
import type { TDataItem } from "src/components/Table/types";
import type { TColumn } from "src/components/Table/types.tsx";
import { Icon } from "src/components/IconButton/icons";
import styles from "./renderPostedCell.module.scss";

/** Стандартный рендер ячейки колонки "posted" в списках документов. */
export function renderPostedCell(row: TDataItem, col: TColumn): ReactNode | undefined {
  if (col.identifier !== "posted") return undefined;
  const isPosted = row.posted === true;
  return (
    <span title={isPosted ? "Документ проведён" : "Не проведён"}>
      <Icon
        name={isPosted ? "posted" : "notPosted"}
        width={17} height={17}
        className={[styles.Icon, isPosted ? styles.Posted : styles.Unposted].join(" ")}
      />
    </span>
  );
}

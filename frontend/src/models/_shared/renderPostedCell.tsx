import type { ReactNode } from "react";
import type { TDataItem } from "src/components/Table/types";
import type { TColumn } from "src/components/Table/types.tsx";
import { Icon } from "src/components/IconButton/icons";

/** Стандартный рендер ячейки колонки "posted" в списках документов. */
export function renderPostedCell(row: TDataItem, col: TColumn): ReactNode | undefined {
  if (col.identifier !== "posted") return undefined;
  const isPosted = row.posted === true;
  return (
    <span title={isPosted ? "Документ проведён" : "Не проведён"}>
      <Icon
        name={isPosted ? "posted" : "notPosted"}
        width={17} height={17}
        style={{ color: isPosted ? "#10b981" : "#9ca3af", flexShrink: 0, display: "flex" }}
      />
    </span>
  );
}

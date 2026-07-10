import type { ReactNode } from "react";
import type { TDataItem, TColumn } from "src/components/Table/types";
import { translate } from "src/i18";

/** Одно изменение поля из журнала: {from, to}. */
interface DiffEntry { from: unknown; to: unknown }

const ACTION_KEYS: Record<string, string> = {
  create: "auditCreate",
  update: "auditUpdate",
  delete: "auditDelete",
  batch_delete: "auditBatchDelete",
};

/** Значение для показа: null/"" → «—», булево → Да/Нет. */
function fmt(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? translate("yes") : translate("no");
  return String(v);
}

/**
 * Сводка изменений: «поле: было → стало» через «;».
 * Для create/delete значения приходят как {from:null,...} / {...,to:null} —
 * показываем ту сторону, которая заполнена, чтобы не рисовать «— → значение»
 * по каждому полю созданной записи.
 */
export function summarizeDiff(diff: Record<string, DiffEntry>, actionType: string): string {
  const keys = Object.keys(diff);
  if (keys.length === 0) return "";
  const isSnapshot = actionType === "create" || actionType === "delete" || actionType === "batch_delete";
  const parts = keys.map((k) => {
    const { from, to } = diff[k];
    if (isSnapshot) return `${k}: ${fmt(actionType === "create" ? to : from)}`;
    return `${k}: ${fmt(from)} → ${fmt(to)}`;
  });
  return parts.join("; ");
}

/**
 * Рендер ячеек журнала действий: тип действия — на языке интерфейса,
 * изменения — компактной сводкой (полный список виден в подсказке).
 */
export function renderAuditCell(row: TDataItem, col: TColumn): ReactNode | undefined {
  if (col.identifier === "actionType") {
    const key = ACTION_KEYS[String(row.actionType)];
    return <span>{key ? translate(key) : String(row.actionType ?? "")}</span>;
  }
  if (col.identifier === "diff") {
    const diff = row.diff as Record<string, DiffEntry> | null | undefined;
    if (!diff || typeof diff !== "object") return <span />;
    const text = summarizeDiff(diff, String(row.actionType));
    return <span title={text}>{text}</span>;
  }
  return undefined;
}

export default renderAuditCell;

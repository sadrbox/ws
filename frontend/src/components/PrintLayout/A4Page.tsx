/**
 * Базовые компоненты-обёртки для регламентированных печатных форм A4.
 * Использование:
 * ```tsx
 * <A4Page>
 *   <A4Header>...</A4Header>
 *   <A4Section>...</A4Section>
 * </A4Page>
 * ```
 */
import type { CSSProperties, FC, ReactNode } from "react";

/** Корневой контейнер листа A4 (внутри iframe он уже обёрнут в .DocSheet). */
export const A4Page: FC<{ children: ReactNode; style?: CSSProperties }> = ({ children, style }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: "4mm", ...style }}>{children}</div>
);

/** Заголовок документа — крупный, по центру. */
export const A4DocTitle: FC<{ children: ReactNode; subtitle?: ReactNode }> = ({ children, subtitle }) => (
  <div style={{ textAlign: "center", marginBottom: "3mm" }}>
    <div style={{ fontSize: "13pt", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px" }}>{children}</div>
    {subtitle && <div style={{ fontSize: "9pt", marginTop: "1mm" }}>{subtitle}</div>}
  </div>
);

/** Метка-значение в две строки (для шапки). */
export const A4Field: FC<{ label: string; children: ReactNode; width?: string }> = ({ label, children, width }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 2, width, minWidth: 0 }}>
    <span style={{ fontSize: "8pt", color: "#444" }}>{label}</span>
    <div style={{ borderBottom: "1px solid #000", paddingBottom: 2, minHeight: "5mm", fontWeight: 500 }}>{children}</div>
  </div>
);

/** Сетка-строка для шапки. */
export const A4Row: FC<{ children: ReactNode; gap?: string; style?: CSSProperties }> = ({ children, gap = "8mm", style }) => (
  <div style={{ display: "flex", gap, alignItems: "flex-end", ...style }}>{children}</div>
);

/** Подпись в правой части шапки (Утверждаю / руководитель и т. п.). */
export const A4Signature: FC<{ role: string; name?: string }> = ({ role, name }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: "9pt", minWidth: "55mm" }}>
    <span>{role}</span>
    <span style={{ borderBottom: "1px solid #000", minHeight: "5mm" }}>&nbsp;{name ?? ""}</span>
    <span style={{ fontSize: "7pt", color: "#666" }}>(подпись, расшифровка)</span>
  </div>
);

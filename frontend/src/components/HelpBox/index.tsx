/**
 * HelpBox — единый информационный/справочный блок над формами и таблицами.
 * Заменяет дублировавшиеся локальные классы .help/.helpTitle/.helpSteps и
 * .Intro/.IntroMain в разных моделях. Маркеры (Ok/Add/Warn) — вместо inline-стилей.
 */
import type { FC, ReactNode } from "react";
import styles from "./HelpBox.module.scss";

interface HelpBoxProps {
  /** Заголовок блока (иконка + текст). */
  title?: ReactNode;
  /** Вторичное примечание под основным текстом (приглушено, с разделителем). */
  footnote?: ReactNode;
  className?: string;
  children: ReactNode;
}

export const HelpBox: FC<HelpBoxProps> = ({ title, footnote, className, children }) => (
  <div className={[styles.HelpBox, className].filter(Boolean).join(" ")}>
    {title && <div className={styles.Title}>{title}</div>}
    {children}
    {footnote && <p className={styles.Footnote}>{footnote}</p>}
  </div>
);

/** Классы цветных маркеров для использования внутри текста подсказок. */
export const helpMarker = { ok: styles.Ok, add: styles.Add, warn: styles.Warn };

export default HelpBox;

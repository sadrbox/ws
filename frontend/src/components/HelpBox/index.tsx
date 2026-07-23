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

/**
 * HelpText — проза подсказки ИЗ СЛОВАРЯ (U3: справка тоже должна переводиться).
 *
 * Раньше текст подсказок был вшит в JSX по-русски и в казахской локали оставался
 * русским. Выносить каждое слово отдельным ключом нельзя — переводчик потеряет
 * контекст фразы, поэтому ключ хранит ПРЕДЛОЖЕНИЕ ЦЕЛИКОМ с лёгкой разметкой:
 *   **жирный**            — выделение;
 *   {ok} {add} {warn}     — цветные маркеры ✓ ＋ ⚠;
 *   {0} {1} …             — подстановки (названия полей из того же словаря).
 */
export const HelpText: FC<{ text: string; values?: ReactNode[] }> = ({ text, values = [] }) => {
  // Разбираем по всем спец-токенам сразу, сохраняя порядок фрагментов.
  const parts = text.split(/(\*\*[^*]+\*\*|\{ok\}|\{add\}|\{warn\}|\{\d+\})/g);
  return (
    <>
      {parts.map((part, i) => {
        if (!part) return null;
        if (part.startsWith("**") && part.endsWith("**")) {
          return <b key={i}>{part.slice(2, -2)}</b>;
        }
        if (part === "{ok}") return <span key={i} className={styles.Ok}>✓</span>;
        if (part === "{add}") return <span key={i} className={styles.Add}>＋</span>;
        if (part === "{warn}") return <span key={i} className={styles.Warn}>⚠</span>;
        const m = /^\{(\d+)\}$/.exec(part);
        if (m) return <span key={i}>{values[Number(m[1])] ?? ""}</span>;
        return <span key={i}>{part}</span>;
      })}
    </>
  );
};

export default HelpBox;

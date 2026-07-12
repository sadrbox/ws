// Notice — блок предупреждений/статуса формы документа (заменяет инлайновые
// заметки полей). Отображает список сообщений с тремя палитрами:
//   success   — форма заполнена корректно;
//   warning   — условное предупреждение (напр. несоответствие договора/основания);
//   attention — незаполненные обязательные поля (нужны для проведения);
//   error     — ОШИБКА ДАННЫХ формы: клиентская валидация или бизнес-отказ бэка
//               (422 «серий меньше количества», 423 «период закрыт»…). Системные
//               сбои (сеть, 5xx, права) сюда НЕ идут — они уходят в <UIToast />.
import type { FC } from "react";
import styles from "./Notice.module.scss";

export type NoticeType = "success" | "warning" | "attention" | "error";

export interface NoticeItem {
  type: NoticeType;
  text: string;
}

interface NoticeProps {
  items?: NoticeItem[];
  className?: string;
}

const ICON: Record<NoticeType, string> = {
  success: "✓",
  warning: "!",
  attention: "✕",
  error: "✕",
};

export const Notice: FC<NoticeProps> = ({ items, className }) => {
  if (!items || items.length === 0) return null;
  return (
    <div className={[styles.Notice, className].filter(Boolean).join(" ")} role="status" aria-live="polite">
      {items.map((it, i) => (
        <div key={i} className={[styles.Item, styles[it.type]].filter(Boolean).join(" ")}>
          <span className={styles.Icon} aria-hidden>{ICON[it.type]}</span>
          <span className={styles.Text}>{it.text}</span>
        </div>
      ))}
    </div>
  );
};

export default Notice;

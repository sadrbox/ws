// Notice — сообщение формы: валидация, состояние, пояснение о работе экрана.
// Палитры:
//   info      — нейтральное пояснение (как работает форма); НЕ тревога;
//   success   — форма заполнена корректно;
//   warning   — условное предупреждение (напр. несоответствие договора/основания);
//   attention — незаполненные обязательные поля (нужны для проведения);
//   error     — ОШИБКА ДАННЫХ формы: клиентская валидация или бизнес-отказ бэка
//               (422 «серий меньше количества», 423 «период закрыт»…). Системные
//               сбои (сеть, 5xx, права) сюда НЕ идут — они уходят в <UIToast />.
//
// ГДЕ ЭТО ВИДНО. Компонент НИЧЕГО НЕ РИСУЕТ НА МЕСТЕ: он сообщает свои строки в область
// «Технические сообщения» (правая сворачиваемая колонка приложения), и показывает их она.
//
// Почему так. Раньше каждая форма вставляла сообщение прямо в свою разметку: появилось —
// содержимое уехало вниз под курсором, потеряв прокрутку; исчезло — уехало обратно. И
// искать его приходилось всякий раз заново: в одной форме оно справа внизу, в другой над
// таблицей, в третьей между областями. Теперь место одно и то же, а разметка форм не
// двигается никогда.
//
// ИСКЛЮЧЕНИЕ — `inline`. В модальном окне подтверждения сообщение ЕСТЬ САМО СОДЕРЖИМОЕ
// окна: «что именно произойдёт с базой», «план от агента». Отправить его в боковую
// колонку значило бы показать пустое окно с кнопкой «Применить». Там — и только там —
// компонент рисует себя на месте.
import { type FC } from "react";
import { useReportNotice } from "src/components/TechMessages/store";
import styles from "./Notice.module.scss";

export type NoticeType = "info" | "success" | "warning" | "attention" | "error";

export interface NoticeItem {
  type: NoticeType;
  text: string;
}

interface NoticeProps {
  items?: NoticeItem[];
  className?: string;
  /**
   * Во всю ширину родителя вместо колонки 300px. Действует только при `inline`:
   * в общей области ширину задаёт она сама.
   */
  wide?: boolean;
  /**
   * Рисовать ЗДЕСЬ, а не сообщать в общую область. Только для случаев, где сообщение —
   * само содержимое места: тело модального окна подтверждения.
   */
  inline?: boolean;
  /** Чем подписать сообщение, если окружение не даёт подписи (пейна нет). */
  source?: string;
}

const ICON: Record<NoticeType, string> = {
  info: "i",
  success: "✓",
  warning: "!",
  attention: "✕",
  error: "✕",
};

/** Разметка одного сообщения — общая для места вызова (inline) и для общей области. */
export const NoticeItems: FC<{ items: NoticeItem[]; className?: string; wide?: boolean }> =
  ({ items, className, wide }) => (
    <div
      className={[styles.Notice, wide ? styles.wide : null, className].filter(Boolean).join(" ")}
      role="status"
      aria-live="polite"
    >
      {items.map((it, i) => (
        <div key={i} className={[styles.Item, styles[it.type]].filter(Boolean).join(" ")}>
          <span className={styles.Icon} aria-hidden>{ICON[it.type]}</span>
          <span className={styles.Text}>{it.text}</span>
        </div>
      ))}
    </div>
  );

export const Notice: FC<NoticeProps> = ({ items, className, wide, inline, source }) => {
  // Хук зовётся безусловно и в обоих режимах: правила хуков не терпят условного вызова.
  // При `inline` сообщаем пустой список — иначе одно и то же было бы видно дважды.
  useReportNotice(inline ? [] : items, source);
  if (!inline) return null;
  if (!items || items.length === 0) return null;
  return <NoticeItems items={items} className={className} wide={wide} />;
};

export default Notice;

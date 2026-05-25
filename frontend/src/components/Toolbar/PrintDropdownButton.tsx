/**
 * PrintDropdownButton — кнопка «Печать» с выпадающим меню выбора макета.
 * Используется в шапке документов для выбора печатной формы (накладная, акт и т.п.)
 */
import { FC, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import IconButton from "src/components/IconButton/IconButton";
import { Icon } from "src/components/IconButton/icons";
import styles from "./Toolbar.module.scss";

export interface PrintLayoutOption {
  id: string;
  label: ReactNode;
  hint?: string;
  disabled?: boolean;
}

interface PrintDropdownButtonProps {
  options: PrintLayoutOption[];
  onSelect: (id: string) => void;
  disabled?: boolean;
  title?: string;
}

const DROP_W = 220;
const DROP_H = 200;

function computeDropStyle(anchor: HTMLElement): CSSProperties {
  const rect = anchor.getBoundingClientRect();
  const s: CSSProperties = { position: "fixed", zIndex: 9999, minWidth: Math.max(rect.width, DROP_W) };
  if (window.innerHeight - rect.bottom >= DROP_H || rect.top < DROP_H) {
    s.top = rect.bottom + 4;
  } else {
    s.bottom = window.innerHeight - rect.top + 4;
  }
  if (rect.left + DROP_W <= window.innerWidth) {
    s.left = rect.left;
  } else {
    s.left = Math.max(4, window.innerWidth - DROP_W - 4);
  }
  return s;
}

const PrintDropdownButton: FC<PrintDropdownButtonProps> = ({
  options,
  onSelect,
  disabled,
  title = "Печать",
}) => {
  const [open, setOpen] = useState(false);
  const [dropStyle, setDropStyle] = useState<CSSProperties>({});
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Пересчёт позиции при скролле / ресайзе пока меню открыто
  useEffect(() => {
    if (!open || !wrapRef.current) return;
    const el = wrapRef.current;
    const update = () => setDropStyle(computeDropStyle(el));
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Синхронно вычисляем позицию при открытии — до первого рендера меню
  const toggle = () => {
    if (!open && wrapRef.current) setDropStyle(computeDropStyle(wrapRef.current));
    setOpen((v) => !v);
  };

  return (
    <div ref={wrapRef} className={styles.DropdownWrap}>
      <IconButton
        size="md"
        icon="print"
        title={title}
        aria-label={title}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={toggle}
      />
      <button
        type="button"
        className={styles.DropdownCaret}
        aria-label="Выбрать макет печатной формы"
        disabled={disabled}
        onClick={toggle}
      >
        <Icon name="caretDown" />
      </button>
      {open && (
        <div role="menu" className={styles.DropdownMenu} style={dropStyle}>
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              role="menuitem"
              className={styles.DropdownItem}
              disabled={o.disabled}
              title={o.hint}
              onClick={() => {
                if (o.disabled) return;
                setOpen(false);
                onSelect(o.id);
              }}
            >
              <span className={styles.DropdownItemLabel}>{o.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

PrintDropdownButton.displayName = "Toolbar.PrintDropdownButton";
export default PrintDropdownButton;

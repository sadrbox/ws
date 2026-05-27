import { FC, useEffect, useRef, useState, type ReactNode } from "react";
import IconButton from "src/components/IconButton/IconButton";
import { Icon } from "src/components/IconButton/icons";
import { useDropdownPosition } from "./useDropdownPosition";
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

const PrintDropdownButton: FC<PrintDropdownButtonProps> = ({
  options,
  onSelect,
  disabled,
  title = "Печать",
}) => {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [dropRef, dropStyle] = useDropdownPosition(open, wrapRef);

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

  const toggle = () => setOpen((v) => !v);

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
        <div ref={dropRef} role="menu" className={styles.DropdownMenu} style={dropStyle}>
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

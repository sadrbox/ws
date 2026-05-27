import { FC, useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "src/components/IconButton/icons";
import { useDropdownPosition } from "./useDropdownPosition";
import styles from "./Toolbar.module.scss";

export interface ActionDropdownOption {
  id: string;
  label: string;
  disabled?: boolean;
  hint?: string;
}

interface ActionsDropdownButtonProps {
  label: string;
  options: ActionDropdownOption[];
  onSelect: (id: string) => void;
  disabled?: boolean;
  icon?: IconName;
}

const ActionsDropdownButton: FC<ActionsDropdownButtonProps> = ({ label, options, onSelect, disabled, icon }) => {
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

  return (
    <div ref={wrapRef} className={styles.DropdownWrap}>
      <button
        type="button"
        className={styles.ActionsButton}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {icon && <Icon name={icon} />}
        {label}
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

ActionsDropdownButton.displayName = "Toolbar.ActionsDropdownButton";
export default ActionsDropdownButton;

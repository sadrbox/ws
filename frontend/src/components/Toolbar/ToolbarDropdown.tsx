// Единый тулбар-дропдаун: кнопка-триггер + меню пунктов. Оболочка (позиционирование,
// клик-вне) — общий хук useDropdownMenu; здесь только разметка. Print/Save/Actions —
// тонкие обёртки над этим компонентом (отличаются лишь триггером и наличием иконок
// в пунктах).
import { FC, type ReactNode } from "react";
import IconButton from "src/components/IconButton/IconButton";
import { useDropdownMenu } from "./useDropdownPosition";
import styles from "./Toolbar.module.scss";

export interface ToolbarDropdownOption {
  id: string;
  label: ReactNode;
  /** Ведущая иконка пункта (опционально). */
  icon?: ReactNode;
  hint?: string;
  disabled?: boolean;
}

interface ToolbarDropdownProps {
  options: ToolbarDropdownOption[];
  onSelect: (id: string) => void;
  /** Содержимое кнопки-триггера (иконка, либо иконка+подпись+каретка). */
  trigger: ReactNode;
  /** icon — компактный IconButton; button — текст-кнопка (ActionsButton). */
  triggerVariant?: "icon" | "button";
  title?: string;
  disabled?: boolean;
}

const ToolbarDropdown: FC<ToolbarDropdownProps> = ({
  options,
  onSelect,
  trigger,
  triggerVariant = "icon",
  title,
  disabled,
}) => {
  const { open, toggle, setOpen, wrapRef, dropRef, dropStyle } = useDropdownMenu();

  const triggerNode = triggerVariant === "button" ? (
    <button
      type="button"
      className={styles.ActionsButton}
      disabled={disabled}
      title={title}
      onClick={toggle}
      aria-haspopup="menu"
      aria-expanded={open}
    >
      {trigger}
    </button>
  ) : (
    <IconButton
      size="md"
      className={styles.DropdownToggleButton}
      title={title}
      aria-label={title}
      aria-haspopup="menu"
      aria-expanded={open}
      disabled={disabled}
      onClick={toggle}
    >
      {trigger}
    </IconButton>
  );

  return (
    <div ref={wrapRef} className={styles.DropdownWrap}>
      {triggerNode}
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
              {o.icon && <span className={styles.DropdownItemIcon}>{o.icon}</span>}
              <span className={styles.DropdownItemLabel}>{o.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

ToolbarDropdown.displayName = "Toolbar.ToolbarDropdown";
export default ToolbarDropdown;

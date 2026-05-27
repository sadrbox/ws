import { FC, type ReactNode } from "react";
import IconButton from "src/components/IconButton/IconButton";
import { Icon } from "src/components/IconButton/icons";
import { useDropdownMenu } from "./useDropdownPosition";
import styles from "./Toolbar.module.scss";

export interface SaveDropdownOption {
  id: string;
  label: ReactNode;
  hint?: string;
  icon?: ReactNode;
  disabled?: boolean;
}

interface SaveDropdownButtonProps {
  options: SaveDropdownOption[];
  onSelect: (id: string) => void;
  disabled?: boolean;
  title?: string;
}

const SaveDropdownButton: FC<SaveDropdownButtonProps> = ({
  options,
  onSelect,
  disabled,
  title = "Сохранить",
}) => {
  const { open, toggle, setOpen, wrapRef, dropRef, dropStyle } = useDropdownMenu();

  return (
    <div ref={wrapRef} className={styles.DropdownWrap}>
      <IconButton
        size="md"
        icon="save"
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
        aria-label="Выбрать формат сохранения"
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
              {o.icon && <span className={styles.DropdownItemIcon}>{o.icon}</span>}
              <span className={styles.DropdownItemLabel}>{o.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

SaveDropdownButton.displayName = "Toolbar.SaveDropdownButton";
export default SaveDropdownButton;

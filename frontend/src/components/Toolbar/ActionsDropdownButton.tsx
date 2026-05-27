import { FC } from "react";
import { Icon, type IconName } from "src/components/IconButton/icons";
import { useDropdownMenu } from "./useDropdownPosition";
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
  const { open, toggle, setOpen, wrapRef, dropRef, dropStyle } = useDropdownMenu();

  return (
    <div ref={wrapRef} className={styles.DropdownWrap}>
      <button
        type="button"
        className={styles.ActionsButton}
        disabled={disabled}
        onClick={toggle}
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

// Кнопка действий с выпадающим списком (текст-триггер: [иконка] подпись ⌄).
// Тонкая обёртка над ToolbarDropdown с triggerVariant="button".
import { FC } from "react";
import { Icon, type IconName } from "src/components/IconButton/icons";
import ToolbarDropdown from "./ToolbarDropdown";

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
  /** Подсказка на кнопке — например причина, по которой она заблокирована. */
  title?: string;
}

const ActionsDropdownButton: FC<ActionsDropdownButtonProps> = ({
  label,
  options,
  onSelect,
  disabled,
  icon,
  title,
}) => (
  <ToolbarDropdown
    options={options}
    onSelect={onSelect}
    disabled={disabled}
    title={title}
    triggerVariant="button"
    trigger={<>{icon && <Icon name={icon} />}{label}<Icon name="caretDown" /></>}
  />
);

ActionsDropdownButton.displayName = "Toolbar.ActionsDropdownButton";
export default ActionsDropdownButton;

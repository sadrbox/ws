// Кнопка с вложенными командами: [иконка] подпись ⌄ + меню пунктов.
//
// Своей кнопки у неё НЕТ — рисует обычную кнопку приложения (components/Button) через
// ToolbarDropdown: вложенные команды не повод заводить вторую кнопку со своими цветами и
// высотой. Отличают её только каретка и меню.
import { FC } from "react";
import { Icon, type IconName } from "src/components/IconButton/icons";
import ToolbarDropdown from "./ToolbarDropdown";

export interface ActionDropdownOption {
  id: string;
  label: string;
  disabled?: boolean;
  hint?: string;
  /** Иконка пункта — 16×16 из общего реестра, как у кнопок. */
  icon?: IconName;
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
    options={options.map((o) => ({ ...o, icon: o.icon ? <Icon name={o.icon} /> : undefined }))}
    onSelect={onSelect}
    disabled={disabled}
    title={title}
    triggerVariant="button"
    triggerIcon={icon}
    triggerLabel={label}
  />
);

ActionsDropdownButton.displayName = "Toolbar.ActionsDropdownButton";
export default ActionsDropdownButton;

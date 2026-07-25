// Кнопка «Сохранить» с выпадающим списком режимов сохранения. Тонкая обёртка над
// ToolbarDropdown (иконка-триггер, пункты могут иметь ведущую иконку).
import { FC, type ReactNode } from "react";
import { Icon } from "src/components/IconButton/icons";
import ToolbarDropdown from "./ToolbarDropdown";

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
}) => (
  <ToolbarDropdown
    options={options}
    onSelect={onSelect}
    disabled={disabled}
    title={title}
    trigger={<Icon name="save" />}
  />
);

SaveDropdownButton.displayName = "Toolbar.SaveDropdownButton";
export default SaveDropdownButton;

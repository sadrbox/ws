// Кнопка «Печать» с выпадающим списком макетов. Тонкая обёртка над ToolbarDropdown
// (иконка-триггер, пункты без ведущих иконок).
import { FC, type ReactNode } from "react";
import { Icon } from "src/components/IconButton/icons";
import ToolbarDropdown from "./ToolbarDropdown";

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
}) => (
  <ToolbarDropdown
    options={options}
    onSelect={onSelect}
    disabled={disabled}
    title={title}
    trigger={<Icon name="print" />}
  />
);

PrintDropdownButton.displayName = "Toolbar.PrintDropdownButton";
export default PrintDropdownButton;

import { FC, ChangeEvent, CSSProperties } from "react";
import { FieldSelect } from "src/components/Field";

export interface PaneHeaderSelectOption { value: string; label: string }

interface PaneHeaderSelectProps {
  name: string;
  value: string;
  options: PaneHeaderSelectOption[];
  onChange: (e: ChangeEvent<HTMLSelectElement>) => void;
  /** Ширина (px или css-значение). По умолчанию 200px. */
  width?: number | string;
  disabled?: boolean;
}

/**
 * PaneHeaderSelect — ЕДИНЫЙ выпадающий список для шапки панели
 * (PaneItemHeaderToolbar): компактный `size="sm"` + единая ширина/вид. Использовать
 * вместо «сырого» FieldSelect в шапке (предпросмотр печати, просмотр файла и т.п.),
 * чтобы все селекты в шапках выглядели одинаково.
 */
const PaneHeaderSelect: FC<PaneHeaderSelectProps> = ({ name, value, options, onChange, width = 200, disabled }) => (
  <FieldSelect
    size="sm"
    label=""
    name={name}
    value={value}
    options={options}
    onChange={onChange}
    disabled={disabled}
    style={{ width: typeof width === "number" ? `${width}px` : width } as CSSProperties}
  />
);

export default PaneHeaderSelect;
export { PaneHeaderSelect };

// Единый тулбар-дропдаун: кнопка-триггер + меню пунктов. Оболочка (позиционирование,
// клик-вне) — общий хук useDropdownMenu; здесь только разметка. Print/Save/Actions —
// тонкие обёртки над этим компонентом (отличаются лишь триггером и наличием иконок
// в пунктах).
import { FC, Fragment, useContext, type ReactNode } from "react";
import IconButton from "src/components/IconButton/IconButton";
import { Button } from "src/components/Button";
import type { IconName } from "src/components/IconButton/icons";
import { useDropdownMenu } from "./useDropdownPosition";
import { ButtonSizeContext } from "src/components/Button/sizeContext";
import styles from "./Toolbar.module.scss";

export interface ToolbarDropdownOption {
  id: string;
  label: ReactNode;
  /** Ведущая иконка пункта (опционально). */
  icon?: ReactNode;
  hint?: string;
  disabled?: boolean;
  /**
   * Раздел меню. Пункты с одним разделом идут подряд; на смене раздела рисуются черта и его заголовок. Пункты без
   * раздела — обычный список, как прежде.
   */
  group?: string;
  /** Разрушающая команда: красный текст — чтобы её не нажимали по привычке рядом с безопасными. */
  danger?: boolean;
}

interface ToolbarDropdownProps {
  options: ToolbarDropdownOption[];
  onSelect: (id: string) => void;
  /** Содержимое кнопки-триггера для варианта icon. */
  trigger?: ReactNode;
  /** icon — компактный IconButton; button — обычная кнопка приложения с кареткой. */
  triggerVariant?: "icon" | "button";
  /** Вариант button: подпись и ведущая иконка — каретку дорисовывает сам триггер. */
  triggerLabel?: ReactNode;
  triggerIcon?: IconName;
  title?: string;
  disabled?: boolean;
}

const ToolbarDropdown: FC<ToolbarDropdownProps> = ({
  options,
  onSelect,
  trigger,
  triggerVariant = "icon",
  triggerLabel,
  triggerIcon,
  title,
  disabled,
}) => {
  const { open, toggle, setOpen, wrapRef, dropRef, dropStyle } = useDropdownMenu();
  /*
   * РАЗМЕР — ИЗ ОБЛАСТИ (19.09). В тулбаре пейна кнопки маленькие (ButtonSizeContext = sm, см. usePaneToolbar), и
   * дропдаун обязан стоять с ними в рост: кнопка-подпись берёт размер сама (это Button), а кнопку-иконку («Печать ▾»,
   * «Сохранить ▾») переводим в sm здесь — иначе она одна выше соседей. Вне тулбара — прежний md.
   */
  const areaSize = useContext(ButtonSizeContext);
  const iconSize = areaSize === "sm" ? "sm" : "md";

  /*
   * Триггер варианта button — ОБЫЧНАЯ кнопка приложения (components/Button), а не своя
   * разметка со своими цветами: «На основании ▾» и «Печать» стоят в одном ряду с
   * «Добавить» и «Удалить», и собственная высота с собственным градиентом делали ряд
   * разнобойным. Всё, что добавляет дропдаун, — каретка и нажатый вид открытого меню.
   */
  const triggerNode = triggerVariant === "button" ? (
    <Button
      icon={triggerIcon}
      trailingIcon="caretDown"
      disabled={disabled}
      title={title}
      active={open}
      onClick={toggle}
      aria-haspopup="menu"
      aria-expanded={open}
    >
      {triggerLabel ?? trigger}
    </Button>
  ) : (
    <IconButton
      size={iconSize}
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
          {options.map((o, i) => {
            const opensGroup = !!o.group && o.group !== options[i - 1]?.group;
            return (
              <Fragment key={o.id}>
                {opensGroup && (
                  <div role="presentation" className={[styles.DropdownGroup, i > 0 ? styles.DropdownGroupSeparated : null].filter(Boolean).join(" ")}>
                    {o.group}
                  </div>
                )}
                <button
                  type="button"
                  role="menuitem"
                  className={[styles.DropdownItem, o.danger ? styles.DropdownItemDanger : null].filter(Boolean).join(" ")}
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
              </Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
};

ToolbarDropdown.displayName = "Toolbar.ToolbarDropdown";
export default ToolbarDropdown;

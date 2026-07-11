/**
 * Toolbar — единый переиспользуемый компонент панели управления.
 *
 * Иконки берутся из единого реестра `src/components/icons` через общий
 * `IconButton`. Старые PNG/SVG-ассеты больше не импортируются.
 *
 * @example
 * <Toolbar right={<SearchField />}>
 *   <Button>Добавить</Button>
 *   <Toolbar.Divider />
 *   <Toolbar.ReloadButton onClick={refresh} disabled={loading} />
 * </Toolbar>
 */

import {
  FC,
  forwardRef,
  type ReactNode,
} from "react";
import IconButton, {
  type IconButtonProps,
} from "src/components/IconButton/IconButton";
import { Icon, type IconName, ClearIcon } from "src/components/IconButton/icons";
import { translate } from "src/i18";
import styles from "./Toolbar.module.scss";

// ─── Toolbar (контейнер) ────────────────────────────────────────────────

interface ToolbarProps {
  children?: ReactNode;
  /** Контент правой части (напр. строка поиска) */
  right?: ReactNode;
  className?: string;
}

const ToolbarRoot: FC<ToolbarProps> = ({ children, right, className }) => (
  <div className={[styles.Toolbar, className].filter(Boolean).join(" ")}>
    {children && <div className={styles.ToolbarGroup}>{children}</div>}
    {right && <div className={styles.ToolbarRight}>{right}</div>}
  </div>
);

ToolbarRoot.displayName = "Toolbar";

// ─── Toolbar.Slot — невидимый портальный слот ───────────────────────────

const ToolbarSlot = forwardRef<HTMLDivElement>((_, ref) => (
  <div ref={ref} className={styles.ToolbarSlot} />
));
ToolbarSlot.displayName = "Toolbar.Slot";

// ─── Toolbar.Divider ────────────────────────────────────────────────────

const ToolbarDivider: FC = () => <div className={styles.ToolbarDivider} />;
ToolbarDivider.displayName = "Toolbar.Divider";

// ─── Toolbar.IconButton — переиспользуемая иконочная кнопка ─────────────

type ToolbarIconButtonProps = IconButtonProps;

const ToolbarIconButton: FC<ToolbarIconButtonProps> = (props) => (
  <IconButton size="md" {...props} />
);
ToolbarIconButton.displayName = "Toolbar.IconButton";

// ─── Хелпер для типовых именованных кнопок ──────────────────────────────

type NamedButtonProps = Omit<ToolbarIconButtonProps, "icon">;

function makeButton(name: IconName, label: string) {
  const Cmp: FC<NamedButtonProps> = ({ title, ...rest }) => (
    <ToolbarIconButton
      icon={name}
      title={title ?? label}
      aria-label={label}
      {...rest}
    />
  );
  Cmp.displayName = `Toolbar.${label}`;
  return Cmp;
}

const ReloadButton = makeButton("reload", translate("refresh"));
const SettingsButton = makeButton("settings", translate("columnSettings"));
const PeriodButton = makeButton("calendar", translate("period"));
const SearchButton = makeButton("search", translate("search"));
const InlineEditButton = makeButton("editInline", translate("inlineEdit"));
const MakePrimaryButton = makeButton("makePrimary", translate("makePrimary"));
const RecalcButton = makeButton("recalc", translate("recalc"));
const RefillButton = makeButton("restore", translate("restore"));
const PrintButton = makeButton("print", translate("print"));

// ─── Toolbar.ClearButton ────────────────────────────────────────────────

const ClearButton: FC<Omit<ToolbarIconButtonProps, "icon" | "children">> = ({
  className,
  title,
  ...props
}) => (
  <ToolbarIconButton
    className={[styles.ClearButton, className].filter(Boolean).join(" ")}
    title={title ?? translate("clear")}
    aria-label={translate("clear")}
    {...props}
  >
    <ClearIcon />
  </ToolbarIconButton>
);
ClearButton.displayName = "Toolbar.ClearButton";

// ─── Toolbar.ToggleSplit — переключатель вида списка (list / split) ──────
const ToggleSplit: FC<{
  pressed?: boolean;
  onClick?: () => void;
  title?: string;
}> = ({ pressed = false, onClick, title }) => (
  <ToolbarIconButton
    icon={pressed ? "viewSplit" as IconName : "list" as IconName}
    aria-pressed={pressed}
    aria-label={title ?? translate("toolbar.toggleSplit")}
    title={title ?? translate("toolbar.toggleSplit")}
    onClick={onClick}
  />
);
ToggleSplit.displayName = "Toolbar.ToggleSplit";

// ─── Compound export ────────────────────────────────────────────────────

type ToolbarComponent = typeof ToolbarRoot & {
  Slot: typeof ToolbarSlot;
  Divider: typeof ToolbarDivider;
  IconButton: typeof ToolbarIconButton;
  Icon: typeof Icon;
  ReloadButton: typeof ReloadButton;
  SettingsButton: typeof SettingsButton;
  PeriodButton: typeof PeriodButton;
  ToggleSplit: typeof ToggleSplit;
  SearchButton: typeof SearchButton;
  InlineEditButton: typeof InlineEditButton;
  MakePrimaryButton: typeof MakePrimaryButton;
  RecalcButton: typeof RecalcButton;
  RefillButton: typeof RefillButton;
  PrintButton: typeof PrintButton;
  ClearButton: typeof ClearButton;
};

const Toolbar = ToolbarRoot as ToolbarComponent;
Toolbar.Slot = ToolbarSlot;
Toolbar.Divider = ToolbarDivider;
Toolbar.IconButton = ToolbarIconButton;
Toolbar.Icon = Icon;
Toolbar.ReloadButton = ReloadButton;
Toolbar.SettingsButton = SettingsButton;
Toolbar.PeriodButton = PeriodButton;
Toolbar.ToggleSplit = ToggleSplit;
Toolbar.SearchButton = SearchButton;
Toolbar.InlineEditButton = InlineEditButton;
Toolbar.MakePrimaryButton = MakePrimaryButton;
Toolbar.RecalcButton = RecalcButton;
Toolbar.RefillButton = RefillButton;
Toolbar.PrintButton = PrintButton;
Toolbar.ClearButton = ClearButton;

export {
  Toolbar,
  ToolbarSlot,
  ToolbarDivider,
  ToolbarIconButton as IconButton,
  ReloadButton,
  SettingsButton,
  PeriodButton,
  SearchButton,
  InlineEditButton,
  MakePrimaryButton,
  RecalcButton,
  RefillButton,
  PrintButton,
  ClearButton,
};
export default Toolbar;

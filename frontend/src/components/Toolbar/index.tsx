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
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import IconButton, {
  type IconButtonProps,
} from "src/components/IconButton/IconButton";
import { Icon, type IconName, CloseIcon } from "src/components/IconButton/icons";
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

// ─── Toolbar.CloseButton ────────────────────────────────────────────────

const CloseButton: FC<Omit<ToolbarIconButtonProps, "icon" | "children">> = ({
  className,
  title,
  ...props
}) => (
  <ToolbarIconButton
    className={[styles.CloseButton, className].filter(Boolean).join(" ")}
    title={title ?? translate("close")}
    aria-label={translate("close")}
    {...props}
  >
    <CloseIcon />
  </ToolbarIconButton>
);
CloseButton.displayName = "Toolbar.CloseButton";

// ─── Backwards-compat: ImageButton (для редких внешних потребителей) ────

interface LegacyImageButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  src: string;
  alt: string;
}

const ImageButton: FC<LegacyImageButtonProps> = ({ src, alt, ...rest }) => (
  <ToolbarIconButton {...rest}>
    <img src={src} alt={alt} width={16} height={16} />
  </ToolbarIconButton>
);
ImageButton.displayName = "Toolbar.ImageButton";

// ─── Compound export ────────────────────────────────────────────────────

type ToolbarComponent = typeof ToolbarRoot & {
  Slot: typeof ToolbarSlot;
  Divider: typeof ToolbarDivider;
  IconButton: typeof ToolbarIconButton;
  Icon: typeof Icon;
  ImageButton: typeof ImageButton;
  ReloadButton: typeof ReloadButton;
  SettingsButton: typeof SettingsButton;
  PeriodButton: typeof PeriodButton;
  SearchButton: typeof SearchButton;
  InlineEditButton: typeof InlineEditButton;
  MakePrimaryButton: typeof MakePrimaryButton;
  RecalcButton: typeof RecalcButton;
  RefillButton: typeof RefillButton;
  PrintButton: typeof PrintButton;
  CloseButton: typeof CloseButton;
};

const Toolbar = ToolbarRoot as ToolbarComponent;
Toolbar.Slot = ToolbarSlot;
Toolbar.Divider = ToolbarDivider;
Toolbar.IconButton = ToolbarIconButton;
Toolbar.Icon = Icon;
Toolbar.ImageButton = ImageButton;
Toolbar.ReloadButton = ReloadButton;
Toolbar.SettingsButton = SettingsButton;
Toolbar.PeriodButton = PeriodButton;
Toolbar.SearchButton = SearchButton;
Toolbar.InlineEditButton = InlineEditButton;
Toolbar.MakePrimaryButton = MakePrimaryButton;
Toolbar.RecalcButton = RecalcButton;
Toolbar.RefillButton = RefillButton;
Toolbar.PrintButton = PrintButton;
Toolbar.CloseButton = CloseButton;

export {
  Toolbar,
  ToolbarSlot,
  ToolbarDivider,
  ToolbarIconButton as IconButton,
  ImageButton,
  ReloadButton,
  SettingsButton,
  PeriodButton,
  SearchButton,
  InlineEditButton,
  MakePrimaryButton,
  RecalcButton,
  RefillButton,
  PrintButton,
  CloseButton,
};
export default Toolbar;

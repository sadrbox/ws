/**
 * Toolbar — единый переиспользуемый компонент панели управления.
 *
 * Заменяет разрозненные паттерны:
 *   FormPanel > TablePanelLeft > colGroup
 *   TablePanel > TablePanelLeft + TablePanelRight
 *   <div style={{display:"flex", gap:8, ...}}>
 *
 * @example
 * // Самостоятельная панель (Table, SalesBoardForm)
 * <Toolbar right={<SearchField />}>
 *   <Button>Добавить</Button>
 *   <Toolbar.Divider />
 *   <Toolbar.ReloadButton onClick={refresh} disabled={loading} />
 * </Toolbar>
 *
 * @example
 * // Через портал в заголовок панели
 * usePaneToolbar(paneId, (
 *   <>
 *     <Button variant="primary" onClick={save}>Сохранить</Button>
 *     <Toolbar.Divider />
 *   </>
 * ));
 */

import { FC, forwardRef, type ButtonHTMLAttributes, type ImgHTMLAttributes, type ReactNode } from "react";
import reload_16 from "src/assets/reload_16.png";
import settingsForm_16 from "src/assets/form-setting_16.png";
import calendar_16 from "src/assets/calendar_16.png";
import searchField_16 from "src/assets/search-field_16.png";
import editInlineIcon from "src/assets/edit-inline_16.svg";
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

// ─── Toolbar.IconButton — произвольная иконочная кнопка ─────────────────

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
}

const IconButton: FC<IconButtonProps> = ({ className, active, style, ...props }) => (
  <button
    type="button"
    className={[styles.IconButton, className].filter(Boolean).join(" ")}
    style={{ ...style, ...(active ? { background: "hsla(210, 79%, 46%, 0.12)", color: "#1976d2" } : undefined) }}
    {...props}
  />
);
IconButton.displayName = "Toolbar.IconButton";

interface ToolbarImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> {
  src: string;
}

const ToolbarImage: FC<ToolbarImageProps> = ({ alt, width = 16, height = 16, ...props }) => (
  <img alt={alt} width={width} height={height} {...props} />
);
ToolbarImage.displayName = "Toolbar.Image";

interface ToolbarImageButtonProps extends IconButtonProps {
  src: string;
  alt: string;
  imageProps?: Omit<ToolbarImageProps, "src" | "alt">;
}

const ImageButton: FC<ToolbarImageButtonProps> = ({ src, alt, imageProps, ...props }) => (
  <IconButton {...props}>
    <ToolbarImage src={src} alt={alt} {...imageProps} />
  </IconButton>
);
ImageButton.displayName = "Toolbar.ImageButton";

const ReloadButton: FC<Omit<ToolbarImageButtonProps, "src" | "alt">> = (props) => (
  <ImageButton src={reload_16} alt="Обновить" title="Обновить" {...props} />
);
ReloadButton.displayName = "Toolbar.ReloadButton";

const SettingsButton: FC<Omit<ToolbarImageButtonProps, "src" | "alt">> = (props) => (
  <ImageButton src={settingsForm_16} alt="Настройки колонок" title="Настройки колонок" {...props} />
);
SettingsButton.displayName = "Toolbar.SettingsButton";

const PeriodButton: FC<Omit<ToolbarImageButtonProps, "src" | "alt">> = (props) => (
  <ImageButton src={calendar_16} alt="Период" title="Период" {...props} />
);
PeriodButton.displayName = "Toolbar.PeriodButton";

const SearchButton: FC<Omit<ToolbarImageButtonProps, "src" | "alt">> = (props) => (
  <ImageButton src={searchField_16} alt="Поиск" title="Поиск" {...props} />
);
SearchButton.displayName = "Toolbar.SearchButton";

const InlineEditButton: FC<Omit<ToolbarImageButtonProps, "src" | "alt">> = (props) => (
  <ImageButton src={editInlineIcon} alt="Редактирование в таблице" title="Редактирование в таблице" {...props} />
);
InlineEditButton.displayName = "Toolbar.InlineEditButton";

// ─── Toolbar.CloseButton — кнопка закрытия с hover-эффектом (синий → красный) ───

type CloseButtonProps = Omit<IconButtonProps, "children">;

const CloseButton: FC<CloseButtonProps> = ({ className, ...props }) => (
  <IconButton
    className={[styles.CloseButton, className].filter(Boolean).join(" ")}
    title="Закрыть"
    {...props}
  >
    <div className={styles.CloseIcon}>✕</div>
    <div className={styles.CloseIconHover} style={{ filter: "invert(19%) sepia(95%) saturate(7477%) hue-rotate(359deg) brightness(98%) contrast(113%)" }}>✕</div>
  </IconButton>
);
CloseButton.displayName = "Toolbar.CloseButton";

// ─── Compound export ────────────────────────────────────────────────────

type ToolbarComponent = typeof ToolbarRoot & {
  Slot: typeof ToolbarSlot;
  Divider: typeof ToolbarDivider;
  IconButton: typeof IconButton;
  Image: typeof ToolbarImage;
  ImageButton: typeof ImageButton;
  ReloadButton: typeof ReloadButton;
  SettingsButton: typeof SettingsButton;
  PeriodButton: typeof PeriodButton;
  SearchButton: typeof SearchButton;
  InlineEditButton: typeof InlineEditButton;
  CloseButton: typeof CloseButton;
};

const Toolbar = ToolbarRoot as ToolbarComponent;
Toolbar.Slot = ToolbarSlot;
Toolbar.Divider = ToolbarDivider;
Toolbar.IconButton = IconButton;
Toolbar.Image = ToolbarImage;
Toolbar.ImageButton = ImageButton;
Toolbar.ReloadButton = ReloadButton;
Toolbar.SettingsButton = SettingsButton;
Toolbar.PeriodButton = PeriodButton;
Toolbar.SearchButton = SearchButton;
Toolbar.InlineEditButton = InlineEditButton;
Toolbar.CloseButton = CloseButton;

export {
  Toolbar,
  ToolbarSlot,
  ToolbarDivider,
  IconButton,
  ToolbarImage,
  ImageButton,
  ReloadButton,
  SettingsButton,
  PeriodButton,
  SearchButton,
  InlineEditButton,
  CloseButton,
};
export default Toolbar;

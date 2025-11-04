import { CSSProperties, FC, PropsWithChildren, useState } from 'react';
import { useAppContextProps } from './AppContextProvider';
import styles from "./styles/main.module.scss"
import NavigationPage from './pages/NavigationPage';
import ActivityHistories from 'src/models/ActivityHistories';
import ContractForm from 'src/models/Contracts/form';

type TypeGroupProps = {
  align?: 'row' | 'col';
  type?: 'easy' | 'medium' | 'hard';
  gap?: string;
  className?: string | string[];
  style?: CSSProperties;
} & PropsWithChildren;

export const Group: FC<TypeGroupProps> = ({ align, gap, type, className, style, children }) => {

  let visibleType: string;
  if (type === 'easy') {
    visibleType = styles.BG_EASY;
  } else if (type === 'medium') {
    visibleType = styles.BG_MEDIUM;
  } else if (type === 'hard') {
    visibleType = styles.BG_HARD;
  } else {
    visibleType = "";
  }

  const reStyle = {
    ...({ borderRadius: '2px' }), ...style, ...(gap && { gap }), ...(type && { padding: '3px', margin: '3px' })
  }
  return (
    <div
      className={[align === 'row' ? styles.RowGroup : styles.ColGroup, type && visibleType, className].filter(s => s && s).join(" ")}
      style={reStyle}>
      {children}
    </div >
  );
};

export const HorizontalLine = () => {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '6px 0' }}>
      <span className={styles.HorizontalLine}></span>
    </div>
  )
}

export const Navbar: FC = () => {

  const context = useAppContextProps();

  const openPane = context?.actions.openPane;

  return (
    <div className={styles.NavbarWrapper}>
      <a href="#" className={styles.NavbarItem} onClick={() => openPane(<NavigationPage />)}>
        Навигация
      </a>
      <a href="#" className={styles.NavbarItem} onClick={() => openPane(<ActivityHistories />)}>
        История активности
      </a>
      <a href="#" className={styles.NavbarItem} onClick={() => openPane(<ContractForm />)}>
        Форма
      </a>
    </div>
  );
};
export const PaneTab: FC = () => {

  const context = useAppContextProps();
  const { tabs, activeID } = context?.panes;
  const setActivePaneID = context?.actions.setActivePaneID;



  return (
    <div className={styles.PaneTabWrapper}>
      {tabs.map((tab) => (
        <div className={[styles.PaneTab, tab.id === activeID ? styles.PaneTabActive : ""].filter(s => s && s).join(" ")}
          key={tab.id}
          onClick={() => setActivePaneID(tab.id)}
        >
          {tab.label}
        </div>
      ))}
    </div>
  );
};
export const PaneGroup = () => {
  const context = useAppContextProps();
  const { tabs, activeID } = context?.panes;
  return (
    <div className={styles.PaneGroupWrapper}>
      {tabs.map((tab) => (
        <div key={tab.id} className={[styles.Pane, tab.id === activeID ? styles.ActivePane : ""].filter(s => s && s).join(" ")}>
          {tab.content}
        </div>
      ))}
    </div>
  )
}
type TypeOverFormProps = PropsWithChildren<{}>;
export const OverForm: FC<TypeOverFormProps> = ({ children }) => {
  return (
    <div className={styles.OverFormNest}>
      <div className={styles.OverFormTringleIcon}>
        <svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" strokeWidth='2' stroke-linejoin="round" stroke-linecap="round">
          <polygon points="4,10 12,10 8,4" fill="#eee" />

          <line x1="4" y1="10" x2="8" y2="4" stroke="#aaa" stroke-width="1" stroke-linejoin="round" stroke-linecap="round" />

          <line x1="8" y1="4" x2="12" y2="10" stroke="#aaa" stroke-width="1" stroke-linejoin="round" stroke-linecap="round" />
        </svg>
      </div>
      <div className={styles.OverFormWrapper}>
        {children}
      </div>
    </div>
  )
}
import { FC, PropsWithChildren, useState } from 'react';
import { useAppContextProps } from './AppContextProvider';
import styles from "./styles/main.module.scss"


export const GroupBox: FC<{ align: 'row' | 'col'; gap?: string } & PropsWithChildren> = ({ align, gap, children }) => {

  return (
    <div className={align === 'row' ? styles.GroupBoxRow : styles.GroupBoxColumn} style={gap ? { gap: gap } : undefined}>
      {children}
    </div >
  );
};

export const GroupBoxRow: FC<{ gap?: string } & PropsWithChildren> = ({ gap, children }) => {

  return (
    <div className={styles.RowGroup} style={gap ? { gap: gap } : undefined}>
      {children}
    </div >
  );
};
export const GroupBoxCol: FC<{ gap?: string } & PropsWithChildren> = ({ gap, children }) => {

  return (
    <div className={styles.ColGroup} style={gap ? { gap: gap } : undefined}>
      {children}
    </div >
  );
};

export const Navbar: FC = () => {

  const context = useAppContextProps();

  const openPane = context?.actions.openPane;

  return (
    <div className={styles.NavbarWrapper}>
      <a href="#" className={styles.NavbarItem} onClick={() => openPane('NavigationPage')}>
        Навигация
      </a>
      <a href="#" className={styles.NavbarItem} onClick={() => openPane('ActivityHistories')}>
        История активности
      </a>
      <a href="#" className={styles.NavbarItem} onClick={() => openPane('ContractFORM')}>
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
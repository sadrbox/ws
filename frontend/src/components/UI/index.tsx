import React, { createContext, CSSProperties, FC, PropsWithChildren, useContext, useEffect, useState, forwardRef, useRef, useImperativeHandle, ReactPortal, ReactNode, SetStateAction } from 'react';
import { useAppContextProps } from '../../app/AppContextProvider';
import styles from "../../app/styles/main.module.scss"
import ListActivityHistories from 'src/models/activityhistories/list';
import ContractForm from 'src/models/contracts/form';
import ReactDOM, { createPortal } from 'react-dom';
import { ref } from 'process';
import { usePortal } from 'src/hooks/usePortal';
import ListOrganizations from 'src/models/organizations/list';
import Counterparties from 'src/models/counterparties';
import ListContracts from 'src/models/contracts/list';

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
    ...({ borderRadius: '2px' }), ...style, ...(gap && { gap: gap }), ...(type && { padding: '3px', margin: '3px' })
  }
  return (
    <div className={[align === 'row'
      ?
      styles.RowGroup
      :
      styles.ColGroup,
    type
    &&
    visibleType,
      className].filter(s => s && s).join(" ")}
      style={reStyle}>
      {children}
    </div>
  );
};

export const HorizontalLine = () => {
  return (
    <div style={{
      display: 'flex'
      ,
      alignItems: 'center'
      ,
      justifyContent: 'center'
      ,
      margin: '6px 0'
    }}>
      <span className={styles.HorizontalLine}></span>
    </div>
  )
}

export const Content = () => {

  const context = useAppContextProps();
  const isPaneShow = context.panes.length > 0;
  // console.log(isPaneShow);

  return isPaneShow ? (
    <>
      <PaneGroup />
      <PaneTab />
    </>
  ) : (<></>);

}
// export const Navbar: FC = () => {

//   const context = useAppContextProps();

//   const openPane = context?.actions.openPane;

//   return (
//     <div className={styles.NavbarWrapper}>
//       <a href="#"
//         Навигация
//       </a>
//       <a href="#"
//         className={styles.NavbarItem}
//         onClick={() => openPane(<ListActivityHistories />)}>
//         История активности
//       </a>
//       <a href="#"
//         className={styles.NavbarItem}
//         onClick={() => openPane(
//           <ContractForm />)}>
//         Форма
//       </a>
//     </div>
//   );
// };
export const PaneTab: FC = () => {

  const context = useAppContextProps();
  const panes = context?.panes;
  const setActivePaneID = context?.actions.setActivePaneID;



  return (
    <div className={styles.PaneTabWrapper}>
      {panes.map(p => (
        <div
          key={p.id}
          className={[styles.PaneTab, p.isActive && styles.PaneTabActive].join(" ")}
          onClick={() => setActivePaneID(p.id)}>
          {p.label}
        </div>
      ))}
    </div>
  );
};

export const PaneGroup = () => {
  const context = useAppContextProps();
  const panes = context?.panes;
  return (
    <div className={styles.PaneGroupWrapper}>
      {panes.map((p) => (
        <div key={p.id}
          className={[styles.Pane, p.isActive && styles.ActivePane].join(" ")}>
          {p.component}
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
        <svg width="16"
          height="16"
          viewBox="0 0 16 16"
          xmlns="http://www.w3.org/2000/svg"
          strokeWidth='2'
          stroke-linejoin="round"
          stroke-linecap="round">
          <polygon points="4,10 12,10 8,4"
            fill="#eee" />

          <line x1="4"
            y1="10"
            x2="8"
            y2="4"
            stroke="#aaa"
            stroke-width="1"
            stroke-linejoin="round"
            stroke-linecap="round" />

          <line x1="8"
            y1="4"
            x2="12"
            y2="10"
            stroke="#aaa"
            stroke-width="1"
            stroke-linejoin="round"
            stroke-linecap="round" />
        </svg>
      </div>
      <div className={styles.OverFormWrapper}>
        {children}
      </div>
    </div>
  )
}

export const Portal = ({ content }: { content: React.ReactNode }) => {
  if (!content) return null;
  const RootPortal = document.getElementById("RootPortal")!;
  RootPortal.className = styles.RootPortal;

  return createPortal(
    <div className={styles.PortalWrapper}>{content}</div>,
    RootPortal
  );
};

// export const Overlay: React.FC<OverlayProps> = ({ isOpen, onClose, children }) => {
//   if (!isOpen) return null;

//   return (
//     <Portal>
//       <div
//         style={{
//           position: 'fixed',
//           top: 0, left: 0, right: 0, bottom: 0,
//           backgroundColor: 'rgba(245, 0, 0, 0.5)',
//           display: 'flex',
//           alignItems: 'center',
//           justifyContent: 'center',
//           zIndex: 1000
//         }}
//         onClick={onClose}
//       >
//         {children}
//       </div>
//     </Portal>
//   );
// };





// Контекст для системы панелей
interface PaneContextType {
  activePane: string | null;
  setActivePane: (id: string) => void;
  registerPane: (id: string, title: string) => void;
  panes: { id: string; title: string }[];
}

const PaneContext = createContext<PaneContextType | undefined>(undefined);

const usePane = () => {
  const context = useContext(PaneContext);
  if (!context) throw new Error('usePane only in PaneGroup');
  return context;
};

interface ScreenProps {
  children: React.ReactNode;
}

// Основные компоненты интерфейса
export const Screen = forwardRef<HTMLDivElement, ScreenProps>(({ children }, ref) => {
  const internalRef = useRef<HTMLDivElement | null>(null);

  useImperativeHandle(ref, () => internalRef.current!, []);

  return (
    <div ref={internalRef} className={styles.Screen}>
      {children}
    </div>
  );
});

// export const Navbar: React.FC = () => {
//   const context = useAppContextProps();

//   // const portal = usePortal();
//   // const { show, hide, Portal } = usePortal();
//   const openPane = context?.actions.openPane;
//   // const setOverlay = context?.actions.setOverlay;
//   // const onClose = context?.overlay.onClose;

//   const { getOverlay, setOverlay } = context.overlay;

//   const modalForm = () => {
//     setOverlay(prev => ({ ...prev, isVisible: true, content: <NavigationPage /> }))
//   }

//   return (
//     <>
//       <div className={styles.NavbarWrapper}>
//         <div className={styles.Active}>
//           <a href="#"
//             onClick={() => modalForm()}
//             className={styles.NavbarItem}>
//             Навигация
//           </a>
//         </div>
//         <div>
//           <a href="#"
//             className={styles.NavbarItem}
//             onClick={() => openPane(<ListActivityHistories />)}>
//             История активности
//           </a>
//         </div>
//         <div>
//           <a href="#"
//             className={styles.NavbarItem}
//             onClick={() => openPane(
//               <ContractForm />)}>
//             Форма
//           </a>
//         </div>
//       </div>
//       {getOverlay.isVisible && <NavbarOverlay />}
//     </>
//   );
// };



type TypeNavbarItem = {
  id: string;
  isActive: boolean;
  title: string;
  component: React.ReactNode;
}



export const Navbar: React.FC = () => {
  const context = useAppContextProps();

  const { props, setProps } = context?.navbar;
  const activeNav = props.find(nav => nav.isActive);
  // const [navs, setNavs] = useState(items);
  // const [activeNav, setActiveNav] = useState(items[0]);

  const setActive = (id: string) => {
    setProps(prev => prev.map(nav => ({ ...nav, isActive: nav.id === id })))
    // setActiveNav(items.find(nav => nav.id === id) ?? items[0])
  }

  const toggleNav = (id: string) => {
    setProps(prev => prev.map(n =>
      n.id === id
        ? { ...n, isActive: !n.isActive }
        : { ...n, isActive: false }
    ))
  }

  return (
    <>
      <div className={styles.NavbarWrapper}>
        {props.map(nav => (
          <div key={nav.id}>
            <a href="#"
              onClick={() => toggleNav(nav.id)}
              className={[styles.NavbarItem, nav.isActive && styles.Active].join(" ")}>
              {nav.title}
            </a>
          </div>
        ))}
      </div>
      {activeNav && <div className={styles.NavbarOverlayWrapper}>{activeNav?.component}</div>}
    </>
  )
}
type TypeNavListProps = {
  lable: string;
}

export const NavList = ({ lable }: TypeNavListProps) => {

  const context = useAppContextProps();
  const addPane = context.actions.addPane;

  if (lable.toLocaleLowerCase() === "Operations".toLocaleLowerCase()) {
    // Торговля
    return (
      <div className={styles.NavListWrapper}>
        <h1>Операционная деятельность</h1>
        <Group gap='64px'>
          <div>
            <h3>Продажи</h3>
            <ul className={styles.NavList}>
              <li>Реализация товара и услуг</li>
              <li>Электронная счет-фактура (исходящие)</li>
              <li>Счет на оплату</li>
            </ul>
          </div>
          <div>
            <h3>Закупка</h3>
            <ul className={styles.NavList}>
              <li>Поступление товара и услуг</li>
              <li>Электронная счет-фактура (входящие)</li>
            </ul>
          </div>
        </Group>
        <Group gap='64px'>
          <div>
            <h3>Справочники</h3>
            <ul className={styles.NavList}>
              <li>Склады</li>
              <li onClick={() => addPane(<ListOrganizations />)}>Организации</li>
              <li onClick={() => addPane(<Counterparties.List />)}>Контрагенты</li>
              <li onClick={() => addPane(<ListContracts />)}>Договора</li>
            </ul>
          </div>
        </Group >
      </div >
    )
  } else if (lable.toLocaleLowerCase() === "CRM".toLocaleLowerCase()) {
    // CRM
    return (
      <div className={styles.NavListWrapper}>
        <h1>CRM</h1>
        <Group gap='64px'>
          <div>
            <h3>Управление задачами</h3>
            <ul className={styles.NavList}>
              <li>Задачи</li>
              <li>Регламентные задачи</li>
            </ul>
          </div>
          <div>
            <h3>Справочники</h3>
            <ul className={styles.NavList}>
              {/* <li onClick={() => alert("0")}></li> */}
              {/* <li onClick={() => addPane(<ListCounterparties />)}>Контрагенты</li> */}
              {/* <li onClick={() => addPane(<ListContracts />)}>Договора</li> */}
              {/* <li onClick={() => addPane(<ListActivityHistories />)}>История активности</li> */}
              <li>Реализация товара и услуг</li>
              <li>Поступление товара и услуг</li>
              <li>Перемещение ТМЗ</li>
              <li>Приходный кассовый ордер</li>
              <li>Расходный кассовый ордер</li>
            </ul>
          </div>
        </Group>
      </div>
    )
  } else if (lable.toLocaleLowerCase() === "Settings".toLocaleLowerCase()) {
    // Settings
    return (
      <div className={styles.NavListWrapper}>
        <h1>Настройки</h1>
        <Group gap='64px'>
          <div>
            <h3>Права доступа</h3>
            <ul className={styles.NavList}>
              <li onClick={() => addPane(<ListOrganizations />)}>Организации</li>
              <li onClick={() => addPane(<Counterparties.List />)}>Контрагенты</li>
              <li onClick={() => addPane(<ListContracts />)}>Договора</li>
              <li onClick={() => addPane(<ListActivityHistories />)}>История активности</li>
            </ul>
          </div>
        </Group>
      </div>
    )
  }
}

// PaneGroup - управление состоянием панелей
// export const PaneGroup: React.FC<{ children: React.ReactNode; defaultPane?: string }> = ({
//   children,
//   defaultPane
// }) => {
//   const [activePane, setActivePane] = useState<string | null>(defaultPane || null);
//   const [panes, setPanes] = useState<{ id: string; title: string }[]>([]);

//   const registerPane = (id: string, title: string) => {
//     setPanes(prev => prev.find(p => p.id === id) ? prev : [...prev, { id, title }]);
//   };

//   useEffect(() => {
//     if (!activePane && panes.length > 0) {
//       setActivePane(panes[0].id);
//     }
//   }, [panes, activePane]);

//   return (
//     <PaneContext.Provider value={{ activePane, setActivePane, registerPane, panes }}>
//       <div style={{ display: 'flex', flex: 1 }}>
//         {children}
//       </div>
//     </PaneContext.Provider>
//   );
// };

// Pane - условный рендеринг по активности
interface PaneProps {
  id: string;
  title: string;
  children: React.ReactNode;
}

const Pane: React.FC<PaneProps> = ({ id, title, children }) => {
  const { activePane, registerPane } = usePane();

  useEffect(() => {
    registerPane(id, title);
  }, [id, title, registerPane]);

  if (activePane !== id) return null;

  return (
    <div style={{ flex: 1, padding: '10px' }}>
      {children}
    </div>
  );
};

// PaneTabs - навигация между панелями
const PaneTabs: React.FC = () => {
  const { panes, activePane, setActivePane } = usePane();

  return (
    <div style={{ display: 'flex', background: '#e0e0e0' }}>
      {panes.map(pane => (
        <button
          key={pane.id}
          onClick={() => setActivePane(pane.id)}
          style={{
            padding: '8px 16px',
            background: activePane === pane.id ? 'white' : 'transparent',
            border: 'none',
            borderBottom: activePane === pane.id ? '2px solid blue' : 'none'
          }}
        >
          {pane.title}
        </button>
      ))}
    </div>
  );
};

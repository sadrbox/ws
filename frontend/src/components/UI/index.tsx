import React, { CSSProperties, FC, PropsWithChildren, useContext, useEffect, useState, forwardRef, useRef, useImperativeHandle, ReactNode, ReactElement, ComponentType, Component, isValidElement, JSX, ErrorInfo } from 'react';
import styles from "../../styles/main.module.scss"
import { createPortal } from 'react-dom';
import ListContracts from 'src/models/Contracts';
import { Divider } from '../Field';
// import { getTranslation } from 'src/i18';
// import { CounterpartiesList } from 'src/models/Organizations';
import ActivityHistoriesList from 'src/models/ActivityHistories';
// import { TComponentNode, TPane } from 'src/app/types';
import { useAppContext } from 'src/app';
import CounterpartiesList from 'src/models/Counterparties/list';

type TypeGroupProps = {
  align?: 'row' | 'col';
  type?: 'easy' | 'medium' | 'hard';
  label?: string;
  gap?: string;
  className?: string;
  style?: CSSProperties;
} & PropsWithChildren;

export const Group: FC<TypeGroupProps> = ({ align, gap, type, label, className, style, children }) => {

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
    ...({ borderRadius: '2px', paddingTop: "6px" }), ...style
  }
  return (
    <div className={className || ""} style={{
      display: 'flex', flexDirection: 'column', marginTop: '16px', position: 'relative'
    }}>
      {label && <div className={styles.GroupLabel}>{label}</div>}
      <div className={[align === 'row'
        ?
        styles.RowGroup
        :
        styles.ColGroup,
        , (visibleType && visibleType)].filter(s => s && s).join(" ")}
        style={{ ...reStyle, ...({ gap: gap ? gap : undefined }) }}
      >
        {children}
      </div>
    </div >
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
  const context = useAppContext();
  const isPaneShow = context.windows.panes.length > 0;

  return (
    <>
      {isPaneShow && <><PaneGroup /><PaneTab /></>}
    </>
  );
}

export const PaneTab: FC = () => {

  const context = useAppContext();
  const panes = context?.windows.panes;
  const { activePane, setActivePane } = context?.windows;



  return (
    <div className={styles.PaneTabWrapper}>
      {panes.map(p => (
        <button
          key={`PaneTab-${p.uniqId}`}
          className={[styles.PaneTab, (p.uniqId === activePane) && styles.PaneTabActive].join(" ")}
          onClick={() => setActivePane(p.uniqId)}>
          {p.label}
        </button>
      ))}
    </div>
  );
};

export const PaneGroup = () => {
  const context = useAppContext();
  const { panes, activePane } = context?.windows;




  return (
    <div className={styles.PaneGroupWrapper}>
      {panes.map(p => {
        const Component = p.component as FC<any>;
        // console.log(p.uniqId)
        return (
          <div key={`PaneGroup-${p.uniqId}`}
            className={[styles.Pane, (p.uniqId === activePane) && styles.ActivePane].join(" ")}>
            <div style={{ display: "flex", gap: "6px" }}>
              <Divider />
              <h2 className={styles.PaneHeaderLabel}>{p.label}</h2>
            </div>
            <Component {...p} />
          </div>
        )
      })}
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



export const Navbar: React.FC = () => {
  const context = useAppContext();

  const { props, setProps } = context?.navbar;
  const activeNav = props.find(nav => nav.isActive);
  // const [navs, setNavs] = useState(items);
  // const [activeNav, setActiveNav] = useState(items[0]);

  // const setActive = (id: string) => {
  //   setProps(prev => prev.map(nav => ({ ...nav, isActive: nav.id === id })))
  //   // setActiveNav(items.find(nav => nav.id === id) ?? items[0])
  // }

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
  label: string;
}

export const NavList = ({ label }: TypeNavListProps) => {

  const context = useAppContext();
  const addPane = context.windows.addPane;


  if (label.toLocaleLowerCase() === "Operations".toLocaleLowerCase()) {
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
              <li onClick={() => addPane({ component: CounterpartiesList })}>Организации</li>
              <li onClick={() => addPane({ component: CounterpartiesList })}>Контрагенты</li>
              <li onClick={() => addPane({ component: ListContracts })}>Договора</li>
            </ul>
          </div>
        </Group >
      </div >
    )
  } else if (label.toLocaleLowerCase() === "CRM".toLocaleLowerCase()) {
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
  } else if (label.toLocaleLowerCase() === "Settings".toLocaleLowerCase()) {
    // Settings
    return (
      <div className={styles.NavListWrapper}>
        <h1>Настройки</h1>
        <Group gap='64px'>
          <div>
            <h3>Права доступа</h3>
            <ul className={styles.NavList}>
              <li onClick={() => addPane({ component: CounterpartiesList })}>Организации</li>
              <li onClick={() => addPane({ component: CounterpartiesList })}>Контрагенты</li>
              <li onClick={() => addPane({ component: ListContracts })}>Договора</li>
              <li onClick={() => addPane({ component: ActivityHistoriesList })}>История активности</li>
            </ul>
          </div>
        </Group >
      </div >
    )
  }
}

interface Props {
  children: ReactNode;
  fallback: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Error caught by ErrorBoundary:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }

    return this.props.children;
  }
}

export const LoadingFallback: React.FC = () => {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
      <span className="ml-3 text-lg">Загрузка...</span>
    </div>
  );
};
import { FC, useState } from 'react';
import styles from "../styles.module.scss"
import { useAppContext } from '../AppContextProvider';


const PaneTab: FC = () => {

  const { context } = useAppContext();
  const { paneTabs, activePaneID } = context?.pane;
  const setActivePaneID = context?.states.setActivePaneID;



  return (
    <div className={styles.PaneTabWrapper}>
      {paneTabs.map((tab) => (
        <div className={[styles.PaneTab, tab.id === activePaneID ? styles.ActivePaneTab : ""].filter(s => s && s).join(" ")}
          key={tab.id}
          onClick={() => setActivePaneID(tab.id)}
        >
          {tab.title}
        </div>
      ))}
    </div>
  );
};

export default PaneTab;
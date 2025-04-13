import React from 'react'
import styles from "../styles/styles.module.scss"
import { useAppContext } from '../AppContextProvider';


const PaneGroup = () => {
  const { context } = useAppContext();
  const { paneTabs, activePaneID } = context?.pane;
  return (
    <div className={styles.PaneGroupWrapper}>
      {paneTabs.map((tab) => (
        <div key={tab.id} className={[styles.Pane, tab.id === activePaneID ? styles.ActivePane : ""].filter(s => s && s).join(" ")}>
          {tab.component}
        </div>
      ))}
    </div>
  )
}

export default PaneGroup;
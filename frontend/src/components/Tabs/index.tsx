
import React, { useEffect, useState } from "react";
import styles from "./styles.module.scss";
// import { useAppContext } from "src/components/app/AppContextProvider";
import { TypeTabs } from "./types";
import { IoMdClose } from "react-icons/io";
import { getMockTabs } from "./dev";
import { useAppContextProps } from "src/app/AppContextProvider";
// import { useAppContext } from "src/app/AppContextProvider";



const Tabs: React.FC = () => {
  const context = useAppContextProps()


  // console.log(context?.context.tabs)
  let tabs: TypeTabs;
  if (!context?.panes?.tabs) { return }
  else {
    tabs = context?.panes?.tabs;
  }
  return (
    <div className={styles.colGroup} style={{ padding: "0px 4px" }}>
      {tabs && tabs.map((tab, keyID) => {
        let active = false;
        if (++keyID === tabs.length) {
          // console.log(tabs.length, keyID)
          active = true; // tab.active
        }
        const wrapperClasses = [styles.item, (active === true ? styles.itemActive : "")].join(' ')
        return (
          <div key={keyID} area-id={tab.id} className={wrapperClasses}>
            <div className={styles.rowGroup}>
              <div className={styles.label}>{tab.label}</div>
              {/* <div className={styles.desc}>{tab.description}</div> */}
            </div>

            <button className={styles.closeTabBtn} type="button">
              <IoMdClose size={16} color="white" style={{ position: "absolute", top: "17px", left: "2px", transform: "rotate(44deg)", }} />
            </button>
          </div>)
      })}
    </div>
  );
};

export default Tabs;

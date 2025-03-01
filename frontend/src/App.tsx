import React, { useState } from "react";
import { createPortal } from "react-dom";

type Tab = {
  id: number;
  title: string;
};

const TabComponent: React.FC<{ id: number }> = ({ id }) => {
  return <div className="tab-content">Контент вкладки {id}</div>;
};

export default function App() {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTab, setActiveTab] = useState<number | null>(null);

  function addTab() {
    const newTab = { id: Date.now(), title: `Вкладка ${tabs.length + 1}` };
    setTabs([...tabs, newTab]);
    setActiveTab(newTab.id);
  }

  return (
    <div className="Screen">
      <button onClick={addTab}>Добавить вкладку</button>
      <div className="PaneGroup">
        <ul>
          {tabs.map((tab) => (
            <li
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                fontWeight: tab.id === activeTab ? "bold" : "normal",
                cursor: "pointer",
              }}
            >
              {tab.title}
            </li>
          ))}
        </ul>
      </div>

      {activeTab !== null &&
        createPortal(
          <TabComponent id={activeTab} />,
          document.querySelector("#content")!
        )}

      <div id="content" className="tab-container"></div>
    </div>
  );
}

import { Tab, Tabs, TabList, TabPanel } from 'react-tabs';
import 'react-tabs/style/react-tabs.css';
import styles from "./styles/global.module.scss";
import { useState } from 'react';
import ActivityHistory from './models/ActivityHistory';
import ContractFORM from './models/Contracts/form';

function App() {

  return (
    <>
      <ContractFORM />
    </>
  );
}

export default App;
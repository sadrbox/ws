import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import styles from "./styles/global.module.scss"
import ActivityHistory from './models/ActivityHistory';
import ContractFORM from './models/Contracts/form';

function App() {

  return (
    <div className={styles.Screen}>
      <div className={styles.PaneGroup}>
        {/* <hr style={{ height: '50px', background: 'green' }} /> */}

        <Router>
          <Routes>
            <Route path="/" element={<ContractFORM />} />
            <Route path="contract" element={<ContractFORM />} />
            <Route path="activityhistory" element={<ActivityHistory />} />
          </Routes>
        </Router>
      </div>
      <div className={styles.PaneTabs}>
        <div className={styles.Tab}>Один</div>
        <div className={styles.Tab}>Два</div>
        <div className={[styles.Tab, styles.active].join(" ")}>Три</div>
        <div className={styles.Tab}>Четыре</div>
      </div>
    </div >
  );
}

export default App;
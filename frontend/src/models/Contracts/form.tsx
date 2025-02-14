import { FC, useState } from 'react';
import InputField from '../../components/ui/Field/InputField';
import ActivityHistory from '../ActivityHistory';
import styles from "./styles.module.scss";


const ContractFORM: FC = () => {


  return (
    <div className={styles.Form}>
      <div className={styles.FromHeader}>
        {/* <InputField label="test" name="testing" /> */}
        {/* <InputField label="test" name="testing" /> */}
        {/* <InputField label="test" name="testing" /> */}
        <InputField label="test" name="testing" />
        <InputField label="test" name="testing" />
      </div>
      <div className={styles.FromTable}>
        <ActivityHistory />
      </div>

    </div>
  );
};

export default ContractFORM;
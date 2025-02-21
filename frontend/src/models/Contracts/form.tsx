import { FC, useState } from 'react';
import InputField from '../../components/ui/Field/InputField';
import ActivityHistory from '../ActivityHistory';
import styles from "./styles.module.scss";


const ContractFORM: FC = () => {


  return (
    <div className={styles.Form}>
      <div className={styles.FormHeader}>

        <InputField label="test" name="testing" />
        <InputField label="test" name="testing" />
        <InputField label="test" name="testing" />
        <hr style={{ height: '20px' }} />
      </div>
      <div className={styles.FormTable}>
        <ActivityHistory />
      </div>

    </div>
  );
};

export default ContractFORM;
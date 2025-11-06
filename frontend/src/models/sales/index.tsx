import { FC, useState } from 'react';
import styles from '../styles.module.scss';
import InputField from 'src/components/Field/InputField';
import ActivityHistories from '../activityhistories';

import { crypto } from 'src/utils/main.module';

const Sales: FC = () => {


const initialFormID = crypto.randomUUID()
const [formID, setFormID] = useState<string>(initialFormID);




  return (
  <div className={styles.FormWrapper}>
    <div className={styles.FormBody}>
      <InputField label="Наименование"
        name={formID
        + "_name"
        } />
      <InputField label="БИН"
        name={formID
        + "_bin"
        } />
      <InputField label="Комментарии"
        name={formID
        + "_comment"
        } />
      {/*
      <hr style={{
        height: '20px'
        }} /> */}
    </div>
    <div className={styles.FormTable}>
      <ActivityHistories />
    </div>

  </div>
  );
  };

  export default Sales;
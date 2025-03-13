import { FC, useMemo, useState } from 'react';
import InputField from '../../components/ui/Field/InputField';
import ActivityHistories from '../ActivityHistories';
import styles from "../styles.module.scss";
import { crypto } from 'src/utils/main.module';


const ContractFORM: FC = () => {

  const initialFormID = crypto.randomUUID()
  const [formID, setFormID] = useState<string>(initialFormID);




  return (
    <div className={styles.FormWrapper}>
      <div className={styles.FormBody}>
        <InputField label="Наименование" name={formID + "_name"} />
        <InputField label="БИН" name={formID + "_bin"} />
        <InputField label="Комментарии" name={formID + "_comment"} />
        {/* <hr style={{ height: '20px' }} /> */}
      </div>
      <div className={styles.FormTable}>
        <ActivityHistories />
      </div>

    </div>
  );
};

export default ContractFORM;
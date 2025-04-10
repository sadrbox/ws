import { FC, useMemo, useState } from 'react';
import InputField from '../../components/ui/Field/InputField';
import ActivityHistories from '../ActivityHistories';
import styles from "../styles.module.scss";
import useUID from 'src/hooks/useUID';


const ContractFORM: FC = () => {

  const formUid = useUID();




  return (
    <div className={styles.FormWrapper}>
      <div className={styles.FormBody}>
        <InputField label="Наименование" name={`${formUid}_name`} />
        <InputField label="БИН" name={`${formUid}_bin`} />
        <InputField label="Комментарии" name={`${formUid}_comment`} />
        {/* <hr style={{ height: '20px' }} /> */}
      </div>
      <div className={styles.FormTable}>
        <ActivityHistories />
      </div>

    </div>
  );
};

export default ContractFORM;
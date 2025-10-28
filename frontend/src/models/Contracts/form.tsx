import { FC, useMemo, useState } from 'react';
// import InputField from '../../components/Field/InputField';
import ActivityHistories from '../ActivityHistories';
import styles from "../../app/styles/main.module.scss"
import useUID from 'src/hooks/useUID';
import { FieldString } from 'src/components/Field/index.tsx';
// import { FieldString } from 'src/components/Field';


const ContractFORM: FC = () => {

  const formUid = useUID();




  return (
    <div className={styles.FormWrapper}>
      <div className={styles.FormBody}>
        <FieldString label="Наименование" name={`${formUid}_name`} />
        <FieldString label="БИН" name={`${formUid}_bin`} />
        <FieldString label="Комментарии" name={`${formUid}_comment`} />
        {/* <hr style={{ height: '20px' }} /> */}
      </div>
      <div className={styles.FormTable}>
        <ActivityHistories />
      </div>

    </div>
  );
};

export default ContractFORM;
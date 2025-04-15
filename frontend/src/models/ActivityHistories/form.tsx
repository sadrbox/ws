import { FC } from 'react';
import styles from "../../app/styles/main.module.scss"

const AcitvityHistoryForm: FC = () => {
  return (
    <div className={styles.Wrapper}>
      <div className={styles.FormHeader}>
        <div className={styles.formName}>Данные записи</div>
      </div>
      <div className={styles.FormBody}>
        <div className={styles.inputField}>
          <label htmlFor='date'>Дата:</label>
          <input type="date" name="date" />
        </div>
        <div className={styles.inputField}>
          <label htmlFor='description'>Описание:</label>
          <input type="text" name="description" />
        </div>
        <div className={styles.inputField}>
          <label htmlFor='comment'>Комментарий:</label>
          <input style={{ width: '300px' }} type="text" name="comment" />
        </div>
      </div>
    </div>
  );
};

export default AcitvityHistoryForm;
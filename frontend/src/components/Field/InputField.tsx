import { FC } from 'react';
import { getTranslation } from "src/i18";
import styles from "./Field.module.scss"


type TProps = {
  label: string
  name: string
}

const InputField: FC<TProps> = ({ label, name }) => {
  return (
    <div className={[styles.rowGroup, styles.FieldWrapper].filter(s => s && s).join(" ")}>
      <label htmlFor={name} className={styles.FieldLabel}>{getTranslation(label)}</label>
      <div className={styles.FieldInputWrapper}>
        <input type="text" name={name} id={name} className={styles.FieldString} autoComplete='off' />
      </div>
    </div>
  );
};

export default InputField;
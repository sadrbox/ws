import { FC, useId } from 'react';
import { getTranslation } from "src/i18";
import styles from "./Field.module.scss"


type TProps = {
  label: string
  name: string
}

const InputField: FC<TProps> = ({ label, name }) => {
  const uid = useId();
  return (
    <div className={[styles.rowGroup, styles.FieldWrapper].filter(s => s && s).join(" ")}>
      <label htmlFor={uid} className={styles.FieldLabel}>{getTranslation(label)}</label>
      <div className={styles.FieldInputWrapper}>
        <input type="text" name={name} id={uid} className={styles.FieldString} autoComplete='off' />
      </div>
    </div>
  );
};

export default InputField;
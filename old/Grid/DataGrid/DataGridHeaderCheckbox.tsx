import { useDataGridContext } from './DataGridContextProvider';
import styles from "../styles.module.scss"

const DataGridTabHeaderCheckbox = () => {
  const { context } = useDataGridContext();
  const { isAllChecked, setIsAllChecked } = context?.states;

  function isCheckedAllRows() {
    return isAllChecked ?? false;
  }
  function setCheckedAllRows() {
    if (setIsAllChecked)
      setIsAllChecked((prev) => !prev)
  }

  return (
    <label className={styles.LabelForCheckbox} htmlFor={`selectOption_All`}>
      <input type="checkbox" name={`selectOption_All`} checked={isCheckedAllRows()} onChange={() => setCheckedAllRows()} />
    </label>
  );
};

export default DataGridTabHeaderCheckbox;
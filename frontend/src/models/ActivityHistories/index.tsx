import { useTable } from "src/hooks/useTable";
import columnsJson from "./columns.json";
import { useAppContextProps } from "src/app/AppContextProvider";
import Table from "src/components/Table";
import styles from "../../app/styles/main.module.scss"


const ListActivityHistories: React.FC = () => {

  const componentName = "ListActivityHistories";
  const model = "ActivityHistories";

  const { tableProps } = useTable({
    componentName,
    model,
    columnsJson,
    // ...(!!ownerUID && { initProps: { filter: { ownerUID } } }),
  }
  );
  return <Table props={tableProps} />;
}

const TableActivityHistories: React.FC<{ ownerUID?: string }> = ({ ownerUID }) => {
  const componentName = "TableActivityHistories";
  const model = "ActivityHistories";

  const type = "part";
  const context = useAppContextProps();
  const addPane = context?.actions.addPane;

  const openForm = (uid: string) => addPane(<FormActivityHistories uid={uid} />);

  const { tableProps } = useTable({
    componentName,
    model,
    columnsJson,
    initProps: { filter: { ownerUID } },
    openForm,
    type
  }
  );
  return <Table props={tableProps} />;
}

const FormActivityHistories: React.FC<{ uid: string }> = ({ uid }) => {
  return (
    <div>
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
    </div>);
}

export { ListActivityHistories, TableActivityHistories, FormActivityHistories };
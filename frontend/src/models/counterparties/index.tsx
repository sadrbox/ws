import { FC, ReactNode } from "react";
import columnsJson from "./columns.json";
import { TDataItem } from "src/components/Table/types";
import Table from "src/components/Table";
import { useTable } from "src/hooks/useTable";
import { useAppContextProps } from "src/app/AppContextProvider";
import styles from "../../app/styles/main.module.scss"
import useUID from 'src/hooks/useUID';
import { Divider, Field, FieldString } from 'src/components/Field/index.tsx';
import ListActivityHistories from '../activityhistories/list';
import { getTranslation } from "src/i18";
import { Button } from "src/components/Button";
import { Group } from "src/components/UI";

type TypeForm = {
  id: string;
}

type TypeComponent = FC<{ children?: React.ReactNode }> & {
  List: FC;
  Form: FC<TypeForm>;
};

const Counterparties: TypeComponent = ({ children }) => {
  return <div className="counterparties">{children}</div>;
};

const List: FC = () => {
  const displayName = "Counterparties.List";
  const model = "Counterparties";

  // const form = (id: string) => <FormCounterparties id={id} />
  const context = useAppContextProps();
  const addPane = context?.actions.addPane;

  const openForm = (id: string) => addPane(<Counterparties.Form id={id} />);


  const { tableProps } = useTable(
    displayName,
    model,
    columnsJson,
    openForm
  );

  return <Table props={tableProps} />;
};


const Form: React.FC<TypeForm> = ({ id }) => {
  // const [argState, setArgState] = useState<TArgState | undefined>(undefined)
  const formUid = useUID();
  const displayName = "Counterparties.Form";

  return (
    <div className={styles.FormWrapper}>
      <div className={styles.FormPanel}>
        <div className={styles.TablePanelLeft}>
          <div className={[styles.colGroup, styles.gap6].join(" ")} style={{ justifyContent: 'flex-start' }}>
            <Button variant="primary" onClick={() => alert('Add clicked!')}>
              <span>Сохранить и закрыть</span>
            </Button>
            <Divider />
            <Button onClick={() => alert('Add clicked!')}>
              <span>Сохранить</span>
            </Button>
            <Button onClick={() => alert('Delete clicked!')}>
              <span>Закрыть</span>
            </Button>
            <Divider />
          </div>
          <div className={[styles.colGroup, styles.gap6].join(" ")} style={{ justifyContent: 'flex-end' }}>
          </div>
        </div>
        <div className={styles.TablePanelRight}></div>
      </div>
      <div className={styles.FormHeader} >
        <Divider />
        <h2 className={styles.FormHeaderLabel}>{getTranslation(displayName)}: ТОО СтройМонтажСервис</h2>
        <div className={styles.FormIdentifier}>ID: 12 </div>
      </div>
      <div className={styles.FormBody}>

        <div className={styles.FormBodyParts}>
          <div className={styles.Form}>
            {/* <Group label="Реквизиты" align="row" gap="12px" > */}
            <div style={{ gap: '12px', display: 'flex', flexDirection: 'column' }}>
              {/* <Field label="Номер" name={`${formUid}_id`} width="120px" /> */}
              <Field label="Наименование" name={`${formUid}_name`} maxWidth="430px" />
            </div>
            <div style={{ gap: '12px', display: 'flex', flexDirection: 'row' }}>
              <Field label="ИНН" name={`${formUid}_inn`} width="auto" />
              <Field label="КБЕ" name={`${formUid}_kpp`} width="auto" />
            </div>
            {/* </Group> */}
          </div>
          <Divider />
          <div className={styles.FormTable}>
            {/* <div className={styles.GroupLabel}>Договора</div> */}

            <div style={{ containerType: 'size', flex: 1, display: 'flex', flexDirection: 'column', overflow: 'clip' }}>
              <ListActivityHistories />
            </div>
          </div>
        </div>
      </div>
    </div >
  )
};

List.displayName = "Counterparties.List";
Form.displayName = "Counterparties.Form";
// Прикрепляем подкомпоненты к основному
Counterparties.List = List;
Counterparties.Form = Form;

export default Counterparties;



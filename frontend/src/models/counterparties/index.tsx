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
      <h2 className={styles.FormHeaderLabel}>{getTranslation(displayName)}: ТОО СтройМонтажСервис</h2>
      <div className={styles.TablePanel}>
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
      <div className={styles.FormBody}>
        <div className={styles.FormBodyParts}>
          <div className={styles.Form}>
            <Group label="Реквизиты" type="hard" align="row" gap="12px" >
              <Group align="col" gap="12px" style={{ justifyContent: "space-between" }}>
                <Field label="Наименование" name={`${formUid}_name`} width="400px" />
                <Field label="Номер" name={`${formUid}_id`} width="120px" />
              </Group>
              <Group align="col" gap="12px">
                <Field label="ИНН" name={`${formUid}_inn`} width="193px" />
                <Field label="КБЕ" name={`${formUid}_kpp`} width="193px" />
              </Group>
            </Group>
          </div>
          <div className={styles.FormTable}>
            <div className={styles.GroupLabel}>Договора</div>
            <div className={styles.BG_HARD} style={{ containerType: 'size', flex: 1, display: 'flex', flexDirection: 'column', overflow: 'clip' }}>
              <ListActivityHistories />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
};

List.displayName = "Counterparties.List";
Form.displayName = "Counterparties.Form";
// Прикрепляем подкомпоненты к основному
Counterparties.List = List;
Counterparties.Form = Form;

export default Counterparties;



import { FC, ReactNode } from "react";
import columnsJson from "./columns.json";
import { TDataItem } from "src/components/Table/types";
import Table from "src/components/Table";
import { useTable } from "src/hooks/useTable";
import { useAppContextProps } from "src/app/AppContextProvider";

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
  const componentName = "Counterparties.List";
  const model = "Counterparties";

  // const form = (id: string) => <FormCounterparties id={id} />
  const context = useAppContextProps();
  const addPane = context?.actions.addPane;

  const openForm = (id: string) => addPane(<Counterparties.Form id={id} />);


  const { tableProps } = useTable(
    componentName,
    model,
    columnsJson,
    openForm
  );

  return <Table props={tableProps} />;
};


const Form: React.FC<TypeForm> = ({ id }) => {
  // const [argState, setArgState] = useState<TArgState | undefined>(undefined)

  return (
    <>
      <div>Counterparties create form `${id}`</div>
    </>
  );
};


// Прикрепляем подкомпоненты к основному
Counterparties.List = List;
Counterparties.Form = Form;

export default Counterparties;



import { FC, ReactNode } from "react";
import columnsJson from "./columns.json";
import { TDataItem } from "src/components/Table/types";
import Table from "src/components/Table";
import { useTable } from "src/hooks/useTable";
import { useAppContextProps } from "src/app/AppContextProvider";

export const ListCounterparties: FC = () => {
  const componentName = "ListCounterparties";
  const model = "Counterparties";

  // const form = (id: string) => <FormCounterparties id={id} />
  const context = useAppContextProps();
  const addPane = context?.actions.addPane;

  const openForm = (id: string) => addPane(<FormCounterparties id={id} />);


  const { tableProps } = useTable(
    componentName,
    model,
    columnsJson,
    openForm
  );

  return <Table props={tableProps} />;
};

type TypeForm = {
  id: string;
}
export const FormCounterparties: React.FC<TypeForm> = ({ id }) => {
  // const [argState, setArgState] = useState<TArgState | undefined>(undefined)

  return (
    <>
      <div>Counterparties create form `${id}`</div>
    </>
  );
};





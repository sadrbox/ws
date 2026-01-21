import { useTable } from "src/hooks/useTable";
import columnsJson from "./columns.json";
import Table from "src/components/Table";
import { useAppContextProps } from "src/app/AppContextProvider";
// import TablePart from "src/components/TablePart";


const ListBankAccounts: React.FC = () => {

  const componentName = "TablePartBankAccounts";
  const model = "BankAccounts";

  const { tableProps } = useTable({
    componentName,
    model,
    columnsJson,
    // initProps: { filter: { ownerUID } },
  }
  );
  return <Table props={tableProps} />;
}

const TableBankAccounts: React.FC<{ ownerUID: string }> = ({ ownerUID }) => {
  const componentName = "TablePartBankAccounts";
  const model = "BankAccounts";

  const type = "part";
  const context = useAppContextProps();
  const addPane = context?.actions.addPane;

  const openForm = (uid: string) => addPane(<FormBankAccounts uid={uid} />);

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

const FormBankAccounts: React.FC<{ uid: string }> = ({ uid }) => {
  return (
    <div>
      Form for Bank Accounts <br />
      UID: {uid}
    </div>);
}

export { ListBankAccounts, TableBankAccounts, FormBankAccounts };
import { FC } from "react";
import columnsJson from "./columns.json";
import { TDataItem } from "src/components/Table/types";
import Table from "src/components/Table";
import { useTable } from "src/hooks/useTable";

const ListContracts: FC = () => {
  const componentName = "ListContracts";
  const model = "Contracts";

  const { tableProps } = useTable<TDataItem>(
    componentName,
    model,
    columnsJson
    // Можно передать дополнительные параметры:
    // {
    //   page: 1,
    //   limit: 50,
    //   filter: { searchBy: { value: "test" } }
    // }
  );

  return <Table props={tableProps} />;
};

export default ListContracts;
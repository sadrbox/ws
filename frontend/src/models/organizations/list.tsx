import { FC } from "react";
import columnsJson from "./columns.json";
import { TDataItem } from "src/components/Table/types";
import Table from "src/components/Table";
import { useTable } from "src/hooks/useTable";

const ListOrganizations: FC = () => {
  const componentName = "ListOrganizations";
  const model = "Organizations";

  const { tableProps } = useTable({
    componentName,
    model,
    columnsJson
  }
    // Можно передать дополнительные параметры:
    // {
    //   page: 1,
    //   limit: 50,
    //   filter: { searchBy: { value: "test" } }
    // }
  );

  return <Table props={tableProps} />;
};

export default ListOrganizations;
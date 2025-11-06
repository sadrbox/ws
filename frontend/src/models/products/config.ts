export const columns = {
	properties: {
		width: "27px 80px 1fr 100px",
	},
	cols: [
		{
			id: "checkbox",
			type: "checkbox",
			// field: {
			// 	style: { textAlign: "center" } as React.CSSProperties,
			// },
		},
		{
			id: "id",
			title: "№",
			type: "id",
		},
		{
			id: "title",
			title: "Наименование",
			type: "string",
		},
		{
			id: "price",
			title: "Цена",
			type: "number",
		},
	],
};

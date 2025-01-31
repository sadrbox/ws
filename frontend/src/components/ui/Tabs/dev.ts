import { isArray } from "lodash";
import { TTabs } from "./types";

export type Root = Root2[];

export interface Root2 {
	userId: number;
	id: number;
	title: string;
	body: string;
}

async function getMockTabs(): Promise<TTabs[]> {
	// console.log("first");
	// const response = await fetch("https://jsonplaceholder.typicode.com/posts");
	// if (!response.ok) {
	// 	throw new Error("Ошибка загрузки постов");
	// }
	// const fetchData = await response.json();
	// // console.log(r);
	// // return response.json();
	// if (isArray(fetchData)) {
	// 	return fetchData.map(
	// 		(post: { id: number; title: string; body: string }) => ({
	// 			id: post.id.toString(),
	// 			label: post.title,
	// 			active: false,
	// 			description: post.body,
	// 		}),
	// 	) as TTabs[];
	// }
	// return [];

	return [
		{
			id: "tab1",
			label: "Dashboard",
			active: true,
			description: "Overview of key metrics and performance.",
		},
		{
			id: "tab2",
			label: "Projects",
			active: false,
			description: "List and details of active projects.",
		},
		{
			id: "tab3",
			label: "Settings",
			active: false,
			description: "User preferences and system configurations.",
		},
	];
}

export { getMockTabs };

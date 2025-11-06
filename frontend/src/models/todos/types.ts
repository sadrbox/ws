import { TDataItem } from "./index";

export interface ITodosResponse {
	todos?: TDataItem[];
	total?: number;
	skip?: number;
	limit?: number;
}
export interface ITodo {
	id: number;
	todo: string;
	completed: boolean;
	userId: number;
}

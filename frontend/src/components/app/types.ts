import { JSX } from "react";

export type TAppContext = {
	pane: {
		activePaneID: number;
		paneTabs: TPaneTab[];
	};
	actions: {
		openPane: (component: string) => void;
	};
	states: {
		setActivePaneID: (id: number) => void;
	};
};

export type TPaneTab = {
	id: number;
	title: string;
	component: JSX.Element;
};

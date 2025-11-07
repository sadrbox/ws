import { TypeTabs } from "src/components/Tabs/types";

export type TypeAppContextProps = {
	screenRef: React.RefObject<HTMLDivElement | null>;
	panes: {
		activeID: number;
		tabs: TypeTabs;
	};
	actions: {
		openPane: (component: React.ReactNode, inTab?: boolean) => void;
		setActivePaneID: (id: number) => void;
	};
};

// export type TPaneTab = {
// 	id: number;
// 	title: string;
// 	component: JSX.Element;
// };

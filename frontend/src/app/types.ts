import { TypeTabs } from "src/components/Tabs/types";
import { ReactNode, SetStateAction, Dispatch } from "react";
// import { OverlayProps } from ".";

export type TypeAppContextProps = {
	screenRef: React.RefObject<HTMLDivElement | null>;
	panes: {
		activeID: number;
		tabs: TypeTabs;
	};
	actions: {
		openPane: (component: React.ReactNode, inTab?: boolean) => void;
		setActivePaneID: (id: number) => void;
		// setOverlay: Dispatch<SetStateAction<OverlayProps>>;
	};
	overlay: {
		getOverlay: OverlayProps;
		setOverlay: Dispatch<SetStateAction<OverlayProps>>;
	};
};

export interface OverlayProps {
	isVisible: boolean;
	toggleVisibility: () => void;
	content: React.ReactNode;
}

// export type TPaneTab = {
// 	id: number;
// 	title: string;
// 	component: JSX.Element;
// };

import { TypePaneItem } from "src/components/Tabs/types";
import { ReactNode, SetStateAction, Dispatch } from "react";
// import { OverlayProps } from ".";

export type TypeAppContextProps = {
	screenRef: React.RefObject<HTMLDivElement | null>;
	panes: TypePaneItem[];
	actions: {
		addPane: (component: React.ReactNode, inTab?: boolean) => void;
		setActivePaneID: (id: number) => void;
		// setOverlay: Dispatch<SetStateAction<OverlayProps>>;
	};
	navbar: {
		props: TypeNavbarProps;
		setProps: Dispatch<SetStateAction<TypeNavbarProps>>;
	};
};

export type TypeNavbarProps = {
	id: string;
	isActive: boolean;
	title: string;
	component: React.ReactNode;
}[];

// id: useUID(),
// isActive: true,
// title: "Навигация",
// component: <NavigationPage />

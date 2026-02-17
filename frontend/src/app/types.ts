import {
	ReactNode,
	SetStateAction,
	Dispatch,
	ReactElement,
	ComponentType,
	JSX,
	ComponentClass,
	FunctionComponent,
	FC,
} from "react";
import { TDataItem } from "src/components/Table/types";
// import { OverlayProps } from ".";

export type TypeAppContextProps = {
	screenRef: React.RefObject<HTMLDivElement | null>;
	windows: {
		panes: TPane[];
		activePane: string | null;
		addPane: (pane: Partial<TPane>) => void;
		removePane: (uniqId: string) => void;
		setActivePane: (uniqId: string) => void;
	};
	actions: {};
	navbar: {
		props: TypeNavbarProps[];
		setProps: Dispatch<SetStateAction<TypeNavbarProps[]>>;
	};
};

export type TypeNavbarProps = {
	id: string;
	isActive: boolean;
	title: string;
	component: React.ReactNode;
};

export type TPane = {
	component: TComponentNode;
	uniqId: string;
	label: string;
	data?: TDataItem;
	onSave?: () => void;
	onClose?: () => void;
};

export type TComponentNode =
	| FC<any>
	| null
	| undefined
	| React.ComponentType<any>;

// export type TPaneProps = {
// 	onSave?: () => void;
// 	onClose?: () => void;
// };
// export type TOpenPaneProps = {
// 	/** Заголовок панели */
// 	label: string;
// 	/** Компонент, который будет отрендерен внутри панели */
// 	component: TComponentNode;
// 	/** Пропсы для компонента */
// 	props?: Record<string, unknown | {}>;
// 	/** Ширина панели (px или %) */
// 	width?: number | string;
// 	/** С какой стороны открывать */
// 	position?: "left" | "right";
// 	/** Можно ли закрыть панель (крестик, Esc) */
// 	closable?: boolean;
// 	/** Колбэк при закрытии */
// 	onClose?: () => void;
// 	// component: TComponentNode;
// 	// label?: string;
// 	// data?: TDataItem;
// 	// props?: TPaneProps;
// };
export type TOpenModelFormProps = Partial<TPane>;

// export type TOpenFormProps = Partial<TPane>;

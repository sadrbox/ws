import { useState } from "react";

export function usePortal() {
	const [content, setContent] = useState<React.ReactNode>(null);

	const open = (element: React.ReactNode) => {
		setContent(element);
	};

	const close = () => {
		setContent(null);
	};

	return { content, open, close };
}

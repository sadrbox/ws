let stack: Array<() => void> = [];
let listenerAttached = false;
let screenRef: { current: HTMLElement | null } | null = null;
let prevBodyOverflow: string | null = null;

const handleKey = (e: KeyboardEvent) => {
	if (e.key === "Escape" && stack.length > 0) {
		e.preventDefault();
		e.stopPropagation();
		const top = stack[stack.length - 1];
		if (top) top();
	}
};

export function setScreenRef(ref: { current: HTMLElement | null } | null) {
	screenRef = ref;
}

export function registerModal(closeFn: () => void) {
	stack.push(closeFn);
	// apply blur when first modal opens
	if (stack.length === 1) {
		try {
			screenRef?.current?.classList.add("blur5");
			// hide background from assistive tech and lock body scroll
			try {
				if (screenRef?.current)
					screenRef.current.setAttribute("aria-hidden", "true");
			} catch {
				/* intentional: non-critical DOM op */
			}
			try {
				prevBodyOverflow = document.body.style.overflow || null;
				document.body.style.overflow = "hidden";
			} catch {
				/* intentional: non-critical DOM op */
			}
		} catch {
			/* intentional: non-critical DOM op */
		}
	}
	// attach global listener once
	if (!listenerAttached) {
		window.addEventListener("keydown", handleKey, true);
		listenerAttached = true;
	}

	return () => unregisterModal(closeFn);
}

export function unregisterModal(closeFn: () => void) {
	const idx = stack.lastIndexOf(closeFn);
	if (idx !== -1) stack.splice(idx, 1);
	// remove blur when last modal closes
	if (stack.length === 0) {
		try {
			screenRef?.current?.classList.remove("blur5");
			try {
				if (screenRef?.current)
					screenRef.current.removeAttribute("aria-hidden");
			} catch {
				/* intentional: non-critical DOM op */
			}
			try {
				if (prevBodyOverflow == null) document.body.style.overflow = "";
				else document.body.style.overflow = prevBodyOverflow;
				prevBodyOverflow = null;
			} catch {
				/* intentional: non-critical DOM op */
			}
		} catch {
			/* intentional: non-critical DOM op */
		}
		if (listenerAttached) {
			window.removeEventListener("keydown", handleKey, true);
			listenerAttached = false;
		}
	}
}

export function closeTop() {
	const top = stack[stack.length - 1];
	if (top) top();
}

export function clearAll() {
	stack = [];
	try {
		screenRef?.current?.classList.remove("blur5");
	} catch {
		/* intentional */
	}
	try {
		if (screenRef?.current) screenRef.current.removeAttribute("aria-hidden");
	} catch {
		/* intentional */
	}
	try {
		if (prevBodyOverflow == null) document.body.style.overflow = "";
		else document.body.style.overflow = prevBodyOverflow;
		prevBodyOverflow = null;
	} catch {
		/* intentional */
	}
	if (listenerAttached) {
		window.removeEventListener("keydown", handleKey, true);
		listenerAttached = false;
	}
}

export default {
	registerModal,
	unregisterModal,
	setScreenRef,
	closeTop,
	clearAll,
};

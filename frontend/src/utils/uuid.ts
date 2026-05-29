/**
 * Генерация UUID v4. Использует нативный `crypto.randomUUID()` (доступен во всех
 * современных браузерах в secure-context); при его отсутствии — Math.random-фолбэк.
 */
export function randomUUID(): string {
	const g = globalThis.crypto;
	if (g && typeof g.randomUUID === "function") return g.randomUUID();
	return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
		const r = (Math.random() * 16) | 0;
		return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
	});
}

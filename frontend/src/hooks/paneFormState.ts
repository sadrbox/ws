// Per-pane флаги dirty / edit-mode (глобальные Set + подписки useSyncExternalStore).
// Вынесено из useFormStore.ts (Q9). Самодостаточно: только React + Set, без form-store.
import { useSyncExternalStore } from "react";

const dirtySet = new Set<string>();
const dirtyListeners = new Set<() => void>();

function notifyDirtyListeners(): void {
	for (const l of dirtyListeners) l();
}

export function setPaneDirty(uniqId: string, isDirty: boolean): void {
	const was = dirtySet.has(uniqId);
	if (isDirty && !was) {
		dirtySet.add(uniqId);
		notifyDirtyListeners();
	} else if (!isDirty && was) {
		dirtySet.delete(uniqId);
		notifyDirtyListeners();
	}
}

function subscribeDirty(listener: () => void): () => void {
	dirtyListeners.add(listener);
	return () => {
		dirtyListeners.delete(listener);
	};
}

/** Хук: есть ли несохранённые изменения в форме (для индикатора на вкладке). */
export function usePaneIsDirty(uniqId: string): boolean {
	return useSyncExternalStore(
		subscribeDirty,
		() => dirtySet.has(uniqId),
		() => false,
	);
}

// ═══════════════════════════════════════════════════════════════════════════
// EDIT MODE PANE STORE — реактивный Set<uniqId> для определения,
// есть ли у панели запись на сервере (форма в режиме редактирования).
// ═══════════════════════════════════════════════════════════════════════════

const editModeSet = new Set<string>();
const editModeListeners = new Set<() => void>();

function notifyEditModeListeners(): void {
	for (const l of editModeListeners) l();
}

export function setPaneIsEditMode(uniqId: string, isEditMode: boolean): void {
	const was = editModeSet.has(uniqId);
	if (isEditMode && !was) {
		editModeSet.add(uniqId);
		notifyEditModeListeners();
	} else if (!isEditMode && was) {
		editModeSet.delete(uniqId);
		notifyEditModeListeners();
	}
}

function subscribeEditMode(listener: () => void): () => void {
	editModeListeners.add(listener);
	return () => {
		editModeListeners.delete(listener);
	};
}

/** Хук: находится ли форма в режиме редактирования (есть запись на сервере). */
export function usePaneIsEditMode(uniqId: string): boolean {
	return useSyncExternalStore(
		subscribeEditMode,
		() => editModeSet.has(uniqId),
		() => false,
	);
}

/**
 * AiAssistant — диалог с BuhProf AI: команды бухгалтеру на естественном языке, исполняемые
 * в 1С через bpapi-agent (см. ai/ в корне репозитория).
 *
 * Транспорт: AI Service живёт на отдельном хосте (ai.buhprof.kz / LAN :3100), поэтому запросы
 * идут fetch'ем с тем же Bearer-JWT, что и в ERP (сервис проверяет его тем же секретом), а не
 * через apiClient — у того baseURL зашит на бэкенд ERP. Организация диалога — активная у
 * пользователя; сервис сверяет доступ по access_rights.
 *
 * История: диалоги и сообщения хранит сервер. Панель при открытии восстанавливает последний
 * диалог организации (id — в localStorage), а в шапке даёт выбрать один из недавних.
 *
 * Подтверждения (§17 ТЗ): изменяющие операции сервис останавливает и показывает карточку —
 * кнопки «Подтвердить»/«Отменить» просто отправляют «да»/«нет» в тот же диалог.
 */
import { FC, useCallback, useEffect, useRef, useState } from "react";
import { getCurrentUser, getToken } from "src/services/auth";
import { translate } from "src/i18";
import styles from "./AiAssistant.module.scss";

const LOCAL_AI_URL = (import.meta.env.VITE_LOCAL_AI_URL as string | undefined) || "http://192.168.1.112:3100";
const REMOTE_AI_URL = (import.meta.env.VITE_AI_URL as string | undefined) || "https://ai.buhprof.kz";

function getAiUrl(): string {
	if (typeof window === "undefined") return REMOTE_AI_URL;
	if ("__TAURI_INTERNALS__" in window) return REMOTE_AI_URL;
	const { hostname } = window.location;
	const isLocal = hostname.includes("192.168.") || hostname === "localhost" || hostname === "127.0.0.1";
	return isLocal ? LOCAL_AI_URL : REMOTE_AI_URL;
}

type Attachment = { fileName: string; mimeType: string; content: string };
type ChatReply = { conversationId: string; state: string; text: string; confirmation?: { tool: string; card: string } | null; attachments?: Attachment[] };
type Summary = { id: string; state: string; messages: { role: string; text: string; at: string }[]; confirmation?: { tool: string; card: string } | null };
type Recent = { id: string; state: string; preview: string; updatedAt: string };
type Envelope<T> = { success: boolean; data?: T; error?: { code: string; message: string } };

type Msg = { id: number; role: "user" | "assistant" | "system"; text: string; attachments?: Attachment[]; pending?: boolean; files?: string[] };

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

/** Файл → base64 (без префикса data:). */
function readAsBase64(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onerror = () => reject(reader.error ?? new Error("read failed"));
		reader.onload = () => resolve((typeof reader.result === "string" ? reader.result : "").replace(/^data:[^;]*;base64,/, ""));
		reader.readAsDataURL(file);
	});
}

const QUICK_PROMPTS = [
	"Найди контрагента Альфа",
	"Создай реализацию для ТОО Альфа: Дизи 450 штук по 550 тенге со склада Основной",
	"Покажи список складов",
];

const storageKey = (org: string | null | undefined) => `ai.assistant.conversation.${org ?? "default"}`;

function downloadAttachment(a: Attachment): void {
	const bytes = Uint8Array.from(atob(a.content), (c) => c.charCodeAt(0));
	const url = URL.createObjectURL(new Blob([bytes], { type: a.mimeType }));
	const link = document.createElement("a");
	link.href = url;
	link.download = a.fileName;
	link.click();
	setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

async function api<T>(path: string, init?: RequestInit): Promise<Envelope<T>> {
	const token = getToken();
	if (!token) return { success: false, error: { code: "NOT_AUTHORIZED", message: translate("aiNotAuthorized") } };
	const r = await fetch(`${getAiUrl()}${path}`, {
		...init,
		headers: { ...(init?.headers ?? {}), authorization: `Bearer ${token}`, ...(init?.body ? { "content-type": "application/json" } : {}) },
	});
	return (await r.json()) as Envelope<T>;
}

const fmtTime = (iso: string) => {
	const d = new Date(iso);
	return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

export const AiAssistantList: FC = () => {
	const org = getCurrentUser()?.organizationUuid ?? null;
	const orgQuery = org ? `?organizationUuid=${encodeURIComponent(org)}` : "";

	const [messages, setMessages] = useState<Msg[]>([]);
	const [input, setInput] = useState("");
	const [busy, setBusy] = useState(false);
	const [conversationId, setConversationId] = useState<string | null>(null);
	const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);
	const [agentStatus, setAgentStatus] = useState("");
	const [recent, setRecent] = useState<Recent[]>([]);
	// Файлы, прикреплённые к следующему сообщению (PDF выписок).
	const [files, setFiles] = useState<File[]>([]);
	const [fileError, setFileError] = useState("");
	const nextId = useRef(1);
	const bottomRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);

	const addFiles = useCallback((list: FileList | null) => {
		if (!list) return;
		setFileError("");
		const next: File[] = [];
		for (const f of Array.from(list)) {
			const isPdf = f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf");
			if (!isPdf) { setFileError(translate("aiAttachOnlyPdf")); continue; }
			if (f.size > MAX_ATTACHMENT_BYTES) { setFileError(translate("aiAttachTooBig")); continue; }
			next.push(f);
		}
		setFiles((prev) => [...prev, ...next].slice(0, 3));
		if (fileInputRef.current) fileInputRef.current.value = "";
	}, []);

	const push = useCallback((m: Omit<Msg, "id">): number => {
		const id = nextId.current++;
		setMessages((prev) => [...prev, { ...m, id }]);
		return id;
	}, []);

	const focusInput = useCallback(() => {
		// После setState DOM ещё не обновлён — фокус ставим следующим тиком.
		setTimeout(() => inputRef.current?.focus(), 0);
	}, []);

	// Автопрокрутка — только если пользователь и так был внизу или только что написал сам.
	// Обновления истории по опросу и открытие диалога позицию не трогают: читать длинный отчёт,
	// который каждые три секунды утаскивает вниз, невозможно.
	const logRef = useRef<HTMLDivElement>(null);
	const stickToBottom = useRef(true);
	const onLogScroll = useCallback(() => {
		const el = logRef.current;
		if (!el) return;
		stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
	}, []);
	useEffect(() => {
		if (stickToBottom.current) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [messages]);

	const loadRecent = useCallback(async () => {
		const env = await api<{ items: Recent[] }>(`/v1/conversations${orgQuery}`);
		if (env.success && env.data) setRecent(env.data.items);
	}, [orgQuery]);

	/** Открыть диалог с сервера: история + незакрытая карточка подтверждения. */
	const openConversation = useCallback(async (id: string) => {
		const env = await api<Summary>(`/v1/conversations/${id}${orgQuery}`);
		if (!env.success || !env.data) {
			localStorage.removeItem(storageKey(org));
			return false;
		}
		nextId.current = 1;
		setMessages(env.data.messages.map((m) => ({ id: nextId.current++, role: m.role === "user" ? "user" : "assistant", text: m.text })));
		setConversationId(env.data.id);
		setAwaitingConfirmation(env.data.state === "WAITING_CONFIRMATION");
		localStorage.setItem(storageKey(org), env.data.id);
		focusInput();
		return true;
	}, [org, orgQuery, focusInput]);

	// При открытии панели: состояние агента, недавние диалоги, восстановление последнего.
	useEffect(() => {
		void api<{ items: { online: boolean; onec: { reachable: boolean; version: string | null } }[] }>(`/v1/agents`)
			.then((env) => {
				const a = env.data?.items?.[0];
				if (!env.success) setAgentStatus(env.error?.message ?? translate("aiAgentUnavailable"));
				else if (!a) setAgentStatus(translate("aiAgentNotConfigured"));
				else if (!a.online) setAgentStatus(translate("aiAgentOffline"));
				else if (!a.onec.reachable) setAgentStatus(translate("aiOnecUnavailable"));
				else setAgentStatus(`${translate("aiConnected")}${a.onec.version ? ` · 1С API ${a.onec.version}` : ""}`);
			})
			.catch(() => setAgentStatus(translate("aiAgentUnavailable")));
		void loadRecent();
		const saved = localStorage.getItem(storageKey(org));
		if (saved) void openConversation(saved);
		else focusInput();
	}, [org, loadRecent, openConversation, focusInput]);

	/** Опрос состояния диалога, пока сервер обрабатывает вложения в фоне (до 10 минут). */
	const waitForReply = useCallback(async (id: string) => {
		const started = Date.now();
		while (Date.now() - started < 600_000) {
			await new Promise((r) => setTimeout(r, 3000));
			const env = await api<Summary>(`/v1/conversations/${id}${orgQuery}`);
			if (!env.success || !env.data) break;
			if (!["UNDERSTANDING", "EXECUTING", "RESOLVING_ENTITIES", "IDLE"].includes(env.data.state)) {
				await openConversation(id);
				void loadRecent();
				return;
			}
		}
		push({ role: "system", text: translate("aiNetworkError") });
	}, [orgQuery, openConversation, loadRecent, push]);

	const send = useCallback(async (text: string) => {
		const clean = text.trim();
		const toSend = files;
		if ((!clean && !toSend.length) || busy) return;
		setInput("");
		setFiles([]);
		setFileError("");
		stickToBottom.current = true;
		push({ role: "user", text: clean, files: toSend.map((f) => f.name) });
		const pendingId = push({ role: "assistant", text: toSend.length ? translate("aiReadingPdf") : "…", pending: true });
		setBusy(true);
		try {
			const attachments: Attachment[] = [];
			for (const f of toSend) attachments.push({ fileName: f.name, mimeType: f.type || "application/pdf", content: await readAsBase64(f) });
			const env = await api<ChatReply>(`/v1/chat`, {
				method: "POST",
				body: JSON.stringify({ conversationId, text: clean, organizationUuid: org ?? undefined, ...(attachments.length ? { attachments } : {}) }),
			});
			if (!env.success || !env.data) {
				setMessages((prev) => prev.map((m) => (m.id === pendingId ? { ...m, pending: false, role: "system", text: env.error?.message ?? translate("aiNetworkError") } : m)));
				return;
			}
			const d = env.data;
			setConversationId(d.conversationId);
			localStorage.setItem(storageKey(org), d.conversationId);
			if (d.state === "PROCESSING") {
				// Вложения обрабатываются на сервере в фоне: ждём, пока диалог выйдет из рабочих состояний,
				// и перечитываем историю целиком (ответ ассистента уже будет в ней).
				setMessages((prev) => prev.map((m) => (m.id === pendingId ? { ...m, text: d.text } : m)));
				await waitForReply(d.conversationId);
				return;
			}
			setAwaitingConfirmation(d.state === "WAITING_CONFIRMATION");
			setMessages((prev) => prev.map((m) => (m.id === pendingId ? { ...m, pending: false, text: d.text, attachments: d.attachments } : m)));
			if (!conversationId) void loadRecent();
		} catch {
			setMessages((prev) => prev.map((m) => (m.id === pendingId ? { ...m, pending: false, role: "system", text: translate("aiNetworkError") } : m)));
		} finally {
			setBusy(false);
			focusInput();
		}
	}, [busy, conversationId, org, push, loadRecent, focusInput, files, waitForReply]);

	const newDialog = useCallback(() => {
		localStorage.removeItem(storageKey(org));
		setConversationId(null);
		setMessages([]);
		setAwaitingConfirmation(false);
		setInput("");
		setFiles([]);
		setFileError("");
		nextId.current = 1;
		focusInput();
	}, [org, focusInput]);

	return (
		<div className={styles.Root}>
			<div className={styles.Header}>
				<div>
					<strong>{translate("AiAssistant")}</strong>
					<span className={styles.Status}>{agentStatus}</span>
				</div>
				<div className={styles.HeaderActions}>
					{recent.length > 0 && (
						<select
							className={styles.Recent}
							value={conversationId ?? ""}
							onChange={(e) => { if (e.target.value) void openConversation(e.target.value); }}
							disabled={busy}
							title={translate("aiRecentDialogs")}
						>
							<option value="">{translate("aiRecentDialogs")}</option>
							{recent.map((c) => (
								<option key={c.id} value={c.id}>{fmtTime(c.updatedAt)} — {c.preview}</option>
							))}
						</select>
					)}
					<button type="button" className={styles.Ghost} onClick={newDialog} disabled={busy}>{translate("aiNewDialog")}</button>
				</div>
			</div>

			<div className={styles.Log} ref={logRef} onScroll={onLogScroll}>
				{messages.length === 0 && (
					<div className={styles.Empty}>
						<p>{translate("aiIntro")}</p>
						<div className={styles.Quick}>
							{QUICK_PROMPTS.map((q) => (
								<button key={q} type="button" onClick={() => void send(q)} disabled={busy}>{q}</button>
							))}
						</div>
					</div>
				)}
				{messages.map((m) => (
					<div key={m.id} className={`${styles.Msg} ${styles[m.role]}${m.pending ? ` ${styles.pending}` : ""}`}>
						<div className={styles.Bubble}>
							{m.text.split("\n").map((line, i) => <p key={i}>{line}</p>)}
							{m.files?.map((name) => <p key={name}>📎 {name}</p>)}
							{m.attachments?.map((a) => (
								<button key={a.fileName} type="button" className={styles.File} onClick={() => downloadAttachment(a)}>
									📄 {a.fileName}
								</button>
							))}
						</div>
					</div>
				))}
				<div ref={bottomRef} />
			</div>

			{awaitingConfirmation && (
				<div className={styles.Confirm}>
					<button type="button" className={styles.Primary} onClick={() => void send("да")} disabled={busy}>{translate("aiConfirm")}</button>
					<button type="button" className={styles.Ghost} onClick={() => void send("нет")} disabled={busy}>{translate("aiCancel")}</button>
				</div>
			)}

			{(files.length > 0 || fileError) && (
				<div className={styles.Attachments}>
					{files.map((f, i) => (
						<span key={`${f.name}-${i}`} className={styles.Chip}>
							📎 {f.name}
							<button type="button" onClick={() => setFiles((prev) => prev.filter((_, n) => n !== i))} disabled={busy} title={translate("aiCancel")}>×</button>
						</span>
					))}
					{fileError && <span className={styles.Status}>{fileError}</span>}
				</div>
			)}

			<form
				className={styles.Composer}
				onSubmit={(e) => {
					e.preventDefault();
					void send(input);
				}}
			>
				<input ref={fileInputRef} type="file" accept="application/pdf,.pdf" multiple hidden onChange={(e) => addFiles(e.target.files)} />
				<button type="button" className={styles.Ghost} onClick={() => fileInputRef.current?.click()} disabled={busy || files.length >= 3} title={translate("aiAttachHint")}>
					📎
				</button>
				<textarea
					ref={inputRef}
					value={input}
					onChange={(e) => setInput(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter" && !e.shiftKey) {
							e.preventDefault();
							void send(input);
						}
					}}
					placeholder={translate("aiPlaceholder")}
					rows={2}
					disabled={busy}
				/>
				<button type="submit" className={styles.Primary} disabled={busy || (!input.trim() && !files.length)}>{translate("aiSend")}</button>
			</form>
		</div>
	);
};

export default AiAssistantList;

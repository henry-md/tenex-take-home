"use client";

import { Settings2 } from "lucide-react";
import Link from "next/link";
import {
  FormEvent,
  useEffect,
  useEffectEvent,
  useState,
} from "react";

import { AuthButton } from "@/app/components/auth-button";
import { type ApprovalModeOption } from "@/lib/google-workspace/approval-mode-options";

type ChatMessage = {
  content: string;
  id: string;
  role: "assistant" | "user";
  toolCalls?: ToolCallSummary[];
};

type ToolCallSummary = {
  arguments: Record<string, unknown>;
  name: string;
  status: "error" | "ok";
};

type ActionDraft = {
  affectedCount: number;
  afterState: unknown;
  beforeState: unknown;
  createdAt: string;
  id: string;
  kind: string;
  provider: string;
  status: string;
  summary: string;
  title: string | null;
};

type Toast = {
  id: string;
  message: string;
};

type OpenAIChatProps = {
  firstName?: string;
  initialApprovalMode: ApprovalModeOption;
};

function extractLabelName(summary: string) {
  const matchedLabel = summary.match(/"([^"]+)" label/);

  return matchedLabel?.[1] ?? null;
}

function getDraftActionLabel(draft: ActionDraft) {
  switch (draft.kind) {
    case "EMAIL_ARCHIVE":
      return "Archive email";
    case "EMAIL_MARK_SPAM":
      return "Mark email as spam";
    case "EMAIL_STAR":
      return "Star email";
    case "EMAIL_UNSTAR":
      return "Remove star";
    case "EMAIL_TRASH":
      return "Move email to trash";
    case "EMAIL_APPLY_LABEL": {
      const labelName = extractLabelName(draft.summary);
      return labelName ? `Add ${labelName} label` : "Add label";
    }
    case "EMAIL_REMOVE_LABEL": {
      const labelName = extractLabelName(draft.summary);
      return labelName ? `Remove ${labelName} label` : "Remove label";
    }
    case "CALENDAR_CREATE_EVENT":
      return "Create event";
    case "CALENDAR_UPDATE_EVENT":
      return "Update event";
    case "CALENDAR_DELETE_EVENT":
      return "Delete event";
    default:
      return draft.summary;
  }
}

function getDraftCountLabel(draft: ActionDraft) {
  if (draft.provider === "GMAIL") {
    return `${draft.affectedCount} email${draft.affectedCount === 1 ? "" : "s"}`;
  }

  return `${draft.affectedCount} event${draft.affectedCount === 1 ? "" : "s"}`;
}

function formatToolCallName(name: string) {
  return name.replaceAll("_", " ");
}

function formatToolCallValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return String(value);
  }

  return JSON.stringify(value);
}

function summarizeToolCallArguments(argumentsObject: Record<string, unknown>) {
  const entries = Object.entries(argumentsObject);

  if (!entries.length) {
    return "No arguments";
  }

  return entries
    .map(([key, value]) => `${key}: ${formatToolCallValue(value)}`)
    .join(", ");
}

export function OpenAIChat({
  firstName,
  initialApprovalMode,
}: OpenAIChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "assistant-intro",
      role: "assistant",
      content: `Welcome${firstName ? `, ${firstName}` : ""}. Ask me to search Gmail, check Calendar, or queue a change for manual approval.`,
    },
  ]);
  const [drafts, setDrafts] = useState<ActionDraft[]>([]);
  const [approvalMode] = useState(initialApprovalMode);
  const [input, setInput] = useState("");
  const [isLoadingDrafts, setIsLoadingDrafts] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingDraftId, setPendingDraftId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  function showToast(message: string) {
    const toastId = crypto.randomUUID();

    setToasts((currentToasts) => [
      ...currentToasts,
      {
        id: toastId,
        message,
      },
    ]);

    window.setTimeout(() => {
      setToasts((currentToasts) =>
        currentToasts.filter((toast) => toast.id !== toastId),
      );
    }, 4000);
  }

  function updateAssistantMessage(
    messageId: string,
    content: string,
    toolCalls: ToolCallSummary[] = [],
  ) {
    setMessages((currentMessages) =>
      currentMessages.map((message) =>
        message.id === messageId
          ? { ...message, content, toolCalls }
          : message,
      ),
    );
  }

  async function loadDrafts() {
    try {
      const response = await fetch("/api/action-drafts");

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | {
              error?: string;
            }
          | null;

        throw new Error(payload?.error ?? "Unable to load approvals.");
      }

      const payload = (await response.json()) as {
        drafts?: ActionDraft[];
      };

      setDrafts(payload.drafts ?? []);
    } catch (loadError) {
      const message =
        loadError instanceof Error
          ? loadError.message
          : "Unable to load approvals.";

      setError(message);
      showToast(message);
    } finally {
      setIsLoadingDrafts(false);
    }
  }

  const loadInitialData = useEffectEvent(() => {
    void loadDrafts();
  });

  useEffect(() => {
    loadInitialData();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedInput = input.trim();

    if (!trimmedInput || isSubmitting) {
      return;
    }

    const nextUserMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmedInput,
    };
    const nextAssistantMessageId = crypto.randomUUID();
    const nextMessages = [...messages, nextUserMessage];

    setMessages([
      ...nextMessages,
      {
        id: nextAssistantMessageId,
        role: "assistant",
        content: "Thinking...",
      },
    ]);
    setInput("");
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: nextMessages.map(({ role, content }) => ({ role, content })),
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | {
              error?: string;
            }
          | null;

        throw new Error(payload?.error ?? "Chat request failed.");
      }

      const payload = (await response.json()) as {
        content?: string;
        toolCalls?: ToolCallSummary[];
      };

      updateAssistantMessage(
        nextAssistantMessageId,
        payload.content ?? "I could not produce a response.",
        payload.toolCalls ?? [],
      );
      await loadDrafts();
    } catch (submissionError) {
      setMessages((currentMessages) =>
        currentMessages.filter((message) => message.id !== nextAssistantMessageId),
      );

      const message =
        submissionError instanceof Error
          ? submissionError.message
          : "Chat request failed.";

      setError(message);
      showToast(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDraftAction(draftId: string, action: "approve" | "reject") {
    setPendingDraftId(draftId);
    setError(null);

    try {
      const response = await fetch(`/api/action-drafts/${draftId}/${action}`, {
        method: "POST",
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | {
              error?: string;
            }
          | null;

        throw new Error(payload?.error ?? `Unable to ${action} this draft.`);
      }

      await loadDrafts();
    } catch (draftError) {
      const message =
        draftError instanceof Error
          ? draftError.message
          : `Unable to ${action} this draft.`;

      setError(message);
      showToast(message);
    } finally {
      setPendingDraftId(null);
    }
  }

  return (
    <section className="rounded-[2rem] border border-white/70 bg-white/85 p-5 shadow-[0_30px_80px_rgba(15,23,42,0.12)] backdrop-blur md:p-6">
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-2">
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">
              Inbox Concierge
            </p>
            <h2 className="text-2xl font-semibold tracking-tight text-slate-950">
              Review changes before they touch Google Workspace
            </h2>
            <p className="max-w-2xl text-sm leading-6 text-slate-600">
              Search Gmail and Calendar in chat, then approve any drafted
              modifications from the queue on the right.
            </p>
          </div>
          <div className="flex items-center gap-3 self-start">
            <div className="rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-medium uppercase tracking-[0.2em] text-emerald-700">
              {approvalMode.label}
            </div>
            <Link
              aria-label="Open settings"
              className="flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
              href="/settings"
            >
              <Settings2 aria-hidden="true" className="h-[18px] w-[18px]" strokeWidth={1.9} />
            </Link>
            <AuthButton className="px-4 py-2.5 text-sm" isAuthenticated />
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_24rem]">
          <div className="flex min-h-[24rem] flex-col overflow-hidden rounded-[1.5rem] border border-slate-200 bg-slate-50 xl:h-[32rem] xl:min-h-0">
            <div className="flex-1 space-y-4 overflow-y-auto p-4 md:p-5">
              {messages.map((message) => (
                <article
                  key={message.id}
                  className={`max-w-[88%] rounded-3xl px-4 py-3 text-sm leading-6 shadow-sm ${
                    message.role === "user"
                      ? "ml-auto bg-slate-950 text-white"
                      : "bg-white text-slate-700"
                  }`}
                >
                  <p>{message.content}</p>
                  {message.role === "assistant" && message.toolCalls?.length ? (
                    <details className="mt-3">
                      <summary className="cursor-pointer text-xs font-medium text-slate-400 transition hover:text-slate-500">
                        show toolcalls
                      </summary>
                      <div className="mt-2 space-y-2 border-l border-slate-200 pl-3 text-xs leading-5 text-slate-500">
                        {message.toolCalls.map((toolCall, index) => (
                          <div key={`${message.id}-${toolCall.name}-${index}`}>
                            <p className="font-medium text-slate-600">
                              {formatToolCallName(toolCall.name)}
                              {toolCall.status === "error" ? " (failed)" : ""}
                            </p>
                            <p>{summarizeToolCallArguments(toolCall.arguments)}</p>
                          </div>
                        ))}
                      </div>
                    </details>
                  ) : null}
                </article>
              ))}
            </div>

            <form
              className="border-t border-slate-200 bg-white p-4"
              onSubmit={handleSubmit}
            >
              <div className="flex flex-col gap-3">
                <textarea
                  className="min-h-24 rounded-[1.25rem] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400"
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (
                      event.key !== "Enter" ||
                      event.shiftKey ||
                      event.altKey ||
                      event.ctrlKey ||
                      event.metaKey ||
                      event.nativeEvent.isComposing
                    ) {
                      return;
                    }

                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }}
                  placeholder="Try: find my most recent email, or draft a change to star a thread and queue it for approval."
                  value={input}
                />
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-slate-500">
                    {approvalMode.description}
                  </p>
                  <button
                    className="rounded-full bg-slate-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
                    disabled={isSubmitting || !input.trim()}
                    type="submit"
                  >
                    {isSubmitting ? "Sending..." : "Send message"}
                  </button>
                </div>
                {error ? (
                  <p className="text-sm text-rose-600">{error}</p>
                ) : null}
              </div>
            </form>
          </div>

          <aside className="flex flex-col gap-4 xl:h-[32rem]">
            <section className="flex min-h-[18rem] flex-col rounded-[1.5rem] bg-slate-950 p-5 text-slate-50">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium uppercase tracking-[0.24em] text-slate-400">
                    Approval queue
                  </p>
                  <p className="mt-1 text-sm leading-6 text-slate-300">
                    Each draft shows the change and how many items it affects.
                  </p>
                </div>
                <div className="rounded-full border border-slate-700 px-3 py-1 text-xs font-medium text-slate-300">
                  {drafts.length}
                </div>
              </div>

              <div className="mt-4 flex-1 space-y-4 overflow-y-auto">
                {isLoadingDrafts ? (
                  <p className="text-sm leading-6 text-slate-300">
                    Loading approvals...
                  </p>
                ) : drafts.length ? (
                  drafts.map((draft) => (
                    <article
                      key={draft.id}
                      className="rounded-[1.25rem] border border-slate-800 bg-slate-900/80 p-4"
                    >
                      <h3 className="text-base font-semibold text-white">
                        {getDraftActionLabel(draft)}
                      </h3>
                      <p className="mt-2 text-sm leading-6 text-slate-300">
                        {getDraftCountLabel(draft)}
                      </p>

                      <div className="mt-4 flex gap-2">
                        <button
                          className="flex-1 rounded-full bg-white px-4 py-2.5 text-sm font-medium text-slate-950 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:bg-slate-500 disabled:text-slate-200"
                          disabled={pendingDraftId === draft.id}
                          onClick={() => void handleDraftAction(draft.id, "approve")}
                          type="button"
                        >
                          {pendingDraftId === draft.id ? "Working..." : "Approve"}
                        </button>
                        <button
                          className="rounded-full border border-slate-700 px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:border-slate-500 hover:bg-slate-800 disabled:cursor-not-allowed disabled:border-slate-800 disabled:text-slate-500"
                          disabled={pendingDraftId === draft.id}
                          onClick={() => void handleDraftAction(draft.id, "reject")}
                          type="button"
                        >
                          Reject
                        </button>
                      </div>
                    </article>
                  ))
                ) : (
                  <p className="text-sm leading-6 text-slate-300">
                    No pending Google Workspace changes.
                  </p>
                )}
              </div>
            </section>

            <section className="rounded-[1.5rem] border border-slate-200 bg-white p-5">
              <p className="text-sm font-medium uppercase tracking-[0.24em] text-slate-500">
                Try asking
              </p>
              <div className="mt-4 space-y-3 text-sm leading-6 text-slate-600">
                <p>&ldquo;Find my most recent email.&rdquo;</p>
                <p>&ldquo;Show my next three events with Alice this week.&rdquo;</p>
                <p>&ldquo;Draft moving tomorrow&apos;s 2pm design review to 3pm, but do not notify attendees.&rdquo;</p>
              </div>
            </section>
          </aside>
        </div>
      </div>
      <div className="pointer-events-none fixed right-6 top-6 z-50 flex w-full max-w-sm flex-col gap-3">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="rounded-[1.25rem] border border-rose-200 bg-white/95 px-4 py-3 text-sm text-slate-800 shadow-[0_20px_50px_rgba(15,23,42,0.16)] backdrop-blur"
          >
            {toast.message}
          </div>
        ))}
      </div>
    </section>
  );
}

"use client";

import {
  ChevronLeft,
  ChevronRight,
  Settings2,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import {
  FormEvent,
  useEffect,
  useEffectEvent,
  useState,
} from "react";

import { AuthButton } from "@/app/components/auth-button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/app/components/ui/alert-dialog";
import { type ApprovalModeOption } from "@/lib/google-workspace/approval-mode-options";

type ChatMessage = {
  content: string;
  emailDisplay?: {
    maxCount?: number;
    show: boolean;
  };
  emailResults?: EmailResult[];
  id: string;
  role: "assistant" | "user";
  toolCalls?: ToolCallSummary[];
};

type ToolCallSummary = {
  arguments: Record<string, unknown>;
  emailDisplay?: {
    maxCount?: number;
    show: boolean;
  };
  emailResults?: EmailResult[];
  name: string;
  status: "error" | "ok";
};

type EmailResult = {
  body: string;
  lastMessageAt: string | null;
  sender: string | null;
  snippet: string;
  subject: string;
  threadId: string;
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

type OpenAIChatProps = {
  firstName?: string;
  initialApprovalMode: ApprovalModeOption;
};

function createIntroMessage(firstName?: string): ChatMessage {
  return {
    id: "assistant-intro",
    role: "assistant",
    content: `Welcome${firstName ? `, ${firstName}` : ""}. Ask me to search Gmail, check Calendar, or queue a change for manual approval.`,
  };
}

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

function formatEmailTimestamp(value: string | null) {
  if (!value) {
    return "Unknown time";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Unknown time";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function getMessageEmailResults(message: ChatMessage) {
  if (message.role !== "assistant") {
    return [];
  }

  const displayDirective = message.emailDisplay;

  if (!displayDirective?.show) {
    return [];
  }

  const emailResults = message.emailResults ?? [];

  if (!displayDirective.maxCount) {
    return emailResults;
  }

  return emailResults.slice(0, displayDirective.maxCount);
}

const EMAIL_BODY_PREVIEW_LENGTH = 280;

function getEmailBodyText(email: EmailResult) {
  return email.body.trim() || email.snippet.trim();
}

function EmailResultCard({ email }: { email: EmailResult }) {
  const [isBodyExpanded, setIsBodyExpanded] = useState(false);
  const bodyText = getEmailBodyText(email);
  const hasLongBody = bodyText.length > EMAIL_BODY_PREVIEW_LENGTH;
  const displayedBody =
    !hasLongBody || isBodyExpanded
      ? bodyText
      : `${bodyText.slice(0, EMAIL_BODY_PREVIEW_LENGTH).trimEnd()}…`;

  return (
    <details className="group overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
      <summary className="cursor-pointer list-none px-4 py-3 transition hover:bg-slate-100 [&::-webkit-details-marker]:hidden">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2">
            <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500">
              <ChevronRight
                aria-hidden="true"
                className="h-2.5 w-2.5 transition-transform duration-200 group-open:rotate-90"
                strokeWidth={2.25}
              />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">
                {email.subject}
              </p>
              <p className="truncate text-xs text-slate-500">
                {email.sender ?? "Unknown sender"}
              </p>
            </div>
          </div>
          <p className="shrink-0 text-xs text-slate-500">
            {formatEmailTimestamp(email.lastMessageAt)}
          </p>
        </div>
      </summary>
      <div className="border-t border-slate-200 px-4 py-3 text-sm leading-6 text-slate-600">
        <p className="whitespace-pre-wrap">
          {displayedBody || "No message preview available."}
        </p>
        {hasLongBody ? (
          <button
            className="mt-3 text-xs font-medium text-slate-500 transition hover:text-slate-700"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setIsBodyExpanded((current) => !current);
            }}
            type="button"
          >
            {isBodyExpanded ? "Show less" : "See more"}
          </button>
        ) : null}
      </div>
    </details>
  );
}

function AssistantMessageContent({ content }: { content: string }) {
  return (
    <ReactMarkdown
      components={{
        li: ({ children }) => (
          <li className="ml-5 list-disc whitespace-pre-wrap">{children}</li>
        ),
        ol: ({ children }) => <ol className="space-y-1">{children}</ol>,
        p: ({ children }) => <p className="whitespace-pre-wrap">{children}</p>,
        strong: ({ children }) => (
          <strong className="font-semibold text-slate-900">{children}</strong>
        ),
        ul: ({ children }) => <ul className="space-y-1">{children}</ul>,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

export function OpenAIChat({
  firstName,
  initialApprovalMode,
}: OpenAIChatProps) {
  const introMessage = createIntroMessage(firstName);
  const [messages, setMessages] = useState<ChatMessage[]>([introMessage]);
  const [drafts, setDrafts] = useState<ActionDraft[]>([]);
  const [input, setInput] = useState("");
  const [isLoadingDrafts, setIsLoadingDrafts] = useState(true);
  const [isLoadingMessages, setIsLoadingMessages] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeletingChat, setIsDeletingChat] = useState(false);
  const [pendingDraftId, setPendingDraftId] = useState<string | null>(null);
  const [isPromptHelpOpen, setIsPromptHelpOpen] = useState(false);
  const [isQueueCollapsed, setIsQueueCollapsed] = useState(false);

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

      toast.error(message);
    } finally {
      setIsLoadingDrafts(false);
    }
  }

  async function loadChatMessages(options?: { suppressErrors?: boolean }) {
    try {
      const response = await fetch("/api/chat");

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | {
              error?: string;
            }
          | null;

        throw new Error(payload?.error ?? "Unable to load chat history.");
      }

      const payload = (await response.json()) as {
        messages?: ChatMessage[];
      };

      setMessages([introMessage, ...(payload.messages ?? [])]);
    } catch (loadError) {
      const message =
        loadError instanceof Error
          ? loadError.message
          : "Unable to load chat history.";

      if (!options?.suppressErrors) {
        toast.error(message);
      }
    } finally {
      setIsLoadingMessages(false);
    }
  }

  const loadInitialData = useEffectEvent(() => {
    void Promise.all([loadDrafts(), loadChatMessages()]);
  });

  useEffect(() => {
    loadInitialData();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedInput = input.trim();

    if (!trimmedInput || isSubmitting || isLoadingMessages || isDeletingChat) {
      return;
    }

    const nextUserMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmedInput,
    };
    const nextAssistantMessageId = crypto.randomUUID();

    setMessages((currentMessages) => [
      ...currentMessages,
      nextUserMessage,
      {
        id: nextAssistantMessageId,
        role: "assistant",
        content: "Thinking...",
      },
    ]);
    setInput("");
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: trimmedInput,
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

      await Promise.all([loadChatMessages({ suppressErrors: true }), loadDrafts()]);
    } catch (submissionError) {
      setMessages((currentMessages) =>
        currentMessages.filter((message) => message.id !== nextAssistantMessageId),
      );
      void loadChatMessages({ suppressErrors: true });

      const message =
        submissionError instanceof Error
          ? submissionError.message
          : "Chat request failed.";

      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDeleteChat() {
    if (isDeletingChat) {
      return;
    }

    setIsDeletingChat(true);

    try {
      const response = await fetch("/api/chat", {
        method: "DELETE",
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | {
              error?: string;
            }
          | null;

        throw new Error(payload?.error ?? "Unable to delete chat history.");
      }

      setMessages([introMessage]);
      setInput("");
      toast.success("Chat history deleted.");
    } catch (deleteError) {
      const message =
        deleteError instanceof Error
          ? deleteError.message
          : "Unable to delete chat history.";

      toast.error(message);
    } finally {
      setIsDeletingChat(false);
    }
  }

  async function handleDraftAction(draftId: string, action: "approve" | "reject") {
    setPendingDraftId(draftId);

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

      toast.error(message);
    } finally {
      setPendingDraftId(null);
    }
  }

  const hasPersistedMessages = messages.length > 1;
  const needsQueueAttention = drafts.length > 0;
  const showsApprovalQueue = !isLoadingDrafts && needsQueueAttention;
  const isApprovalQueueVisible = showsApprovalQueue && !isQueueCollapsed;

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
              modifications from the review queue when needed.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 self-start">
            <div className="rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-medium uppercase tracking-[0.2em] text-emerald-700">
              {initialApprovalMode.label}
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button
                  aria-label="Delete chat history"
                  className="flex h-11 w-11 items-center justify-center rounded-full border border-rose-200 bg-rose-50 text-rose-700 transition hover:border-rose-300 hover:bg-rose-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                  disabled={!hasPersistedMessages || isDeletingChat || isSubmitting}
                  type="button"
                >
                  <Trash2 aria-hidden="true" className="h-[18px] w-[18px]" strokeWidth={1.9} />
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this chat?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This permanently removes every saved message in this
                    conversation. Google Workspace approval drafts will stay in
                    the queue.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={isDeletingChat}>
                    Keep chat
                  </AlertDialogCancel>
                  <AlertDialogAction
                    disabled={isDeletingChat}
                    onClick={() => void handleDeleteChat()}
                  >
                    {isDeletingChat ? "Deleting..." : "Delete chat"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
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

        {showsApprovalQueue ? (
          <div className="flex justify-end">
            <button
              aria-controls="approval-queue"
              aria-expanded={!isQueueCollapsed}
              aria-label={
                isQueueCollapsed ? "Show approval queue" : "Hide approval queue"
              }
              className={`flex h-11 items-center gap-2 rounded-full border px-4 text-sm font-medium transition ${
                isQueueCollapsed && needsQueueAttention
                  ? "border-amber-300 bg-amber-50 text-amber-700 hover:border-amber-400 hover:bg-amber-100"
                  : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
              }`}
              onClick={() => setIsQueueCollapsed((current) => !current)}
              type="button"
            >
              {isQueueCollapsed ? (
                <ChevronLeft
                  aria-hidden="true"
                  className="h-4 w-4"
                  strokeWidth={2}
                />
              ) : (
                <ChevronRight
                  aria-hidden="true"
                  className="h-4 w-4"
                  strokeWidth={2}
                />
              )}
              <span>{isQueueCollapsed ? "Show queue" : "Hide queue"}</span>
              {isQueueCollapsed && needsQueueAttention ? (
                <TriangleAlert
                  aria-hidden="true"
                  className="h-4 w-4 text-amber-500"
                  strokeWidth={2}
                />
              ) : null}
            </button>
          </div>
        ) : null}

        <div
          className={`grid gap-4 xl:min-h-[calc(100vh-15rem)] ${
            isApprovalQueueVisible
              ? "xl:grid-cols-[minmax(0,1fr)_24rem]"
              : "xl:grid-cols-1"
          }`}
        >
          <div className="flex min-h-[24rem] flex-col overflow-hidden rounded-[1.5rem] border border-slate-200 bg-slate-50 xl:h-full xl:min-h-0">
            <div className="flex-1 space-y-4 overflow-y-auto p-4 md:p-5">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex ${
                    message.role === "user" ? "justify-end" : "justify-start"
                  }`}
                >
                  <article
                    className={`max-w-[88%] rounded-3xl px-4 py-3 text-sm leading-6 shadow-sm ${
                      message.role === "user"
                        ? "bg-slate-950 text-white"
                        : "bg-white text-slate-700"
                    }`}
                  >
                    {message.role === "assistant" ? (
                      <AssistantMessageContent content={message.content} />
                    ) : (
                      <p className="whitespace-pre-wrap break-words">
                        {message.content}
                      </p>
                    )}
                    {getMessageEmailResults(message).length ? (
                      <div className="mt-3 space-y-2">
                        {getMessageEmailResults(message).map((email) => (
                          <EmailResultCard
                            key={`${message.id}-${email.threadId}`}
                            email={email}
                          />
                        ))}
                      </div>
                    ) : null}
                    {message.role === "assistant" && message.toolCalls?.length ? (
                      <details className="group mt-3">
                        <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium text-slate-400 transition hover:text-slate-500 [&::-webkit-details-marker]:hidden">
                          <span className="flex h-4 w-4 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-500 transition duration-200 group-open:border-slate-300 group-open:bg-white group-open:text-slate-700">
                            <ChevronRight
                              aria-hidden="true"
                              className="h-2.5 w-2.5 transition-transform duration-200 group-open:rotate-90"
                              strokeWidth={2.25}
                            />
                          </span>
                          <span>show toolcalls</span>
                        </summary>
                        <div className="mt-2 space-y-2 border-l border-slate-200 pl-3 text-xs leading-5 text-slate-500">
                          {message.toolCalls.map((toolCall, index) => (
                            <div key={`${message.id}-${toolCall.name}-${index}`}>
                              <p className="font-medium text-slate-600">
                                {formatToolCallName(toolCall.name)}
                                {toolCall.status === "error" ? " (failed)" : ""}
                              </p>
                              <p>
                                {summarizeToolCallArguments(toolCall.arguments)}
                              </p>
                            </div>
                          ))}
                        </div>
                      </details>
                    ) : null}
                  </article>
                </div>
              ))}
              {isLoadingMessages ? (
                <p className="text-sm leading-6 text-slate-500">
                  Loading conversation...
                </p>
              ) : null}
            </div>

            <form
              className="border-t border-slate-200 bg-white p-4"
              onSubmit={handleSubmit}
            >
              <div className="flex flex-col gap-3">
                <div className="relative">
                  <textarea
                    className="min-h-24 w-full rounded-[1.25rem] border border-slate-200 bg-slate-50 px-4 py-3 pr-14 text-sm text-slate-900 outline-none transition focus:border-slate-400 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
                    disabled={isLoadingMessages || isDeletingChat}
                    onChange={(event) => setInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (isSubmitting && event.key === "Enter") {
                        event.preventDefault();
                        return;
                      }

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
                    placeholder="Ask Gmail or Calendar to search, summarize, or draft a change."
                    value={input}
                  />
                  <button
                    aria-controls="prompt-help-tooltip"
                    aria-expanded={isPromptHelpOpen}
                    aria-label={
                      isPromptHelpOpen
                        ? "Hide prompt examples"
                        : "Show prompt examples"
                    }
                    className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-sm font-semibold text-slate-500 shadow-sm transition hover:border-slate-300 hover:text-slate-700"
                    onClick={() => setIsPromptHelpOpen((current) => !current)}
                    type="button"
                  >
                    {isPromptHelpOpen ? (
                      <X aria-hidden="true" className="h-4 w-4" strokeWidth={2} />
                    ) : (
                      "?"
                    )}
                  </button>
                  {isPromptHelpOpen ? (
                    <div
                      className="absolute bottom-[calc(100%+0.75rem)] right-0 z-10 w-full max-w-sm rounded-[1.25rem] border border-slate-200 bg-white p-4 shadow-[0_20px_50px_rgba(15,23,42,0.14)]"
                      id="prompt-help-tooltip"
                      role="tooltip"
                    >
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
                        Try asking
                      </p>
                      <div className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
                        <p>&ldquo;Find my most recent email.&rdquo;</p>
                        <p>
                          &ldquo;Show my next three events with Alice this
                          week.&rdquo;
                        </p>
                        <p>
                          &ldquo;Draft moving tomorrow&apos;s 2pm design review
                          to 3pm, but do not notify attendees.&rdquo;
                        </p>
                      </div>
                    </div>
                  ) : null}
                </div>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-slate-500">
                    {initialApprovalMode.description}
                  </p>
                  <button
                    className="rounded-full bg-slate-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
                    disabled={
                      isLoadingMessages ||
                      isSubmitting ||
                      isDeletingChat ||
                      !input.trim()
                    }
                    type="submit"
                  >
                    {isSubmitting ? "Sending..." : "Send message"}
                  </button>
                </div>
              </div>
            </form>
          </div>

          <aside
            className={`${isApprovalQueueVisible ? "flex" : "hidden"} self-start`}
            id="approval-queue"
          >
            <section className="flex min-h-[18rem] w-full max-w-[24rem] flex-col rounded-[1.5rem] bg-slate-950 p-5 text-slate-50">
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

              <div className="mt-4 space-y-4">
                {drafts.map((draft) => (
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
                ))}
              </div>
            </section>
          </aside>
        </div>
      </div>
    </section>
  );
}

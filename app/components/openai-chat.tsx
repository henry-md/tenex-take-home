"use client";

import {
  ChevronRight,
  Maximize2,
  MessageSquare,
  Minimize2,
  Settings2,
  ShieldAlert,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { toast } from "sonner";
import {
  FormEvent,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";

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
  bodyHtml?: string;
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
    content: `Ask for Gmail or Calendar help whenever you need it${firstName ? `, ${firstName}` : ""}. The inbox board stays primary, and I can still search, summarize, or draft changes on demand.`,
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

const EMAIL_BODY_SANITIZE_SCHEMA = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    a: [...(defaultSchema.attributes?.a ?? []), "href", "rel", "target"],
    td: [...(defaultSchema.attributes?.td ?? []), "colspan", "rowspan"],
    th: [...(defaultSchema.attributes?.th ?? []), "colspan", "rowspan"],
  },
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    "div",
    "hr",
    "section",
    "span",
    "table",
    "tbody",
    "td",
    "tfoot",
    "th",
    "thead",
    "tr",
  ],
};

function getEmailBodyText(email: EmailResult) {
  return email.body.trim() || email.snippet.trim();
}

function normalizeEmailTextForComparison(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function hasRenderedEmailBody(email: EmailResult) {
  if (email.bodyHtml?.trim()) {
    return true;
  }

  const bodyText = getEmailBodyText(email);

  if (!bodyText) {
    return false;
  }

  return (
    normalizeEmailTextForComparison(bodyText) !==
    normalizeEmailTextForComparison(email.snippet)
  );
}

function EmailBodyContent({ email }: { email: EmailResult }) {
  if (email.bodyHtml?.trim()) {
    return (
      <div className="space-y-3 break-words text-sm leading-7 text-slate-700">
        <ReactMarkdown
          components={{
            a: ({ children, href }) => (
              <a
                className="font-medium text-slate-900 underline decoration-slate-300 underline-offset-2 transition hover:text-slate-700"
                href={href}
                rel="noreferrer"
                target="_blank"
              >
                {children}
              </a>
            ),
            blockquote: ({ children }) => (
              <blockquote className="border-l-2 border-slate-200 pl-4 italic text-slate-600">
                {children}
              </blockquote>
            ),
            li: ({ children }) => (
              <li className="ml-5 list-disc whitespace-pre-wrap">{children}</li>
            ),
            ol: ({ children }) => <ol className="space-y-1">{children}</ol>,
            p: ({ children }) => <p className="whitespace-pre-wrap">{children}</p>,
            strong: ({ children }) => (
              <strong className="font-semibold text-slate-950">{children}</strong>
            ),
            table: ({ children }) => (
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="min-w-full border-collapse text-left text-sm">
                  {children}
                </table>
              </div>
            ),
            td: ({ children }) => (
              <td className="border-t border-slate-200 px-3 py-2 align-top">
                {children}
              </td>
            ),
            th: ({ children }) => (
              <th className="bg-slate-50 px-3 py-2 font-semibold text-slate-900">
                {children}
              </th>
            ),
            ul: ({ children }) => <ul className="space-y-1">{children}</ul>,
          }}
          rehypePlugins={[rehypeRaw, [rehypeSanitize, EMAIL_BODY_SANITIZE_SCHEMA]]}
        >
          {email.bodyHtml}
        </ReactMarkdown>
      </div>
    );
  }

  return (
    <p className="whitespace-pre-wrap break-words text-sm leading-7 text-slate-700">
      {getEmailBodyText(email)}
    </p>
  );
}

function EmailResultCard({ email }: { email: EmailResult }) {
  const showsBody = hasRenderedEmailBody(email);

  return (
    <details className="group overflow-hidden rounded-[1.35rem] border border-slate-300/90 bg-white shadow-[0_18px_44px_rgba(15,23,42,0.08)]">
      <summary className="cursor-pointer list-none bg-[linear-gradient(180deg,rgba(248,250,252,0.96),rgba(255,255,255,0.98))] px-4 py-3.5 transition hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2">
            <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500">
              <ChevronRight
                aria-hidden="true"
                className="details-chevron h-2.5 w-2.5"
                strokeWidth={2.25}
              />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                Email
              </p>
              <p className="truncate text-sm font-semibold text-slate-900">
                {email.subject}
              </p>
              <p className="truncate text-xs text-slate-500">
                {email.sender ?? "Unknown sender"}
              </p>
              <p className="truncate text-sm text-slate-500">
                {email.snippet || "No message preview available."}
              </p>
            </div>
          </div>
          <p className="shrink-0 text-xs text-slate-500">
            {formatEmailTimestamp(email.lastMessageAt)}
          </p>
        </div>
      </summary>
      <div className="border-t border-slate-200 bg-[linear-gradient(180deg,rgba(248,250,252,0.85),rgba(241,245,249,0.55))] p-4">
        <div className="overflow-hidden rounded-[1.1rem] border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              Message body
            </p>
          </div>
          <div className="max-h-[28rem] overflow-y-auto px-4 py-4">
            {showsBody ? (
              <EmailBodyContent email={email} />
            ) : (
              <p className="text-sm leading-7 text-slate-500">
                No additional message body is available beyond the preview.
              </p>
            )}
          </div>
        </div>
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
  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const expandedGutterClass = "px-8 py-6 md:px-12";

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

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end",
    });
  }, [isOpen, messages]);

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

  if (!isOpen) {
    return (
      <button
        aria-label="Open assistant"
        className="fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-slate-950 text-white shadow-[0_24px_60px_rgba(15,23,42,0.32)] transition hover:bg-slate-800"
        onClick={() => setIsOpen(true)}
        type="button"
      >
        <MessageSquare aria-hidden="true" className="h-6 w-6" strokeWidth={2} />
        {needsQueueAttention ? (
          <span className="absolute -right-1 -top-1 min-w-6 rounded-full bg-amber-400 px-1.5 py-0.5 text-xs font-semibold text-slate-950">
            {drafts.length}
          </span>
        ) : null}
      </button>
    );
  }

  return (
    <section
      className={`fixed z-50 flex flex-col overflow-hidden bg-white/95 backdrop-blur ${
        isExpanded
          ? "inset-0 h-screen w-screen rounded-none border-0 shadow-none"
          : "bottom-4 right-4 h-[min(82vh,48rem)] w-[min(26rem,calc(100vw-1rem))] rounded-[1.75rem] border border-white/70 shadow-[0_30px_90px_rgba(15,23,42,0.26)]"
      }`}
    >
      <header
        className={`border-b border-slate-200 bg-[linear-gradient(135deg,rgba(255,248,235,0.95),rgba(248,250,252,0.98)_58%,rgba(241,245,249,0.98))] ${
          isExpanded ? expandedGutterClass : "px-4 py-4"
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-2">
            <div>
              <p className="text-sm font-semibold text-slate-950">
                Workspace assistant
              </p>
              <p className={`text-slate-500 ${isExpanded ? "max-w-xl text-xs" : "text-xs"}`}>
                Search Gmail or Calendar without leaving the inbox board.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700">
                {initialApprovalMode.label}
              </span>
              {showsApprovalQueue ? (
                <button
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] transition ${
                    isQueueCollapsed
                      ? "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                  onClick={() => setIsQueueCollapsed((current) => !current)}
                  type="button"
                >
                  <ShieldAlert aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
                  {drafts.length} pending
                  {isQueueCollapsed ? (
                    <TriangleAlert aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
                  ) : null}
                </button>
              ) : null}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              aria-label={isExpanded ? "Collapse assistant" : "Expand assistant"}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
              onClick={() => setIsExpanded((current) => !current)}
              type="button"
            >
              {isExpanded ? (
                <Minimize2
                  aria-hidden="true"
                  className="h-[18px] w-[18px]"
                  strokeWidth={1.9}
                />
              ) : (
                <Maximize2
                  aria-hidden="true"
                  className="h-[18px] w-[18px]"
                  strokeWidth={1.9}
                />
              )}
            </button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button
                  aria-label="Delete chat history"
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-rose-200 bg-rose-50 text-rose-700 transition hover:border-rose-300 hover:bg-rose-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                  disabled={!hasPersistedMessages || isDeletingChat || isSubmitting}
                  type="button"
                >
                  <Trash2
                    aria-hidden="true"
                    className="h-[16px] w-[16px]"
                    strokeWidth={1.9}
                  />
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
              className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
              href="/settings"
            >
              <Settings2
                aria-hidden="true"
                className="h-[18px] w-[18px]"
                strokeWidth={1.9}
              />
            </Link>
            <button
              aria-label="Collapse assistant"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
              onClick={() => {
                setIsExpanded(false);
                setIsOpen(false);
              }}
              type="button"
            >
              <X
                aria-hidden="true"
                className="h-[18px] w-[18px]"
                strokeWidth={2}
              />
            </button>
          </div>
        </div>
      </header>

      {showsApprovalQueue && !isQueueCollapsed ? (
        <section
          className={`border-b border-slate-200 bg-slate-950 text-slate-50 ${
            isExpanded ? expandedGutterClass : "px-4 py-4"
          }`}
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
                Approval queue
              </p>
              <p className="mt-1 text-xs leading-5 text-slate-300">
                Drafted changes stay here until you approve or reject them.
              </p>
            </div>
            <div className="rounded-full border border-slate-700 px-3 py-1 text-xs font-medium text-slate-300">
              {drafts.length}
            </div>
          </div>

          <div className="mt-3 max-h-52 space-y-3 overflow-y-auto pr-1">
            {drafts.map((draft) => (
              <article
                key={draft.id}
                className="rounded-[1.25rem] border border-slate-800 bg-slate-900/80 p-4"
              >
                <h3 className="text-sm font-semibold text-white">
                  {getDraftActionLabel(draft)}
                </h3>
                <p className="mt-2 text-xs leading-5 text-slate-300">
                  {getDraftCountLabel(draft)}
                </p>

                <div className="mt-3 flex gap-2">
                  <button
                    className="flex-1 rounded-full bg-white px-4 py-2 text-xs font-medium text-slate-950 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:bg-slate-500 disabled:text-slate-200"
                    disabled={pendingDraftId === draft.id}
                    onClick={() => void handleDraftAction(draft.id, "approve")}
                    type="button"
                  >
                    {pendingDraftId === draft.id ? "Working..." : "Approve"}
                  </button>
                  <button
                    className="rounded-full border border-slate-700 px-4 py-2 text-xs font-medium text-slate-200 transition hover:border-slate-500 hover:bg-slate-800 disabled:cursor-not-allowed disabled:border-slate-800 disabled:text-slate-500"
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
      ) : null}

      <div className="min-h-0 flex-1 bg-slate-50">
        <div
          className={`h-full overflow-y-auto ${
            isExpanded ? expandedGutterClass : "p-4"
          }`}
        >
          <div className={`space-y-4 ${isExpanded ? "space-y-5" : ""}`}>
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${
                message.role === "user" ? "justify-end" : "justify-start"
              }`}
            >
              <article
                className={`rounded-3xl shadow-sm ${
                  isExpanded
                    ? "max-w-[48rem] px-5 py-4 text-sm leading-7"
                    : "max-w-[92%] px-4 py-3 text-sm leading-6"
                } ${
                  message.role === "user"
                    ? "bg-slate-950 text-white"
                    : "bg-white text-slate-700"
                }`}
              >
                {message.role === "assistant" ? (
                  <AssistantMessageContent content={message.content} />
                ) : (
                  <p className="whitespace-pre-wrap break-words">{message.content}</p>
                )}
                {getMessageEmailResults(message).length ? (
                  <div className="mt-4 rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]">
                    <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                      {getMessageEmailResults(message).length === 1
                        ? "Email result"
                        : "Email results"}
                    </p>
                    <div className="space-y-3">
                      {getMessageEmailResults(message).map((email) => (
                        <EmailResultCard
                          key={`${message.id}-${email.threadId}`}
                          email={email}
                        />
                      ))}
                    </div>
                  </div>
                ) : null}
                {message.role === "assistant" && message.toolCalls?.length ? (
                  <details className="group mt-3">
                    <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium text-slate-400 transition hover:text-slate-500 [&::-webkit-details-marker]:hidden">
                      <span className="flex h-4 w-4 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-500 transition duration-200 group-open:border-slate-300 group-open:bg-white group-open:text-slate-700">
                        <ChevronRight
                          aria-hidden="true"
                          className="details-chevron h-2.5 w-2.5"
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
                          <p>{summarizeToolCallArguments(toolCall.arguments)}</p>
                        </div>
                      ))}
                    </div>
                  </details>
                ) : null}
              </article>
            </div>
          ))}
          {isLoadingMessages ? (
            <p className="text-sm leading-6 text-slate-500">Loading conversation...</p>
          ) : null}
          <div ref={messagesEndRef} />
          </div>
        </div>
      </div>

      <form
        className={`border-t border-slate-200 bg-white ${
          isExpanded ? expandedGutterClass : "p-4"
        }`}
        onSubmit={handleSubmit}
      >
        <div className={`flex flex-col ${isExpanded ? "gap-4" : "gap-3"}`}>
          <div className="relative">
            <textarea
              className={`w-full rounded-[1.25rem] border border-slate-200 bg-slate-50 text-slate-900 outline-none transition focus:border-slate-400 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 ${
                isExpanded
                  ? "min-h-28 px-5 py-4 pr-16 text-sm"
                  : "min-h-24 px-4 py-3 pr-14 text-sm"
              }`}
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
                isPromptHelpOpen ? "Hide prompt examples" : "Show prompt examples"
              }
              className={`absolute flex items-center justify-center rounded-full border border-slate-200 bg-white font-semibold text-slate-500 shadow-sm transition hover:border-slate-300 hover:text-slate-700 ${
                isExpanded
                  ? "right-4 top-4 h-9 w-9 text-sm"
                  : "right-3 top-3 h-8 w-8 text-sm"
              }`}
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
                className={`absolute bottom-[calc(100%+0.75rem)] right-0 z-10 w-full rounded-[1.25rem] border border-slate-200 bg-white shadow-[0_20px_50px_rgba(15,23,42,0.14)] ${
                  isExpanded ? "max-w-sm p-4" : "max-w-sm p-4"
                }`}
                id="prompt-help-tooltip"
                role="tooltip"
              >
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
                  Try asking
                </p>
                <div className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
                  <p>&ldquo;Find my most recent email.&rdquo;</p>
                  <p>&ldquo;Show my next three events with Alice this week.&rdquo;</p>
                  <p>
                    &ldquo;Draft moving tomorrow&apos;s 2pm design review to 3pm,
                    but do not notify attendees.&rdquo;
                  </p>
                </div>
              </div>
            ) : null}
          </div>
          <div className="flex items-center justify-between gap-3">
            <p className={`${isExpanded ? "text-sm" : "text-xs"} text-slate-500`}>
              {initialApprovalMode.description}
            </p>
            <button
              className={`rounded-full bg-slate-950 font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400 ${
                isExpanded ? "px-6 py-3 text-sm" : "px-5 py-3 text-sm"
              }`}
              disabled={
                isLoadingMessages ||
                isSubmitting ||
                isDeletingChat ||
                !input.trim()
              }
              type="submit"
            >
              {isSubmitting ? "Sending..." : "Send"}
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}

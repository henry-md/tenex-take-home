"use client";

import { FormEvent, useEffect, useState } from "react";

import { AuthButton } from "@/app/components/auth-button";

type ChatMessage = {
  content: string;
  id: string;
  role: "assistant" | "user";
};

type ActionDraft = {
  afterState: unknown;
  beforeState: unknown;
  createdAt: string;
  expiresAt: string;
  id: string;
  kind: string;
  provider: string;
  status: string;
  summary: string;
  title: string | null;
};

type OpenAIChatProps = {
  firstName?: string;
};

function prettifyKey(key: string) {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/_/g, " ")
    .replace(/^./, (value) => value.toUpperCase());
}

function formatStateValue(value: unknown) {
  if (value === null || value === undefined) {
    return "None";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.length ? value.join(", ") : "None";
  }

  return JSON.stringify(value);
}

function renderStateRows(state: unknown) {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    return (
      <p className="text-sm leading-6 text-slate-600">{formatStateValue(state)}</p>
    );
  }

  return (
    <div className="space-y-2">
      {Object.entries(state).map(([key, value]) => (
        <div key={key} className="rounded-2xl bg-slate-50 px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            {prettifyKey(key)}
          </p>
          <p className="mt-1 text-sm leading-6 text-slate-700">
            {formatStateValue(value)}
          </p>
        </div>
      ))}
    </div>
  );
}

export function OpenAIChat({ firstName }: OpenAIChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "assistant-intro",
      role: "assistant",
      content: `Welcome${firstName ? `, ${firstName}` : ""}. Ask me to search Gmail, check Calendar, or queue a change for manual approval.`,
    },
  ]);
  const [drafts, setDrafts] = useState<ActionDraft[]>([]);
  const [input, setInput] = useState("");
  const [isLoadingDrafts, setIsLoadingDrafts] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingDraftId, setPendingDraftId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadDrafts();
  }, []);

  function updateAssistantMessage(messageId: string, content: string) {
    setMessages((currentMessages) =>
      currentMessages.map((message) =>
        message.id === messageId ? { ...message, content } : message,
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
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load approvals.",
      );
    } finally {
      setIsLoadingDrafts(false);
    }
  }

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

      const assistantContent = await response.text();
      updateAssistantMessage(nextAssistantMessageId, assistantContent);
      await loadDrafts();
    } catch (submissionError) {
      setMessages((currentMessages) =>
        currentMessages.filter((message) => message.id !== nextAssistantMessageId),
      );

      setError(
        submissionError instanceof Error
          ? submissionError.message
          : "Chat request failed.",
      );
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
      setError(
        draftError instanceof Error
          ? draftError.message
          : `Unable to ${action} this draft.`,
      );
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
              Approval required
            </div>
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
                  {message.content}
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
                  placeholder="Try: find my most recent email, or draft a change to star a thread and queue it for approval."
                  value={input}
                />
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-slate-500">
                    The assistant can read Google data directly, but queued
                    changes only execute after you approve them.
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
                    Gmail and Calendar changes stay here until you approve them.
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
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                            {draft.provider.replaceAll("_", " ")}
                          </p>
                          <h3 className="mt-1 text-base font-semibold text-white">
                            {draft.title ?? draft.summary}
                          </h3>
                        </div>
                        <p className="rounded-full border border-amber-400/40 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-200">
                          Pending
                        </p>
                      </div>

                      <p className="mt-3 text-sm leading-6 text-slate-300">
                        {draft.summary}
                      </p>

                      <div className="mt-4 grid gap-3">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                            Current state
                          </p>
                          <div className="mt-2 rounded-[1rem] bg-white p-3 text-slate-900">
                            {renderStateRows(draft.beforeState)}
                          </div>
                        </div>

                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                            Proposed state
                          </p>
                          <div className="mt-2 rounded-[1rem] bg-white p-3 text-slate-900">
                            {renderStateRows(draft.afterState)}
                          </div>
                        </div>
                      </div>

                      <p className="mt-3 text-xs leading-5 text-slate-400">
                        Expires {new Date(draft.expiresAt).toLocaleString()}
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
    </section>
  );
}

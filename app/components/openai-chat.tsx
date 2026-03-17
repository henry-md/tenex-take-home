"use client";

import { FormEvent, useState } from "react";

import { AuthButton } from "@/app/components/auth-button";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type OpenAIChatProps = {
  firstName?: string;
};

export function OpenAIChat({ firstName }: OpenAIChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "assistant-intro",
      role: "assistant",
      content: `Welcome${firstName ? `, ${firstName}` : ""}. Ask for help sorting messages, defining buckets, or deciding what needs attention first.`,
    },
  ]);
  const [input, setInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateAssistantMessage(messageId: string, content: string) {
    setMessages((currentMessages) =>
      currentMessages.map((message) =>
        message.id === messageId ? { ...message, content } : message,
      ),
    );
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

      if (!response.body) {
        throw new Error("Streaming response body unavailable.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let assistantContent = "";

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          assistantContent += decoder.decode();
          break;
        }

        assistantContent += decoder.decode(value, { stream: true });
        updateAssistantMessage(nextAssistantMessageId, assistantContent);
      }

      updateAssistantMessage(nextAssistantMessageId, assistantContent);
    } catch (submissionError) {
      setMessages((currentMessages) =>
        currentMessages.filter((message) => message.id !== nextAssistantMessageId),
      );

      const message =
        submissionError instanceof Error
          ? submissionError.message
          : "Chat request failed.";

      setError(message);
    } finally {
      setIsSubmitting(false);
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
              Organize what matters first
            </h2>
            <p className="max-w-2xl text-sm leading-6 text-slate-600">
              Use the assistant to pressure-test bucket ideas, draft triage
              rules, and decide which conversations deserve immediate follow-up.
            </p>
          </div>
          <div className="flex items-center gap-3 self-start">
            <div className="rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-medium uppercase tracking-[0.2em] text-emerald-700">
              Ready
            </div>
            <AuthButton
              className="px-4 py-2.5 text-sm"
              isAuthenticated
            />
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_19rem]">
          <div className="flex min-h-[24rem] flex-col overflow-hidden rounded-[1.5rem] border border-slate-200 bg-slate-50 lg:h-[30rem] lg:min-h-0">
            <div className="flex-1 space-y-4 overflow-y-auto p-4 md:p-5">
              {messages.map((message) => (
                <article
                  key={message.id}
                  className={`max-w-[85%] rounded-3xl px-4 py-3 text-sm leading-6 shadow-sm ${
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
                  placeholder="Ask about sorting priorities, custom buckets, or how to handle a tricky thread."
                  value={input}
                />
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-slate-500">
                    Keep prompts short and specific for sharper triage advice.
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

          <aside className="rounded-[1.5rem] bg-slate-950 p-5 text-slate-50 lg:h-[30rem]">
            <div className="space-y-4">
              <p className="text-sm font-medium uppercase tracking-[0.24em] text-slate-400">
                Try asking
              </p>
              <div className="space-y-3 text-sm leading-6 text-slate-300">
                <p>&ldquo;Which inbox buckets should I start with for client work?&rdquo;</p>
                <p>&ldquo;How would you separate receipts from important finance emails?&rdquo;</p>
                <p>&ldquo;What should go into a custom bucket for hiring conversations?&rdquo;</p>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}

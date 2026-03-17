"use client";

import { FormEvent, useState } from "react";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

const starterMessages: ChatMessage[] = [
  {
    id: "assistant-intro",
    role: "assistant",
    content:
      "Ask anything about Inbox Concierge. This panel sends messages to the OpenAI API through the app server.",
  },
];

export function OpenAIChat() {
  const [messages, setMessages] = useState<ChatMessage[]>(starterMessages);
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
    <section className="rounded-[2rem] border border-white/70 bg-white/85 p-6 shadow-[0_30px_80px_rgba(15,23,42,0.12)] backdrop-blur md:p-8">
      <div className="flex flex-col gap-6">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">
              OpenAI chat
            </p>
            <h2 className="text-2xl font-semibold tracking-tight text-slate-950">
              Test a simple assistant directly in the UI
            </h2>
            <p className="max-w-2xl text-sm leading-6 text-slate-600">
              This is a minimal chat surface backed by the OpenAI API. The API
              key stays server-side and the model name comes from your
              environment configuration.
            </p>
          </div>
          <div className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
            Server-routed
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.4fr_0.6fr]">
          <div className="flex min-h-[28rem] flex-col overflow-hidden rounded-[1.5rem] border border-slate-200 bg-slate-50">
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
              className="border-t border-slate-200 bg-white p-4 md:p-5"
              onSubmit={handleSubmit}
            >
              <div className="flex flex-col gap-3">
                <textarea
                  className="min-h-28 rounded-[1.25rem] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400"
                  onChange={(event) => setInput(event.target.value)}
                  placeholder="Ask the assistant about inbox triage, product ideas, or anything else."
                  value={input}
                />
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-slate-500">
                    Responses are generated by your configured OpenAI model.
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

          <aside className="rounded-[1.5rem] bg-slate-950 p-5 text-slate-50">
            <div className="space-y-4">
              <p className="text-sm font-medium uppercase tracking-[0.24em] text-slate-400">
                Configuration
              </p>
              <div className="space-y-3 text-sm leading-6 text-slate-300">
                <p>
                  Required env vars:
                  <br />
                  <code>OPENAI_API_KEY</code>
                  <br />
                  <code>OPENAI_MODEL</code>
                </p>
                <p>
                  The browser only calls <code>/api/chat</code>. The OpenAI API
                  key is never exposed to the client.
                </p>
                <p>
                  The route currently sends the full visible chat history on
                  each request for a simple multi-turn conversation.
                </p>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}

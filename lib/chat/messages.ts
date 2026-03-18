import { OpenAIChatMessageRole, type Prisma } from "@/generated/prisma/client";
import type {
  ChatMessage,
  EmailDisplayDirective,
  EmailToolResult,
  ToolCallSummary,
} from "@/lib/assistant/google-workspace-agent";
import { prisma } from "@/lib/prisma";
import { findUserIdByEmail, type AppUserInput, upsertAppUser } from "@/lib/users";

export type PersistedChatMessage = {
  content: string;
  emailDisplay?: EmailDisplayDirective;
  emailResults?: EmailToolResult[];
  id: string;
  role: "assistant" | "user";
  toolCalls?: ToolCallSummary[];
};

export type ChatOwnerInput = AppUserInput;

function isUnknownChatFieldError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message.includes("Unknown field `emailDisplay`") ||
    error.message.includes("Unknown field `emailResults`") ||
    error.message.includes("Unknown argument `emailDisplay`") ||
    error.message.includes("Unknown argument `emailResults`")
  );
}

function serializeRole(
  role: OpenAIChatMessageRole,
): PersistedChatMessage["role"] {
  return role === OpenAIChatMessageRole.USER ? "user" : "assistant";
}

function parseToolCalls(value: unknown): ToolCallSummary[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const toolCalls = value.filter((entry): entry is ToolCallSummary => {
    if (!entry || typeof entry !== "object") {
      return false;
    }

    const candidate = entry as {
      arguments?: unknown;
      name?: unknown;
      status?: unknown;
    };

    return (
      typeof candidate.name === "string" &&
      (candidate.status === "ok" || candidate.status === "error") &&
      candidate.arguments !== null &&
      typeof candidate.arguments === "object" &&
      !Array.isArray(candidate.arguments)
    );
  });

  return toolCalls.length
    ? toolCalls.map((toolCall) => {
        const emailResults = Array.isArray(
          (toolCall as { emailResults?: unknown }).emailResults,
        )
          ? ((toolCall as { emailResults: unknown[] }).emailResults.flatMap(
              (entry) => {
                if (!entry || typeof entry !== "object") {
                  return [];
                }

                const candidate = entry as {
                  body?: unknown;
                  bodyHtml?: unknown;
                  lastMessageAt?: unknown;
                  sender?: unknown;
                  snippet?: unknown;
                  subject?: unknown;
                  threadId?: unknown;
                };

                if (
                  typeof candidate.threadId !== "string" ||
                  typeof candidate.subject !== "string" ||
                  typeof candidate.snippet !== "string"
                ) {
                  return [];
                }

                return [
                  {
                    body:
                      typeof candidate.body === "string" && candidate.body.trim().length
                        ? candidate.body
                        : candidate.snippet,
                    bodyHtml:
                      typeof candidate.bodyHtml === "string" &&
                      candidate.bodyHtml.trim().length
                        ? candidate.bodyHtml
                        : undefined,
                    lastMessageAt:
                      typeof candidate.lastMessageAt === "string"
                        ? candidate.lastMessageAt
                        : null,
                    sender:
                      typeof candidate.sender === "string"
                        ? candidate.sender
                        : null,
                    snippet: candidate.snippet,
                    subject: candidate.subject,
                    threadId: candidate.threadId,
                  } satisfies EmailToolResult,
                ];
              },
            ) as EmailToolResult[])
          : undefined;
        const emailDisplay = (() => {
          const candidate = (toolCall as { emailDisplay?: unknown }).emailDisplay;

          if (!candidate || typeof candidate !== "object") {
            return undefined;
          }

          const nextValue = candidate as {
            maxCount?: unknown;
            show?: unknown;
          };

          if (typeof nextValue.show !== "boolean") {
            return undefined;
          }

          return {
            maxCount:
              typeof nextValue.maxCount === "number" ? nextValue.maxCount : undefined,
            show: nextValue.show,
          } satisfies EmailDisplayDirective;
        })();

        return {
          ...toolCall,
          emailDisplay,
          emailResults: emailResults?.length ? emailResults : undefined,
        };
      })
    : undefined;
}

function serializeChatMessage(message: {
  content: string;
  emailDisplay: unknown;
  emailResults: unknown;
  id: string;
  role: OpenAIChatMessageRole;
  toolCalls: unknown;
}) {
  return {
    content: message.content,
    emailDisplay: parseEmailDisplay(message.emailDisplay),
    emailResults: parseEmailResults(message.emailResults),
    id: message.id,
    role: serializeRole(message.role),
    toolCalls: parseToolCalls(message.toolCalls),
  } satisfies PersistedChatMessage;
}

function parseEmailDisplay(value: unknown): EmailDisplayDirective | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const candidate = value as {
    maxCount?: unknown;
    show?: unknown;
  };

  if (typeof candidate.show !== "boolean") {
    return undefined;
  }

  return {
    maxCount: typeof candidate.maxCount === "number" ? candidate.maxCount : undefined,
    show: candidate.show,
  };
}

function parseEmailResults(value: unknown): EmailToolResult[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const emailResults = value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }

    const candidate = entry as {
      body?: unknown;
      bodyHtml?: unknown;
      lastMessageAt?: unknown;
      sender?: unknown;
      snippet?: unknown;
      subject?: unknown;
      threadId?: unknown;
    };

    if (
      typeof candidate.threadId !== "string" ||
      typeof candidate.subject !== "string" ||
      typeof candidate.snippet !== "string"
    ) {
      return [];
    }

    return [
      {
        body:
          typeof candidate.body === "string" && candidate.body.trim().length
            ? candidate.body
            : candidate.snippet,
        bodyHtml:
          typeof candidate.bodyHtml === "string" && candidate.bodyHtml.trim().length
            ? candidate.bodyHtml
            : undefined,
        lastMessageAt:
          typeof candidate.lastMessageAt === "string" ? candidate.lastMessageAt : null,
        sender: typeof candidate.sender === "string" ? candidate.sender : null,
        snippet: candidate.snippet,
        subject: candidate.subject,
        threadId: candidate.threadId,
      } satisfies EmailToolResult,
    ];
  });

  return emailResults.length ? emailResults : undefined;
}

export async function listPersistedChatMessages(ownerEmail: string) {
  const ownerId = await findUserIdByEmail(ownerEmail);

  if (!ownerId) {
    return [];
  }

  let messages: Array<{
    content: string;
    emailDisplay: unknown;
    emailResults: unknown;
    id: string;
    role: OpenAIChatMessageRole;
    toolCalls: unknown;
  }>;

  try {
    messages = await prisma.openAIChatMessage.findMany({
      where: {
        ownerId,
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        content: true,
        emailDisplay: true,
        emailResults: true,
        id: true,
        role: true,
        toolCalls: true,
      },
    });
  } catch (error) {
    if (!isUnknownChatFieldError(error)) {
      throw error;
    }

    const legacyMessages = await prisma.openAIChatMessage.findMany({
      where: {
        ownerId,
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        content: true,
        id: true,
        role: true,
        toolCalls: true,
      },
    });

    messages = legacyMessages.map((message) => ({
      ...message,
      emailDisplay: null,
      emailResults: null,
    }));
  }

  return messages.map(serializeChatMessage);
}

export async function listAssistantChatMessages(ownerEmail: string) {
  const messages = await listPersistedChatMessages(ownerEmail);

  return messages.map(
    (message) =>
      ({
        content: message.content,
        role: message.role,
      }) satisfies ChatMessage,
  );
}

export async function createPersistedChatMessage(input: {
  content: string;
  emailDisplay?: EmailDisplayDirective;
  emailResults?: EmailToolResult[];
  owner: ChatOwnerInput;
  role: PersistedChatMessage["role"];
  toolCalls?: ToolCallSummary[];
}) {
  const owner = await upsertAppUser(input.owner);

  let message;

  try {
    message = await prisma.openAIChatMessage.create({
      data: {
        content: input.content,
        emailDisplay: input.emailDisplay as Prisma.InputJsonValue | undefined,
        emailResults: input.emailResults as Prisma.InputJsonValue | undefined,
        ownerId: owner.id,
        role:
          input.role === "user"
            ? OpenAIChatMessageRole.USER
            : OpenAIChatMessageRole.ASSISTANT,
        toolCalls: input.toolCalls?.length
          ? (input.toolCalls as Prisma.InputJsonValue)
          : undefined,
      },
    });
  } catch (error) {
    if (!isUnknownChatFieldError(error)) {
      throw error;
    }

    message = await prisma.openAIChatMessage.create({
      data: {
        content: input.content,
        ownerId: owner.id,
        role:
          input.role === "user"
            ? OpenAIChatMessageRole.USER
            : OpenAIChatMessageRole.ASSISTANT,
        toolCalls: input.toolCalls?.length
          ? (input.toolCalls as Prisma.InputJsonValue)
          : undefined,
      },
    });
  }

  return serializeChatMessage(message);
}

export async function deletePersistedChatMessages(ownerEmail: string) {
  const ownerId = await findUserIdByEmail(ownerEmail);

  if (!ownerId) {
    return 0;
  }

  const result = await prisma.openAIChatMessage.deleteMany({
    where: {
      ownerId,
    },
  });

  return result.count;
}

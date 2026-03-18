import { OpenAIChatMessageRole, type Prisma } from "@/generated/prisma/client";
import type {
  ChatMessage,
  ToolCallSummary,
} from "@/lib/assistant/google-workspace-agent";
import { prisma } from "@/lib/prisma";

export type PersistedChatMessage = {
  content: string;
  id: string;
  role: "assistant" | "user";
  toolCalls?: ToolCallSummary[];
};

export type ChatOwnerInput = {
  email: string;
  image?: string | null;
  name?: string | null;
};

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

  return toolCalls.length ? toolCalls : undefined;
}

function serializeChatMessage(message: {
  content: string;
  id: string;
  role: OpenAIChatMessageRole;
  toolCalls: unknown;
}) {
  return {
    content: message.content,
    id: message.id,
    role: serializeRole(message.role),
    toolCalls: parseToolCalls(message.toolCalls),
  } satisfies PersistedChatMessage;
}

async function findChatOwnerId(email: string) {
  const user = await prisma.user.findUnique({
    where: {
      email,
    },
    select: {
      id: true,
    },
  });

  return user?.id ?? null;
}

async function upsertChatOwner(owner: ChatOwnerInput) {
  return prisma.user.upsert({
    where: {
      email: owner.email,
    },
    create: {
      email: owner.email,
      image: owner.image ?? null,
      name: owner.name ?? null,
    },
    update: {
      ...(owner.image !== undefined ? { image: owner.image } : {}),
      ...(owner.name !== undefined ? { name: owner.name } : {}),
    },
    select: {
      id: true,
    },
  });
}

export async function listPersistedChatMessages(ownerEmail: string) {
  const ownerId = await findChatOwnerId(ownerEmail);

  if (!ownerId) {
    return [];
  }

  const messages = await prisma.openAIChatMessage.findMany({
    where: {
      ownerId,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

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
  owner: ChatOwnerInput;
  role: PersistedChatMessage["role"];
  toolCalls?: ToolCallSummary[];
}) {
  const owner = await upsertChatOwner(input.owner);

  const message = await prisma.openAIChatMessage.create({
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

  return serializeChatMessage(message);
}

export async function deletePersistedChatMessages(ownerEmail: string) {
  const ownerId = await findChatOwnerId(ownerEmail);

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

import {
  IntegrationActionStatus,
  type IntegrationActionDraft,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

import { executeCalendarActionDraft } from "./calendar";
import { executeEmailActionDraft } from "./gmail";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "The Google action failed.";
}

type SerializedAffectedEmail = {
  body: string;
  lastMessageAt: string | null;
  sender: string | null;
  snippet: string;
  subject: string;
  threadId: string;
};

function serializeAffectedEmails(
  draft: IntegrationActionDraft,
): SerializedAffectedEmail[] | undefined {
  if (draft.provider !== "GMAIL") {
    return undefined;
  }

  const beforeState = draft.beforeState as
    | {
        threads?: Array<{
          body?: unknown;
          id?: unknown;
          lastMessageAt?: unknown;
          sender?: unknown;
          snippet?: unknown;
          subject?: unknown;
        }>;
      }
    | null;

  const threads = Array.isArray(beforeState?.threads) ? beforeState.threads : [];
  const affectedEmails = threads.flatMap((thread) => {
    if (typeof thread.id !== "string" || !thread.id.trim()) {
      return [];
    }

    return [
      {
        body: typeof thread.body === "string" ? thread.body : "",
        lastMessageAt:
          typeof thread.lastMessageAt === "string" ? thread.lastMessageAt : null,
        sender: typeof thread.sender === "string" ? thread.sender : null,
        snippet: typeof thread.snippet === "string" ? thread.snippet : "",
        subject: typeof thread.subject === "string" ? thread.subject : "Untitled email",
        threadId: thread.id,
      },
    ];
  });

  return affectedEmails.length ? affectedEmails : undefined;
}

function serializeDraft(draft: IntegrationActionDraft) {
  const payload = draft.payload as {
    threadId?: string;
    threadIds?: string[];
  };
  const affectedCount =
    draft.provider === "GMAIL"
      ? Array.from(
          new Set(
            [
              ...(Array.isArray(payload.threadIds) ? payload.threadIds : []),
              payload.threadId,
            ].filter((threadId): threadId is string => Boolean(threadId)),
          ),
        ).length || 1
      : 1;

  return {
    affectedCount,
    affectedEmails: serializeAffectedEmails(draft),
    afterState: draft.afterState,
    beforeState: draft.beforeState,
    createdAt: draft.createdAt.toISOString(),
    executedAt: draft.executedAt?.toISOString() ?? null,
    failureReason: draft.failureReason,
    id: draft.id,
    kind: draft.kind,
    provider: draft.provider,
    status: draft.status,
    summary: draft.summary,
    targetId: draft.targetId,
    title: draft.title,
    updatedAt: draft.updatedAt.toISOString(),
  };
}

async function expireStaleDrafts(ownerEmail: string) {
  await prisma.integrationActionDraft.updateMany({
    where: {
      ownerEmail,
      status: IntegrationActionStatus.PENDING,
      expiresAt: {
        lt: new Date(),
      },
    },
    data: {
      status: IntegrationActionStatus.EXPIRED,
    },
  });
}

async function findOwnedDraft(ownerEmail: string, draftId: string) {
  return prisma.integrationActionDraft.findFirst({
    where: {
      id: draftId,
      ownerEmail,
    },
  });
}

export async function listPendingActionDrafts(ownerEmail: string) {
  await expireStaleDrafts(ownerEmail);

  const drafts = await prisma.integrationActionDraft.findMany({
    where: {
      ownerEmail,
      status: IntegrationActionStatus.PENDING,
    },
    orderBy: {
      createdAt: "desc",
    },
    take: 20,
  });

  return drafts.map(serializeDraft);
}

export async function rejectActionDraft(ownerEmail: string, draftId: string) {
  const draft = await findOwnedDraft(ownerEmail, draftId);

  if (!draft || draft.status !== IntegrationActionStatus.PENDING) {
    throw new Error("This draft is no longer available for rejection.");
  }

  if (draft.expiresAt.getTime() < Date.now()) {
    await prisma.integrationActionDraft.update({
      where: {
        id: draft.id,
      },
      data: {
        status: IntegrationActionStatus.EXPIRED,
      },
    });

    throw new Error("This draft has expired and can no longer be approved.");
  }

  const rejectedDraft = await prisma.integrationActionDraft.update({
    where: {
      id: draft.id,
    },
    data: {
      status: IntegrationActionStatus.REJECTED,
    },
  });

  return serializeDraft(rejectedDraft);
}

export async function approveActionDraft(input: {
  accessToken: string;
  draftId: string;
  ownerEmail: string;
}) {
  const draft = await findOwnedDraft(input.ownerEmail, input.draftId);

  if (!draft || draft.status !== IntegrationActionStatus.PENDING) {
    throw new Error("This draft is no longer available for approval.");
  }

  if (draft.expiresAt.getTime() < Date.now()) {
    await prisma.integrationActionDraft.update({
      where: {
        id: draft.id,
      },
      data: {
        status: IntegrationActionStatus.EXPIRED,
      },
    });

    throw new Error("This draft has expired and can no longer be approved.");
  }

  await prisma.integrationActionDraft.update({
    where: {
      id: draft.id,
    },
    data: {
      approvedAt: new Date(),
      status: IntegrationActionStatus.APPROVED,
    },
  });

  try {
    const executedDraft =
      draft.provider === "GMAIL"
        ? await executeEmailActionDraft(input.accessToken, draft)
        : await executeCalendarActionDraft(input.accessToken, draft);

    return serializeDraft(executedDraft);
  } catch (error) {
    await prisma.integrationActionDraft.update({
      where: {
        id: draft.id,
      },
      data: {
        failureReason: getErrorMessage(error),
        status: IntegrationActionStatus.FAILED,
      },
    });

    throw error;
  }
}

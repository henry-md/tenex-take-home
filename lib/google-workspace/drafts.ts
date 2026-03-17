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

function serializeDraft(draft: IntegrationActionDraft) {
  return {
    afterState: draft.afterState,
    beforeState: draft.beforeState,
    createdAt: draft.createdAt.toISOString(),
    executedAt: draft.executedAt?.toISOString() ?? null,
    expiresAt: draft.expiresAt.toISOString(),
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

import {
  IntegrationActionKind,
  IntegrationActionStatus,
  IntegrationProvider,
  type IntegrationActionDraft,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

import { googleApiRequest } from "./google-api";

type GmailHeader = {
  name?: string;
  value?: string;
};

type GmailMessage = {
  id: string;
  internalDate?: string;
  labelIds?: string[];
  payload?: {
    headers?: GmailHeader[];
  };
};

type GmailThreadResponse = {
  id: string;
  snippet?: string;
  messages?: GmailMessage[];
};

type GmailLabel = {
  id: string;
  name: string;
  type: string;
};

type PrepareEmailActionInput = {
  action:
    | "APPLY_LABEL"
    | "ARCHIVE"
    | "MARK_SPAM"
    | "REMOVE_LABEL"
    | "STAR"
    | "TRASH"
    | "UNSTAR";
  labelName?: string;
  rationale?: string;
  threadId: string;
};

type EmailActionPayload = {
  action: PrepareEmailActionInput["action"];
  labelId?: string;
  labelName?: string;
  threadId: string;
};

export type EmailThreadSummary = {
  id: string;
  labelIds: string[];
  lastMessageAt: string | null;
  sender: string | null;
  snippet: string;
  subject: string;
};

function getHeaderValue(headers: GmailHeader[] | undefined, name: string) {
  return (
    headers?.find((header) => header.name?.toLowerCase() === name.toLowerCase())
      ?.value ?? null
  );
}

function summarizeThread(thread: GmailThreadResponse): EmailThreadSummary {
  const firstMessage = thread.messages?.[0];
  const labelIds = Array.from(
    new Set(thread.messages?.flatMap((message) => message.labelIds ?? []) ?? []),
  ).sort();
  const mostRecentInternalDate = thread.messages?.reduce<number | null>(
    (latest, message) => {
      const nextValue = message.internalDate ? Number(message.internalDate) : null;

      if (!nextValue) {
        return latest;
      }

      return latest === null ? nextValue : Math.max(latest, nextValue);
    },
    null,
  );

  return {
    id: thread.id,
    labelIds,
    lastMessageAt: mostRecentInternalDate
      ? new Date(mostRecentInternalDate).toISOString()
      : null,
    sender: getHeaderValue(firstMessage?.payload?.headers, "from"),
    snippet: thread.snippet ?? "",
    subject: getHeaderValue(firstMessage?.payload?.headers, "subject") ?? "(No subject)",
  };
}

function mapActionToKind(
  action: PrepareEmailActionInput["action"],
): IntegrationActionKind {
  switch (action) {
    case "ARCHIVE":
      return IntegrationActionKind.EMAIL_ARCHIVE;
    case "MARK_SPAM":
      return IntegrationActionKind.EMAIL_MARK_SPAM;
    case "STAR":
      return IntegrationActionKind.EMAIL_STAR;
    case "UNSTAR":
      return IntegrationActionKind.EMAIL_UNSTAR;
    case "TRASH":
      return IntegrationActionKind.EMAIL_TRASH;
    case "APPLY_LABEL":
      return IntegrationActionKind.EMAIL_APPLY_LABEL;
    case "REMOVE_LABEL":
      return IntegrationActionKind.EMAIL_REMOVE_LABEL;
  }
}

function predictLabelIds(
  currentLabelIds: string[],
  action: PrepareEmailActionInput["action"],
  labelId?: string,
) {
  const nextLabels = new Set(currentLabelIds);

  if (action === "ARCHIVE") {
    nextLabels.delete("INBOX");
  }

  if (action === "MARK_SPAM") {
    nextLabels.add("SPAM");
    nextLabels.delete("INBOX");
  }

  if (action === "STAR") {
    nextLabels.add("STARRED");
  }

  if (action === "UNSTAR") {
    nextLabels.delete("STARRED");
  }

  if (action === "TRASH") {
    nextLabels.add("TRASH");
    nextLabels.delete("INBOX");
  }

  if (action === "APPLY_LABEL" && labelId) {
    nextLabels.add(labelId);
  }

  if (action === "REMOVE_LABEL" && labelId) {
    nextLabels.delete(labelId);
  }

  return Array.from(nextLabels).sort();
}

function describeEmailAction(
  action: PrepareEmailActionInput["action"],
  thread: EmailThreadSummary,
  labelName?: string,
) {
  switch (action) {
    case "ARCHIVE":
      return `Archive "${thread.subject}".`;
    case "MARK_SPAM":
      return `Move "${thread.subject}" to spam.`;
    case "STAR":
      return `Star "${thread.subject}".`;
    case "UNSTAR":
      return `Remove the star from "${thread.subject}".`;
    case "TRASH":
      return `Move "${thread.subject}" to trash.`;
    case "APPLY_LABEL":
      return `Apply the "${labelName}" label to "${thread.subject}".`;
    case "REMOVE_LABEL":
      return `Remove the "${labelName}" label from "${thread.subject}".`;
  }
}

async function getGmailThread(
  accessToken: string,
  threadId: string,
): Promise<GmailThreadResponse> {
  return googleApiRequest<GmailThreadResponse>(
    accessToken,
    `/gmail/v1/users/me/threads/${threadId}`,
    {
      query: {
        format: "metadata",
      },
    },
  );
}

async function getLabelByName(accessToken: string, labelName: string) {
  const response = await googleApiRequest<{ labels?: GmailLabel[] }>(
    accessToken,
    "/gmail/v1/users/me/labels",
  );

  return (
    response.labels?.find(
      (label) => label.name.toLowerCase() === labelName.toLowerCase(),
    ) ?? null
  );
}

async function modifyThreadLabels(
  accessToken: string,
  threadId: string,
  body: {
    addLabelIds?: string[];
    removeLabelIds?: string[];
  },
) {
  return googleApiRequest<GmailThreadResponse>(
    accessToken,
    `/gmail/v1/users/me/threads/${threadId}/modify`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
}

export async function searchEmailThreads(
  accessToken: string,
  input: {
    maxResults?: number;
    query?: string;
  },
) {
  const maxResults = Math.min(Math.max(input.maxResults ?? 5, 1), 10);
  const response = await googleApiRequest<{ threads?: Array<{ id: string }> }>(
    accessToken,
    "/gmail/v1/users/me/threads",
    {
      query: {
        maxResults,
        q: input.query?.trim() || undefined,
      },
    },
  );
  const threadIds = response.threads?.map((thread) => thread.id) ?? [];
  const threads = await Promise.all(
    threadIds.map((threadId) => getEmailThread(accessToken, threadId)),
  );

  return {
    threads,
  };
}

export async function getEmailThread(accessToken: string, threadId: string) {
  const thread = await getGmailThread(accessToken, threadId);

  return summarizeThread(thread);
}

export async function listEmailLabels(accessToken: string) {
  const response = await googleApiRequest<{ labels?: GmailLabel[] }>(
    accessToken,
    "/gmail/v1/users/me/labels",
  );

  return {
    labels:
      response.labels?.map((label) => ({
        id: label.id,
        name: label.name,
        type: label.type,
      })) ?? [],
  };
}

export async function prepareEmailActionDraft(input: {
  accessToken: string;
  ownerEmail: string;
  request: PrepareEmailActionInput;
}) {
  const thread = await getEmailThread(input.accessToken, input.request.threadId);
  let resolvedLabel: GmailLabel | null = null;

  if (
    (input.request.action === "APPLY_LABEL" ||
      input.request.action === "REMOVE_LABEL") &&
    input.request.labelName
  ) {
    resolvedLabel = await getLabelByName(input.accessToken, input.request.labelName);
  }

  if (
    (input.request.action === "APPLY_LABEL" ||
      input.request.action === "REMOVE_LABEL") &&
    !resolvedLabel
  ) {
    throw new Error(`No Gmail label matched "${input.request.labelName}".`);
  }

  const draft = await prisma.integrationActionDraft.create({
    data: {
      ownerEmail: input.ownerEmail,
      provider: IntegrationProvider.GMAIL,
      kind: mapActionToKind(input.request.action),
      title: thread.subject,
      summary: describeEmailAction(
        input.request.action,
        thread,
        resolvedLabel?.name ?? input.request.labelName,
      ),
      targetId: thread.id,
      beforeState: {
        labelIds: thread.labelIds,
        lastMessageAt: thread.lastMessageAt,
        sender: thread.sender,
        snippet: thread.snippet,
        subject: thread.subject,
      },
      afterState: {
        labelIds: predictLabelIds(
          thread.labelIds,
          input.request.action,
          resolvedLabel?.id,
        ),
      },
      payload: {
        action: input.request.action,
        labelId: resolvedLabel?.id,
        labelName: resolvedLabel?.name,
        threadId: thread.id,
      },
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });

  return {
    draftId: draft.id,
    summary: draft.summary,
    status: draft.status,
  };
}

export async function executeEmailActionDraft(
  accessToken: string,
  draft: IntegrationActionDraft,
) {
  const payload = draft.payload as unknown as EmailActionPayload;

  if (payload.action === "TRASH") {
    await googleApiRequest<void>(
      accessToken,
      `/gmail/v1/users/me/threads/${payload.threadId}/trash`,
      {
        method: "POST",
      },
    );
  } else if (payload.action === "ARCHIVE") {
    await modifyThreadLabels(accessToken, payload.threadId, {
      removeLabelIds: ["INBOX"],
    });
  } else if (payload.action === "MARK_SPAM") {
    await modifyThreadLabels(accessToken, payload.threadId, {
      addLabelIds: ["SPAM"],
      removeLabelIds: ["INBOX"],
    });
  } else if (payload.action === "STAR") {
    await modifyThreadLabels(accessToken, payload.threadId, {
      addLabelIds: ["STARRED"],
    });
  } else if (payload.action === "UNSTAR") {
    await modifyThreadLabels(accessToken, payload.threadId, {
      removeLabelIds: ["STARRED"],
    });
  } else if (payload.action === "APPLY_LABEL" && payload.labelId) {
    await modifyThreadLabels(accessToken, payload.threadId, {
      addLabelIds: [payload.labelId],
    });
  } else if (payload.action === "REMOVE_LABEL" && payload.labelId) {
    await modifyThreadLabels(accessToken, payload.threadId, {
      removeLabelIds: [payload.labelId],
    });
  } else {
    throw new Error("The email draft payload is incomplete.");
  }

  const refreshedThread = await getEmailThread(accessToken, payload.threadId);

  return prisma.integrationActionDraft.update({
    where: {
      id: draft.id,
    },
    data: {
      status: IntegrationActionStatus.EXECUTED,
      approvedAt: new Date(),
      executedAt: new Date(),
      executionResult: refreshedThread,
      failureReason: null,
    },
  });
}

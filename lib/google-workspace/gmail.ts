import {
  IntegrationActionKind,
  IntegrationActionStatus,
  IntegrationProvider,
  type IntegrationActionDraft,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

import { getWorkspaceApprovalMode, requiresApproval } from "./approval-mode";
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
    body?: {
      data?: string;
    };
    mimeType?: string;
    parts?: GmailMessagePart[];
  };
};

type GmailMessagePart = {
  body?: {
    data?: string;
  };
  mimeType?: string;
  parts?: GmailMessagePart[];
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
  forceManualApproval?: boolean;
  threadId?: string;
  threadIds?: string[];
};

type EmailActionPayload = {
  action: PrepareEmailActionInput["action"];
  labelId?: string;
  labelName?: string;
  threadId?: string;
  threadIds?: string[];
};

type EmailDraftRecordInput = {
  action: PrepareEmailActionInput["action"];
  labelId?: string;
  labelName?: string;
  ownerEmail: string;
  requiresManualApproval: boolean;
  threads: EmailThreadSummary[];
};

export type EmailThreadSummary = {
  body: string;
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

function decodeBase64Url(value: string) {
  return Buffer.from(
    value.replaceAll("-", "+").replaceAll("_", "/"),
    "base64",
  ).toString("utf8");
}

function decodeHtmlEntities(value: string) {
  return value
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

function stripHtml(value: string) {
  return decodeHtmlEntities(
    value
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|section|article|tr|table)>/gi, "\n")
      .replace(/<li[^>]*>/gi, "- ")
      .replace(/<\/li>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  );
}

function normalizeEmailText(value: string) {
  return value
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeMessagePartBody(part: { body?: { data?: string } }) {
  const encodedBody = part.body?.data;

  if (!encodedBody) {
    return "";
  }

  try {
    return normalizeEmailText(decodeBase64Url(encodedBody));
  } catch {
    return "";
  }
}

function extractPayloadBodies(
  payload?: GmailMessage["payload"] | GmailMessagePart,
): {
  htmlBodies: string[];
  plainBodies: string[];
} {
  if (!payload) {
    return {
      htmlBodies: [],
      plainBodies: [],
    };
  }

  const nestedBodies = (payload.parts ?? []).reduce<{
    htmlBodies: string[];
    plainBodies: string[];
  }>(
    (collected, part) => {
      const nextBodies = extractPayloadBodies(part);

      collected.htmlBodies.push(...nextBodies.htmlBodies);
      collected.plainBodies.push(...nextBodies.plainBodies);

      return collected;
    },
    {
      htmlBodies: [],
      plainBodies: [],
    },
  );
  const body = decodeMessagePartBody(payload);

  if (!body) {
    return nestedBodies;
  }

  if (payload.mimeType === "text/plain") {
    nestedBodies.plainBodies.unshift(body);
    return nestedBodies;
  }

  if (payload.mimeType === "text/html") {
    nestedBodies.htmlBodies.unshift(body);
    return nestedBodies;
  }

  if (!payload.parts?.length) {
    nestedBodies.plainBodies.unshift(body);
  }

  return nestedBodies;
}

function getMessageBody(payload?: GmailMessage["payload"]) {
  const { htmlBodies, plainBodies } = extractPayloadBodies(payload);
  const plainText = plainBodies.find((body) => body.length);

  if (plainText) {
    return plainText;
  }

  const htmlText = htmlBodies.find((body) => body.length);

  return htmlText ? normalizeEmailText(stripHtml(htmlText)) : "";
}

function getMostRecentMessage(messages: GmailMessage[] | undefined) {
  return messages?.reduce<GmailMessage | null>((latest, message) => {
    const nextValue = message.internalDate ? Number(message.internalDate) : 0;

    if (!nextValue) {
      return latest ?? message;
    }

    if (!latest) {
      return message;
    }

    const latestValue = latest.internalDate ? Number(latest.internalDate) : 0;

    return nextValue >= latestValue ? message : latest;
  }, null);
}

function summarizeThread(thread: GmailThreadResponse): EmailThreadSummary {
  const primaryMessage = getMostRecentMessage(thread.messages) ?? thread.messages?.[0];
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
  const body = getMessageBody(primaryMessage?.payload);
  const normalizedSnippet = normalizeEmailText(thread.snippet ?? "");

  return {
    body,
    id: thread.id,
    labelIds,
    lastMessageAt: mostRecentInternalDate
      ? new Date(mostRecentInternalDate).toISOString()
      : null,
    sender: getHeaderValue(primaryMessage?.payload?.headers, "from"),
    snippet:
      normalizedSnippet || body.split("\n").join(" ").slice(0, 220).trim(),
    subject:
      getHeaderValue(primaryMessage?.payload?.headers, "subject") ?? "(No subject)",
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
  threads: EmailThreadSummary[],
  labelName?: string,
) {
  if (threads.length !== 1) {
    switch (action) {
      case "ARCHIVE":
        return `Archive ${threads.length} emails.`;
      case "MARK_SPAM":
        return `Move ${threads.length} emails to spam.`;
      case "STAR":
        return `Star ${threads.length} emails.`;
      case "UNSTAR":
        return `Remove the star from ${threads.length} emails.`;
      case "TRASH":
        return `Move ${threads.length} emails to trash.`;
      case "APPLY_LABEL":
        return `Apply the "${labelName}" label to ${threads.length} emails.`;
      case "REMOVE_LABEL":
        return `Remove the "${labelName}" label from ${threads.length} emails.`;
    }
  }

  const [thread] = threads;

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
        format: "full",
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

function normalizeThreadIds(input: PrepareEmailActionInput) {
  const threadIds = Array.from(
    new Set(
      [
        ...(Array.isArray(input.threadIds) ? input.threadIds : []),
        input.threadId,
      ].filter((threadId): threadId is string => Boolean(threadId?.trim())),
    ),
  );

  if (!threadIds.length) {
    throw new Error("At least one Gmail thread id is required.");
  }

  return threadIds;
}

function getPayloadThreadIds(payload: EmailActionPayload) {
  const threadIds = Array.from(
    new Set(
      [
        ...(Array.isArray(payload.threadIds) ? payload.threadIds : []),
        payload.threadId,
      ].filter((threadId): threadId is string => Boolean(threadId?.trim())),
    ),
  );

  if (!threadIds.length) {
    throw new Error("The email draft payload is incomplete.");
  }

  return threadIds;
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
  const threadIds = normalizeThreadIds(input.request);
  const threads = await Promise.all(
    threadIds.map((threadId) => getEmailThread(input.accessToken, threadId)),
  );
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

  const approvalMode = await getWorkspaceApprovalMode(input.ownerEmail);
  const affectedEmailCount = input.request.forceManualApproval
    ? Math.max(threads.length, 2)
    : threads.length;
  const requiresManualApproval = requiresApproval({
    affectedEmailCount,
    mode: approvalMode,
    provider: "GMAIL",
  });

  const draft = await createEmailActionDraftRecord({
    action: input.request.action,
    labelId: resolvedLabel?.id,
    labelName: resolvedLabel?.name ?? input.request.labelName,
    ownerEmail: input.ownerEmail,
    requiresManualApproval,
    threads,
  });

  if (requiresManualApproval) {
    return {
      draftId: draft.id,
      requiresApproval: true,
      status: draft.status,
      summary: draft.summary,
    };
  }

  const executedDraft = await executeEmailActionDraft(input.accessToken, draft);

  return {
    draftId: executedDraft.id,
    requiresApproval: false,
    status: executedDraft.status,
    summary: executedDraft.summary,
  };
}

async function createEmailActionDraftRecord(input: EmailDraftRecordInput) {
  const [primaryThread] = input.threads;

  const draft = await prisma.integrationActionDraft.create({
    data: {
      ownerEmail: input.ownerEmail,
      provider: IntegrationProvider.GMAIL,
      kind: mapActionToKind(input.action),
      status: input.requiresManualApproval
        ? IntegrationActionStatus.PENDING
        : IntegrationActionStatus.APPROVED,
      title:
        input.threads.length === 1
          ? primaryThread.subject
          : `${input.threads.length} emails`,
      summary: describeEmailAction(
        input.action,
        input.threads,
        input.labelName,
      ),
      targetId: input.threads.length === 1 ? primaryThread.id : null,
      beforeState: {
        affectedEmailCount: input.threads.length,
        threads: input.threads.map((thread) => ({
          id: thread.id,
          labelIds: thread.labelIds,
          lastMessageAt: thread.lastMessageAt,
          body: thread.body,
          sender: thread.sender,
          snippet: thread.snippet,
          subject: thread.subject,
        })),
      },
      afterState: {
        affectedEmailCount: input.threads.length,
        threads: input.threads.map((thread) => ({
          id: thread.id,
          labelIds: predictLabelIds(
            thread.labelIds,
            input.action,
            input.labelId,
          ),
          subject: thread.subject,
        })),
      },
      payload: {
        action: input.action,
        labelId: input.labelId,
        labelName: input.labelName,
        threadIds: input.threads.map((thread) => thread.id),
      },
      approvedAt: input.requiresManualApproval ? undefined : new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });

  return draft;
}

export async function executeEmailActionDraft(
  accessToken: string,
  draft: IntegrationActionDraft,
) {
  const payload = draft.payload as unknown as EmailActionPayload;
  const threadIds = getPayloadThreadIds(payload);

  await Promise.all(
    threadIds.map(async (threadId) => {
      if (payload.action === "TRASH") {
        await googleApiRequest<void>(
          accessToken,
          `/gmail/v1/users/me/threads/${threadId}/trash`,
          {
            method: "POST",
          },
        );
      } else if (payload.action === "ARCHIVE") {
        await modifyThreadLabels(accessToken, threadId, {
          removeLabelIds: ["INBOX"],
        });
      } else if (payload.action === "MARK_SPAM") {
        await modifyThreadLabels(accessToken, threadId, {
          addLabelIds: ["SPAM"],
          removeLabelIds: ["INBOX"],
        });
      } else if (payload.action === "STAR") {
        await modifyThreadLabels(accessToken, threadId, {
          addLabelIds: ["STARRED"],
        });
      } else if (payload.action === "UNSTAR") {
        await modifyThreadLabels(accessToken, threadId, {
          removeLabelIds: ["STARRED"],
        });
      } else if (payload.action === "APPLY_LABEL" && payload.labelId) {
        await modifyThreadLabels(accessToken, threadId, {
          addLabelIds: [payload.labelId],
        });
      } else if (payload.action === "REMOVE_LABEL" && payload.labelId) {
        await modifyThreadLabels(accessToken, threadId, {
          removeLabelIds: [payload.labelId],
        });
      } else {
        throw new Error("The email draft payload is incomplete.");
      }
    }),
  );

  const refreshedThreads = await Promise.all(
    threadIds.map((threadId) => getEmailThread(accessToken, threadId)),
  );

  return prisma.integrationActionDraft.update({
    where: {
      id: draft.id,
    },
    data: {
      status: IntegrationActionStatus.EXECUTED,
      approvedAt: new Date(),
      executedAt: new Date(),
      executionResult: {
        affectedEmailCount: refreshedThreads.length,
        threads: refreshedThreads,
      },
      failureReason: null,
    },
  });
}

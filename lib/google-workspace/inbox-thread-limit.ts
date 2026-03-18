import { prisma } from "@/lib/prisma";

export const MIN_INBOX_THREAD_LIMIT = 1;
export const MAX_INBOX_THREAD_LIMIT = 500;
const FALLBACK_INBOX_THREAD_LIMIT = 200;

function parseInboxThreadLimit(value: string | undefined) {
  if (!value) {
    return FALLBACK_INBOX_THREAD_LIMIT;
  }

  const parsedValue = Number.parseInt(value, 10);

  if (Number.isNaN(parsedValue)) {
    return FALLBACK_INBOX_THREAD_LIMIT;
  }

  return parsedValue;
}

export function clampInboxThreadLimit(value: number) {
  return Math.min(
    Math.max(Math.trunc(value), MIN_INBOX_THREAD_LIMIT),
    MAX_INBOX_THREAD_LIMIT,
  );
}

export function getDefaultInboxThreadLimit() {
  return clampInboxThreadLimit(
    parseInboxThreadLimit(process.env.DEFAULT_INBOX_THREAD_LIMIT),
  );
}

export async function getWorkspaceInboxThreadLimit(ownerEmail: string) {
  const preference = await prisma.workspaceApprovalPreference.findUnique({
    where: {
      ownerEmail,
    },
    select: {
      inboxThreadLimit: true,
    },
  });

  return preference?.inboxThreadLimit ?? getDefaultInboxThreadLimit();
}

export async function setWorkspaceInboxThreadLimit(
  ownerEmail: string,
  inboxThreadLimit: number,
) {
  const normalizedInboxThreadLimit = clampInboxThreadLimit(inboxThreadLimit);
  const preference = await prisma.workspaceApprovalPreference.upsert({
    where: {
      ownerEmail,
    },
    create: {
      ownerEmail,
      inboxThreadLimit: normalizedInboxThreadLimit,
    },
    update: {
      inboxThreadLimit: normalizedInboxThreadLimit,
    },
    select: {
      inboxThreadLimit: true,
    },
  });

  return preference.inboxThreadLimit ?? getDefaultInboxThreadLimit();
}

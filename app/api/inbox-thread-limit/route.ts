import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/auth";
import {
  MAX_INBOX_THREAD_LIMIT,
  getWorkspaceInboxThreadLimit,
  setWorkspaceInboxThreadLimit,
} from "@/lib/google-workspace/inbox-thread-limit";

export async function GET() {
  const session = await getServerSession(authOptions);
  const ownerEmail = session?.user?.email;

  if (!ownerEmail) {
    return NextResponse.json(
      {
        error: "Authentication required.",
      },
      { status: 401 },
    );
  }

  const inboxThreadLimit = await getWorkspaceInboxThreadLimit(ownerEmail);

  return NextResponse.json({
    inboxThreadLimit,
  });
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  const ownerEmail = session?.user?.email;

  if (!ownerEmail) {
    return NextResponse.json(
      {
        error: "Authentication required.",
      },
      { status: 401 },
    );
  }

  const body = (await request.json().catch(() => null)) as
    | {
        inboxThreadLimit?: number;
      }
    | null;

  if (
    typeof body?.inboxThreadLimit !== "number" ||
    !Number.isInteger(body.inboxThreadLimit) ||
    body.inboxThreadLimit < 1
  ) {
    return NextResponse.json(
      {
        error: "A whole-number inbox thread limit is required.",
      },
      { status: 400 },
    );
  }

  if (body.inboxThreadLimit > MAX_INBOX_THREAD_LIMIT) {
    return NextResponse.json(
      {
        error: `Inbox thread limit must be ${MAX_INBOX_THREAD_LIMIT} or less.`,
      },
      { status: 400 },
    );
  }

  const inboxThreadLimit = await setWorkspaceInboxThreadLimit(
    ownerEmail,
    body.inboxThreadLimit,
  );

  return NextResponse.json({
    inboxThreadLimit,
  });
}

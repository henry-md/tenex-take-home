import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/auth";
import { WorkspaceApprovalMode } from "@/generated/prisma/client";
import {
  getWorkspaceApprovalMode,
  serializeWorkspaceApprovalMode,
  setWorkspaceApprovalMode,
} from "@/lib/google-workspace/approval-mode";

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

  const mode = await getWorkspaceApprovalMode(ownerEmail);

  return NextResponse.json({
    approvalMode: serializeWorkspaceApprovalMode(mode),
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
        mode?: string;
      }
    | null;

  if (
    body?.mode !== WorkspaceApprovalMode.SAFE &&
    body?.mode !== WorkspaceApprovalMode.BULK_EMAIL_ONLY &&
    body?.mode !== WorkspaceApprovalMode.DANGEROUS
  ) {
    return NextResponse.json(
      {
        error: "A valid approval mode is required.",
      },
      { status: 400 },
    );
  }

  const approvalMode = await setWorkspaceApprovalMode(ownerEmail, body.mode);

  return NextResponse.json({
    approvalMode,
  });
}

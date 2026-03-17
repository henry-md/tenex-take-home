import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/auth";
import { listPendingActionDrafts } from "@/lib/google-workspace/drafts";

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

  try {
    const drafts = await listPendingActionDrafts(ownerEmail);

    return NextResponse.json({
      drafts,
    });
  } catch (error) {
    console.error("Listing action drafts failed", error);

    return NextResponse.json(
      {
        error: "Unable to load pending approvals.",
      },
      { status: 500 },
    );
  }
}

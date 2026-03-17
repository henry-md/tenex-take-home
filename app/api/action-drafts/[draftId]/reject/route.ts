import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/auth";
import { rejectActionDraft } from "@/lib/google-workspace/drafts";

type RouteContext = {
  params: Promise<{
    draftId: string;
  }>;
};

export async function POST(_request: Request, context: RouteContext) {
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
    const { draftId } = await context.params;
    const draft = await rejectActionDraft(ownerEmail, draftId);

    return NextResponse.json({
      draft,
    });
  } catch (error) {
    console.error("Rejecting action draft failed", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to reject this draft.",
      },
      { status: 400 },
    );
  }
}

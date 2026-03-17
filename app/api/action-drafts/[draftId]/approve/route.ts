import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/auth";
import { approveActionDraft } from "@/lib/google-workspace/drafts";

type RouteContext = {
  params: Promise<{
    draftId: string;
  }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const session = await getServerSession(authOptions);
  const ownerEmail = session?.user?.email;

  if (!ownerEmail || !session.accessToken || session.authError) {
    return NextResponse.json(
      {
        error: "An active Google session is required.",
      },
      { status: 401 },
    );
  }

  try {
    const { draftId } = await context.params;
    const draft = await approveActionDraft({
      accessToken: session.accessToken,
      draftId,
      ownerEmail,
    });

    return NextResponse.json({
      draft,
    });
  } catch (error) {
    console.error("Approving action draft failed", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to approve this draft.",
      },
      { status: 400 },
    );
  }
}

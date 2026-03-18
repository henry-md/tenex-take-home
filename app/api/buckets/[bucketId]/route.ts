import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/auth";
import { updateBucketPrompt } from "@/lib/inbox/classification";

export async function PATCH(
  request: Request,
  context: {
    params: Promise<{
      bucketId: string;
    }>;
  },
) {
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
    const body = (await request.json()) as {
      prompt?: string;
    };
    const { bucketId } = await context.params;

    if (typeof body.prompt !== "string") {
      return NextResponse.json(
        {
          error: "Bucket prompt is required.",
        },
        { status: 400 },
      );
    }

    const buckets = await updateBucketPrompt({
      bucketId,
      ownerEmail,
      prompt: body.prompt,
    });

    return NextResponse.json({ buckets });
  } catch (error) {
    console.error("Updating bucket prompt failed", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to update bucket prompt.",
      },
      { status: 500 },
    );
  }
}

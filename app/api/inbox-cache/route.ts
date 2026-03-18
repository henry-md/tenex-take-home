import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/auth";
import { clearInboxClassificationCache } from "@/lib/inbox/classification";

export async function DELETE() {
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
    const deletedCount = await clearInboxClassificationCache(ownerEmail);

    return NextResponse.json({
      deletedCount,
      ok: true,
    });
  } catch (error) {
    console.error("Clearing inbox classification cache failed", error);

    return NextResponse.json(
      {
        error: "Unable to clear inbox classification cache.",
      },
      { status: 500 },
    );
  }
}

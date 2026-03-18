import { NextResponse } from "next/server";
import { getServerSession, type Session } from "next-auth";

import { authOptions } from "@/auth";
import { getInboxRefreshStatus } from "@/lib/inbox/classification";

function getInboxOwner(session: Session | null) {
  const ownerEmail = session?.user?.email;

  if (!ownerEmail) {
    return null;
  }

  return {
    email: ownerEmail,
    image: session.user?.image,
    name: session.user?.name,
  };
}

export async function GET() {
  const session = await getServerSession(authOptions);
  const owner = getInboxOwner(session);

  if (!session || !owner || !session.accessToken || session.authError) {
    return NextResponse.json(
      {
        error: "Sign in with Google again to check inbox updates.",
      },
      { status: 401 },
    );
  }

  try {
    const status = await getInboxRefreshStatus({
      accessToken: session.accessToken,
      ownerEmail: owner.email,
      ownerImage: owner.image,
      ownerName: owner.name,
    });

    return NextResponse.json(status, {
      headers: {
        "Cache-Control": "no-cache, no-transform",
      },
    });
  } catch (error) {
    console.error("Loading inbox refresh status failed", {
      error,
      ownerEmail: owner.email,
    });

    return NextResponse.json(
      {
        error: "Unable to check for inbox updates.",
      },
      { status: 500 },
    );
  }
}

import { NextResponse } from "next/server";
import { getServerSession, type Session } from "next-auth";
import OpenAI from "openai";

import { authOptions } from "@/auth";
import {
  runGoogleWorkspaceAssistant,
  type ChatMessage,
} from "@/lib/assistant/google-workspace-agent";
import {
  createPersistedChatMessage,
  deletePersistedChatMessages,
  listAssistantChatMessages,
  listPersistedChatMessages,
} from "@/lib/chat/messages";

const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_MODEL;

const client = apiKey ? new OpenAI({ apiKey }) : null;

function getChatOwner(session: Session | null) {
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
  const owner = getChatOwner(session);

  if (!owner) {
    return NextResponse.json(
      {
        error: "Authentication required.",
      },
      { status: 401 },
    );
  }

  try {
    const messages = await listPersistedChatMessages(owner.email);

    return NextResponse.json(
      { messages },
      {
        headers: {
          "Cache-Control": "no-cache, no-transform",
        },
      },
    );
  } catch (error) {
    console.error("Loading persisted chat failed", error);

    return NextResponse.json(
      {
        error: "Unable to load chat history.",
      },
      { status: 500 },
    );
  }
}

export async function DELETE() {
  const session = await getServerSession(authOptions);
  const owner = getChatOwner(session);

  if (!owner) {
    return NextResponse.json(
      {
        error: "Authentication required.",
      },
      { status: 401 },
    );
  }

  try {
    await deletePersistedChatMessages(owner.email);

    return NextResponse.json(
      { ok: true },
      {
        headers: {
          "Cache-Control": "no-cache, no-transform",
        },
      },
    );
  } catch (error) {
    console.error("Deleting persisted chat failed", error);

    return NextResponse.json(
      {
        error: "Unable to delete chat history.",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  if (!client || !model) {
    return NextResponse.json(
      {
        error: "The assistant is temporarily unavailable.",
      },
      { status: 500 },
    );
  }

  try {
    const session = await getServerSession(authOptions);
    const owner = getChatOwner(session);

    if (!session || !owner || !session.accessToken || session.authError) {
      return NextResponse.json(
        {
          error: "Sign in with Google again to use the assistant.",
        },
        { status: 401 },
      );
    }

    const body = (await request.json()) as {
      message?: string;
      messages?: ChatMessage[];
    };
    const message =
      typeof body.message === "string"
        ? body.message
        : [...(body.messages ?? [])]
            .reverse()
            .find(
              (candidate) =>
                candidate.role === "user" && candidate.content.trim(),
            )?.content;
    const trimmedMessage = message?.trim();

    if (!trimmedMessage) {
      return NextResponse.json(
        { error: "At least one message is required." },
        { status: 400 },
      );
    }

    await createPersistedChatMessage({
      content: trimmedMessage,
      owner,
      role: "user",
    });

    const messages = await listAssistantChatMessages(owner.email);

    const assistantResponse = await runGoogleWorkspaceAssistant({
      accessToken: session.accessToken,
      client,
      messages,
      model,
      ownerEmail: owner.email,
    });

    const assistantMessage = await createPersistedChatMessage({
      content: assistantResponse.content,
      owner,
      role: "assistant",
      toolCalls: assistantResponse.toolCalls,
    });

    return NextResponse.json(
      {
        assistantMessage,
        content: assistantResponse.content,
        toolCalls: assistantResponse.toolCalls,
      },
      {
        headers: {
          "Cache-Control": "no-cache, no-transform",
        },
      },
    );
  } catch (error) {
    console.error("OpenAI chat request failed", error);

    return NextResponse.json(
      { error: "The OpenAI request failed." },
      { status: 500 },
    );
  }
}

import OpenAI from "openai";
import type {
  FunctionTool,
  Response,
  ResponseCreateParamsNonStreaming,
  ResponseFunctionToolCall,
  ToolChoiceFunction,
} from "openai/resources/responses/responses";

import { getCalendarEvent, prepareCalendarActionDraft, searchCalendarEvents } from "@/lib/google-workspace/calendar";
import { listPendingActionDrafts } from "@/lib/google-workspace/drafts";
import {
  getEmailThread,
  listEmailLabels,
  prepareEmailActionDraft,
  searchEmailThreads,
} from "@/lib/google-workspace/gmail";
import { GoogleApiError } from "@/lib/google-workspace/google-api";
import { reserveOpenAICall } from "@/lib/openai/rate-limit";

export type ChatMessage = {
  content: string;
  role: "assistant" | "user";
};

export type EmailToolResult = {
  body: string;
  bodyHtml?: string;
  lastMessageAt: string | null;
  sender: string | null;
  snippet: string;
  subject: string;
  threadId: string;
};

export type EmailDisplayDirective = {
  maxCount?: number;
  show: boolean;
};

export type ToolCallSummary = {
  arguments: Record<string, unknown>;
  emailDisplay?: EmailDisplayDirective;
  emailResults?: EmailToolResult[];
  name: string;
  status: "error" | "ok";
};

export type AssistantRunResult = {
  content: string;
  emailDisplay?: EmailDisplayDirective;
  emailResults?: EmailToolResult[];
  toolCalls: ToolCallSummary[];
};

type AssistantContext = {
  accessToken: string;
  ownerEmail: string;
};

type ToolOutputInput = {
  call_id: string;
  output: string;
  type: "function_call_output";
};

const WORKSPACE_DATA_PATTERN =
  /\b(email|emails|gmail|inbox|thread|threads|message|messages|spam|star|archive|label|calendar|event|events|meeting|meetings|schedule|scheduled|availability)\b/i;

const DIRECT_ACCESS_PATTERN =
  /\b(can you see|show me|find|search|look up|what is|what's|most recent|recent|latest|last|first|next|upcoming)\b/i;

const LAST_EMAIL_PATTERN =
  /\b(last|latest|most recent|recent)\b.*\b(email|emails|gmail|message|messages|thread|threads)\b|\b(email|emails|gmail|message|messages|thread|threads)\b.*\b(last|latest|most recent|recent)\b/i;

const NEXT_EVENT_PATTERN =
  /\b(next|upcoming)\b.*\b(event|events|meeting|meetings|calendar)\b|\b(event|events|meeting|meetings|calendar)\b.*\b(next|upcoming)\b/i;

function getLastUserMessage(messages: ChatMessage[]) {
  return [...messages]
    .reverse()
    .find((message) => message.role === "user");
}

function getRequestedEmailCardCount(message: string) {
  const matchedCount = message.match(/\b(\d+)\b/);

  if (!matchedCount) {
    return undefined;
  }

  const parsedCount = Number.parseInt(matchedCount[1], 10);

  if (Number.isNaN(parsedCount)) {
    return undefined;
  }

  return Math.min(Math.max(parsedCount, 1), 10);
}

function inferEmailDisplayDirective(
  lastUserMessage: ChatMessage | undefined,
  executedToolCalls: ToolCallSummary[],
) {
  if (!lastUserMessage) {
    return undefined;
  }

  const hasEmailResults = executedToolCalls.some(
    (toolCall) => (toolCall.emailResults?.length ?? 0) > 0,
  );

  if (!hasEmailResults || !LAST_EMAIL_PATTERN.test(lastUserMessage.content)) {
    return undefined;
  }

  return {
    maxCount: getRequestedEmailCardCount(lastUserMessage.content),
    show: true,
  } satisfies EmailDisplayDirective;
}

function buildEmailCardIntro(
  lastUserMessage: ChatMessage | undefined,
  emailResults: EmailToolResult[],
) {
  const count = emailResults.length;
  const message = lastUserMessage?.content.toLowerCase() ?? "";

  if (count === 1) {
    if (/\b(latest|last|recent|most recent)\b/.test(message)) {
      return "Here is your most recent email.";
    }

    return "Here is the email you asked for.";
  }

  if (/\b(latest|last|recent|most recent)\b/.test(message)) {
    return `Here are your last ${count} emails.`;
  }

  return `Here are the ${count} emails you asked for.`;
}

function shouldKeepNativeEmailIntro(
  content: string,
  emailResults: EmailToolResult[],
) {
  const trimmedContent = content.trim();

  if (!trimmedContent) {
    return false;
  }

  if (trimmedContent.length > 140 || trimmedContent.includes("\n")) {
    return false;
  }

  const normalizedContent = trimmedContent.toLowerCase();

  if (/\b(from|date|subject):\b/.test(normalizedContent)) {
    return false;
  }

  return !emailResults.some(
    (email) =>
      normalizedContent.includes(email.subject.toLowerCase()) ||
      (email.sender
        ? normalizedContent.includes(email.sender.toLowerCase())
        : false),
  );
}

function normalizeAssistantContentForNativeEmailCards(input: {
  content: string;
  emailDisplay?: EmailDisplayDirective;
  emailResults?: EmailToolResult[];
  lastUserMessage?: ChatMessage;
}) {
  if (!input.emailDisplay?.show || !input.emailResults?.length) {
    return input.content || "I could not produce a response.";
  }

  if (shouldKeepNativeEmailIntro(input.content, input.emailResults)) {
    return input.content.trim();
  }

  return buildEmailCardIntro(input.lastUserMessage, input.emailResults);
}

function toResponseInputMessage(message: ChatMessage) {
  return {
    type: "message" as const,
    role: message.role,
    content: message.content,
  };
}

const GOOGLE_WORKSPACE_TOOLS: FunctionTool[] = [
  {
    type: "function",
    name: "search_email_threads",
    description:
      "Search recent Gmail threads and return compact thread summaries. Use this when the user asks for their latest, last, or most recent email and no thread id is known yet.",
    strict: false,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        maxResults: {
          type: "integer",
          minimum: 1,
          maximum: 10,
        },
        query: {
          type: "string",
        },
      },
      required: [],
    },
  },
  {
    type: "function",
    name: "get_email_thread",
    description:
      "Get a compact Gmail thread summary for a specific thread id. Use this only when you already have a Gmail thread id.",
    strict: false,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        threadId: {
          type: "string",
        },
      },
      required: ["threadId"],
    },
  },
  {
    type: "function",
    name: "list_email_labels",
    description: "List Gmail labels available to the current user.",
    strict: false,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {},
      required: [],
    },
  },
  {
    type: "function",
    name: "search_calendar_events",
    description: "Search upcoming Google Calendar events on the primary calendar.",
    strict: false,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        endTime: {
          type: "string",
        },
        maxResults: {
          type: "integer",
          minimum: 1,
          maximum: 10,
        },
        query: {
          type: "string",
        },
        startTime: {
          type: "string",
        },
      },
      required: [],
    },
  },
  {
    type: "function",
    name: "get_calendar_event",
    description: "Get a compact Google Calendar event summary by event id.",
    strict: false,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        eventId: {
          type: "string",
        },
      },
      required: ["eventId"],
    },
  },
  {
    type: "function",
    name: "set_chat_response_mode",
    description:
      "Control whether the UI should render structured email cards for this assistant reply. Use this after Gmail read tools when the user asked to see or read emails in chat. Do not use it for Gmail mutations.",
    strict: false,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        maxCount: {
          type: "integer",
          minimum: 1,
          maximum: 10,
        },
        showEmailResults: {
          type: "boolean",
        },
      },
      required: ["showEmailResults"],
    },
  },
  {
    type: "function",
    name: "prepare_email_action",
    description:
      "Prepare a Gmail action. Depending on the user's approval mode, this may either queue a review draft or execute immediately. When one user request affects multiple emails, send all target thread ids together in threadIds and do not split them across separate prepare calls.",
    strict: false,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        action: {
          type: "string",
          enum: [
            "APPLY_LABEL",
            "ARCHIVE",
            "MARK_SPAM",
            "REMOVE_LABEL",
            "STAR",
            "TRASH",
            "UNSTAR",
          ],
        },
        labelName: {
          type: "string",
        },
        rationale: {
          type: "string",
        },
        threadId: {
          type: "string",
        },
        threadIds: {
          type: "array",
          items: {
            type: "string",
          },
        },
      },
      required: ["action"],
    },
  },
  {
    type: "function",
    name: "prepare_calendar_action",
    description:
      "Prepare a Google Calendar action. Depending on the user's approval mode, this may either queue a review draft or execute immediately.",
    strict: false,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        action: {
          type: "string",
          enum: ["CREATE", "DELETE", "UPDATE"],
        },
        description: {
          type: "string",
        },
        endTime: {
          type: "string",
        },
        eventId: {
          type: "string",
        },
        location: {
          type: "string",
        },
        rationale: {
          type: "string",
        },
        sendUpdates: {
          type: "string",
          enum: ["all", "externalOnly", "none"],
        },
        startTime: {
          type: "string",
        },
        summary: {
          type: "string",
        },
        timeZone: {
          type: "string",
        },
      },
      required: ["action"],
    },
  },
  {
    type: "function",
    name: "list_pending_google_actions",
    description: "List pending Gmail and Calendar drafts awaiting manual approval.",
    strict: false,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {},
      required: [],
    },
  },
];

function getSystemPrompt() {
  return [
    "You are Inbox Concierge, a concise Google Workspace assistant for Gmail triage and calendar coordination.",
    "Use the available tools when the user asks about concrete Gmail threads, labels, calendar events, or actions.",
    "If the user asks about their own Gmail or Calendar data, do not answer from memory or with a capability disclaimer. Use a read tool first unless the request is too ambiguous to execute.",
    "The UI can render structured email cards from Gmail read tool results.",
    "Do not restate subject, sender, timestamp, or snippet in prose unless the user explicitly asks for a text-only rendering.",
    "If the user wants emails shown in the chat, call set_chat_response_mode with showEmailResults=true and keep your prose to a single short framing sentence.",
    "When showEmailResults=true, do not enumerate emails, use bullets, or repeat subject lines, senders, dates, snippets, or message bodies in prose.",
    "If Gmail data is only supporting context, do not call set_chat_response_mode.",
    "All Gmail and Calendar writes must go through prepare_* tools.",
    "If one user request modifies multiple Gmail threads, prepare that as a single prepare_email_action call with all target ids in threadIds.",
    "Only tell the user to review the approval queue when a prepare_* tool returns a pending status or requiresApproval=true.",
    "When a prepare_* tool returns a pending status or requires approval, do not ask the user a follow-up question like 'would you like me to proceed' or 'should I do that'. State that the change has been added to the approval queue and that the user can approve it there.",
    "Only say a Gmail or Calendar change already happened when the tool result status is EXECUTED.",
    "If a tool result status is EXECUTED, say the change was completed. If a tool result status is PENDING, say it was queued for approval.",
    "If an action would be destructive or user intent is ambiguous, ask a clarifying question instead of drafting it.",
  ].join(" ");
}

function shouldRequireWorkspaceTools(messages: ChatMessage[]) {
  const lastUserMessage = getLastUserMessage(messages);

  if (!lastUserMessage) {
    return false;
  }

  return (
    WORKSPACE_DATA_PATTERN.test(lastUserMessage.content) &&
    DIRECT_ACCESS_PATTERN.test(lastUserMessage.content)
  );
}

function selectToolChoice(
  messages: ChatMessage[],
): "auto" | "required" | ToolChoiceFunction {
  const lastUserMessage = getLastUserMessage(messages);

  if (!lastUserMessage) {
    return "auto";
  }

  if (LAST_EMAIL_PATTERN.test(lastUserMessage.content)) {
    return {
      type: "function",
      name: "search_email_threads",
    };
  }

  if (NEXT_EVENT_PATTERN.test(lastUserMessage.content)) {
    return {
      type: "function",
      name: "search_calendar_events",
    };
  }

  return shouldRequireWorkspaceTools(messages) ? "required" : "auto";
}

function serializeToolError(error: unknown) {
  if (error instanceof GoogleApiError) {
    return {
      message: error.message,
      status: error.status,
      details: error.details,
    };
  }

  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    message: "Unknown workspace tool error.",
    raw: error,
  };
}

function parseToolArguments(toolCall: ResponseFunctionToolCall) {
  try {
    return JSON.parse(toolCall.arguments) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function handleToolCall(
  toolCall: ResponseFunctionToolCall,
  context: AssistantContext,
  options?: {
    forceManualApproval?: boolean;
  },
) {
  const argumentsObject = parseToolArguments(toolCall);

  switch (toolCall.name) {
    case "search_email_threads":
      return searchEmailThreads(context.accessToken, {
        maxResults:
          typeof argumentsObject.maxResults === "number"
            ? argumentsObject.maxResults
            : undefined,
        query:
          typeof argumentsObject.query === "string"
            ? argumentsObject.query
            : undefined,
      });
    case "get_email_thread":
      return getEmailThread(
        context.accessToken,
        String(argumentsObject.threadId ?? ""),
      );
    case "list_email_labels":
      return listEmailLabels(context.accessToken);
    case "search_calendar_events":
      return searchCalendarEvents(context.accessToken, {
        endTime:
          typeof argumentsObject.endTime === "string"
            ? argumentsObject.endTime
            : undefined,
        maxResults:
          typeof argumentsObject.maxResults === "number"
            ? argumentsObject.maxResults
            : undefined,
        query:
          typeof argumentsObject.query === "string"
            ? argumentsObject.query
            : undefined,
        startTime:
          typeof argumentsObject.startTime === "string"
            ? argumentsObject.startTime
            : undefined,
      });
    case "get_calendar_event":
      return getCalendarEvent(
        context.accessToken,
        String(argumentsObject.eventId ?? ""),
      );
    case "prepare_email_action":
      return prepareEmailActionDraft({
        accessToken: context.accessToken,
        ownerEmail: context.ownerEmail,
        request: {
          action: String(argumentsObject.action ?? "") as
            | "APPLY_LABEL"
            | "ARCHIVE"
            | "MARK_SPAM"
            | "REMOVE_LABEL"
            | "STAR"
            | "TRASH"
            | "UNSTAR",
          labelName:
            typeof argumentsObject.labelName === "string"
              ? argumentsObject.labelName
              : undefined,
          rationale:
            typeof argumentsObject.rationale === "string"
              ? argumentsObject.rationale
              : undefined,
          forceManualApproval: options?.forceManualApproval,
          threadId:
            typeof argumentsObject.threadId === "string"
              ? argumentsObject.threadId
              : undefined,
          threadIds: Array.isArray(argumentsObject.threadIds)
            ? argumentsObject.threadIds.filter(
                (threadId): threadId is string =>
                  typeof threadId === "string",
              )
            : undefined,
        },
      });
    case "prepare_calendar_action":
      return prepareCalendarActionDraft({
        accessToken: context.accessToken,
        ownerEmail: context.ownerEmail,
        request: {
          action: String(argumentsObject.action ?? "") as
            | "CREATE"
            | "DELETE"
            | "UPDATE",
          description:
            typeof argumentsObject.description === "string"
              ? argumentsObject.description
              : undefined,
          endTime:
            typeof argumentsObject.endTime === "string"
              ? argumentsObject.endTime
              : undefined,
          eventId:
            typeof argumentsObject.eventId === "string"
              ? argumentsObject.eventId
              : undefined,
          location:
            typeof argumentsObject.location === "string"
              ? argumentsObject.location
              : undefined,
          rationale:
            typeof argumentsObject.rationale === "string"
              ? argumentsObject.rationale
              : undefined,
          sendUpdates:
            argumentsObject.sendUpdates === "all" ||
            argumentsObject.sendUpdates === "externalOnly" ||
            argumentsObject.sendUpdates === "none"
              ? argumentsObject.sendUpdates
              : undefined,
          startTime:
            typeof argumentsObject.startTime === "string"
              ? argumentsObject.startTime
              : undefined,
          summary:
            typeof argumentsObject.summary === "string"
              ? argumentsObject.summary
              : undefined,
          timeZone:
            typeof argumentsObject.timeZone === "string"
              ? argumentsObject.timeZone
              : undefined,
        },
      });
    case "list_pending_google_actions":
      return {
        drafts: await listPendingActionDrafts(context.ownerEmail),
      };
    case "set_chat_response_mode":
      return {
        ok: true,
      };
    default:
      throw new Error(`Unsupported tool: ${toolCall.name}`);
  }
}

function asToolOutput(callId: string, output: unknown): ToolOutputInput {
  return {
    type: "function_call_output",
    call_id: callId,
    output:
      typeof output === "string"
        ? output
        : JSON.stringify(output),
  };
}

function getRequestedEmailTargetCount(toolCall: ResponseFunctionToolCall) {
  if (toolCall.name !== "prepare_email_action") {
    return 0;
  }

  const argumentsObject = parseToolArguments(toolCall);
  const threadIds = Array.from(
    new Set(
      [
        ...(Array.isArray(argumentsObject.threadIds)
          ? argumentsObject.threadIds.filter(
              (threadId): threadId is string => typeof threadId === "string",
            )
          : []),
        typeof argumentsObject.threadId === "string"
          ? argumentsObject.threadId
          : undefined,
      ].filter((threadId): threadId is string => Boolean(threadId)),
    ),
  );

  return threadIds.length;
}

function extractEmailResults(
  toolName: string,
  output: unknown,
): EmailToolResult[] | undefined {
  if (toolName === "search_email_threads") {
    const candidate = output as {
      threads?: Array<{
        body?: unknown;
        bodyHtml?: unknown;
        id?: unknown;
        lastMessageAt?: unknown;
        sender?: unknown;
        snippet?: unknown;
        subject?: unknown;
      }>;
    };

    const threads = candidate.threads?.flatMap((thread) => {
      if (
        typeof thread?.id !== "string" ||
        typeof thread.subject !== "string" ||
        typeof thread.snippet !== "string"
      ) {
        return [];
      }

      return [
        {
          body:
            typeof thread.body === "string" && thread.body.trim().length
              ? thread.body
              : thread.snippet,
          bodyHtml:
            typeof thread.bodyHtml === "string" && thread.bodyHtml.trim().length
              ? thread.bodyHtml
              : undefined,
          lastMessageAt:
            typeof thread.lastMessageAt === "string" ? thread.lastMessageAt : null,
          sender: typeof thread.sender === "string" ? thread.sender : null,
          snippet: thread.snippet,
          subject: thread.subject,
          threadId: thread.id,
        } satisfies EmailToolResult,
      ];
    });

    return threads?.length ? threads : undefined;
  }

  if (toolName === "get_email_thread") {
    const thread = output as {
      body?: unknown;
      bodyHtml?: unknown;
      id?: unknown;
      lastMessageAt?: unknown;
      sender?: unknown;
      snippet?: unknown;
      subject?: unknown;
    };

    if (
      typeof thread.id !== "string" ||
      typeof thread.subject !== "string" ||
      typeof thread.snippet !== "string"
    ) {
      return undefined;
    }

    return [
      {
        body:
          typeof thread.body === "string" && thread.body.trim().length
            ? thread.body
            : thread.snippet,
        bodyHtml:
          typeof thread.bodyHtml === "string" && thread.bodyHtml.trim().length
            ? thread.bodyHtml
            : undefined,
        lastMessageAt:
          typeof thread.lastMessageAt === "string" ? thread.lastMessageAt : null,
        sender: typeof thread.sender === "string" ? thread.sender : null,
        snippet: thread.snippet,
        subject: thread.subject,
        threadId: thread.id,
      },
    ];
  }

  return undefined;
}

function extractEmailDisplayDirective(
  toolName: string,
  argumentsObject: Record<string, unknown>,
): EmailDisplayDirective | undefined {
  if (toolName !== "set_chat_response_mode") {
    return undefined;
  }

  return {
    maxCount:
      typeof argumentsObject.maxCount === "number"
        ? Math.min(Math.max(argumentsObject.maxCount, 1), 10)
        : undefined,
    show: Boolean(argumentsObject.showEmailResults),
  };
}

export async function runGoogleWorkspaceAssistant(input: {
  accessToken: string;
  client: OpenAI;
  messages: ChatMessage[];
  model: string;
  ownerEmail: string;
}): Promise<AssistantRunResult> {
  const context: AssistantContext = {
    accessToken: input.accessToken,
    ownerEmail: input.ownerEmail,
  };
  const executedToolCalls: ToolCallSummary[] = [];
  const lastUserMessage = getLastUserMessage(input.messages);

  const createResponse = async (
    responseInput: ResponseCreateParamsNonStreaming,
  ): Promise<Response> => {
    await reserveOpenAICall(input.ownerEmail);

    return input.client.responses.create(responseInput);
  };

  let response = await createResponse({
    model: input.model,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: getSystemPrompt(),
          },
        ],
      },
      ...input.messages.map(toResponseInputMessage),
    ],
    tools: GOOGLE_WORKSPACE_TOOLS,
    tool_choice: selectToolChoice(input.messages),
  });

  for (let step = 0; step < 8; step += 1) {
    const toolCalls = response.output.filter(
      (outputItem): outputItem is ResponseFunctionToolCall =>
        outputItem.type === "function_call",
    );

    if (!toolCalls.length) {
      const emailDisplay =
        [...executedToolCalls]
        .reverse()
        .find((toolCall) => toolCall.emailDisplay)?.emailDisplay ??
        inferEmailDisplayDirective(lastUserMessage, executedToolCalls);
      const emailResults = emailDisplay?.show
        ? executedToolCalls
            .flatMap((toolCall) => toolCall.emailResults ?? [])
            .slice(0, emailDisplay.maxCount ?? undefined)
        : undefined;
      const content = normalizeAssistantContentForNativeEmailCards({
        content: response.output_text || "I could not produce a response.",
        emailDisplay,
        emailResults,
        lastUserMessage,
      });

      return {
        content,
        emailDisplay,
        emailResults: emailResults?.length ? emailResults : undefined,
        toolCalls: executedToolCalls,
      };
    }

    const emailMutationTargetCount = toolCalls.reduce(
      (total, toolCall) => total + getRequestedEmailTargetCount(toolCall),
      0,
    );
    const shouldForceBulkEmailApproval = emailMutationTargetCount > 1;

    const toolResults = await Promise.all(
      toolCalls.map(async (toolCall) => {
        const toolArguments = parseToolArguments(toolCall);

        try {
          const output = await handleToolCall(toolCall, context, {
            forceManualApproval:
              shouldForceBulkEmailApproval &&
              toolCall.name === "prepare_email_action",
          });

          return {
            summary: {
              arguments: toolArguments,
              emailDisplay: extractEmailDisplayDirective(
                toolCall.name,
                toolArguments,
              ),
              emailResults: extractEmailResults(toolCall.name, output),
              name: toolCall.name,
              status: "ok" as const,
            },
            toolOutput: asToolOutput(toolCall.call_id, {
              ok: true,
              result: output,
            }),
          };
        } catch (error) {
          console.error("Workspace tool call failed", {
            error: serializeToolError(error),
            toolName: toolCall.name,
            toolArguments: toolCall.arguments,
          });

          return {
            summary: {
              arguments: toolArguments,
              name: toolCall.name,
              status: "error" as const,
            },
            toolOutput: asToolOutput(toolCall.call_id, {
              error:
                error instanceof Error
                  ? error.message
                  : "The requested tool call failed.",
              ok: false,
            }),
          };
        }
      }),
    );
    const toolOutputs = toolResults.map((toolResult) => toolResult.toolOutput);

    executedToolCalls.push(
      ...toolResults.map((toolResult) => toolResult.summary),
    );

    response = await createResponse({
      model: input.model,
      previous_response_id: response.id,
      input: toolOutputs,
      tools: GOOGLE_WORKSPACE_TOOLS,
    });
  }

  return {
    content: "I hit the tool-call limit before finishing that request.",
    emailDisplay: undefined,
    emailResults: undefined,
    toolCalls: executedToolCalls,
  };
}

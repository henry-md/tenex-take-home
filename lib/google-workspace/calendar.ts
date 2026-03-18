import {
  IntegrationActionKind,
  IntegrationActionStatus,
  IntegrationProvider,
  type IntegrationActionDraft,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

import { getWorkspaceApprovalMode, requiresApproval } from "./approval-mode";
import { googleApiRequest } from "./google-api";

type CalendarEventDateTime = {
  date?: string;
  dateTime?: string;
  timeZone?: string;
};

type CalendarEventAttendee = {
  email?: string;
  responseStatus?: string;
};

type CalendarEventResponse = {
  description?: string;
  etag?: string;
  htmlLink?: string;
  id: string;
  location?: string;
  start?: CalendarEventDateTime;
  end?: CalendarEventDateTime;
  summary?: string;
  attendees?: CalendarEventAttendee[];
};

type PrepareCalendarActionInput = {
  action: "CREATE" | "DELETE" | "UPDATE";
  description?: string;
  endTime?: string;
  eventId?: string;
  location?: string;
  rationale?: string;
  sendUpdates?: "all" | "externalOnly" | "none";
  startTime?: string;
  summary?: string;
  timeZone?: string;
};

type CalendarActionPayload = {
  action: PrepareCalendarActionInput["action"];
  eventId?: string;
  eventPatch?: {
    description?: string;
    end?: CalendarEventDateTime;
    location?: string;
    start?: CalendarEventDateTime;
    summary?: string;
  };
  etag?: string;
  sendUpdates: "all" | "externalOnly" | "none";
};

type CalendarDraftRecordInput = {
  action: PrepareCalendarActionInput["action"];
  draftTitle: string;
  eventId?: string;
  existingEvent: CalendarEventSummary | null;
  nextState:
    | {
        description?: string;
        end?: CalendarEventDateTime;
        location?: string;
        start?: CalendarEventDateTime;
        summary?: string;
      }
    | undefined;
  ownerEmail: string;
  requiresManualApproval: boolean;
  sendUpdates: "all" | "externalOnly" | "none";
};

export type CalendarEventSummary = {
  attendeeEmails: string[];
  description: string | null;
  endTime: string | null;
  etag: string | null;
  htmlLink: string | null;
  id: string;
  location: string | null;
  startTime: string | null;
  summary: string;
  timeZone: string | null;
};

function summarizeCalendarEvent(event: CalendarEventResponse): CalendarEventSummary {
  return {
    attendeeEmails:
      event.attendees
        ?.map((attendee) => attendee.email)
        .filter((email): email is string => Boolean(email)) ?? [],
    description: event.description ?? null,
    endTime: event.end?.dateTime ?? event.end?.date ?? null,
    etag: event.etag ?? null,
    htmlLink: event.htmlLink ?? null,
    id: event.id,
    location: event.location ?? null,
    startTime: event.start?.dateTime ?? event.start?.date ?? null,
    summary: event.summary ?? "(Untitled event)",
    timeZone: event.start?.timeZone ?? event.end?.timeZone ?? null,
  };
}

function mapActionToKind(
  action: PrepareCalendarActionInput["action"],
): IntegrationActionKind {
  switch (action) {
    case "CREATE":
      return IntegrationActionKind.CALENDAR_CREATE_EVENT;
    case "UPDATE":
      return IntegrationActionKind.CALENDAR_UPDATE_EVENT;
    case "DELETE":
      return IntegrationActionKind.CALENDAR_DELETE_EVENT;
  }
}

function buildEventDateTime(dateTime: string | undefined, timeZone: string | undefined) {
  if (!dateTime) {
    return undefined;
  }

  return {
    dateTime,
    timeZone,
  };
}

function requireEventTiming(startTime?: string, endTime?: string) {
  if (!startTime || !endTime) {
    throw new Error("Calendar drafts require both a start time and an end time.");
  }

  const startDate = new Date(startTime);
  const endDate = new Date(endTime);

  if (Number.isNaN(startDate.valueOf()) || Number.isNaN(endDate.valueOf())) {
    throw new Error("Calendar drafts require ISO-8601 start and end times.");
  }

  if (endDate <= startDate) {
    throw new Error("Calendar drafts require the end time to be after the start time.");
  }
}

function describeCalendarAction(
  action: PrepareCalendarActionInput["action"],
  eventSummary: string,
) {
  switch (action) {
    case "CREATE":
      return `Create the "${eventSummary}" calendar event.`;
    case "UPDATE":
      return `Update the "${eventSummary}" calendar event.`;
    case "DELETE":
      return `Delete the "${eventSummary}" calendar event.`;
  }
}

async function getRawCalendarEvent(accessToken: string, eventId: string) {
  return googleApiRequest<CalendarEventResponse>(
    accessToken,
    `/calendar/v3/calendars/primary/events/${eventId}`,
  );
}

export async function searchCalendarEvents(
  accessToken: string,
  input: {
    endTime?: string;
    maxResults?: number;
    query?: string;
    startTime?: string;
  },
) {
  const maxResults = Math.min(Math.max(input.maxResults ?? 5, 1), 10);
  const response = await googleApiRequest<{ items?: CalendarEventResponse[] }>(
    accessToken,
    "/calendar/v3/calendars/primary/events",
    {
      query: {
        maxResults,
        orderBy: "startTime",
        q: input.query?.trim() || undefined,
        singleEvents: true,
        timeMax: input.endTime,
        timeMin: input.startTime ?? new Date().toISOString(),
      },
    },
  );

  return {
    events: response.items?.map(summarizeCalendarEvent) ?? [],
  };
}

export async function getCalendarEvent(accessToken: string, eventId: string) {
  const event = await getRawCalendarEvent(accessToken, eventId);

  return summarizeCalendarEvent(event);
}

export async function prepareCalendarActionDraft(input: {
  accessToken: string;
  ownerEmail: string;
  request: PrepareCalendarActionInput;
}) {
  const sendUpdates = input.request.sendUpdates ?? "none";
  let existingEvent: CalendarEventSummary | null = null;

  if (input.request.action !== "CREATE") {
    if (!input.request.eventId) {
      throw new Error("Calendar update and delete drafts require an event id.");
    }

    existingEvent = await getCalendarEvent(input.accessToken, input.request.eventId);
  }

  if (input.request.action === "CREATE") {
    requireEventTiming(input.request.startTime, input.request.endTime);
  }

  if (
    input.request.action === "UPDATE" &&
    (input.request.startTime || input.request.endTime)
  ) {
    requireEventTiming(
      input.request.startTime ?? existingEvent?.startTime ?? undefined,
      input.request.endTime ?? existingEvent?.endTime ?? undefined,
    );
  }

  const nextState =
    input.request.action === "DELETE"
      ? undefined
      : {
          description:
            input.request.description ?? existingEvent?.description ?? undefined,
          end: buildEventDateTime(
            input.request.endTime ?? existingEvent?.endTime ?? undefined,
            input.request.timeZone ?? existingEvent?.timeZone ?? undefined,
          ),
          location: input.request.location ?? existingEvent?.location ?? undefined,
          start: buildEventDateTime(
            input.request.startTime ?? existingEvent?.startTime ?? undefined,
            input.request.timeZone ?? existingEvent?.timeZone ?? undefined,
          ),
          summary: input.request.summary ?? existingEvent?.summary ?? "Untitled event",
        };

  const draftTitle =
    input.request.summary ?? existingEvent?.summary ?? "Untitled event";

  const approvalMode = await getWorkspaceApprovalMode(input.ownerEmail);
  const requiresManualApproval = requiresApproval({
    mode: approvalMode,
    provider: "GOOGLE_CALENDAR",
  });
  const draft = await createCalendarActionDraftRecord({
    action: input.request.action,
    draftTitle,
    eventId: existingEvent?.id,
    existingEvent,
    nextState,
    ownerEmail: input.ownerEmail,
    requiresManualApproval,
    sendUpdates,
  });

  if (requiresManualApproval) {
    return {
      draftId: draft.id,
      requiresApproval: true,
      status: draft.status,
      summary: draft.summary,
    };
  }

  const executedDraft = await executeCalendarActionDraft(input.accessToken, draft);

  return {
    draftId: executedDraft.id,
    requiresApproval: false,
    status: executedDraft.status,
    summary: executedDraft.summary,
  };
}

async function createCalendarActionDraftRecord(input: CalendarDraftRecordInput) {
  return prisma.integrationActionDraft.create({
    data: {
      ownerEmail: input.ownerEmail,
      provider: IntegrationProvider.GOOGLE_CALENDAR,
      kind: mapActionToKind(input.action),
      status: input.requiresManualApproval
        ? IntegrationActionStatus.PENDING
        : IntegrationActionStatus.APPROVED,
      title: input.draftTitle,
      summary: describeCalendarAction(input.action, input.draftTitle),
      targetId: input.eventId,
      beforeState: input.existingEvent ?? undefined,
      afterState:
        input.action === "DELETE"
          ? {
              deleted: true,
            }
          : input.nextState ?? undefined,
      payload: {
        action: input.action,
        eventId: input.eventId,
        eventPatch: input.nextState,
        etag: input.existingEvent?.etag ?? undefined,
        sendUpdates: input.sendUpdates,
      },
      approvedAt: input.requiresManualApproval ? undefined : new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });
}

export async function executeCalendarActionDraft(
  accessToken: string,
  draft: IntegrationActionDraft,
) {
  const payload = draft.payload as unknown as CalendarActionPayload;
  const headers: HeadersInit = {
    "Content-Type": "application/json",
  };

  if (payload.etag) {
    headers["If-Match"] = payload.etag;
  }

  if (payload.action === "CREATE") {
    const createdEvent = await googleApiRequest<CalendarEventResponse>(
      accessToken,
      "/calendar/v3/calendars/primary/events",
      {
        method: "POST",
        headers,
        query: {
          sendUpdates: payload.sendUpdates,
        },
        body: JSON.stringify(payload.eventPatch),
      },
    );

    return prisma.integrationActionDraft.update({
      where: {
        id: draft.id,
      },
      data: {
        status: IntegrationActionStatus.EXECUTED,
        approvedAt: new Date(),
        executedAt: new Date(),
        executionResult: summarizeCalendarEvent(createdEvent),
        failureReason: null,
      },
    });
  }

  if (!payload.eventId) {
    throw new Error("The calendar draft payload is missing the event id.");
  }

  if (payload.action === "UPDATE") {
    const updatedEvent = await googleApiRequest<CalendarEventResponse>(
      accessToken,
      `/calendar/v3/calendars/primary/events/${payload.eventId}`,
      {
        method: "PATCH",
        headers,
        query: {
          sendUpdates: payload.sendUpdates,
        },
        body: JSON.stringify(payload.eventPatch),
      },
    );

    return prisma.integrationActionDraft.update({
      where: {
        id: draft.id,
      },
      data: {
        status: IntegrationActionStatus.EXECUTED,
        approvedAt: new Date(),
        executedAt: new Date(),
        executionResult: summarizeCalendarEvent(updatedEvent),
        failureReason: null,
      },
    });
  }

  await googleApiRequest<void>(
    accessToken,
    `/calendar/v3/calendars/primary/events/${payload.eventId}`,
    {
      method: "DELETE",
      headers,
      query: {
        sendUpdates: payload.sendUpdates,
      },
    },
  );

  return prisma.integrationActionDraft.update({
    where: {
      id: draft.id,
    },
    data: {
      status: IntegrationActionStatus.EXECUTED,
      approvedAt: new Date(),
      executedAt: new Date(),
      executionResult: {
        deleted: true,
        eventId: payload.eventId,
      },
      failureReason: null,
    },
  });
}

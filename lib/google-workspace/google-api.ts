const GOOGLE_API_ROOT = "https://www.googleapis.com";

export class GoogleApiError extends Error {
  status: number;

  details: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = "GoogleApiError";
    this.status = status;
    this.details = details;
  }
}

function isGoogleApiErrorPayload(
  value: unknown,
): value is {
  error?: {
    errors?: Array<{
      reason?: string;
    }>;
  };
} {
  return typeof value === "object" && value !== null;
}

export function getGoogleApiErrorReason(error: GoogleApiError) {
  if (!isGoogleApiErrorPayload(error.details)) {
    return undefined;
  }

  return error.details.error?.errors?.find(
    (entry) => typeof entry.reason === "string",
  )?.reason;
}

export function getGoogleApiRetryAt(error: GoogleApiError) {
  const matchedRetryAt = error.message.match(
    /\bRetry after (\d{4}-\d{2}-\d{2}T[^ )]+)\b/i,
  )?.[1];

  return matchedRetryAt ?? undefined;
}

export function serializeGoogleApiError(error: GoogleApiError) {
  return {
    details: error.details,
    error: error.message,
    reason: getGoogleApiErrorReason(error),
    retryAt: getGoogleApiRetryAt(error),
    status: error.status,
  };
}

type GoogleApiRequestOptions = Omit<RequestInit, "body"> & {
  body?: BodyInit | null;
  query?: Record<string, boolean | number | string | undefined>;
};

export async function googleApiRequest<T>(
  accessToken: string,
  path: string,
  options: GoogleApiRequestOptions = {},
): Promise<T> {
  const url = new URL(path, GOOGLE_API_ROOT);

  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value === undefined) {
      continue;
    }

    url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...options.headers,
    },
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const message =
      typeof payload === "object" &&
      payload !== null &&
      "error" in payload &&
      typeof payload.error === "object" &&
      payload.error !== null &&
      "message" in payload.error &&
      typeof payload.error.message === "string"
        ? payload.error.message
        : "Google API request failed.";

    throw new GoogleApiError(
      `${message} (HTTP ${response.status} on ${url.pathname})`,
      response.status,
      payload,
    );
  }

  return payload as T;
}

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

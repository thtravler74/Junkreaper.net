export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init?: { method?: string; body?: unknown; signal?: AbortSignal }): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: init?.method ?? (init?.body ? "POST" : "GET"),
      headers: init?.body ? { "content-type": "application/json" } : undefined,
      body: init?.body ? JSON.stringify(init.body) : undefined,
      signal: init?.signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ApiError(0, "network", "We couldn't reach the server. Check your connection and try again.");
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const e = (data as { error?: { code: string; message: string } } | null)?.error;
    throw new ApiError(response.status, e?.code ?? "error", e?.message ?? `Something went wrong (${response.status}).`);
  }
  return data as T;
}

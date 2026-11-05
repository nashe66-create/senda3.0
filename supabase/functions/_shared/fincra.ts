/**
 * Shared Fincra server-side API adapter for Supabase Edge Functions.
 *
 * Authentication: Fincra's secret API key is sent in the `api-key` header.
 * Never import this module into client/mobile code.
 *
 * Configure:
 *   FINCRA_SECRET_KEY (required)
 *   FINCRA_BASE_URL (optional; defaults to sandbox)
 */
export type FincraEnvironment = "sandbox" | "production";

export type FincraRequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
  idempotencyKey?: string;
  timeoutMs?: number;
};

export class FincraApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: unknown;

  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.name = "FincraApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const DEFAULT_SANDBOX_URL = "https://sandboxapi.fincra.com";
const DEFAULT_PRODUCTION_URL = "https://api.fincra.com";

function resolveBaseUrl(): string {
  const configured = Deno.env.get("FINCRA_BASE_URL")?.trim();
  if (!configured) return DEFAULT_SANDBOX_URL;

  // Prevent accidental credential exfiltration to arbitrary hosts.
  const allowed = new Set([DEFAULT_SANDBOX_URL, DEFAULT_PRODUCTION_URL]);
  if (!allowed.has(configured.replace(/\/$/, ""))) {
    throw new Error("FINCRA_BASE_URL must be the official Fincra sandbox or production URL");
  }
  return configured.replace(/\/$/, "");
}

function parseResponse(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function extractError(payload: any): { message: string; code?: string } {
  const message =
    payload?.message ??
    payload?.error?.message ??
    payload?.error_description ??
    payload?.error ??
    "Fincra API request failed";
  const code = payload?.code ?? payload?.error?.code ?? payload?.error_code;
  return {
    message: typeof message === "string" ? message : "Fincra API request failed",
    code: typeof code === "string" ? code : undefined,
  };
}

export async function fincraRequest<T = unknown>(
  path: string,
  options: FincraRequestOptions = {},
): Promise<T> {
  const apiKey = Deno.env.get("FINCRA_SECRET_KEY");
  if (!apiKey) throw new Error("FINCRA_SECRET_KEY is not configured");

  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new Error("Fincra path must be a relative API path beginning with a single slash");
  }

  const method = options.method ?? "GET";
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 20_000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const headers: Record<string, string> = {
    Accept: "application/json",
    "api-key": apiKey,
    ...options.headers,
  };

  if (options.body !== undefined) headers["Content-Type"] ??= "application/json";
  if (options.idempotencyKey) headers["X-Idempotency-Key"] = options.idempotencyKey;

  try {
    const response = await fetch(`${resolveBaseUrl()}${path}`, {
      method,
      headers,
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      signal: controller.signal,
    });

    const text = await response.text();
    const payload = parseResponse(text);

    if (!response.ok) {
      const error = extractError(payload);
      throw new FincraApiError(error.message, response.status, error.code, payload);
    }

    return payload as T;
  } catch (error) {
    if (error instanceof FincraApiError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new FincraApiError("Fincra request timed out", 408, "TIMEOUT");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

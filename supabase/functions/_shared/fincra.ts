export class FincraApiError extends Error {
  status: number;
  code?: string;
  payload?: unknown;

  constructor(message: string, status: number, payload?: unknown, code?: string) {
    super(message);
    this.name = "FincraApiError";
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}

export interface FincraRequestOptions {
  extraHeaders?: Record<string, string>;
  idempotencyKey?: string;
}

export function resolveFincraBaseUrl(): string {
  const configured = Deno.env.get("FINCRA_BASE_URL") ?? "";
  if (configured.trim()) {
    return configured.replace(/\/+$/, "");
  }

  const envName = Deno.env.get("FINCRA_ENV") ?? "sandbox";
  if (envName === "production") {
    return "https://api.fincra.com";
  }

  return "https://sandboxapi.fincra.com";
}

export function getFincraApiKey(): string {
  const apiKey = Deno.env.get("FINCRA_SECRET_KEY") ?? Deno.env.get("FINCRA_API_KEY");
  if (!apiKey || !apiKey.trim()) {
    throw new Error("FINCRA_SECRET_KEY is not configured");
  }

  return apiKey.trim();
}

export function buildFincraHeaders(extraHeaders: Record<string, string> = {}): Headers {
  const headers = new Headers({
    Accept: "application/json",
    "api-key": getFincraApiKey(),
  });

  for (const [key, value] of Object.entries(extraHeaders)) {
    if (value) {
      headers.set(key, value);
    }
  }

  return headers;
}

export async function fincraRequest<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  options: FincraRequestOptions = {},
): Promise<T> {
  const baseUrl = resolveFincraBaseUrl();
  const url = new URL(path, `${baseUrl}/`).toString();
  const headers = buildFincraHeaders(options.extraHeaders ?? {});

  if (options.idempotencyKey) {
    headers.set("X-Idempotency-Key", options.idempotencyKey);
  }

  if (body !== undefined && body !== null && method.toUpperCase() !== "GET") {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body !== undefined && body !== null && method.toUpperCase() !== "GET"
      ? JSON.stringify(body)
      : undefined,
  });

  const text = await response.text();
  let payload: any = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw_response: text };
  }

  if (!response.ok) {
    const message =
      payload?.message ??
      payload?.error?.message ??
      payload?.error?.description ??
      payload?.details?.message ??
      `Fincra request failed (${response.status})`;

    throw new FincraApiError(
      message,
      response.status,
      payload,
      payload?.error?.code ?? payload?.code ?? payload?.details?.code,
    );
  }

  return payload?.data !== undefined ? payload.data : (payload as T);
}

export function getFincraQuotePath(): string {
  return "/quotes/generate";
}

export async function createFincraCheckout<T = unknown>(body: Record<string, unknown>, reference?: string) {
  const checkoutReference = reference ??
    (typeof body.reference === "string" ? body.reference : `senda-checkout-${crypto.randomUUID()}`);
  return fincraRequest<T>("POST", "/checkout/payments", {
    ...body,
    reference: checkoutReference,
  }, {
    idempotencyKey: checkoutReference,
  });
}

export async function getFincraCheckoutByReference<T = unknown>(reference: string) {
  return fincraRequest<T>("GET", `/checkout/payments/merchant-reference/${encodeURIComponent(reference)}`);
}

export async function listFincraWallets<T = unknown>(query?: Record<string, string>) {
  const search = new URLSearchParams(query ?? {});
  const path = `/wallets${search.toString() ? `?${search.toString()}` : ""}`;
  return fincraRequest<T>("GET", path);
}

export async function getFincraWallet<T = unknown>(walletId: string) {
  return fincraRequest<T>("GET", `/wallets/${encodeURIComponent(walletId)}`);
}

export async function initiateFincraConversion<T = unknown>(body: Record<string, unknown>) {
  return fincraRequest<T>("POST", "/conversions/initiate", body, {
    idempotencyKey: body.reference ? String(body.reference) : `senda-conversion-${crypto.randomUUID()}`,
  });
}

export async function getFincraConversionByReference<T = unknown>(reference: string) {
  return fincraRequest<T>("GET", `/conversions/reference/${encodeURIComponent(reference)}`);
}

export async function createFincraPayout<T = unknown>(body: Record<string, unknown>) {
  return fincraRequest<T>("POST", "/disbursements/payouts", body, {
    idempotencyKey: body.reference ? String(body.reference) : `senda-payout-${crypto.randomUUID()}`,
  });
}

export async function getFincraPayoutByReference<T = unknown>(reference: string) {
  return fincraRequest<T>("GET", `/disbursements/payouts/reference/${encodeURIComponent(reference)}`);
}

export async function verifyFincraWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  webhookSecretKey: string | null = Deno.env.get("FINCRA_WEBHOOK_SECRET") ??
    Deno.env.get("FINCRA_WEBHOOK_SECRET_KEY") ??
    null,
): Promise<boolean> {
  if (!signatureHeader || !webhookSecretKey) {
    return false;
  }

  const encoder = new TextEncoder();
  const keyBytes = encoder.encode(webhookSecretKey);
  const dataBytes = encoder.encode(rawBody);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );

  const signed = await crypto.subtle.sign("HMAC", cryptoKey, dataBytes);
  const computed = Array.from(new Uint8Array(signed))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  return computed === signatureHeader.toLowerCase();
}

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.58.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const TOKEN_URL = "https://idp.flutterwave.com/realms/flutterwave/protocol/openid-connect/token";
const FLW_BASE_URL = Deno.env.get("FLW_BASE_URL") || "https://developersandbox-api.flutterwave.com";

function jsonResponse(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function getAccessToken(): Promise<string> {
  const clientId = Deno.env.get("FLW_CLIENT_ID");
  const clientSecret = Deno.env.get("FLW_CLIENT_SECRET");
  if (!clientId) throw new Error("FLW_CLIENT_ID is not configured");
  if (!clientSecret) throw new Error("FLW_CLIENT_SECRET is not configured");

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    }),
  });

  const text = await response.text();
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw_response: text }; }

  if (!response.ok || !data?.access_token) {
    throw new Error(data?.error_description ?? data?.message ?? "Flutterwave authentication failed");
  }
  return data.access_token;
}

// Keep this resolver aligned with the corridor sync's explicit country/currency
// capability lists. Never derive a provider type from arbitrary input.
const MOBILE_MONEY_CURRENCIES = new Set([
  "XAF", "XOF", "EGP", "ETB", "GHS", "KES", "MWK", "RWF", "TZS", "UGX", "ZMW",
]);
const BANK_CURRENCIES = new Set([
  "XAF", "XOF", "EGP", "ETB", "GHS", "INR", "KES", "MWK", "NGN", "RWF", "SLL",
  "TZS", "UGX", "USD", "ZAR", "ZMW",
]);

function getRecipientType(receivingMethod: string, currency: string): string | null {
  const normalizedCurrency = currency.trim().toUpperCase();

  if (receivingMethod === "mobile_money" && MOBILE_MONEY_CURRENCIES.has(normalizedCurrency)) {
    return `mobile_money_${normalizedCurrency.toLowerCase()}`;
  }
  if (receivingMethod === "bank_account" && BANK_CURRENCIES.has(normalizedCurrency)) {
    return `bank_${normalizedCurrency.toLowerCase()}`;
  }
  return null;
}

function buildRecipientBody(
  receivingMethod: string,
  currency: string,
  mobileMoney: { network: string; msisdn: string; country: string } | undefined,
  bankAccount: { account_number: string; bank_code: string; country: string } | undefined,
  recipientType: string,
  recipientName: string,
): Record<string, unknown> | null {
  const nameParts = (recipientName ?? "").trim().split(/\s+/);
  const firstName = nameParts[0] || "";
  const lastName = nameParts.slice(1).join(" ") || "";
  const body: Record<string, unknown> = {
    type: recipientType,
    name: { first: firstName, last: lastName },
    currency,
  };

  if (receivingMethod === "mobile_money" && mobileMoney) {
    if (!mobileMoney.network?.trim()) return null;
    body.mobile_money = {
      network: mobileMoney.network,
      msisdn: mobileMoney.msisdn,
      country: mobileMoney.country,
    };
  } else if (receivingMethod === "bank_account" && bankAccount) {
    body.bank = {
      account_number: bankAccount.account_number,
      code: bankAccount.bank_code,
    };
  } else {
    return null;
  }

  return body;
}

function extractAccountName(receivingMethod: string, data: any): string | null {
  if (receivingMethod !== "bank_account") return null;
  const nameObj = data?.data?.name;
  if (typeof nameObj === "string") return nameObj;
  if (nameObj && typeof nameObj === "object") {
    return [nameObj.first, nameObj.last].filter(Boolean).join(" ") || null;
  }
  return null;
}

// Central Flutterwave validation-error -> user-safe message mapping.
// Never surface raw Flutterwave codes/field paths to the user.
const VALIDATION_FIELD_MESSAGES: Array<{ match: RegExp; message: string }> = [
  { match: /mobile.*network/i, message: "The selected mobile network could not be verified. Please select the correct network." },
  { match: /bank\.account_number|account_number/i, message: "Please enter a valid bank account number." },
  { match: /bank\.code|bank\.branch/i, message: "Please select a valid bank." },
  { match: /phone/i, message: "Please enter a valid phone number." },
  { match: /email/i, message: "Please provide a valid email address." },
  { match: /address/i, message: "Please provide a valid recipient address." },
];

function mapValidationError(receivingMethod: string, data: any): { code: string; message: string } {
  const rawErrors: Array<{ field_name?: string; message?: string }> =
    Array.isArray(data?.error?.validation_errors) ? data.error.validation_errors
    : Array.isArray(data?.validation_errors) ? data.validation_errors
    : [];

  const codeParts: string[] = [];
  const messages = new Set<string>();

  for (const err of rawErrors) {
    const field = String(err?.field_name ?? "");
    if (field) codeParts.push(field);
    const mapped = VALIDATION_FIELD_MESSAGES.find((m) => m.match.test(field));
    if (mapped) messages.add(mapped.message);
  }

  if (messages.size === 0) {
    // Fall back to a method-specific generic message rather than exposing raw Flutterwave text.
    messages.add(
      receivingMethod === "mobile_money"
        ? "We couldn't verify the mobile money network for this recipient. Please select the correct mobile network and try again."
        : receivingMethod === "bank_account"
        ? "We couldn't verify the bank details for this recipient. Please check the bank and account number and try again."
        : "We couldn't verify this recipient's payout details. Please review and try again."
    );
  }

  return {
    code: codeParts.join(",") || String(data?.error?.type ?? data?.type ?? "VALIDATION_ERROR"),
    message: [...messages].join(" "),
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    if (!action) {
      return jsonResponse({
        success: false,
        error: "Missing action",
        supported_actions: ["create", "update"],
      }, 400);
    }

    const accessToken = await getAccessToken();

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Supabase server configuration is missing");
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      console.log("[flutterwave-recipients] No Authorization header present");
      return jsonResponse({ success: false, error: "Unauthorized" }, 401);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      console.log("[flutterwave-recipients] Supabase auth failed:", userError?.message ?? "no user");
      return jsonResponse({ success: false, error: "Unauthorized" }, 401);
    }
    const userId = user.id;

    const serviceClient = createClient(supabaseUrl, serviceRoleKey);

    // =======================================================
    // CREATE RECIPIENT
    // =======================================================
    if (req.method === "POST" && action === "create") {
      let payload: {
        recipient_id: string;
        receiving_method: string;
        currency: string;
        mobile_money?: { network: string; msisdn: string; country: string };
        bank_account?: { account_number: string; bank_code: string; country: string };
      };
      try { payload = await req.json(); } catch {
        return jsonResponse({ success: false, error: "Invalid JSON request body" }, 400);
      }

      if (!payload.recipient_id || !payload.receiving_method || !payload.currency) {
        return jsonResponse({ success: false, error: "Missing required fields" }, 400);
      }

      const { data: recipientRow, error: recipientLookupError } = await serviceClient
        .from("recipients")
        .select("id, user_id, name, receiving_method, bank_code, account_number, country")
        .eq("id", payload.recipient_id)
        .eq("user_id", userId)
        .maybeSingle();

      if (recipientLookupError || !recipientRow) {
        console.log("[flutterwave-recipients] create: recipient not found", payload.recipient_id, recipientLookupError?.message);
        return jsonResponse({ success: false, error: "Recipient not found" }, 404);
      }

      const recipientType = getRecipientType(payload.receiving_method, payload.currency);
      if (!recipientType) {
        return jsonResponse({
          success: false,
          error: "The selected receiving method is not available for this currency.",
        }, 400);
      }
      const recipientBody = buildRecipientBody(
        payload.receiving_method, payload.currency, payload.mobile_money, payload.bank_account, recipientType, recipientRow.name,
      );

      if (!recipientBody) {
        return jsonResponse({
          success: false,
          error: "Missing payout details for the selected receiving method",
        }, 400);
      }

      const idempotencyKey = `SENDA-RECIPIENT-${payload.recipient_id}`;
      console.log("[flutterwave-recipients] create: recipient_id:", payload.recipient_id, "type:", recipientType, "idempotency:", idempotencyKey);
      // TEMPORARY DIAGNOSTIC: confirm the exact outbound network/currency/type (no phone/account/name values).
      console.log("[flutterwave-recipients] create: outbound", {
        type: recipientType,
        currency: payload.currency,
        country: payload.mobile_money?.country ?? payload.bank_account?.country ?? null,
        mobile_money_network: payload.mobile_money?.network ?? null,
      });

      const response = await fetch(`${FLW_BASE_URL}/transfers/recipients`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Trace-Id": crypto.randomUUID(),
          "X-Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify(recipientBody),
      });

      const text = await response.text();
      let data: any = {};
      try { data = text ? JSON.parse(text) : {}; } catch { data = { raw_response: text }; }

      if (!response.ok) {
        const diagnosticHeaders = Object.fromEntries(
          ["x-request-id", "x-trace-id", "x-reference-id", "x-correlation-id", "traceparent"]
            .flatMap((name) => {
              const value = response.headers.get(name);
              return value ? [[name, value]] : [];
            }),
        );
        console.log("[flutterwave-recipients] create: Flutterwave error", {
          status: response.status,
          headers: diagnosticHeaders,
          body: data,
        });
        const mapped = mapValidationError(payload.receiving_method, data);
        await serviceClient
          .from("recipients")
          .update({
            verification_status: "needs_attention",
            validation_error_code: mapped.code,
            validation_error_message: mapped.message,
          })
          .eq("id", payload.recipient_id)
          .eq("user_id", userId);
        return jsonResponse({
          success: false,
          error: mapped.message,
          error_code: mapped.code,
        }, response.status);
      }

      const flwRecipientId = data?.data?.id ?? null;
      const flwRecipientType = data?.data?.type ?? recipientType;
      const accountName = extractAccountName(payload.receiving_method, data);

      const updateData: Record<string, unknown> = {
        flutterwave_recipient_id: flwRecipientId,
        flutterwave_recipient_type: flwRecipientType,
        verification_status: "verified",
        validation_error_code: null,
        validation_error_message: null,
      };

      if (accountName) {
        updateData.flutterwave_account_name = accountName;
      }

      await serviceClient
        .from("recipients")
        .update(updateData)
        .eq("id", payload.recipient_id)
        .eq("user_id", userId);

      return jsonResponse({
        success: true,
        recipient_id: flwRecipientId,
        recipient_type: flwRecipientType,
        account_name: accountName,
        flutterwave_response: data,
      });
    }

    // =======================================================
    // UPDATE RECIPIENT (re-create when banking details change)
    // =======================================================
    if (req.method === "POST" && action === "update") {
      let payload: {
        recipient_id: string;
        receiving_method: string;
        currency: string;
        mobile_money?: { network: string; msisdn: string; country: string };
        bank_account?: { account_number: string; bank_code: string; country: string };
      };
      try { payload = await req.json(); } catch {
        return jsonResponse({ success: false, error: "Invalid JSON request body" }, 400);
      }

      if (!payload.recipient_id || !payload.receiving_method || !payload.currency) {
        return jsonResponse({ success: false, error: "Missing required fields" }, 400);
      }

      const { data: recipientRow, error: recipientLookupError } = await serviceClient
        .from("recipients")
        .select("id, user_id, name, receiving_method, bank_code, account_number, country")
        .eq("id", payload.recipient_id)
        .eq("user_id", userId)
        .maybeSingle();

      if (recipientLookupError || !recipientRow) {
        console.log("[flutterwave-recipients] update: recipient not found", payload.recipient_id, recipientLookupError?.message);
        return jsonResponse({ success: false, error: "Recipient not found" }, 404);
      }

      const recipientType = getRecipientType(payload.receiving_method, payload.currency);
      if (!recipientType) {
        return jsonResponse({
          success: false,
          error: "The selected receiving method is not available for this currency.",
        }, 400);
      }
      const recipientBody = buildRecipientBody(
        payload.receiving_method, payload.currency, payload.mobile_money, payload.bank_account, recipientType, recipientRow.name,
      );

      if (!recipientBody) {
        return jsonResponse({
          success: false,
          error: "Missing payout details for the selected receiving method",
        }, 400);
      }

      const idempotencyKey = `SENDA-RECIPIENT-${payload.recipient_id}`;
      console.log("[flutterwave-recipients] update: recipient_id:", payload.recipient_id, "type:", recipientType, "idempotency:", idempotencyKey);
      // TEMPORARY DIAGNOSTIC: confirm the exact outbound network/currency/type (no phone/account/name values).
      console.log("[flutterwave-recipients] update: outbound", {
        type: recipientType,
        currency: payload.currency,
        country: payload.mobile_money?.country ?? payload.bank_account?.country ?? null,
        mobile_money_network: payload.mobile_money?.network ?? null,
      });

      const response = await fetch(`${FLW_BASE_URL}/transfers/recipients`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Trace-Id": crypto.randomUUID(),
          "X-Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify(recipientBody),
      });

      const text = await response.text();
      let data: any = {};
      try { data = text ? JSON.parse(text) : {}; } catch { data = { raw_response: text }; }

      if (!response.ok) {
        const diagnosticHeaders = Object.fromEntries(
          ["x-request-id", "x-trace-id", "x-reference-id", "x-correlation-id", "traceparent"]
            .flatMap((name) => {
              const value = response.headers.get(name);
              return value ? [[name, value]] : [];
            }),
        );
        console.log("[flutterwave-recipients] update: Flutterwave error", {
          status: response.status,
          headers: diagnosticHeaders,
          body: data,
        });
        const mapped = mapValidationError(payload.receiving_method, data);
        await serviceClient
          .from("recipients")
          .update({
            verification_status: "needs_attention",
            validation_error_code: mapped.code,
            validation_error_message: mapped.message,
          })
          .eq("id", payload.recipient_id)
          .eq("user_id", userId);
        return jsonResponse({
          success: false,
          error: mapped.message,
          error_code: mapped.code,
        }, response.status);
      }

      const flwRecipientId = data?.data?.id ?? null;
      const flwRecipientType = data?.data?.type ?? recipientType;
      const accountName = extractAccountName(payload.receiving_method, data);

      const updateData: Record<string, unknown> = {
        flutterwave_recipient_id: flwRecipientId,
        flutterwave_recipient_type: flwRecipientType,
        verification_status: "verified",
        validation_error_code: null,
        validation_error_message: null,
      };

      if (accountName) {
        updateData.flutterwave_account_name = accountName;
      }

      await serviceClient
        .from("recipients")
        .update(updateData)
        .eq("id", payload.recipient_id)
        .eq("user_id", userId);

      return jsonResponse({
        success: true,
        recipient_id: flwRecipientId,
        recipient_type: flwRecipientType,
        account_name: accountName,
        flutterwave_response: data,
      });
    }

    return jsonResponse({
      success: false,
      error: "Unsupported recipient operation",
      supported_actions: ["create", "update"],
    }, 400);
  } catch (error) {
    console.error("Flutterwave recipients error:", error);
    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : "Unexpected error",
    }, 500);
  }
});

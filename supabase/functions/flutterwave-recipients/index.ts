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

function getRecipientType(receivingMethod: string, currency: string): string {
  const suffix = (currency || "").toLowerCase();
  if (receivingMethod === "mobile_money") return `mobile_money_${suffix}`;
  if (receivingMethod === "bank_account") return `bank_${suffix}`;
  return suffix;
}

function buildRecipientBody(
  receivingMethod: string,
  mobileMoney: { network: string; msisdn: string; country: string } | undefined,
  bankAccount: { account_number: string; bank_code: string; country: string } | undefined,
  recipientType: string,
): Record<string, unknown> | null {
  const body: Record<string, unknown> = { type: recipientType };

  if (receivingMethod === "mobile_money" && mobileMoney) {
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

      const recipientType = getRecipientType(payload.receiving_method, payload.currency);
      const recipientBody = buildRecipientBody(
        payload.receiving_method, payload.mobile_money, payload.bank_account, recipientType,
      );

      if (!recipientBody) {
        return jsonResponse({
          success: false,
          error: "Missing payout details for the selected receiving method",
        }, 400);
      }

      const idempotencyKey = `SENDA-RECIPIENT-${payload.recipient_id}`;
      console.log("[flutterwave-recipients] create: recipient_id:", payload.recipient_id, "type:", recipientType, "idempotency:", idempotencyKey);

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
        return jsonResponse({
          success: false,
          error: data?.message ?? data?.error?.message ?? `Flutterwave returned ${response.status}`,
          flutterwave_response: data,
        }, response.status);
      }

      const flwRecipientId = data?.data?.id ?? null;
      const flwRecipientType = data?.data?.type ?? recipientType;
      const accountName = extractAccountName(payload.receiving_method, data);

      const updateData: Record<string, unknown> = {
        flutterwave_recipient_id: flwRecipientId,
        flutterwave_recipient_type: flwRecipientType,
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

      const recipientType = getRecipientType(payload.receiving_method, payload.currency);
      const recipientBody = buildRecipientBody(
        payload.receiving_method, payload.mobile_money, payload.bank_account, recipientType,
      );

      if (!recipientBody) {
        return jsonResponse({
          success: false,
          error: "Missing payout details for the selected receiving method",
        }, 400);
      }

      const idempotencyKey = `SENDA-RECIPIENT-${payload.recipient_id}`;
      console.log("[flutterwave-recipients] update: recipient_id:", payload.recipient_id, "type:", recipientType, "idempotency:", idempotencyKey);

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
        console.log("[flutterwave-recipients] update: Flutterwave returned", response.status);
        return jsonResponse({
          success: false,
          error: data?.message ?? data?.error?.message ?? `Flutterwave returned ${response.status}`,
          flutterwave_response: data,
        }, response.status);
      }

      const flwRecipientId = data?.data?.id ?? null;
      const flwRecipientType = data?.data?.type ?? recipientType;
      const accountName = extractAccountName(payload.receiving_method, data);

      const updateData: Record<string, unknown> = {
        flutterwave_recipient_id: flwRecipientId,
        flutterwave_recipient_type: flwRecipientType,
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

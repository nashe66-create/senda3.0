import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.58.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const TOKEN_URL = "https://idp.flutterwave.com/realms/flutterwave/protocol/openid-connect/token";
const FLW_BASE_URL = (() => {
  const v = Deno.env.get("FLW_BASE_URL") ?? "";
  return /^https:\/\/[^ ]*flutterwave\.com/i.test(v) ? v : "https://developersandbox-api.flutterwave.com";
})();

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

async function flutterwaveRequest(accessToken: string, method: string, path: string, body?: unknown, idempotencyKey?: string) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-Trace-Id": crypto.randomUUID(),
  };
  if (idempotencyKey) {
    headers["X-Idempotency-Key"] = idempotencyKey;
  } else if (method === "POST") {
    headers["X-Idempotency-Key"] = crypto.randomUUID();
  }

  const response = await fetch(`${FLW_BASE_URL}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  const text = await response.text();
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw_response: text }; }

  return { response, data };
}



Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Supabase server configuration is missing");
    }
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ success: false, error: "Unauthorized" }, 401);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return jsonResponse({ success: false, error: "Unauthorized" }, 401);
    }
    const userId = user.id;

    const serviceClient = createClient(supabaseUrl, serviceRoleKey);

    let payload: {
      transaction_id: string;
      type: "otp" | "pin" | "address";
      otp?: { code: string };
      pin?: { nonce: string; encrypted_pin: string };
      address?: Record<string, string>;
    };
    try { payload = await req.json(); } catch {
      return jsonResponse({ success: false, error: "Invalid JSON request body" }, 400);
    }

    if (!payload.transaction_id || !payload.type) {
      return jsonResponse({ success: false, error: "Missing transaction_id or type" }, 400);
    }

    // Look up the charge ID from the transaction
    const { data: transaction } = await supabase
      .from("transactions")
      .select("flutterwave_charge_id, next_action_type, plan_id")
      .eq("id", payload.transaction_id)
      .eq("user_id", userId)
      .maybeSingle();

    if (!transaction) {
      return jsonResponse({ success: false, error: "Transaction not found" }, 404);
    }

    if (!transaction.flutterwave_charge_id) {
      return jsonResponse({ success: false, error: "No charge ID found for this transaction" }, 400);
    }

    // Build authorization payload based on type
    let authorization: Record<string, unknown> = {};
    if (payload.type === "otp" && payload.otp) {
      authorization = { type: "otp", otp: { code: payload.otp.code } };
    } else if (payload.type === "pin" && payload.pin) {
      authorization = {
        type: "pin",
        pin: payload.pin.encrypted_pin,
      };
    } else if (payload.type === "address" && payload.address) {
      authorization = { type: "avs", avs: { address: payload.address } };
    } else {
      return jsonResponse({ success: false, error: "Invalid authorization type or missing fields" }, 400);
    }

    const accessToken = await getAccessToken();
    const idempotencyKey = `SENDA-PAY-AUTH-${payload.transaction_id}`;
    const { response, data } = await flutterwaveRequest(
      accessToken, "PUT", `/charges/${transaction.flutterwave_charge_id}`,
      { authorization }, idempotencyKey
    );

    // Update next_action_type on the transaction
    const nextActionType = data?.data?.next_action?.type ?? null;
    const updateData: Record<string, unknown> = { next_action_type: nextActionType };

    if (data?.data?.status === "failed") {
      updateData.status = "failed";
    }

    if (data?.data?.card?.last_4) {
      updateData.card_last4 = data.data.card.last_4;
    }
    if (data?.data?.card?.network) {
      updateData.card_network = data.data.card.network;
    }

    await serviceClient
      .from("transactions")
      .update(updateData)
      .eq("id", payload.transaction_id);

    if (data?.data?.status === "failed" && transaction.plan_id) {
      await serviceClient
        .from("plans")
        .update({
          payment_status: "failed",
          status: "payment_failed",
        })
        .eq("id", transaction.plan_id)
        .in("status", ["awaiting_payment", "payment_processing"]);
    }

    return jsonResponse({
      success: response.ok,
      status: data?.data?.status ?? null,
      next_action: data?.data?.next_action ?? null,
    }, response.status);
  } catch (error) {
    console.error("Flutterwave charge-authorize error:", error);
    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : "Unexpected error",
    }, 500);
  }
});

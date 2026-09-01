import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.58.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
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

async function flutterwaveRequest(accessToken: string, method: string, path: string, body?: unknown, idempotencyKey?: string) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-Trace-Id": crypto.randomUUID(),
  };
  if (method === "POST") headers["X-Idempotency-Key"] = idempotencyKey ?? crypto.randomUUID();

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

async function getWalletBalance(accessToken: string, currency: string): Promise<number | null> {
  const { response, data } = await flutterwaveRequest(accessToken, "GET", `/wallets/${currency}/balance`);
  const balance = data?.data?.available_balance ?? data?.data?.balance;
  if (!response.ok || balance === undefined || balance === null) return null;
  return Number(balance);
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
        supported_actions: ["create", "confirm", "cancel", "get", "list"],
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

    return jsonResponse({
      success: false,
      error: "This endpoint is disabled. Use senda-orchestrate for the payout lifecycle.",
    }, 410);

    // =======================================================
    // CREATE TRANSFER
    // POST ?action=create
    // Uses POST /transfers with recipient_id when available,
    // falls back to POST /direct-transfers with inline recipient details.
    // =======================================================
    if (req.method === "POST" && action === "create") {
      let payload: {
        commitment_id: string;
        action: "deferred" | "instant";
        type: string;
        source_currency: string;
        destination_currency: string;
        amount_applies_to: string;
        amount_value: number;
        recipient_id?: string;
        recipient?: {
          name: { first: string; last: string };
          mobile_money: { network: string; msisdn: string; country: string };
        };
        bank?: {
          name: { first: string; last: string };
          bank: { account_number: string; code: string };
        };
        narration?: string;
      };
      try { payload = await req.json(); } catch {
        return jsonResponse({ success: false, error: "Invalid JSON request body" }, 400);
      }

      if (!payload.commitment_id || !payload.amount_value) {
        return jsonResponse({ success: false, error: "Missing required fields" }, 400);
      }

      if (!payload.recipient_id && !payload.recipient && !payload.bank) {
        return jsonResponse({ success: false, error: "Missing recipient details" }, 400);
      }

      // Verify the user has a sender ID (required for GBP-source transfers)
      const { data: profile } = await supabase
        .from("profiles")
        .select("flutterwave_sender_id")
        .eq("id", userId)
        .maybeSingle();

      if (!profile?.flutterwave_sender_id) {
        return jsonResponse({
          success: false,
          error: "KYC not completed. Please complete identity verification before sending money.",
        }, 403);
      }

      // Generate reference and deterministic idempotency key, store on commitment BEFORE the API call
      const reference = `senda-${crypto.randomUUID().substring(0, 18)}`;
      const idempotencyKey = `SENDA-PAYOUT-${payload.commitment_id}`;

      const { error: commitError } = await serviceClient
        .from("commitments")
        .update({
          idempotency_key: idempotencyKey,
          transfer_action: payload.action,
          status: "processing",
        })
        .eq("id", payload.commitment_id)
        .eq("user_id", userId);

      if (commitError) {
        console.error("Failed to store idempotency key:", commitError);
      }

      // Build transfer payload — use /transfers with recipient_id when available,
      // fall back to /direct-transfers with inline recipient details.
      let transferPath: string;
      let transferPayload: Record<string, unknown>;

      if (payload.recipient_id) {
        // Use the cleaner /transfers endpoint with a pre-created recipient
        transferPath = "/transfers";
        transferPayload = {
          action: payload.action,
          type: payload.type,
          reference,
          narration: payload.narration || "Senda transfer",
          payment_instruction: {
            source_currency: payload.source_currency,
            amount: {
              applies_to: payload.amount_applies_to,
              value: payload.amount_value,
            },
            recipient_id: payload.recipient_id,
            destination_currency: payload.destination_currency,
            sender_id: profile.flutterwave_sender_id,
          },
        };
      } else {
        // Fall back to inline /direct-transfers
        transferPath = "/direct-transfers";
        const recipientField: Record<string, unknown> = {};

        if (payload.recipient) {
          recipientField.name = payload.recipient.name;
          recipientField.mobile_money = payload.recipient.mobile_money;
        } else if (payload.bank) {
          recipientField.name = payload.bank.name;
          recipientField.bank = payload.bank.bank;
        }

        transferPayload = {
          action: payload.action,
          type: payload.type,
          reference,
          narration: payload.narration || "Senda transfer",
          payment_instruction: {
            source_currency: payload.source_currency,
            amount: {
              applies_to: payload.amount_applies_to,
              value: payload.amount_value,
            },
            recipient: recipientField,
            destination_currency: payload.destination_currency,
            sender_id: profile.flutterwave_sender_id,
          },
        };
      }

      const { response, data } = await flutterwaveRequest(
        accessToken, "POST", transferPath, transferPayload, idempotencyKey
      );

      // Store the transfer ID on the commitment
      const transferId = data?.data?.id ?? null;
      const transferStatus = data?.data?.status ?? null;

      if (transferId) {
        await serviceClient
          .from("commitments")
          .update({
            flutterwave_transfer_id: String(transferId),
            status: transferStatus === "NEW" ? "processing" : (transferStatus?.toLowerCase() === "completed" ? "completed" : "processing"),
          })
          .eq("id", payload.commitment_id)
          .eq("user_id", userId);
      } else if (!response.ok) {
        await serviceClient
          .from("commitments")
          .update({
            status: "failed",
            failure_reason: data?.message ?? "Transfer creation failed",
          })
          .eq("id", payload.commitment_id)
          .eq("user_id", userId);
      }

      return jsonResponse({
        success: response.ok,
        transfer_id: transferId,
        reference,
        status: transferStatus,
        flutterwave_response: data,
      }, response.status);
    }

    // =======================================================
    // CONFIRM TRANSFER (fire it — action: instant)
    // POST ?action=confirm
    // =======================================================
    if (req.method === "POST" && action === "confirm") {
      let payload: { commitment_id: string };
      try { payload = await req.json(); } catch {
        return jsonResponse({ success: false, error: "Invalid JSON request body" }, 400);
      }

      if (!payload.commitment_id) {
        return jsonResponse({ success: false, error: "Missing commitment_id" }, 400);
      }

      const { data: commitment } = await supabase
        .from("commitments")
        .select("flutterwave_transfer_id, amount_gbp, destination_currency, amount_destination, user_id")
        .eq("id", payload.commitment_id)
        .eq("user_id", userId)
        .maybeSingle();

      if (!commitment) {
        return jsonResponse({ success: false, error: "Commitment not found" }, 404);
      }

      if (!commitment.flutterwave_transfer_id) {
        return jsonResponse({ success: false, error: "No transfer ID found for this commitment" }, 400);
      }

      // Server-side wallet balance check before firing
      const balance = await getWalletBalance(accessToken, "GBP");
      if (balance !== null && balance < Number(commitment.amount_gbp)) {
        return jsonResponse({
          success: false,
          error: "Insufficient wallet balance to complete this transfer",
          wallet_balance: balance,
          required: Number(commitment.amount_gbp),
        }, 402);
      }

      const { response, data } = await flutterwaveRequest(
        accessToken, "PUT", `/transfers/${commitment.flutterwave_transfer_id}`,
        { initiate: true },
      );

      const transferStatus = data?.data?.status ?? null;
      let dbStatus = "processing";
      if (transferStatus?.toLowerCase() === "completed" || transferStatus?.toLowerCase() === "successful") {
        dbStatus = "completed";
      } else if (transferStatus?.toLowerCase() === "failed" || transferStatus?.toLowerCase() === "cancelled") {
        dbStatus = "failed";
      }

      await serviceClient
        .from("commitments")
        .update({
          status: dbStatus,
          failure_reason: dbStatus === "failed" ? (data?.message ?? null) : null,
        })
        .eq("id", payload.commitment_id)
        .eq("user_id", userId);

      return jsonResponse({
        success: response.ok,
        status: transferStatus,
        flutterwave_response: data,
      }, response.status);
    }

    // =======================================================
    // CANCEL TRANSFER (close it)
    // POST ?action=cancel
    // =======================================================
    if (req.method === "POST" && action === "cancel") {
      let payload: { commitment_id: string };
      try { payload = await req.json(); } catch {
        return jsonResponse({ success: false, error: "Invalid JSON request body" }, 400);
      }

      if (!payload.commitment_id) {
        return jsonResponse({ success: false, error: "Missing commitment_id" }, 400);
      }

      const { data: commitment } = await supabase
        .from("commitments")
        .select("flutterwave_transfer_id")
        .eq("id", payload.commitment_id)
        .eq("user_id", userId)
        .maybeSingle();

      if (!commitment) {
        return jsonResponse({ success: false, error: "Commitment not found" }, 404);
      }

      if (!commitment.flutterwave_transfer_id) {
        return jsonResponse({ success: false, error: "No transfer ID found for this commitment" }, 400);
      }

      const { response, data } = await flutterwaveRequest(
        accessToken, "PUT", `/transfers/${commitment.flutterwave_transfer_id}`,
        { action: "close" },
      );

      await serviceClient
        .from("commitments")
        .update({ status: "failed", failure_reason: "Transfer cancelled by user" })
        .eq("id", payload.commitment_id)
        .eq("user_id", userId);

      return jsonResponse({
        success: response.ok,
        flutterwave_response: data,
      }, response.status);
    }

    // =======================================================
    // GET TRANSFER
    // GET ?action=get&id=...
    // =======================================================
    if (req.method === "GET" && action === "get") {
      const id = url.searchParams.get("id");
      if (!id) {
        return jsonResponse({ success: false, error: "Transfer ID is required" }, 400);
      }

      const { response, data } = await flutterwaveRequest(accessToken, "GET", `/transfers/${encodeURIComponent(id)}`);

      return jsonResponse({
        success: response.ok,
        transfer: data?.data ?? null,
        flutterwave_response: data,
      }, response.ok ? 200 : 502);
    }

    // =======================================================
    // LIST TRANSFERS
    // GET ?action=list
    // =======================================================
    if (req.method === "GET" && action === "list") {
      const params = new URLSearchParams();
      const allowedParams = ["next", "previous", "size", "bulk_id", "recipient_id", "sender_id", "destination_currency", "source_currency", "action", "type", "status", "from", "to"];
      for (const name of allowedParams) {
        const value = url.searchParams.get(name);
        if (value) params.set(name, value);
      }
      const query = params.toString();
      const path = query ? `/transfers?${query}` : "/transfers";

      const { response, data } = await flutterwaveRequest(accessToken, "GET", path);

      return jsonResponse({
        success: response.ok,
        transfers: data?.data ?? null,
        flutterwave_response: data,
      }, response.ok ? 200 : 502);
    }

    return jsonResponse({
      success: false,
      error: "Unsupported transfer operation",
      supported_actions: ["create", "confirm", "cancel", "get", "list"],
    }, 400);
  } catch (error) {
    console.error("Flutterwave transfers error:", error);
    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : "Unexpected error",
    }, 500);
  }
});

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.58.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
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

function customerFriendlyFailure(reason: string | null | undefined): string {
  if (!reason) return "The transfer could not be completed. Please try again or contact Senda support.";
  const lower = reason.toLowerCase();
  if (lower.includes("insufficient") && lower.includes("balance")) return "Senda's wallet balance was insufficient to complete this transfer. Please try again later.";
  if (lower.includes("recipient") || lower.includes("account")) return "The recipient account details may be incorrect. Please verify the recipient information and try again.";
  if (lower.includes("network") || lower.includes("timeout") || lower.includes("unavailable")) return "A network issue prevented the transfer. Please try again.";
  if (lower.includes("compliance") || lower.includes("verification") || lower.includes("kyc")) return "Additional verification is required for this transfer. Please contact Senda support.";
  return "The transfer could not be completed. Please try a different payout method or contact Senda support.";
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
    const supabase = createClient(supabaseUrl, serviceRoleKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return jsonResponse({ success: false, error: "Unauthorized" }, 401);
    }
    const userId = user.id;
    const serviceClient = createClient(supabaseUrl, serviceRoleKey);

    const url = new URL(req.url);
    const commitmentId = url.searchParams.get("commitment_id");

    if (!commitmentId) {
      return jsonResponse({ success: false, error: "Missing commitment_id parameter" }, 400);
    }

    // Look up the transfer ID from the commitment
    const { data: commitment } = await supabase
      .from("commitments")
      .select("flutterwave_transfer_id, status, user_id")
      .eq("id", commitmentId)
      .eq("user_id", userId)
      .maybeSingle();

    if (!commitment) {
      return jsonResponse({ success: false, error: "Commitment not found" }, 404);
    }

    if (!commitment.flutterwave_transfer_id) {
      return jsonResponse({ success: false, error: "No transfer ID found for this commitment" }, 400);
    }

    const accessToken = await getAccessToken();

    const response = await fetch(
      `${FLW_BASE_URL}/transfers/${encodeURIComponent(commitment.flutterwave_transfer_id)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Trace-Id": crypto.randomUUID(),
        },
      },
    );

    const text = await response.text();
    let data: any = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw_response: text }; }

    if (!response.ok) {
      return jsonResponse({
        success: false,
        error: data?.message ?? "Failed to fetch transfer status",
        flutterwave_response: data,
      }, response.status);
    }

    const transferData = data?.data ?? {};
    const transferStatus = String(transferData.status ?? "").toUpperCase();

    // Map Flutterwave status to our DB status
    let dbStatus = commitment.status;
    if (transferStatus === "COMPLETED" || transferStatus === "SUCCESSFUL") {
      dbStatus = "completed";
    } else if (transferStatus === "FAILED" || transferStatus === "CANCELLED") {
      dbStatus = "failed";
    }

    // Update commitment if status changed
    if (dbStatus !== commitment.status) {
      const updateData: Record<string, unknown> = { status: dbStatus, provider_status: transferStatus };
      if (dbStatus === "failed") {
        const rawReason = transferData?.reversal?.reason ?? "Transfer failed";
        updateData.failure_reason = rawReason;
        updateData.failure_reason_display = customerFriendlyFailure(rawReason);
      }
      await serviceClient
        .from("commitments")
        .update(updateData)
        .eq("id", commitmentId)
        .eq("user_id", userId);
    }

    return jsonResponse({
      success: true,
      status: dbStatus,
      transfer_status: transferStatus,
      flutterwave_response: data,
    });
  } catch (error) {
    console.error("Transfer status error:", error);
    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : "Unexpected error",
    }, 500);
  }
});

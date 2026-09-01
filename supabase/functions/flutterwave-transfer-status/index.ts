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

function mapTransferStatus(providerStatus: string): string {
  if (providerStatus === "COMPLETED" || providerStatus === "SUCCESSFUL") return "completed";
  if (providerStatus === "FAILED" || providerStatus === "CANCELLED") return "failed";
  if (providerStatus === "NEW" || providerStatus === "PENDING") return "submitted";
  return "processing";
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

    // Find the latest non-terminal attempt. A missing provider ID is an
    // unknown outcome, never evidence that Flutterwave did not create it.
    const { data: commitment } = await supabase
      .from("commitments")
      .select("flutterwave_transfer_id, status, user_id")
      .eq("id", commitmentId)
      .eq("user_id", userId)
      .maybeSingle();

    if (!commitment) {
      return jsonResponse({ success: false, error: "Commitment not found" }, 404);
    }

    const activeStatuses = ["creating_unknown", "submitted", "confirming_unknown", "processing", "reconciliation_required"];
    const { data: attempt } = await serviceClient
      .from("transfer_attempts")
      .select("id, provider_transfer_id, status")
      .eq("commitment_id", commitmentId)
      .in("status", activeStatuses)
      .order("attempt_number", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!attempt?.provider_transfer_id) {
      if (attempt) {
        await serviceClient.from("transfer_attempts")
          .update({ status: "reconciliation_required", last_checked_at: new Date().toISOString() })
          .eq("id", attempt.id).in("status", activeStatuses);
        await serviceClient.from("commitments")
          .update({ status: "reconciliation_required" })
          .eq("id", commitmentId).in("status", activeStatuses);
      }
      return jsonResponse({
        success: false,
        error: "This payout has no recorded provider transfer ID and requires provider-reference reconciliation. No retry was created.",
      }, 409);
    }

    const accessToken = await getAccessToken();

    const response = await fetch(
      `${FLW_BASE_URL}/transfers/${encodeURIComponent(attempt.provider_transfer_id)}`,
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

    // A verified provider response resolves an unknown attempt without retrying it.
    const dbStatus = mapTransferStatus(transferStatus);

    // Update commitment if status changed
    if (dbStatus !== attempt.status) {
      const attemptUpdate: Record<string, unknown> = { status: dbStatus, provider_status: transferStatus };
      const commitmentUpdate: Record<string, unknown> = { status: dbStatus, provider_status: transferStatus };
      if (dbStatus === "failed") {
        const rawReason = transferData?.reversal?.reason ?? "Transfer failed";
        attemptUpdate.error_message = rawReason;
        commitmentUpdate.failure_reason = rawReason;
        commitmentUpdate.failure_reason_display = customerFriendlyFailure(rawReason);
      }
      await serviceClient
        .from("transfer_attempts")
        .update(attemptUpdate)
        .eq("id", attempt.id)
        .in("status", activeStatuses);

      await serviceClient
        .from("commitments")
        .update(commitmentUpdate)
        .eq("id", commitmentId)
        .eq("user_id", userId)
        .in("status", activeStatuses);
    }

    await serviceClient.from("transfer_attempts")
      .update({ last_checked_at: new Date().toISOString() }).eq("id", attempt.id);

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

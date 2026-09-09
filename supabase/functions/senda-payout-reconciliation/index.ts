import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.58.0";

const TOKEN_URL = "https://idp.flutterwave.com/realms/flutterwave/protocol/openid-connect/token";
const FLW_BASE_URL = (() => {
  const value = Deno.env.get("FLW_BASE_URL") ?? "";
  return /^https:\/\/[^ ]*flutterwave\.com/i.test(value)
    ? value
    : "https://developersandbox-api.flutterwave.com";
})();
const ACTIVE_STATUSES = [
  "creating_unknown",
  "submitted",
  "confirming_unknown",
  "processing",
  "reconciliation_required",
];
const MAX_ATTEMPTS_PER_RUN = 50;

function jsonResponse(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function getAccessToken(): Promise<string> {
  const clientId = Deno.env.get("FLW_CLIENT_ID");
  const clientSecret = Deno.env.get("FLW_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new Error("Flutterwave credentials are not configured");

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

function mapProviderStatus(providerStatus: string): "completed" | "failed" | "processing" {
  const status = providerStatus.toUpperCase();
  if (status === "COMPLETED" || status === "SUCCESSFUL") return "completed";
  if (status === "FAILED" || status === "CANCELLED") return "failed";
  return "processing";
}

function customerFriendlyFailure(reason: string | null | undefined): string {
  if (!reason) return "The transfer could not be completed. Please try again or contact Senda support.";
  const lower = reason.toLowerCase();
  if (lower.includes("insufficient") && lower.includes("balance")) {
    return "Senda's wallet balance was insufficient to complete this transfer. Please try again later.";
  }
  if (lower.includes("recipient") || lower.includes("account")) {
    return "The recipient account details may be incorrect. Please verify the recipient information and try again.";
  }
  if (lower.includes("network") || lower.includes("timeout") || lower.includes("unavailable")) {
    return "A network issue prevented the transfer. Please try again.";
  }
  if (lower.includes("compliance") || lower.includes("verification") || lower.includes("kyc")) {
    return "Additional verification is required for this transfer. Please contact Senda support.";
  }
  return "The transfer could not be completed. Please try a different payout method or contact Senda support.";
}

async function fetchTransfer(accessToken: string, transferId: string) {
  const response = await fetch(`${FLW_BASE_URL}/transfers/${encodeURIComponent(transferId)}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "X-Trace-Id": crypto.randomUUID(),
    },
  });
  const text = await response.text();
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw_response: text }; }
  return { response, data };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return jsonResponse({ success: false, error: "Method not allowed" }, 405);

  const configuredSecret = Deno.env.get("SENDA_RECONCILIATION_CRON_SECRET");
  if (!configuredSecret || req.headers.get("x-senda-cron-secret") !== configuredSecret) {
    return jsonResponse({ success: false, error: "Unauthorized" }, 401);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) throw new Error("Supabase server configuration is missing");

    const serviceClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: attempts, error: attemptsError } = await serviceClient
      .from("transfer_attempts")
      .select("id, commitment_id, provider_transfer_id, status")
      .eq("provider", "flutterwave")
      .in("status", ACTIVE_STATUSES)
      .not("provider_transfer_id", "is", null)
      .order("last_checked_at", { ascending: true, nullsFirst: true })
      .limit(MAX_ATTEMPTS_PER_RUN);

    if (attemptsError) throw attemptsError;
    if (!attempts?.length) return jsonResponse({ success: true, checked: 0, completed: 0, failed: 0, processing: 0 });

    const accessToken = await getAccessToken();
    const summary = { checked: 0, completed: 0, failed: 0, processing: 0, errors: 0 };

    for (const attempt of attempts) {
      try {
        const { response, data } = await fetchTransfer(accessToken, String(attempt.provider_transfer_id));
        if (!response.ok) {
          summary.errors += 1;
          continue;
        }

        const transferData = data?.data ?? {};
        const providerStatus = String(transferData.status ?? "").toUpperCase();
        const nextStatus = mapProviderStatus(providerStatus);
        const failureReason = nextStatus === "failed"
          ? (transferData?.reversal?.reason ?? transferData?.message ?? "Transfer failed")
          : null;

        const { data: updatedAttempt } = await serviceClient
          .from("transfer_attempts")
          .update({
            provider_status: providerStatus,
            status: nextStatus,
            last_checked_at: new Date().toISOString(),
            completed_at: nextStatus === "completed" ? new Date().toISOString() : null,
            failed_at: nextStatus === "failed" ? new Date().toISOString() : null,
            error_message: failureReason,
          })
          .eq("id", attempt.id)
          .in("status", ACTIVE_STATUSES)
          .select("id")
          .maybeSingle();

        if (!updatedAttempt) continue;

        await serviceClient
          .from("commitments")
          .update({
            flutterwave_transfer_id: String(attempt.provider_transfer_id),
            provider_status: providerStatus,
            status: nextStatus,
            failure_reason: failureReason,
            failure_reason_display: nextStatus === "failed" ? customerFriendlyFailure(failureReason) : null,
          })
          .eq("id", attempt.commitment_id)
          .in("status", ACTIVE_STATUSES);

        summary.checked += 1;
        summary[nextStatus] += 1;
      } catch (error) {
        summary.errors += 1;
        console.error("Payout reconciliation attempt failed:", attempt.id, error);
      }
    }

    return jsonResponse({ success: true, ...summary });
  } catch (error) {
    console.error("Payout reconciliation worker failed:", error);
    return jsonResponse({ success: false, error: "Payout reconciliation failed" }, 500);
  }
});

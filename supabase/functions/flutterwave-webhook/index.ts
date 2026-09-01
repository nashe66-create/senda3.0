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

async function flutterwaveGet(accessToken: string, path: string) {
  const response = await fetch(`${FLW_BASE_URL}${path}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Trace-Id": crypto.randomUUID(),
    },
  });

  const text = await response.text();
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw_response: text }; }

  return { ok: response.ok, data };
}

async function verifySignature(rawBody: string, signature: string, secretHash: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secretHash);
  const bodyData = encoder.encode(rawBody);
  const cryptoKey = await crypto.subtle.importKey("raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signatureBuffer = await crypto.subtle.sign("HMAC", cryptoKey, bodyData);
  const signatureBytes = new Uint8Array(signatureBuffer);
  let binary = "";
  for (const byte of signatureBytes) binary += String.fromCharCode(byte);
  const expectedSignature = btoa(binary);
  return expectedSignature === signature;
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

async function webhookIdentity(event: any, eventType: string, data: any): Promise<string> {
  if (event?.id ?? event?.webhook_id) return String(event.id ?? event.webhook_id);
  const stableFields = [eventType, data?.id ?? data?.transfer_id ?? "", data?.reference ?? data?.transfer_reference ?? "", data?.status ?? "", event?.created_at ?? ""].join("|");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stableFields));
  return `fallback:${Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function findTransferAttempt(supabase: any, transferId: string | null, reference: string | null) {
  let byTransfer: any = null;
  let byReference: any = null;
  if (transferId) {
    const { data } = await supabase.from("transfer_attempts").select("id, commitment_id, status")
      .eq("provider", "flutterwave").eq("provider_transfer_id", String(transferId)).maybeSingle();
    byTransfer = data;
  }
  if (reference) {
    const { data } = await supabase.from("transfer_attempts").select("id, commitment_id, status")
      .eq("provider", "flutterwave").eq("provider_reference", reference).maybeSingle();
    byReference = data;
  }
  if (byTransfer && byReference && byTransfer.id !== byReference.id) return null;
  return byTransfer ?? byReference;
}

async function applyVerifiedTransferStatus(supabase: any, transferId: string, reference: string | null, transferData: any) {
  const attempt = await findTransferAttempt(supabase, transferId, reference);
  if (!attempt) return false;
  const providerStatus = String(transferData?.status ?? "").toUpperCase();
  const nextStatus = providerStatus === "COMPLETED" || providerStatus === "SUCCESSFUL" ? "completed"
    : providerStatus === "FAILED" || providerStatus === "CANCELLED" ? "failed" : "processing";
  const error = nextStatus === "failed" ? (transferData?.reversal?.reason ?? "Transfer failed") : null;
  const activeStatuses = ["creating", "creating_unknown", "submitted", "confirming", "confirming_unknown", "processing", "reconciliation_required"];
  const { data: updated } = await supabase.from("transfer_attempts").update({
    provider_transfer_id: String(transferId), provider_status: providerStatus,
    status: nextStatus, last_checked_at: new Date().toISOString(),
    completed_at: nextStatus === "completed" ? new Date().toISOString() : null,
    failed_at: nextStatus === "failed" ? new Date().toISOString() : null,
    error_message: error,
  }).eq("id", attempt.id).in("status", activeStatuses).select("commitment_id").maybeSingle();
  if (!updated) return true;
  await supabase.from("commitments").update({
    flutterwave_transfer_id: String(transferId), provider_status: providerStatus, status: nextStatus,
    failure_reason: error, failure_reason_display: nextStatus === "failed" ? customerFriendlyFailure(error) : null,
  }).eq("id", updated.commitment_id).in("status", activeStatuses);
  return true;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const rawBody = await req.text();
    if (!rawBody) {
      return new Response(JSON.stringify({ error: "Empty webhook body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const secretHash = Deno.env.get("FLW_SECRET_HASH");
    if (!secretHash) {
      console.error("FLW_SECRET_HASH is not configured");
      return new Response(JSON.stringify({ error: "Webhook security is not configured" }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const signature = req.headers.get("flutterwave-signature");
    if (!signature) {
      console.error("Missing flutterwave-signature header");
      return new Response(JSON.stringify({ error: "Missing webhook signature" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const validSignature = await verifySignature(rawBody, signature, secretHash);
    if (!validSignature) {
      console.error("Invalid Flutterwave webhook signature");
      return new Response(JSON.stringify({ error: "Invalid webhook signature" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let event: any;
    try { event = JSON.parse(rawBody); } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON webhook payload" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const eventType = String(event?.type ?? "").toLowerCase();
    const data = event?.data ?? {};
    const webhookId = await webhookIdentity(event, eventType, data);

    console.log("Flutterwave webhook received:", JSON.stringify({
      event_type: eventType,
      webhook_id: webhookId,
    }));

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Supabase server configuration is missing");
    }
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Insert first; the primary key is the concurrency-safe deduplication claim.
    const { error: dedupError } = await supabase.from("flutterwave_webhook_events").insert({
      webhook_id: webhookId,
      event_type: eventType,
      payload: event,
    });
    if (dedupError) {
      if (dedupError.code === "23505") {
        return new Response(JSON.stringify({ received: true, duplicate: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw dedupError;
    }

    const accessToken = await getAccessToken();

    // =======================================================
    // CHARGE COMPLETED (card collection)
    // =======================================================
    if (eventType === "charge.completed") {
      const reference = data?.reference ?? data?.tx_ref ?? null;
      const chargeId = data?.id ?? null;

      if (reference) {
        // Re-verify via GET /charges/{id}
        if (chargeId) {
          const { ok, data: verifyData } = await flutterwaveGet(accessToken, `/charges/${chargeId}`);

          if (ok && verifyData?.data) {
            const chargeData = verifyData.data;
            const chargeStatus = String(chargeData.status ?? "").toLowerCase();

            if (chargeStatus === "succeeded") {
              const { data: transaction } = await supabase
                .from("transactions")
                .select("id, plan_id, amount_gbp, payment_reference")
                .eq("payment_reference", reference)
                .maybeSingle();

              if (transaction?.plan_id) {
                const { data: plan } = await supabase
                  .from("plans")
                  .select("id, status, quote_locked_at, customer_pays")
                  .eq("id", transaction.plan_id)
                  .maybeSingle();

                const amountMatches = Number(chargeData.amount) === Number(transaction.amount_gbp)
                  && plan && Math.abs(Number(chargeData.amount) - Number(plan.customer_pays)) <= 0.01;
                const referenceMatches = chargeData.reference === transaction.payment_reference;
                const currencyMatches = String(chargeData.currency ?? "GBP").toUpperCase() === "GBP";
                const fundingVerified = plan?.quote_locked_at && amountMatches && referenceMatches && currencyMatches;

                if (fundingVerified) {
                  const updateData: Record<string, unknown> = {
                    status: "successful",
                    completed_at: new Date().toISOString(),
                    flutterwave_charge_id: String(chargeId),
                  };
                  if (chargeData.card?.last_4) updateData.card_last4 = chargeData.card.last_4;
                  if (chargeData.card?.network) updateData.card_network = chargeData.card.network;
                  await supabase.from("transactions").update(updateData)
                    .eq("id", transaction.id)
                    .eq("status", "pending");
                  await supabase.from("plans").update({ payment_status: "successful", status: "funded" })
                    .eq("id", transaction.plan_id).in("status", ["awaiting_payment", "payment_processing"]);
                } else {
                  await supabase.from("transactions").update({ status: "failed" }).eq("id", transaction.id);
                  await supabase.from("plans").update({ payment_status: "failed", status: "payment_failed" })
                    .eq("id", transaction.plan_id).in("status", ["awaiting_payment", "payment_processing"]);
                }
              }
            } else if (chargeStatus === "failed") {
              await supabase
                .from("transactions")
                .update({ status: "failed" })
                .eq("payment_reference", reference)
                .eq("status", "pending");

              // Transition plan to payment_failed
              const { data: transaction } = await supabase
                .from("transactions")
                .select("plan_id")
                .eq("payment_reference", reference)
                .maybeSingle();

              if (transaction?.plan_id) {
                await supabase
                  .from("plans")
                  .update({
                    payment_status: "failed",
                    status: "payment_failed",
                  })
                  .eq("id", transaction.plan_id)
                  .in("status", ["awaiting_payment", "payment_processing"]);
              }
            }
          }
        }
      }
    }

    // =======================================================
    // TRANSFER DISBURSE (payout completed)
    // =======================================================
    if (eventType === "transfer.disburse") {
      const reference = data?.reference ?? data?.transfer_reference ?? null;
      const transferId = data?.id ?? data?.transfer_id ?? null;
      if (transferId) {
        const { ok, data: verifyData } = await flutterwaveGet(accessToken, `/transfers/${transferId}`);
        if (ok && verifyData?.data) {
          await applyVerifiedTransferStatus(supabase, String(transferId), reference, verifyData.data);
        }
      }

      if (false && reference) {
        // Re-verify via GET /transfers/{id}
        if (transferId) {
          const { ok, data: verifyData } = await flutterwaveGet(accessToken, `/transfers/${transferId}`);

          if (ok && verifyData?.data) {
            const transferData = verifyData.data;
            const transferStatus = String(transferData.status ?? "").toUpperCase();

            let dbStatus = "processing";
            if (transferStatus === "COMPLETED" || transferStatus === "SUCCESSFUL") {
              dbStatus = "completed";
            } else if (transferStatus === "FAILED" || transferStatus === "CANCELLED") {
              dbStatus = "failed";
            }

            const updateData: Record<string, unknown> = {
              status: dbStatus,
              provider_status: transferStatus,
              flutterwave_transfer_id: String(transferId),
            };
            if (dbStatus === "failed") {
              const rawReason = transferData?.reversal?.reason ?? "Transfer failed";
              updateData.failure_reason = rawReason;
              updateData.failure_reason_display = customerFriendlyFailure(rawReason);
            }

            await supabase
              .from("commitments")
              .update(updateData)
              .eq("id", reference)
              .or(`flutterwave_transfer_id.eq.${transferId}`);

            // The database trigger (recalc_plan_status_from_commitments) will
            // automatically recalculate the plan status based on commitment statuses.
          }
        }
      }
    }

    // =======================================================
    // TRANSFER REVERSAL (payout failed/reversed)
    // =======================================================
    if (eventType === "transfer.reversal") {
      const reference = data?.reference ?? data?.transfer_reference ?? null;
      const transferId = data?.id ?? data?.transfer_id ?? null;

      if (transferId) {
        const { ok, data: verifyData } = await flutterwaveGet(accessToken, `/transfers/${transferId}`);
        if (ok && verifyData?.data) {
          await applyVerifiedTransferStatus(supabase, String(transferId), reference, verifyData.data);
        }
      }

      if (false && (reference || transferId)) {
        const rawReason = data?.reversal?.reason ?? "Transfer reversed";
        const updateData: Record<string, unknown> = {
          status: "failed",
          failure_reason: rawReason,
          failure_reason_display: customerFriendlyFailure(rawReason),
        };
        if (transferId) {
          updateData.flutterwave_transfer_id = String(transferId);
          updateData.provider_status = String(data?.status ?? "").toUpperCase();
        }

        let query = supabase.from("commitments").update(updateData);
        if (reference) {
          query = query.eq("id", reference).or(`flutterwave_transfer_id.eq.${transferId}`);
        } else if (transferId) {
          query = query.eq("flutterwave_transfer_id", String(transferId));
        }
        await query;

        // The database trigger will automatically recalculate the plan status.
      }
    }

    return new Response(JSON.stringify({
      received: true,
      event_type: eventType,
      webhook_id: webhookId,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Flutterwave webhook error:", error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : "Unexpected error",
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

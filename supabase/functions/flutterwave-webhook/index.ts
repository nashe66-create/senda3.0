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
    const webhookId = event?.id ?? event?.webhook_id ?? null;
    const data = event?.data ?? {};

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

    // Deduplicate: check if we've already processed this webhook
    if (webhookId) {
      const { data: existing } = await supabase
        .from("flutterwave_webhook_events")
        .select("webhook_id")
        .eq("webhook_id", String(webhookId))
        .maybeSingle();

      if (existing) {
        console.log("Duplicate webhook, skipping:", webhookId);
        return new Response(JSON.stringify({ received: true, duplicate: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Insert the event for deduplication
      await supabase
        .from("flutterwave_webhook_events")
        .insert({
          webhook_id: String(webhookId),
          event_type: eventType,
          payload: event,
        });
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
              const updateData: Record<string, unknown> = {
                status: "successful",
                completed_at: new Date().toISOString(),
                flutterwave_charge_id: String(chargeId),
              };
              if (chargeData.card?.last_4) updateData.card_last4 = chargeData.card.last_4;
              if (chargeData.card?.network) updateData.card_network = chargeData.card.network;

              await supabase
                .from("transactions")
                .update(updateData)
                .eq("payment_reference", reference);

              // Transition plan to FUNDED — the funding gate
              const { data: transaction } = await supabase
                .from("transactions")
                .select("plan_id")
                .eq("payment_reference", reference)
                .maybeSingle();

              if (transaction?.plan_id) {
                const { data: plan } = await supabase
                  .from("plans")
                  .select("id, status, customer_pays")
                  .eq("id", transaction.plan_id)
                  .maybeSingle();

                if (plan && (plan.status === "payment_processing" || plan.status === "awaiting_payment")) {
                  const amountMatches = Math.abs(Number(chargeData.amount) - Number(plan.customer_pays)) <= 0.01;
                  const currencyMatches = String(chargeData.currency ?? "GBP").toUpperCase() === "GBP";

                  if (amountMatches && currencyMatches) {
                    await supabase
                      .from("plans")
                      .update({
                        payment_status: "successful",
                        status: "funded",
                      })
                      .eq("id", transaction.plan_id);
                  } else {
                    await supabase
                      .from("plans")
                      .update({
                        payment_status: "failed",
                        status: "payment_failed",
                      })
                      .eq("id", transaction.plan_id);
                  }
                }
              }
            } else if (chargeStatus === "failed") {
              await supabase
                .from("transactions")
                .update({ status: "failed" })
                .eq("payment_reference", reference);

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
                  .eq("id", transaction.plan_id);
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
      const status = String(data?.status ?? "").toUpperCase();

      if (reference) {
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

      if (reference || transferId) {
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

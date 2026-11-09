import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.58.0";
import { verifyFincraWebhookSignature } from "../_shared/fincra.ts";
import { invokeFincraFunction, invokeReadyFincraPayouts } from "../_shared/internal-functions.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Fincra-Signature, X-Signature, Authorization",
};

function jsonResponse(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ success: false, error: "Method not allowed" }, 405);
  }

  try {
    const rawBody = await req.text();
    if (!rawBody) {
      return jsonResponse({ success: false, error: "Empty webhook body" }, 400);
    }

    if (!Deno.env.get("FINCRA_WEBHOOK_SECRET") && !Deno.env.get("FINCRA_WEBHOOK_SECRET_KEY")) {
      console.error("FINCRA_WEBHOOK_SECRET is not configured");
      return jsonResponse({ success: false, error: "Webhook verification is not configured" }, 503);
    }

    const signature =
      req.headers.get("x-fincra-signature") ??
      req.headers.get("x-signature");
    const isValid = await verifyFincraWebhookSignature(rawBody, signature);
    if (!isValid) {
      return jsonResponse({ success: false, error: "Invalid webhook signature" }, 401);
    }

    let payload: Record<string, any>;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return jsonResponse({ success: false, error: "Invalid JSON webhook payload" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Supabase server configuration is missing");
    }

    const data = payload.data && typeof payload.data === "object" ? payload.data : payload;
    const eventType = String(payload.event ?? payload.eventType ?? payload.type ?? "");
    const eventTypeLower = eventType.toLowerCase();
    const providerStatus = String(data.status ?? payload.status ?? "").toLowerCase();
    const reference = String(
      data.merchantReference ??
        data.merchant_reference ??
        data.reference ??
        payload.merchantReference ??
        payload.merchant_reference ??
        payload.reference ??
        "",
    );

    let stage: "collection" | "conversion" | "payout" | null = null;
    if (/conversion|convert/.test(eventTypeLower)) {
      stage = "conversion";
    } else if (/payout|disbursement/.test(eventTypeLower)) {
      stage = "payout";
    } else if (/checkout|collection|payment|charge/.test(eventTypeLower)) {
      stage = "collection";
    }

    const statusMap: Record<string, string> = {
      pending: "pending",
      initiated: "pending",
      processing: "processing",
      in_progress: "processing",
      successful: "successful",
      success: "successful",
      completed: "successful",
      paid: "successful",
      failed: "failed",
      failure: "failed",
      cancelled: "failed",
      canceled: "failed",
      reversed: "reversed",
      refunded: "reversed",
    };
    const normalizedStatus = statusMap[providerStatus];
    if (!eventType || !stage || !reference || !normalizedStatus) {
      return jsonResponse({
        success: false,
        error: "Webhook event is missing a supported type, reference, or status",
      }, 400);
    }

    const amountValue = stage === "conversion"
      ? data.destinationAmount ?? data.destination_amount ?? data.amountToReceive ?? data.amount_to_receive
      : data.amount ?? data.paidAmount ?? data.paid_amount ?? data.chargedAmount;
    const amount = amountValue == null ? null : Number(amountValue);
    if (amount !== null && !Number.isFinite(amount)) {
      return jsonResponse({ success: false, error: "Webhook amount is invalid" }, 400);
    }
    const currencyValue = stage === "conversion"
      ? data.destinationCurrency ?? data.destination_currency ?? data.currency
      : data.currency;
    const currency = currencyValue == null ? null : String(currencyValue);
    const eventId = String(payload.eventId ?? payload.event_id ?? payload.webhookId ?? payload.webhook_id ?? "");
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawBody));
    const stableEventId = eventId || `sha256:${Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")}`;

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { data: result, error } = await supabase.rpc("apply_fincra_webhook_event", {
      p_event_id: stableEventId,
      p_event_type: eventType,
      p_reference: reference,
      p_stage: stage,
      p_provider_status: normalizedStatus,
      p_amount: amount,
      p_currency: currency,
      p_payload: payload,
    });

    if (error) {
      console.error("Failed to reconcile Fincra webhook:", error);
      throw new Error("Failed to reconcile Fincra webhook");
    }

    if ([
      "reference_not_found",
      "transaction_not_found",
      "collection_not_confirmed",
      "funding_or_conversion_not_confirmed",
    ].includes(result?.reason)) {
      return jsonResponse({
        success: false,
        received: true,
        applied: false,
        reason: result.reason,
      }, 503);
    }

    if ((result?.applied || result?.duplicate) && normalizedStatus === "successful") {
      if (stage === "collection") {
        const { data: plan, error: planError } = await supabase
          .from("plans")
          .select("id")
          .eq("fincra_collection_reference", reference)
          .maybeSingle();
        if (planError || !plan) {
          throw new Error(`Could not find the funded plan for Fincra collection reference ${reference}`);
        }
        await invokeFincraFunction("fincra-conversion", { plan_id: plan.id });
      } else if (stage === "conversion") {
        const { data: plan, error: planError } = await supabase
          .from("plans")
          .select("id, fincra_conversion_status")
          .eq("fincra_conversion_reference", reference)
          .maybeSingle();
        if (planError) throw new Error(`Could not load plan for Fincra conversion: ${planError.message}`);
        if (plan?.fincra_conversion_status === "successful") {
          await invokeReadyFincraPayouts(plan.id);
        }
      }
    }

    return jsonResponse({
      success: true,
      received: true,
      applied: Boolean(result?.applied),
      duplicate: Boolean(result?.duplicate),
      reason: result?.reason ?? null,
    });
  } catch (error) {
    console.error("Fincra webhook reconciliation failed:", error);
    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : "Webhook reconciliation failed",
    }, 500);
  }
});

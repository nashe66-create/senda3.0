import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.58.0";
import { FincraApiError, createFincraPayout, getFincraPayoutByReference } from "../_shared/fincra.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function jsonResponse(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function statusForReconciliation(payout: Record<string, unknown>): string | null {
  const status = String(payout.status ?? payout.transactionStatus ?? "").toLowerCase();
  const statusMap: Record<string, string> = {
    pending: "pending",
    initiated: "pending",
    processing: "processing",
    in_progress: "processing",
    successful: "successful",
    success: "successful",
    completed: "successful",
    failed: "failed",
    failure: "failed",
    cancelled: "failed",
    canceled: "failed",
    reversed: "reversed",
    refunded: "reversed",
  };
  return statusMap[status] ?? null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  let attemptedPayout: { commitmentId: string; userId: string } | null = null;
  let attemptedReference: string | null = null;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Supabase server configuration is missing");
    }

    const authHeader = req.headers.get("Authorization");
    const isInternal = req.headers.get("x-senda-internal-key") === serviceRoleKey;
    if (!isInternal && !authHeader) {
      return jsonResponse({ success: false, error: "Unauthorized" }, 401);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      global: isInternal ? undefined : { headers: { Authorization: authHeader! } },
    });

    let userId: string | null = null;
    if (!isInternal) {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) {
        return jsonResponse({ success: false, error: "Unauthorized" }, 401);
      }
      userId = user.id;
    }

    if (req.method === "GET") {
      if (!userId) return jsonResponse({ success: false, error: "Unauthorized" }, 401);
      const reference = new URL(req.url).searchParams.get("reference");
      if (!reference) {
        return jsonResponse({ success: false, error: "Missing reference query parameter" }, 400);
      }

      const { data: commitment, error: commitmentError } = await supabase
        .from("commitments")
        .select("id, plan_id")
        .eq("user_id", userId)
        .eq("fincra_payout_reference", reference)
        .maybeSingle();

      if (commitmentError || !commitment) {
        return jsonResponse({ success: false, error: "Payout not found" }, 404);
      }

      const payout = await getFincraPayoutByReference<Record<string, unknown>>(reference);
      const status = statusForReconciliation(payout);
      let reconciliation: unknown = null;
      if (status) {
        const amountValue = payout.amount ?? payout.paidAmount ?? payout.paid_amount;
        const amount = amountValue == null ? null : Number(amountValue);
        if (amount !== null && !Number.isFinite(amount)) {
          return jsonResponse({ success: false, error: "Fincra payout amount is invalid" }, 502);
        }
        const supabaseUrl = Deno.env.get("SUPABASE_URL");
        const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        if (!supabaseUrl || !serviceRoleKey) {
          throw new Error("Supabase server configuration is missing");
        }
        const digest = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(JSON.stringify(payout)),
        );
        const eventId = `payout-poll:${reference}:${Array.from(new Uint8Array(digest))
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join("")}`;
        const serviceClient = createClient(supabaseUrl, serviceRoleKey);
        const { data: result, error: reconciliationError } = await serviceClient.rpc("apply_fincra_webhook_event", {
          p_event_id: eventId,
          p_event_type: "payout.status.poll",
          p_reference: reference,
          p_stage: "payout",
          p_provider_status: status,
          p_amount: amount,
          p_currency: payout.currency == null ? null : String(payout.currency),
          p_payload: payout,
        });
        if (reconciliationError) {
          throw new Error(`Failed to reconcile verified payout status: ${reconciliationError.message}`);
        }
        reconciliation = result;
      }

      return jsonResponse({ success: true, data: { payout, reconciliation } });
    }

    if (req.method !== "POST") {
      return jsonResponse({ success: false, error: "Method not allowed" }, 405);
    }

    let payload: {
      commitment_id?: string;
    };

    try {
      payload = await req.json();
    } catch {
      return jsonResponse({ success: false, error: "Invalid JSON request body" }, 400);
    }

    if (!payload.commitment_id) {
      return jsonResponse({ success: false, error: "Missing required field: commitment_id" }, 400);
    }

    const { data: commitment, error: commitmentError } = await supabase
      .from("commitments")
      .select("id, plan_id, user_id, status, amount_destination, destination_currency, receiving_method, recipient_snapshot, fincra_payout_reference, fincra_payout_status")
      .eq("id", payload.commitment_id)
      .maybeSingle();

    const ownerId = typeof commitment?.user_id === "string" ? commitment.user_id : "";
    if (commitmentError || !commitment || !ownerId || (userId && ownerId !== userId)) {
      return jsonResponse({ success: false, error: "Commitment not found" }, 404);
    }

    userId = ownerId;
    const { data: plan, error: planError } = await supabase
      .from("plans")
      .select("id, payment_status, fincra_conversion_status")
      .eq("id", commitment.plan_id)
      .eq("user_id", userId)
      .maybeSingle();

    if (planError || !plan) {
      return jsonResponse({ success: false, error: "Plan not found" }, 404);
    }

    if (plan.payment_status !== "successful" || plan.fincra_conversion_status !== "successful") {
      return jsonResponse({
        success: false,
        error: "Payout requires successful collection and conversion",
        error_code: "PLAN_NOT_READY_FOR_PAYOUT",
      }, 409);
    }

    if (commitment.status !== "ready") {
      return jsonResponse({
        success: false,
        error: "Commitment is not ready for payout",
        error_code: "COMMITMENT_NOT_READY",
        current_status: commitment.status,
      }, 409);
    }

    const amount = Number(commitment.amount_destination ?? 0);
    const currency = String(commitment.destination_currency ?? "").toUpperCase();
    const recipientSnapshot = commitment.recipient_snapshot;
    if (!Number.isFinite(amount) || amount <= 0 || !currency || !recipientSnapshot) {
      return jsonResponse({
        success: false,
        error: "Commitment payout snapshot is incomplete",
        error_code: "INVALID_PAYOUT_SNAPSHOT",
      }, 409);
    }

    const reference = String(commitment.fincra_payout_reference ?? `senda-payout-${commitment.id}`);
    const { data: claimedCommitment, error: claimError } = await supabase
      .from("commitments")
      .update({
        status: "processing",
        fincra_payout_reference: reference,
        fincra_payout_status: "processing",
      })
      .eq("id", commitment.id)
      .eq("user_id", ownerId)
      .eq("status", "ready")
      .select("id")
      .maybeSingle();

    if (claimError) {
      throw new Error(`Failed to claim commitment payout: ${claimError.message}`);
    }
    if (!claimedCommitment) {
      return jsonResponse({ success: false, error: "Commitment payout is already in progress" }, 409);
    }
    attemptedPayout = { commitmentId: commitment.id, userId: ownerId };
    attemptedReference = reference;

    const payout = await createFincraPayout({
      amount,
      currency,
      walletId: Deno.env.get("FINCRA_WALLET_ID") ?? undefined,
      reference,
      business: Deno.env.get("FINCRA_BUSINESS_ID") ?? undefined,
      beneficiary: recipientSnapshot,
      metadata: {
        plan_id: commitment.plan_id,
        commitment_id: commitment.id,
        user_id: ownerId,
      },
    });

    const { error: transactionUpdateError } = await supabase
      .from("transactions")
      .update({
        fincra_payout_status: "processing",
      })
      .eq("plan_id", commitment.plan_id)
      .eq("status", "successful");

    if (transactionUpdateError) {
      throw new Error(`Failed to persist payout status: ${transactionUpdateError.message}`);
    }

    return jsonResponse({
      success: true,
      data: { plan_id: commitment.plan_id, commitment_id: commitment.id, reference, payout },
    });
  } catch (error) {
    if (attemptedPayout && attemptedReference) {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (supabaseUrl && serviceRoleKey) {
        const serviceClient = createClient(supabaseUrl, serviceRoleKey);
        const { error: reconciliationError } = await serviceClient
          .from("commitments")
          .update({
            status: "reconciliation_required",
            fincra_payout_status: "processing",
          })
          .eq("id", attemptedPayout.commitmentId)
          .eq("user_id", attemptedPayout.userId)
          .eq("fincra_payout_reference", attemptedReference)
          .eq("status", "processing");
        if (reconciliationError) {
          console.error("Failed to mark Fincra payout for reconciliation:", reconciliationError);
        }
      }
    }

    if (error instanceof FincraApiError) {
      return jsonResponse({ success: false, error: error.message, error_code: "FINCRA_PAYOUT_FAILED" }, 502);
    }

    const message = error instanceof Error ? error.message : "Payout failed";
    return jsonResponse({ success: false, error: message }, 500);
  }
});

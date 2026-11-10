import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.58.0";
import {
  FincraApiError,
  createFincraPayout,
  getFincraPayoutByCustomerReference,
  getFincraPayoutByReference,
  listFincraPayoutProviders,
} from "../_shared/fincra.ts";

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

      let { data: commitment, error: commitmentError } = await supabase
        .from("commitments")
        .select("id, plan_id, fincra_payout_reference, fincra_payout_customer_reference")
        .eq("user_id", userId)
        .eq("fincra_payout_reference", reference)
        .maybeSingle();

      let lookupByCustomerReference = false;
      if (!commitment && !commitmentError) {
        const customerLookup = await supabase
          .from("commitments")
          .select("id, plan_id, fincra_payout_reference, fincra_payout_customer_reference")
          .eq("user_id", userId)
          .eq("fincra_payout_customer_reference", reference)
          .maybeSingle();
        commitment = customerLookup.data;
        commitmentError = customerLookup.error;
        lookupByCustomerReference = Boolean(commitment);
      }

      if (commitmentError || !commitment) {
        return jsonResponse({ success: false, error: "Payout not found" }, 404);
      }

      let payout: Record<string, unknown>;
      if (lookupByCustomerReference) {
        payout = await getFincraPayoutByCustomerReference<Record<string, unknown>>(reference);
      } else {
        try {
          payout = await getFincraPayoutByReference<Record<string, unknown>>(reference);
        } catch (error) {
          if (!commitment.fincra_payout_customer_reference) throw error;
          payout = await getFincraPayoutByCustomerReference<Record<string, unknown>>(
            commitment.fincra_payout_customer_reference,
          );
        }
      }
      const providerReference = String(payout.reference ?? commitment.fincra_payout_reference ?? "");
      if (!providerReference) {
        return jsonResponse({ success: false, error: "Fincra payout response has no provider reference" }, 502);
      }
      if (providerReference !== commitment.fincra_payout_reference) {
        const { error: referenceUpdateError } = await supabase
          .from("commitments")
          .update({ fincra_payout_reference: providerReference })
          .eq("id", commitment.id)
          .eq("user_id", userId);
        if (referenceUpdateError) {
          throw new Error(`Failed to persist Fincra payout reference: ${referenceUpdateError.message}`);
        }
      }
      const status = statusForReconciliation(payout);
      let reconciliation: unknown = null;
      if (status) {
        const amountValue = payout.amountReceived ?? payout.amount_received ?? payout.amount ?? payout.paidAmount ?? payout.paid_amount;
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
        const eventId = `payout-poll:${providerReference}:${Array.from(new Uint8Array(digest))
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join("")}`;
        const serviceClient = createClient(supabaseUrl, serviceRoleKey);
        const { data: result, error: reconciliationError } = await serviceClient.rpc("apply_fincra_webhook_event", {
          p_event_id: eventId,
          p_event_type: "payout.status.poll",
          p_reference: providerReference,
          p_stage: "payout",
          p_provider_status: status,
          p_amount: amount,
          p_currency: payout.destinationCurrency == null && payout.currency == null
            ? null
            : String(payout.destinationCurrency ?? payout.currency),
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

    const payoutMethod = String(commitment.receiving_method ?? "");
    const paymentDestination = payoutMethod === "bank_account"
      ? "bank_account"
      : payoutMethod === "mobile_money"
      ? "mobile_money_wallet"
      : null;
    if (!paymentDestination) {
      return jsonResponse({
        success: false,
        error: "Fincra payouts currently support bank accounts and mobile-money wallets only.",
        error_code: "UNSUPPORTED_FINCRA_PAYOUT_METHOD",
      }, 409);
    }

    const snapshot = recipientSnapshot as Record<string, unknown>;
    const recipientName = String(snapshot.recipient_name ?? snapshot.name ?? "").trim();
    const nameParts = recipientName.split(/\s+/).filter(Boolean);
    const firstName = String(snapshot.first_name ?? nameParts[0] ?? "").trim();
    const lastName = String(snapshot.last_name ?? nameParts.slice(1).join(" ") ?? "").trim();
    const country = String(snapshot.destination_country ?? snapshot.country ?? "").toUpperCase();
    const accountNumber = String(snapshot.account_number ?? "").trim() ||
      (payoutMethod === "mobile_money" ? String(snapshot.phone ?? "").trim() : "");
    const bankCode = String(snapshot.fincra_bank_code ?? snapshot.bank_code ?? "").trim();
    const mobileMoneyCode = String(
      snapshot.fincra_mobile_money_code ?? snapshot.mobile_money_provider ?? snapshot.mobile_money_network ?? "",
    ).trim();
    const paymentScheme = String(snapshot.fincra_payment_scheme ?? snapshot.payment_scheme ?? "").trim();

    if (!firstName || !lastName || !country || !accountNumber ||
      (payoutMethod === "bank_account" && !bankCode) ||
      (payoutMethod === "mobile_money" && !mobileMoneyCode)) {
      return jsonResponse({
        success: false,
        error: "Recipient snapshot is missing Fincra-required name, country, account, or provider-code details.",
        error_code: "INCOMPLETE_FINCRA_BENEFICIARY",
      }, 409);
    }

    const payoutProviders = await listFincraPayoutProviders<Array<Record<string, unknown>>>({
      country,
      currency,
      paymentDestination,
    });
    const providerCode = paymentDestination === "bank_account" ? bankCode : mobileMoneyCode;
    if (!payoutProviders.some((provider) => String(provider.code ?? "") === providerCode)) {
      return jsonResponse({
        success: false,
        error: "The saved recipient provider code is not enabled for this Fincra corridor. Re-verify the recipient with Fincra's provider list before payout.",
        error_code: "FINCRA_PROVIDER_CODE_UNAVAILABLE",
      }, 409);
    }

    const businessId = Deno.env.get("FINCRA_BUSINESS_ID")?.trim();
    if (!businessId) {
      return jsonResponse({ success: false, error: "FINCRA_BUSINESS_ID is not configured" }, 500);
    }

    const customerReference = `senda-payout-${commitment.id}-${crypto.randomUUID()}`;
    const { data: claimedCommitment, error: claimError } = await supabase
      .from("commitments")
      .update({
        status: "processing",
        fincra_payout_customer_reference: customerReference,
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
    attemptedReference = customerReference;

    const payout = await createFincraPayout({
      amount,
      sourceCurrency: currency,
      destinationCurrency: currency,
      paymentDestination,
      customerReference,
      description: `Senda recipient payout ${commitment.id}`,
      paymentScheme: paymentScheme || undefined,
      business: businessId,
      beneficiary: {
        firstName,
        lastName: lastName || undefined,
        accountHolderName: String(snapshot.account_holder_name ?? recipientName).trim(),
        type: "individual",
        country,
        accountNumber,
        ...(paymentDestination === "bank_account" ? { bankCode } : { mobileMoneyCode }),
      },
    });

    const providerReference = String(payout.reference ?? "");
    if (!providerReference) {
      throw new Error("Fincra payout response did not contain a provider reference");
    }

    const { error: payoutReferenceError } = await supabase
      .from("commitments")
      .update({ fincra_payout_reference: providerReference })
      .eq("id", commitment.id)
      .eq("user_id", ownerId)
      .eq("fincra_payout_customer_reference", customerReference);
    if (payoutReferenceError) {
      throw new Error(`Payout was submitted but its Fincra reference could not be saved: ${payoutReferenceError.message}`);
    }

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
      data: {
        plan_id: commitment.plan_id,
        commitment_id: commitment.id,
        customer_reference: customerReference,
        reference: providerReference,
        payout,
      },
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
          .eq("fincra_payout_customer_reference", attemptedReference)
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

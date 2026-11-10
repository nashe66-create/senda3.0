import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.58.0";
import {
  FincraApiError,
  getFincraConversionByReference,
  getFincraWallet,
  fincraRequest,
  initiateFincraConversion,
} from "../_shared/fincra.ts";
import { invokeReadyFincraPayouts } from "../_shared/internal-functions.ts";

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

function getAvailableBalance(wallet: unknown): number {
  if (!wallet || typeof wallet !== "object") {
    throw new Error("Fincra wallet response is invalid");
  }

  const record = wallet as Record<string, unknown>;
  const rawBalance = record.availableBalance ?? record.available_balance ?? record.balance;
  const balance = Number(rawBalance);
  if (!Number.isFinite(balance) || balance < 0) {
    throw new Error("Fincra wallet response did not contain a valid available balance");
  }

  return balance;
}

function statusForReconciliation(conversion: Record<string, unknown>): string | null {
  const status = String(conversion.status ?? conversion.conversionStatus ?? "").toLowerCase();
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
  };
  return statusMap[status] ?? null;
}

async function reconcileConversion(
  supabaseUrl: string,
  serviceRoleKey: string,
  planId: string,
  reference: string,
  conversion: Record<string, unknown>,
): Promise<{ status: string | null; reconciliation: Record<string, unknown> | null }> {
  const status = statusForReconciliation(conversion);
  if (!status) return { status: null, reconciliation: null };

  const amountValue = conversion.destinationAmount ??
    conversion.destination_amount ??
    conversion.amountToReceive ??
    conversion.amount_to_receive ??
    conversion.amountReceived ??
    conversion.amount_received;
  const amount = amountValue == null ? null : Number(amountValue);
  if (amount !== null && !Number.isFinite(amount)) {
    throw new Error("Fincra conversion amount is invalid");
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(conversion)),
  );
  const eventId = `conversion-poll:${reference}:${Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
  const serviceClient = createClient(supabaseUrl, serviceRoleKey);
  const { data: result, error } = await serviceClient.rpc("apply_fincra_webhook_event", {
    p_event_id: eventId,
    p_event_type: "conversion.status.poll",
    p_reference: reference,
    p_stage: "conversion",
    p_provider_status: status,
    p_amount: amount,
    p_currency: conversion.destinationCurrency == null && conversion.destination_currency == null
      ? null
      : String(conversion.destinationCurrency ?? conversion.destination_currency),
    p_payload: conversion,
  });
  if (error) {
    throw new Error(`Failed to reconcile verified conversion status: ${error.message}`);
  }
  if (result?.applied || result?.duplicate) {
    const conversionState = status === "successful"
      ? "confirmed"
      : status === "failed" || status === "reversed"
      ? "failed"
      : status;
    const { error: stateError } = await serviceClient
      .from("plans")
      .update({
        conversion_status: conversionState,
        conversion_confirmed_at: status === "successful" ? new Date().toISOString() : null,
      })
      .eq("id", planId);
    if (stateError) {
      throw new Error(`Failed to persist Fincra conversion lifecycle state: ${stateError.message}`);
    }
  }
  if (
    status === "successful" &&
    (result?.applied || result?.duplicate) &&
    !result?.reason
  ) {
    await invokeReadyFincraPayouts(planId);
  }
  return { status, reconciliation: result as Record<string, unknown> | null };
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

      const { data: plan, error: planError } = await supabase
        .from("plans")
        .select("id")
        .eq("user_id", userId)
        .eq("fincra_conversion_reference", reference)
        .maybeSingle();

      if (planError || !plan) {
        return jsonResponse({ success: false, error: "Conversion not found" }, 404);
      }

      const conversion = await getFincraConversionByReference<Record<string, unknown>>(reference);
      const reconciliation = await reconcileConversion(
        supabaseUrl,
        serviceRoleKey,
        plan.id,
        reference,
        conversion,
      );
      return jsonResponse({ success: true, data: { conversion, ...reconciliation } });
    }

    if (req.method !== "POST") {
      return jsonResponse({ success: false, error: "Method not allowed" }, 405);
    }

    let payload: {
      plan_id?: string;
    };

    try {
      payload = await req.json();
    } catch {
      return jsonResponse({ success: false, error: "Invalid JSON request body" }, 400);
    }

    if (!payload.plan_id) {
      return jsonResponse({ success: false, error: "Missing required field: plan_id" }, 400);
    }

    let planQuery = supabase
      .from("plans")
      .select("id, user_id, status, payment_status, pricing_mode, source_amount, destination_amount, destination_currency, conversion_status, fincra_conversion_reference, fincra_conversion_quote_reference, fincra_conversion_status")
      .eq("id", payload.plan_id);
    if (userId) planQuery = planQuery.eq("user_id", userId);
    const { data: plan, error: planError } = await planQuery.maybeSingle();

    if (planError || !plan) {
      return jsonResponse({ success: false, error: "Plan not found" }, 404);
    }
    userId = plan.user_id;

    if (plan.pricing_mode !== "fixed_source") {
      return jsonResponse({
        success: false,
        error: "Fincra post-funding conversion is currently available only for fixed-source plans.",
        error_code: "FIXED_DESTINATION_TEMPORARILY_UNAVAILABLE",
      }, 409);
    }

    if (plan.payment_status !== "successful" || !["funded", "payouts_processing"].includes(plan.status)) {
      return jsonResponse({
        success: false,
        error: "Conversion requires a successfully funded plan",
        error_code: "PLAN_NOT_FUNDED",
      }, 409);
    }

    if (plan.fincra_conversion_status === "successful") {
      return jsonResponse({ success: false, error: "This plan has already been converted" }, 409);
    }
    if (["failed", "reversed"].includes(String(plan.fincra_conversion_status))) {
      return jsonResponse({
        success: false,
        error: "Conversion has a terminal failure status and requires reconciliation before retry.",
        error_code: "CONVERSION_REQUIRES_RECONCILIATION",
      }, 409);
    }
    if (plan.fincra_conversion_status === "processing") {
      const reference = plan.fincra_conversion_reference;
      if (!reference) {
        return jsonResponse({
          success: false,
          error: "Fincra conversion submission has an unknown outcome and requires reconciliation before retry.",
          error_code: "CONVERSION_REQUIRES_RECONCILIATION",
        }, 409);
      }
      const conversion = await getFincraConversionByReference<Record<string, unknown>>(reference);
      const reconciliation = await reconcileConversion(
        supabaseUrl,
        serviceRoleKey,
        plan.id,
        reference,
        conversion,
      );
      return jsonResponse({
        success: true,
        data: {
          plan_id: plan.id,
          reference,
          conversion,
          ...reconciliation,
          already_in_progress: true,
        },
      });
    }
    if (plan.fincra_conversion_status) {
      return jsonResponse({
        success: false,
        error: "A conversion attempt is already recorded and must be checked before another attempt",
        error_code: "CONVERSION_REQUIRES_RECONCILIATION",
      }, 409);
    }

    if (plan.conversion_status && plan.conversion_status !== "not_started") {
      return jsonResponse({
        success: false,
        error: "A conversion attempt is already in progress and must be reconciled before another attempt.",
        error_code: "CONVERSION_REQUIRES_RECONCILIATION",
      }, 409);
    }

    const amount = Number(plan.source_amount ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      return jsonResponse({ success: false, error: "Plan source amount must be greater than zero" }, 409);
    }

    const walletId = Deno.env.get("FINCRA_WALLET_ID");
    if (!walletId) {
      throw new Error("FINCRA_WALLET_ID is not configured");
    }

    const wallet = await getFincraWallet(walletId);
    const availableBalance = getAvailableBalance(wallet);
    if (availableBalance < amount) {
      return jsonResponse({
        success: false,
        error: "Fincra GBP wallet balance is insufficient for this conversion",
        error_code: "INSUFFICIENT_WALLET_BALANCE",
      }, 409);
    }

    const { data: claimedPlan, error: claimError } = await supabase
      .from("plans")
      .update({ conversion_status: "quote_pending" })
      .eq("id", plan.id)
      .eq("user_id", userId)
      .eq("payment_status", "successful")
      .is("fincra_conversion_status", null)
      .eq("conversion_status", "not_started")
      .select("id")
      .maybeSingle();

    if (claimError) {
      throw new Error(`Failed to claim conversion quote: ${claimError.message}`);
    }
    if (!claimedPlan) {
      return jsonResponse({ success: false, error: "A conversion attempt is already in progress" }, 409);
    }

    let conversionSubmitted = false;
    let quoteApplied = false;
    const customerReference = `senda-conversion-${plan.id}`;

    try {
      const businessId = Deno.env.get("FINCRA_BUSINESS_ID")?.trim();
      if (!businessId) throw new Error("FINCRA_BUSINESS_ID is not configured");

      const { data: commitments, error: commitmentsError } = await supabase
        .from("commitments")
        .select("id, amount_gbp, amount_destination")
        .eq("plan_id", plan.id)
        .order("created_at", { ascending: true });

      if (commitmentsError || !commitments?.length) {
        throw new Error(`Failed to load conversion allocations: ${commitmentsError?.message ?? "No commitments found"}`);
      }

      const quote = await fincraRequest<Record<string, unknown>>(
        "POST",
        "/quotes/generate",
        {
          sourceCurrency: "GBP",
          destinationCurrency: String(plan.destination_currency).toUpperCase(),
          amount: amount.toFixed(2),
          action: "send",
          transactionType: "conversion",
          business: businessId,
          feeBearer: "customer",
          paymentDestination: "fliqpay_wallet",
          beneficiaryType: "individual",
        },
      );

      const quoteReference = String(quote.reference ?? "");
      const sourceAmount = Number(quote.sourceAmount ?? quote.amountToCharge ?? amount);
      const destinationAmount = Number(quote.destinationAmount ?? quote.amountToReceive ?? 0);
      const amountToReceive = Number(quote.amountToReceive ?? destinationAmount);
      const rate = Number(quote.rate ?? (destinationAmount / sourceAmount));
      const fee = Number(quote.fee ?? 0);
      const expiresAt = String(quote.expireAt ?? quote.expiresAt ?? "");
      const expiryMs = new Date(expiresAt).getTime();

      if (
        !quoteReference ||
        !Number.isFinite(sourceAmount) || Math.abs(sourceAmount - amount) > 0.01 ||
        !Number.isFinite(amountToReceive) || amountToReceive <= 0 ||
        !Number.isFinite(rate) || rate <= 0 ||
        !Number.isFinite(fee) || fee < 0 ||
        !Number.isFinite(expiryMs) || expiryMs <= Date.now() + 2000
      ) {
        throw new Error("Fincra conversion quote is invalid or too close to expiry");
      }

      const weightTotal = commitments.reduce((sum, commitment) => sum + Math.max(0, Number(commitment.amount_destination) || 0), 0);
      if (weightTotal <= 0) throw new Error("Plan has no positive recipient allocation to reprice");

      const totalMinorUnits = Math.round(amountToReceive * 100);
      let allocatedMinorUnits = 0;
      const allocations = commitments.map((commitment, index) => {
        const weight = Math.max(0, Number(commitment.amount_destination) || 0);
        const allocationMinorUnits = index === commitments.length - 1
          ? totalMinorUnits - allocatedMinorUnits
          : Math.round(totalMinorUnits * weight / weightTotal);
        allocatedMinorUnits += allocationMinorUnits;
        const destinationAllocation = Number((allocationMinorUnits / 100).toFixed(2));
        const sourceAllocation = Number(commitment.amount_gbp) || 0;
        return {
          commitment_id: commitment.id,
          destination_amount: destinationAllocation,
          fx_rate: sourceAllocation > 0
            ? Number((destinationAllocation / sourceAllocation).toFixed(8))
            : rate,
        };
      });

      const { error: quoteApplyError } = await supabase.rpc("apply_fincra_conversion_quote", {
        p_plan_id: plan.id,
        p_quote_reference: quoteReference,
        p_source_amount: sourceAmount,
        p_destination_amount: amountToReceive,
        p_rate: rate,
        p_fee: fee,
        p_expires_at: expiresAt,
        p_commitments: allocations,
      });

      if (quoteApplyError) {
        throw new Error(`Failed to apply Fincra conversion quote: ${quoteApplyError.message}`);
      }
      quoteApplied = true;

      if (new Date(expiresAt).getTime() <= Date.now() + 1000) {
        throw new Error("Fincra conversion quote expired before it could be submitted");
      }

      const { error: initiatingError } = await supabase
        .from("plans")
        .update({ conversion_status: "initiating" })
        .eq("id", plan.id)
        .eq("conversion_status", "quoted");
      if (initiatingError) {
        throw new Error(`Failed to mark conversion as initiating: ${initiatingError.message}`);
      }

      conversionSubmitted = true;
      const conversion = await initiateFincraConversion({
        business: businessId,
        quoteReference,
        customerReference,
      });
      const reference = String(conversion.reference ?? conversion.conversionReference ?? "");
      if (!reference) {
        throw new Error("Fincra accepted the conversion request without returning a conversion reference");
      }

      const { error: conversionUpdateError } = await supabase
        .from("plans")
        .update({
          fincra_conversion_reference: reference,
          fincra_conversion_status: "processing",
          conversion_status: "processing",
          conversion_initiated_at: new Date().toISOString(),
        })
        .eq("id", plan.id);
      if (conversionUpdateError) {
        throw new Error(`Conversion was submitted but its reference could not be saved: ${conversionUpdateError.message}`);
      }

      const { error: transactionUpdateError } = await supabase
        .from("transactions")
        .update({
          fincra_conversion_reference: reference,
          fincra_conversion_status: "processing",
        })
        .eq("plan_id", plan.id)
        .eq("status", "successful");
      if (transactionUpdateError) {
        throw new Error(`Failed to persist conversion transaction details: ${transactionUpdateError.message}`);
      }

      return jsonResponse({
        success: true,
        data: {
          plan_id: plan.id,
          reference,
          quote_reference: quoteReference,
          conversion,
          indicative_rate: true,
        },
      });
    } catch (error) {
      const serviceClient = createClient(supabaseUrl, serviceRoleKey);
      if (conversionSubmitted) {
        const { error: markError } = await serviceClient
          .from("plans")
          .update({
            fincra_conversion_status: "processing",
            conversion_status: "initiating_unknown",
          })
          .eq("id", plan.id)
          .is("fincra_conversion_reference", null);
        if (markError) console.error("Failed to flag Fincra conversion for reconciliation:", markError);
      } else {
        const { error: releaseError } = await serviceClient
          .from("plans")
          .update({ conversion_status: "not_started" })
          .eq("id", plan.id)
          .in("conversion_status", quoteApplied ? ["quoted", "initiating"] : ["quote_pending"])
          .is("fincra_conversion_status", null);
        if (releaseError) console.error("Failed to release Fincra conversion quote claim:", releaseError);
      }

      throw error;
    }
  } catch (error) {
    if (error instanceof FincraApiError) {
      return jsonResponse({ success: false, error: error.message, error_code: "FINCRA_CONVERSION_FAILED" }, 502);
    }

    const message = error instanceof Error ? error.message : "Conversion failed";
    return jsonResponse({ success: false, error: message }, 500);
  }
});

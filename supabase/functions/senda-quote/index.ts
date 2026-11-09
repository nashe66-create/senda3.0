import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.58.0";
import { FincraApiError, fincraRequest } from "../_shared/fincra.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function jsonResponse(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function toMinorUnits(amount: number): number {
  return Math.round(Number((Number(amount) || 0).toFixed(2)) * 100);
}

function fromMinorUnits(amount: number): number {
  return Number((amount / 100).toFixed(2));
}

function calculateSendaFee(sourceAmount: number): number {
  const sourceMinorUnits = toMinorUnits(sourceAmount);
  return fromMinorUnits(Math.max(Math.round(sourceMinorUnits / 200), 50));
}

function getPayoutMethod(receivingMethod: string | null | undefined): string {
  switch (receivingMethod) {
    case "bank_account":
      return "bank";
    case "mobile_money":
      return "mobile_money";
    case "cash_pickup":
      return "cash_pickup";
    default:
      return "mobile_money";
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
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

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return jsonResponse({ success: false, error: "Unauthorized" }, 401);
    }

    let payload: {
      plan_id: string;
      pricing_mode?: "fixed_source" | "fixed_destination";
      destination_country?: string;
      destination_currency?: string;
      allocations: Array<{
        commitment_id?: string;
        recipient_id?: string;
        source_amount?: number;
        destination_amount?: number;
      }>;
    };

    try {
      payload = await req.json();
    } catch {
      return jsonResponse({ success: false, error: "Invalid JSON request body" }, 400);
    }

    if (!payload.plan_id) {
      return jsonResponse({ success: false, error: "Missing required field: plan_id" }, 400);
    }

    if (!payload.allocations || payload.allocations.length === 0) {
      return jsonResponse({ success: false, error: "At least one allocation is required" }, 400);
    }

    const planSelect = [
      "id",
      "user_id",
      "status",
      "pricing_mode",
      "destination_country",
      "destination_currency",
      "source_amount",
      "destination_amount",
      "customer_pays",
      "quote_reference",
      "quote_expires_at",
      "quote_status",
    ].join(",");

    const { data: plan, error: planError } = await supabase
      .from("plans")
      .select(planSelect)
      .eq("id", payload.plan_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (planError || !plan) {
      return jsonResponse({ success: false, error: "Plan not found" }, 404);
    }

    if (plan.status !== "draft" && plan.status !== "quoted") {
      return jsonResponse({
        success: false,
        error: "Quote can only be created for draft or quoted plans",
        error_code: "INVALID_PLAN_STATUS",
      }, 400);
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("kyc_status")
      .eq("id", user.id)
      .maybeSingle();

    if (profile?.kyc_status !== "verified") {
      return jsonResponse({
        success: false,
        error: "Complete account setup and wait for KYC verification before requesting a quote.",
        error_code: "KYC_NOT_VERIFIED",
      }, 403);
    }

    const pricingMode = String(plan.pricing_mode ?? "fixed_source") as "fixed_source" | "fixed_destination";
    if (pricingMode !== "fixed_source" && pricingMode !== "fixed_destination") {
      return jsonResponse({
        success: false,
        error: "Plan pricing mode is invalid",
        error_code: "INVALID_PLAN_PRICING_MODE",
      }, 400);
    }

    const destinationCountry = String(plan.destination_country ?? "").toUpperCase();
    const destinationCurrency = String(plan.destination_currency ?? "").toUpperCase();
    if (!destinationCountry || !destinationCurrency) {
      return jsonResponse({
        success: false,
        error: "Plan corridor is incomplete. Destination country and currency are required.",
        error_code: "PLAN_CORRIDOR_INCOMPLETE",
      }, 400);
    }

    const { data: commitments, error: commitmentsError } = await supabase
      .from("commitments")
      .select(
        "id, recipient_id, amount_gbp, amount_destination, fx_rate, receiving_method, destination_currency, recipient_snapshot, recipient:recipients(id, name, country, receiving_method, phone, mobile_money_network, mobile_money_provider, bank_code, account_number, destination_country, currency)"
      )
      .eq("plan_id", payload.plan_id)
      .order("created_at", { ascending: true });

    if (commitmentsError || !commitments) {
      return jsonResponse({ success: false, error: "Failed to fetch commitments" }, 500);
    }

    if (commitments.length === 0) {
      return jsonResponse({ success: false, error: "No recipients in this plan" }, 400);
    }

    const planCommitmentIds = new Set(commitments.map((commitment: { id: string }) => commitment.id));
    const allocationsByCommitmentId = new Map<string, (typeof payload.allocations)[number]>();

    for (const allocation of payload.allocations) {
      const commitmentId = allocation.commitment_id?.trim();
      if (!commitmentId) {
        return jsonResponse({
          success: false,
          error: "Each allocation must include commitment_id",
          error_code: "MISSING_COMMITMENT_ID",
        }, 400);
      }

      if (!planCommitmentIds.has(commitmentId)) {
        return jsonResponse({
          success: false,
          error: `Allocation commitment_id ${commitmentId} does not belong to this plan`,
          error_code: "INVALID_COMMITMENT_ID",
        }, 400);
      }

      if (allocationsByCommitmentId.has(commitmentId)) {
        return jsonResponse({
          success: false,
          error: `Duplicate allocation for commitment_id ${commitmentId}`,
          error_code: "DUPLICATE_COMMITMENT_ID",
        }, 400);
      }

      allocationsByCommitmentId.set(commitmentId, allocation);
    }

    if (allocationsByCommitmentId.size !== commitments.length) {
      return jsonResponse({
        success: false,
        error: `Allocation count mismatch. Expected ${commitments.length}, received ${allocationsByCommitmentId.size}`,
        error_code: "ALLOCATION_COUNT_MISMATCH",
      }, 400);
    }

    for (const commitment of commitments) {
      if (!allocationsByCommitmentId.has(commitment.id)) {
        return jsonResponse({
          success: false,
          error: `Missing allocation for commitment_id ${commitment.id}`,
          error_code: "MISSING_ALLOCATION",
        }, 400);
      }

      const recipient = commitment.recipient as any;
      if (!recipient) {
        return jsonResponse({
          success: false,
          error: `Commitment ${commitment.id} has no recipient attached`,
          error_code: "MISSING_RECIPIENT",
        }, 400);
      }

      const recipientCountry = String(recipient.country ?? "").toUpperCase();
      if (recipientCountry !== destinationCountry) {
        return jsonResponse({
          success: false,
          error: `Recipient ${recipient.name ?? commitment.recipient_id ?? commitment.id} is in ${recipient.country ?? "unknown"}, but plan destination country is ${destinationCountry}`,
          error_code: "RECIPIENT_COUNTRY_MISMATCH",
        }, 400);
      }

      const commitmentCurrency = String(commitment.destination_currency ?? "").toUpperCase();
      if (commitmentCurrency !== destinationCurrency) {
        return jsonResponse({
          success: false,
          error: `Commitment ${commitment.id} destination currency ${commitment.destination_currency ?? "unknown"} does not match plan destination currency ${destinationCurrency}`,
          error_code: "COMMITMENT_CURRENCY_MISMATCH",
        }, 400);
      }

      const recipientCurrency = String(recipient.currency ?? "").toUpperCase();
      if (recipientCurrency && recipientCurrency !== destinationCurrency) {
        return jsonResponse({
          success: false,
          error: `Recipient ${recipient.name ?? commitment.recipient_id ?? commitment.id} currency ${recipient.currency} does not match plan destination currency ${destinationCurrency}`,
          error_code: "RECIPIENT_CURRENCY_MISMATCH",
        }, 400);
      }
    }

    let totalSourceAmount = 0;
    let totalDestinationAmount = 0;
    const breakdown: Array<{
      commitment_id: string;
      recipient_name: string;
      source_amount: number;
      destination_amount: number;
      fx_rate: number;
      payout_method: string;
    }> = [];

    for (const commitment of commitments) {
      const allocation = allocationsByCommitmentId.get(commitment.id)!;
      const recipient = commitment.recipient as any;

      let sourceAmount: number;
      let destinationAmount: number;

      if (pricingMode === "fixed_source") {
        sourceAmount = Number(allocation.source_amount ?? commitment.amount_gbp ?? 0);
        destinationAmount = Number((sourceAmount * (Number(commitment.fx_rate) || 1)).toFixed(2));
      } else {
        destinationAmount = Number(allocation.destination_amount ?? commitment.amount_destination ?? 0);
        sourceAmount = Number((destinationAmount / (Number(commitment.fx_rate) || 1)).toFixed(2));
      }

      totalSourceAmount += sourceAmount;
      totalDestinationAmount += destinationAmount;

      const payoutMethod = getPayoutMethod(commitment.receiving_method);
      breakdown.push({
        commitment_id: commitment.id,
        recipient_name: recipient?.name ?? "Unknown",
        source_amount: sourceAmount,
        destination_amount: destinationAmount,
        fx_rate: Number(commitment.fx_rate) || 1,
        payout_method: payoutMethod,
      });
    }

    if (totalSourceAmount <= 0 || totalDestinationAmount <= 0) {
      return jsonResponse({ success: false, error: "Total amount must be greater than zero" }, 400);
    }

    const sendaFee = calculateSendaFee(totalSourceAmount);
    const providerQuote = await fincraRequest<any>(
      "POST",
      "/quotes/generate",
      {
        sourceCurrency: "GBP",
        destinationCurrency,
        sourceAmount: Number(totalSourceAmount.toFixed(2)),
        business: Deno.env.get("FINCRA_BUSINESS_ID") ?? undefined,
        feeBearer: "customer",
        customerReference: payload.plan_id,
        reference: payload.plan_id,
      },
      {
        idempotencyKey: `senda-quote-${payload.plan_id}-${Date.now()}`,
      },
    );

    const quote = providerQuote ?? {};
    const quoteReference = quote.quoteReference ?? quote.reference ?? null;
    const quoteRate = Number(quote.rate ?? 0);
    const providerFee = quote.fee == null ? null : Number(quote.fee);
    const amountToCharge = quote.amountToCharge != null ? Number(quote.amountToCharge) : Number((totalSourceAmount + sendaFee).toFixed(2));
    const amountToReceive = quote.amountToReceive != null ? Number(quote.amountToReceive) : Number(totalDestinationAmount.toFixed(2));
    const expiresAt = quote.expiresAt ?? quote.expireAt ?? null;

    if (!quoteReference) {
      return jsonResponse({
        success: false,
        error: "Fincra quote did not return a valid quote reference",
        error_code: "FINCRA_QUOTE_INVALID",
      }, 502);
    }

    const customerPays = Number((amountToCharge || totalSourceAmount + sendaFee).toFixed(2));

    const planUpdate = {
      status: "quoted",
      quote_reference: quoteReference,
      quote_status: "quoted",
      quote_rate: quoteRate || 0,
      quote_fee: providerFee ?? 0,
      quote_amount_to_charge: customerPays,
      quote_amount_to_receive: amountToReceive,
      quote_expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
      source_amount: totalSourceAmount,
      destination_amount: totalDestinationAmount,
      customer_pays: customerPays,
      customer_fx_rate: quoteRate || 0,
      provider_fx_rate: quoteRate || 0,
      provider_fee: providerFee ?? 0,
      senda_fee: sendaFee,
      price_lock_updated_at: new Date().toISOString(),
    } as Record<string, unknown>;

    const { error: updatePlanError } = await supabase
      .from("plans")
      .update(planUpdate)
      .eq("id", plan.id);

    if (updatePlanError) {
      throw new Error(`Failed to persist quote details: ${updatePlanError.message}`);
    }

    for (const commitment of commitments) {
      const targetAmount = breakdown.find((entry) => entry.commitment_id === commitment.id);
      if (!targetAmount) continue;

      const { error: updateCommitmentError } = await supabase
        .from("commitments")
        .update({
          amount_destination: targetAmount.destination_amount,
          fx_rate: targetAmount.fx_rate,
          payout_method: targetAmount.payout_method,
          provider_status: "quoted",
          recipient_snapshot: {
            ...(commitment.recipient_snapshot ?? {}),
            commitment_id: commitment.id,
            recipient_name: targetAmount.recipient_name,
            payout_method: targetAmount.payout_method,
            amount_destination: targetAmount.destination_amount,
            currency: destinationCurrency,
          },
        })
        .eq("id", commitment.id);

      if (updateCommitmentError) {
        throw new Error(`Failed to persist commitment quote data: ${updateCommitmentError.message}`);
      }
    }

    return jsonResponse({
      success: true,
      message: "Quote generated successfully",
      data: {
        plan_id: plan.id,
        quote: {
          source_currency: "GBP",
          destination_currency: destinationCurrency,
          source_amount: Number(totalSourceAmount.toFixed(2)),
          destination_amount: Number(totalDestinationAmount.toFixed(2)),
          amount_to_charge: customerPays,
          amount_to_receive: Number(amountToReceive.toFixed(2)),
          rate: quoteRate || 0,
          fee: providerFee,
          senda_fee: sendaFee,
          quote_reference: quoteReference,
          expires_at: expiresAt,
        },
        pricing: {
          senda_fee: sendaFee,
          provider_fee: providerFee,
          total_customer_pays: customerPays,
          quote_rate: quoteRate || 0,
          actual_collection_cost: providerFee,
        },
        breakdown,
      },
    });
  } catch (error) {
    if (error instanceof FincraApiError) {
      return jsonResponse({
        success: false,
        error: error.message,
        error_code: "FINCRA_QUOTE_FAILED",
      }, 502);
    }

    const message = error instanceof Error ? error.message : "Failed to generate quote";
    return jsonResponse({
      success: false,
      error: message,
      error_code: "QUOTE_GENERATION_FAILED",
    }, 500);
  }
});

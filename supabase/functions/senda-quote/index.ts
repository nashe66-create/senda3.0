import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.58.0";
import { fincraRequest, FincraApiError } from "../_shared/fincra.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

/** Supported pilot corridors: Mobile Money + Bank (Fincra). */
const SUPPORTED_CORRIDORS: Record<string, { currency: string; country: string }> = {
  KE: { currency: "KES", country: "KE" },
  GH: { currency: "GHS", country: "GH" },
  UG: { currency: "UGX", country: "UG" },
  ZM: { currency: "ZMW", country: "ZM" },
  TZ: { currency: "TZS", country: "TZ" },
  CM: { currency: "XAF", country: "CM" },
  CI: { currency: "XOF", country: "CI" },
  SN: { currency: "XOF", country: "SN" },
  BJ: { currency: "XOF", country: "BJ" },
  BF: { currency: "XOF", country: "BF" },
};

function jsonResponse(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function toMinorUnits(amount: number): number {
  return Math.round(Number(amount.toFixed(2)) * 100);
}

function fromMinorUnits(amount: number): number {
  return Number((amount / 100).toFixed(2));
}

/** Senda fee: 0.5% of principal, minimum £0.50. */
function calculateSendaFee(sourceAmount: number): number {
  const sourceMinorUnits = toMinorUnits(sourceAmount);
  return fromMinorUnits(Math.max(Math.round(sourceMinorUnits / 200), 50));
}

type FincraConversionQuote = {
  reference: string;
  rate: number;
  sourceAmount: number;
  destinationAmount: number;
  fee: number;
  amountToCharge: number | null;
  amountToReceive: number | null;
  expireAt: string;
  raw: unknown;
};

/**
 * Executable wallet-conversion quote (GBP → destination currency).
 * transactionType=conversion, paymentDestination=fliqpay_wallet.
 * Fee bearer = business so recipient amounts are not reduced by provider fee.
 * Quotes expire in ~30 seconds per Fincra contract.
 */
async function generateFincraConversionQuote(params: {
  sourceCurrency: string;
  destinationCurrency: string;
  amount: number;
  action: "send" | "receive";
  businessId: string;
}): Promise<FincraConversionQuote> {
  const body = {
    sourceCurrency: params.sourceCurrency,
    destinationCurrency: params.destinationCurrency,
    amount: String(params.amount),
    action: params.action,
    transactionType: "conversion",
    business: params.businessId,
    feeBearer: "business",
    paymentDestination: "fliqpay_wallet",
    beneficiaryType: "individual",
  };

  const response = await fincraRequest<any>("/quotes/generate", {
    method: "POST",
    body,
    idempotencyKey: `SENDA-QUOTE-${crypto.randomUUID()}`,
  });

  const root = response?.data ?? response;
  const reference = String(root?.reference ?? root?.quoteReference ?? "").trim();
  const rate = Number(root?.rate ?? root?.exchangeRate ?? root?.conversionRate ?? 0);
  const sourceAmount = Number(root?.sourceAmount ?? root?.amountToCharge ?? params.amount);
  const destinationAmount = Number(root?.destinationAmount ?? root?.amountToReceive ?? 0);
  const fee = Number(root?.fee ?? root?.providerFee ?? 0);
  const amountToCharge = root?.amountToCharge != null ? Number(root.amountToCharge) : null;
  const amountToReceive = root?.amountToReceive != null ? Number(root.amountToReceive) : null;
  const expireAt = String(root?.expireAt ?? root?.expiresAt ?? "");

  if (!reference) {
    throw new FincraApiError("Fincra quote response missing reference", 502, "MISSING_QUOTE_REFERENCE", response);
  }
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new FincraApiError("Fincra quote response missing valid rate", 502, "INVALID_QUOTE_RATE", response);
  }
  if (!Number.isFinite(destinationAmount) || destinationAmount <= 0) {
    throw new FincraApiError("Fincra quote response missing destination amount", 502, "INVALID_DESTINATION_AMOUNT", response);
  }

  // Default 30s if provider omits expiry
  const resolvedExpireAt = expireAt || new Date(Date.now() + 30_000).toISOString();

  return {
    reference,
    rate,
    sourceAmount: Number(sourceAmount.toFixed(2)),
    destinationAmount: Number(destinationAmount.toFixed(2)),
    fee: Number.isFinite(fee) && fee >= 0 ? Number(fee.toFixed(2)) : 0,
    amountToCharge: amountToCharge != null && Number.isFinite(amountToCharge) ? Number(amountToCharge.toFixed(2)) : null,
    amountToReceive: amountToReceive != null && Number.isFinite(amountToReceive) ? Number(amountToReceive.toFixed(2)) : null,
    expireAt: resolvedExpireAt,
    raw: response,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const businessId = Deno.env.get("FINCRA_BUSINESS_ID");

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Supabase server configuration is missing");
    }
    if (!businessId) {
      throw new Error("FINCRA_BUSINESS_ID is not configured");
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
    const userId = user.id;

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

    // Verify the user owns the plan
    const { data: plan, error: planError } = await supabase
      .from("plans")
      .select("id, user_id, status, total_gbp, pricing_mode, destination_country, destination_currency")
      .eq("id", payload.plan_id)
      .eq("user_id", userId)
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
      .eq("id", userId)
      .maybeSingle();

    // Provider-neutral KYC gate (Flutterwave sender_id no longer required)
    if (profile?.kyc_status !== "verified") {
      return jsonResponse({
        success: false,
        error: "Complete account verification before requesting a quote.",
        error_code: "SENDER_NOT_READY",
      }, 403);
    }

    const planPricingMode = plan.pricing_mode as "fixed_source" | "fixed_destination";
    const planDestinationCountry = String(plan.destination_country ?? "").toUpperCase();
    const planDestinationCurrency = String(plan.destination_currency ?? "").toUpperCase();

    if (!planPricingMode || (planPricingMode !== "fixed_source" && planPricingMode !== "fixed_destination")) {
      return jsonResponse({
        success: false,
        error: "Plan pricing mode is invalid",
        error_code: "INVALID_PLAN_PRICING_MODE",
      }, 400);
    }

    if (!planDestinationCountry || !planDestinationCurrency) {
      return jsonResponse({
        success: false,
        error: "Plan corridor is incomplete. Destination country and currency are required.",
        error_code: "PLAN_CORRIDOR_INCOMPLETE",
      }, 400);
    }

    // Corridor allow-list for current pilot set
    const corridor = SUPPORTED_CORRIDORS[planDestinationCountry];
    if (!corridor || corridor.currency !== planDestinationCurrency) {
      return jsonResponse({
        success: false,
        error: `Corridor ${planDestinationCountry}/${planDestinationCurrency} is not enabled for Fincra payouts yet. Supported: KE/KES, GH/GHS, UG/UGX, ZM/ZMW, TZ/TZS, CM/XAF, CI|SN|BJ|BF/XOF.`,
        error_code: "UNSUPPORTED_CORRIDOR",
      }, 422);
    }

    // Fetch commitments with recipients
    const { data: commitments, error: commitError } = await supabase
      .from("commitments")
      .select(
        "id, recipient_id, amount_gbp, amount_destination, fx_rate, receiving_method, destination_currency, recipient:recipients(id, name, country, receiving_method, phone, mobile_money_network, mobile_money_provider, bank_code, account_number, destination_country, currency)",
      )
      .eq("plan_id", payload.plan_id)
      .order("created_at", { ascending: true });

    if (commitError || !commitments) {
      return jsonResponse({ success: false, error: "Failed to fetch commitments" }, 500);
    }

    if (commitments.length === 0) {
      return jsonResponse({ success: false, error: "No recipients in this plan" }, 400);
    }

    // Validate allocation mapping by commitment_id (no array-order reliance)
    const planCommitmentIds = new Set(commitments.map((c) => c.id));
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

    for (const c of commitments) {
      if (!allocationsByCommitmentId.has(c.id)) {
        return jsonResponse({
          success: false,
          error: `Missing allocation for commitment_id ${c.id}`,
          error_code: "MISSING_ALLOCATION",
        }, 400);
      }
    }

    // Server-side corridor validation against authoritative plan data
    for (const c of commitments) {
      const recipient = c.recipient as any;
      if (!recipient) {
        return jsonResponse({
          success: false,
          error: `Commitment ${c.id} has no recipient attached`,
          error_code: "MISSING_RECIPIENT",
        }, 400);
      }

      const recipientCountry = String(recipient.country ?? "").toUpperCase();
      if (recipientCountry !== planDestinationCountry) {
        return jsonResponse({
          success: false,
          error: `Recipient ${recipient.name ?? c.recipient_id ?? c.id} is in ${recipient.country ?? "unknown"}, but plan destination country is ${planDestinationCountry}`,
          error_code: "RECIPIENT_COUNTRY_MISMATCH",
        }, 400);
      }

      const commitmentCurrency = String(c.destination_currency ?? "").toUpperCase();
      if (commitmentCurrency !== planDestinationCurrency) {
        return jsonResponse({
          success: false,
          error: `Commitment ${c.id} destination currency ${c.destination_currency ?? "unknown"} does not match plan destination currency ${planDestinationCurrency}`,
          error_code: "COMMITMENT_CURRENCY_MISMATCH",
        }, 400);
      }

      const recipientCurrency = String(recipient.currency ?? "").toUpperCase();
      if (recipientCurrency && recipientCurrency !== planDestinationCurrency) {
        return jsonResponse({
          success: false,
          error: `Recipient ${recipient.name ?? c.recipient_id ?? c.id} currency ${recipient.currency} does not match plan destination currency ${planDestinationCurrency}`,
          error_code: "RECIPIENT_CURRENCY_MISMATCH",
        }, 400);
      }

      // Payout method must be bank or mobile_money for these corridors
      const method = String(c.receiving_method ?? recipient.receiving_method ?? "").toLowerCase();
      if (method && method !== "bank_account" && method !== "mobile_money" && method !== "cash_pickup") {
        return jsonResponse({
          success: false,
          error: `Unsupported receiving method ${method} for commitment ${c.id}`,
          error_code: "UNSUPPORTED_PAYOUT_METHOD",
        }, 400);
      }
    }

    // Build provisional totals from allocations so we know what to quote
    let provisionalSource = 0;
    let provisionalDestination = 0;

    for (const c of commitments) {
      const allocation = allocationsByCommitmentId.get(c.id)!;
      if (planPricingMode === "fixed_source") {
        const src = Number(allocation.source_amount ?? c.amount_gbp ?? 0);
        if (!(src > 0)) {
          return jsonResponse({
            success: false,
            error: `source_amount must be > 0 for commitment ${c.id}`,
            error_code: "INVALID_SOURCE_AMOUNT",
          }, 400);
        }
        provisionalSource += src;
      } else {
        const dest = Number(allocation.destination_amount ?? c.amount_destination ?? 0);
        if (!(dest > 0)) {
          return jsonResponse({
            success: false,
            error: `destination_amount must be > 0 for commitment ${c.id}`,
            error_code: "INVALID_DESTINATION_AMOUNT",
          }, 400);
        }
        provisionalDestination += dest;
      }
    }

    if (planPricingMode === "fixed_source" && provisionalSource <= 0) {
      return jsonResponse({ success: false, error: "Total amount must be greater than zero" }, 400);
    }
    if (planPricingMode === "fixed_destination" && provisionalDestination <= 0) {
      return jsonResponse({ success: false, error: "Total amount must be greater than zero" }, 400);
    }

    // Executable Fincra conversion quote for the whole order
    const quoteAction: "send" | "receive" = planPricingMode === "fixed_source" ? "send" : "receive";
    const quoteAmount = planPricingMode === "fixed_source" ? provisionalSource : provisionalDestination;

    let fincraQuote: FincraConversionQuote;
    try {
      fincraQuote = await generateFincraConversionQuote({
        sourceCurrency: "GBP",
        destinationCurrency: planDestinationCurrency,
        amount: Number(quoteAmount.toFixed(2)),
        action: quoteAction,
        businessId,
      });
    } catch (error) {
      console.error("Fincra conversion quote failed", error instanceof FincraApiError
        ? { status: error.status, code: error.code }
        : { message: error instanceof Error ? error.message : "unknown" });

      const status = error instanceof FincraApiError
        ? (error.status >= 400 && error.status < 500 ? 422 : 502)
        : 502;

      return jsonResponse({
        success: false,
        error: error instanceof Error ? error.message : "Failed to obtain Fincra conversion quote",
        error_code: error instanceof FincraApiError ? (error.code ?? "FINCRA_QUOTE_FAILED") : "FINCRA_QUOTE_FAILED",
      }, status);
    }

    const fxRate = fincraQuote.rate;

    // Per-recipient breakdown using the locked executable rate
    const recipientBreakdown: Array<{
      commitment_id: string;
      recipient_name: string;
      source_amount: number;
      destination_amount: number;
      fx_rate: number;
      payout_method: string;
    }> = [];

    let totalSourceAmount = 0;
    let totalDestinationAmount = 0;

    for (const c of commitments) {
      const allocation = allocationsByCommitmentId.get(c.id)!;
      const recipient = c.recipient as any;

      let sourceAmount: number;
      let destinationAmount: number;

      if (planPricingMode === "fixed_source") {
        sourceAmount = Number(allocation?.source_amount ?? c.amount_gbp);
        destinationAmount = Number((sourceAmount * fxRate).toFixed(2));
      } else {
        destinationAmount = Number(allocation?.destination_amount ?? c.amount_destination);
        sourceAmount = Number((destinationAmount / fxRate).toFixed(2));
      }

      totalSourceAmount += sourceAmount;
      totalDestinationAmount += destinationAmount;

      const payoutMethod = c.receiving_method === "bank_account"
        ? "bank"
        : c.receiving_method === "mobile_money"
        ? "mobile_money"
        : c.receiving_method === "cash_pickup"
        ? "cash_pickup"
        : "mobile_money";

      recipientBreakdown.push({
        commitment_id: c.id,
        recipient_name: recipient?.name ?? "Unknown",
        source_amount: sourceAmount,
        destination_amount: destinationAmount,
        fx_rate: fxRate,
        payout_method: payoutMethod,
      });
    }

    const sourceAmount = Number(totalSourceAmount.toFixed(2));
    const destinationAmount = Number(totalDestinationAmount.toFixed(2));
    const sendaFee = calculateSendaFee(sourceAmount);

    // Conversion fee is from the Fincra quote (business-borne). Collection fee is
    // unknown until checkout completes — do not invent it.
    const providerConversionFee = fincraQuote.fee;
    const collectionFee: number | null = null;
    const sendaFxMargin = 0;

    // Customer pays principal + Senda fee. Provider conversion fee is settled
    // from Senda's business wallet after GBP collection. Collection cost is
    // applied once verified at checkout.
    const processingFee = sendaFee;
    const customerPays = fromMinorUnits(
      toMinorUnits(sourceAmount) + toMinorUnits(processingFee),
    );

    const now = new Date();
    // Trust Fincra expiry (typically 30s). Do not extend.
    const expiresAt = new Date(fincraQuote.expireAt);

    // Persist quote on plan (including conversion quote reference for later stage)
    const planUpdate: Record<string, unknown> = {
      source_amount: sourceAmount,
      destination_amount: destinationAmount,
      customer_pays: customerPays,
      customer_fx_rate: fxRate,
      provider_fx_rate: fxRate,
      provider_fee: providerConversionFee,
      senda_fee: sendaFee,
      processing_fee: processingFee,
      senda_fx_margin: sendaFxMargin,
      actual_collection_cost: collectionFee,
      quote_created_at: now.toISOString(),
      quote_expires_at: expiresAt.toISOString(),
      quote_locked_at: null,
      status: "quoted",
      total_gbp: sourceAmount,
      funding_provider: "fincra",
      conversion_status: "quoted",
      fincra_conversion_quote_reference: fincraQuote.reference,
      conversion_source_amount: sourceAmount,
      conversion_destination_amount: destinationAmount,
      conversion_rate: fxRate,
      conversion_fee: providerConversionFee,
      conversion_expires_at: expiresAt.toISOString(),
    };

    const { error: updateError } = await supabase
      .from("plans")
      .update(planUpdate)
      .eq("id", payload.plan_id)
      .eq("user_id", userId);

    if (updateError) {
      // Foundation migration may not be applied yet — fall back to legacy columns only
      console.warn("Plan update with Fincra conversion fields failed; retrying with core columns", {
        code: updateError.code,
        message: updateError.message,
      });

      const { error: fallbackError } = await supabase
        .from("plans")
        .update({
          source_amount: sourceAmount,
          destination_amount: destinationAmount,
          customer_pays: customerPays,
          customer_fx_rate: fxRate,
          provider_fx_rate: fxRate,
          provider_fee: providerConversionFee,
          senda_fee: sendaFee,
          processing_fee: processingFee,
          senda_fx_margin: sendaFxMargin,
          quote_created_at: now.toISOString(),
          quote_expires_at: expiresAt.toISOString(),
          quote_locked_at: null,
          status: "quoted",
          total_gbp: sourceAmount,
        })
        .eq("id", payload.plan_id)
        .eq("user_id", userId);

      if (fallbackError) {
        console.error("Failed to update plan with quote:", fallbackError);
        return jsonResponse({ success: false, error: "Failed to save quote" }, 500);
      }
    }

    // Update each commitment with calculated amounts
    for (const rb of recipientBreakdown) {
      const { error: commitUpdateError } = await supabase
        .from("commitments")
        .update({
          amount_gbp: rb.source_amount,
          amount_destination: rb.destination_amount,
          fx_rate: rb.fx_rate,
          payout_method: rb.payout_method,
        })
        .eq("id", rb.commitment_id)
        .eq("user_id", userId);

      if (commitUpdateError) {
        console.error("Failed to update commitment after quote", {
          commitment_id: rb.commitment_id,
          error: commitUpdateError.message,
        });
        // Continue; plan quote is already stored. Client can re-quote if needed.
      }
    }

    return jsonResponse({
      success: true,
      plan_id: payload.plan_id,
      provider: "fincra",
      pricing_mode: planPricingMode,
      source_currency: "GBP",
      destination_country: planDestinationCountry,
      destination_currency: planDestinationCurrency,
      source_amount: sourceAmount,
      destination_amount: destinationAmount,
      customer_pays: customerPays,
      customer_fx_rate: fxRate,
      provider_fx_rate: fxRate,
      provider_fee: providerConversionFee,
      senda_fee: sendaFee,
      processing_fee: processingFee,
      senda_fx_margin: sendaFxMargin,
      actual_collection_cost: collectionFee,
      quote_reference: fincraQuote.reference,
      quote_created_at: now.toISOString(),
      quote_expires_at: expiresAt.toISOString(),
      quote_note:
        "Executable Fincra conversion quote. Valid for ~30 seconds. GBP collection is separate; conversion runs after GBP settles into the merchant wallet.",
      recipients: recipientBreakdown,
    });
  } catch (error) {
    console.error("senda-quote error:", error);
    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : "Unexpected error",
    }, 500);
  }
});

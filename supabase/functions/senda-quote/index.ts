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

async function fetchFxRate(accessToken: string, sourceCurrency: string, destinationCurrency: string, amount: number): Promise<{ rate: number; destinationAmount: number | null }> {
  const response = await fetch(`${FLW_BASE_URL}/transfers/rates`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Trace-Id": crypto.randomUUID(),
      "X-Idempotency-Key": `SENDA-FX-${Date.now()}`,
    },
    body: JSON.stringify({
      source: { currency: sourceCurrency },
      destination: { currency: destinationCurrency, amount },
      precision: 6,
    }),
  });

  const text = await response.text();
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw_response: text }; }

  if (!response.ok) {
    throw new Error(data?.message ?? "Failed to fetch FX rate");
  }

  const root = data?.data ?? data;
  const rate = Number(root?.rate ?? root?.exchange_rate ?? root?.conversion_rate ?? root?.rate_card?.rate ?? 0);
  const destinationAmount = root?.destination?.amount ?? root?.destination_amount ?? null;

  return { rate, destinationAmount };
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
    const userId = user.id;

    let payload: {
      plan_id: string;
      pricing_mode: "fixed_source" | "fixed_destination";
      destination_country: string;
      destination_currency: string;
      allocations: Array<{
        commitment_id?: string;
        recipient_id?: string;
        source_amount?: number;
        destination_amount?: number;
      }>;
    };
    try { payload = await req.json(); } catch {
      return jsonResponse({ success: false, error: "Invalid JSON request body" }, 400);
    }

    if (!payload.plan_id || !payload.pricing_mode || !payload.destination_country || !payload.destination_currency) {
      return jsonResponse({
        success: false,
        error: "Missing required fields: plan_id, pricing_mode, destination_country, destination_currency",
      }, 400);
    }

    if (!payload.allocations || payload.allocations.length === 0) {
      return jsonResponse({ success: false, error: "At least one allocation is required" }, 400);
    }

    // Verify the user owns the plan
    const { data: plan, error: planError } = await supabase
      .from("plans")
      .select("id, user_id, status, total_gbp")
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

    // Fetch commitments with recipients
    const { data: commitments, error: commitError } = await supabase
      .from("commitments")
      .select("id, recipient_id, amount_gbp, amount_destination, fx_rate, receiving_method, destination_currency, recipient:recipients(id, name, country, receiving_method, phone, mobile_money_network, mobile_money_provider, bank_code, account_number, destination_country, currency, flutterwave_recipient_id)")
      .eq("plan_id", payload.plan_id)
      .order("created_at", { ascending: true });

    if (commitError || !commitments) {
      return jsonResponse({ success: false, error: "Failed to fetch commitments" }, 500);
    }

    if (commitments.length === 0) {
      return jsonResponse({ success: false, error: "No recipients in this plan" }, 400);
    }

    // Enforce one country/currency: verify all commitments match the requested destination_currency
    for (const c of commitments) {
      if (c.destination_currency !== payload.destination_currency) {
        return jsonResponse({
          success: false,
          error: `All recipients must use the same destination currency. Expected ${payload.destination_currency}, found ${c.destination_currency}`,
          error_code: "MIXED_CURRENCIES",
        }, 400);
      }
    }

    // Fetch FX rate from Flutterwave
    const accessToken = await getAccessToken();
    const fxAmount = payload.pricing_mode === "fixed_source"
      ? payload.allocations.reduce((sum, a) => sum + (a.source_amount ?? 0), 0)
      : payload.allocations.reduce((sum, a) => sum + (a.destination_amount ?? 0), 0);

    if (fxAmount <= 0) {
      return jsonResponse({ success: false, error: "Total amount must be greater than zero" }, 400);
    }

    const { rate: fxRate } = await fetchFxRate(accessToken, "GBP", payload.destination_currency, fxAmount);

    if (fxRate <= 0) {
      return jsonResponse({ success: false, error: "Failed to fetch valid FX rate from Flutterwave" }, 502);
    }

    // Calculate per-recipient amounts based on pricing mode
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

    for (let i = 0; i < commitments.length; i++) {
      const c = commitments[i];
      const allocation = payload.allocations[i];
      const recipient = c.recipient as any;

      let sourceAmount: number;
      let destinationAmount: number;

      if (payload.pricing_mode === "fixed_source") {
        sourceAmount = Number(allocation?.source_amount ?? c.amount_gbp);
        destinationAmount = Number((sourceAmount * fxRate).toFixed(2));
      } else {
        destinationAmount = Number(allocation?.destination_amount ?? c.amount_destination);
        sourceAmount = Number((destinationAmount / fxRate).toFixed(2));
      }

      totalSourceAmount += sourceAmount;
      totalDestinationAmount += destinationAmount;

      // Determine payout method from recipient
      const payoutMethod = c.receiving_method === "bank_account" ? "bank"
        : c.receiving_method === "mobile_money" ? "mobile_money"
        : c.receiving_method === "cash_pickup" ? "cash_pickup"
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

    // For fixed_source: validate that allocated source amounts match total
    if (payload.pricing_mode === "fixed_source") {
      const allocatedTotal = payload.allocations.reduce((sum, a) => sum + (a.source_amount ?? 0), 0);
      if (Math.abs(allocatedTotal - totalSourceAmount) > 0.01) {
        return jsonResponse({
          success: false,
          error: `Allocation mismatch: allocated ${allocatedTotal} does not equal total ${totalSourceAmount}`,
          error_code: "ALLOCATION_MISMATCH",
        }, 400);
      }
    }

    // Calculate fee (for now, estimate as 0 — Flutterwave fees are typically deducted from the destination amount
    // or charged separately. We capture the actual fee from the charge response later.)
    const providerFee = 0;
    const customerPays = Number(totalSourceAmount.toFixed(2)) + Number(providerFee.toFixed(2));

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 60_000);

    // Update the plan with quote data
    const { error: updateError } = await supabase
      .from("plans")
      .update({
        pricing_mode: payload.pricing_mode,
        destination_country: payload.destination_country,
        destination_currency: payload.destination_currency,
        source_amount: Number(totalSourceAmount.toFixed(2)),
        destination_amount: Number(totalDestinationAmount.toFixed(2)),
        customer_pays: customerPays,
        customer_fx_rate: fxRate,
        provider_fx_rate: fxRate,
        provider_fee: providerFee,
        senda_fx_margin: 0,
        quote_created_at: now.toISOString(),
        quote_expires_at: expiresAt.toISOString(),
        quote_locked_at: null,
        status: "quoted",
        total_gbp: Number(totalSourceAmount.toFixed(2)),
      })
      .eq("id", payload.plan_id)
      .eq("user_id", userId);

    if (updateError) {
      console.error("Failed to update plan with quote:", updateError);
      return jsonResponse({ success: false, error: "Failed to save quote" }, 500);
    }

    // Update each commitment with the calculated amounts
    for (const rb of recipientBreakdown) {
      await supabase
        .from("commitments")
        .update({
          amount_gbp: rb.source_amount,
          amount_destination: rb.destination_amount,
          fx_rate: rb.fx_rate,
          payout_method: rb.payout_method,
        })
        .eq("id", rb.commitment_id)
        .eq("user_id", userId);
    }

    return jsonResponse({
      success: true,
      plan_id: payload.plan_id,
      pricing_mode: payload.pricing_mode,
      source_currency: "GBP",
      destination_country: payload.destination_country,
      destination_currency: payload.destination_currency,
      source_amount: Number(totalSourceAmount.toFixed(2)),
      destination_amount: Number(totalDestinationAmount.toFixed(2)),
      customer_pays: customerPays,
      customer_fx_rate: fxRate,
      provider_fx_rate: fxRate,
      provider_fee: providerFee,
      senda_fx_margin: 0,
      quote_created_at: now.toISOString(),
      quote_expires_at: expiresAt.toISOString(),
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

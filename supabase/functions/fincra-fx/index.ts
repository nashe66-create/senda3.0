import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.58.0";
import { fincraRequest, FincraApiError } from "../_shared/fincra.ts";

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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ success: false, error: "Method not allowed" }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!url || !anonKey) throw new Error("Supabase configuration is missing");

    const authorization = req.headers.get("Authorization");
    if (!authorization) return jsonResponse({ success: false, error: "Unauthorized" }, 401);

    const authClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error: authError } = await authClient.auth.getUser();
    if (authError || !user) return jsonResponse({ success: false, error: "Unauthorized" }, 401);

    let body: Record<string, unknown>;
    try { body = await req.json(); } catch {
      return jsonResponse({ success: false, error: "Invalid JSON request body" }, 400);
    }

    const sourceCurrency = String(body.source_currency ?? body.sourceCurrency ?? "GBP").toUpperCase();
    const destinationCurrency = String(body.destination_currency ?? body.destinationCurrency ?? "NGN").toUpperCase();
    const amount = Number(body.amount ?? 1);
    if (!/^[A-Z]{3}$/.test(sourceCurrency) || !/^[A-Z]{3}$/.test(destinationCurrency)) {
      return jsonResponse({ success: false, error: "Currencies must be valid three-letter codes" }, 400);
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return jsonResponse({ success: false, error: "Amount must be greater than zero" }, 400);
    }

    if (sourceCurrency === destinationCurrency) {
      return jsonResponse({ success: true, provider: "fincra", source_currency: sourceCurrency,
        destination_currency: destinationCurrency, amount, rate: 1, destination_amount: amount,
        rate_timestamp: new Date().toISOString(), quote_reference: null, quote_expires_at: null });
    }

    // Market data is indicative only. The executable quote endpoint requires
    // business + transaction + payout-rail context and returns a 30s reference.
    const pair = `${sourceCurrency}-${destinationCurrency}`;
    const response = await fincraRequest<any>(
      `/quotes/treasury-orders/rates?currencyPair=${encodeURIComponent(pair)}&perPage=100`,
    );
    const rates = response?.data?.rates;
    if (!response?.success || !Array.isArray(rates)) {
      return jsonResponse({ success: false, error: "Fincra rates endpoint returned an unexpected response" }, 502);
    }

    const matchingRates = rates.filter((item: any) =>
      String(item.baseCurrency).toUpperCase() === sourceCurrency &&
      String(item.quoteCurrency).toUpperCase() === destinationCurrency
    );
    if (matchingRates.length === 0) {
      return jsonResponse({ success: false, error: `Fincra returned no market rates for ${pair}`,
        error_code: "RATE_UNAVAILABLE" }, 422);
    }

    return jsonResponse({
      success: true,
      provider: "fincra",
      mode: "indicative_market_rates",
      source_currency: sourceCurrency,
      destination_currency: destinationCurrency,
      amount,
      rates: matchingRates,
      rate_timestamp: response?.data?.pagination?.timestamp ?? null,
      executable_quote: false,
      quote_note: "Indicative buy/sell rates only. Generate a Fincra quote with transaction type, business, payout rail and fee bearer before displaying a locked customer rate. Fincra quotes expire after 30 seconds.",
    });
  } catch (error) {
    console.error("Fincra FX lookup failed", error instanceof FincraApiError ? {
      status: error.status, code: error.code,
    } : { message: error instanceof Error ? error.message : "Unknown error" });
    const status = error instanceof FincraApiError ? (error.status >= 400 && error.status < 500 ? 422 : 502) : 500;
    return jsonResponse({ success: false, error: error instanceof Error ? error.message : "Fincra FX lookup failed" }, status);
  }
});

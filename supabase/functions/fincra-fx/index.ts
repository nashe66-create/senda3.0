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

    // Verify the caller's JWT using Supabase Auth; never decode JWTs locally.
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
    if (!/^[A-Z]{3}$/.test(sourceCurrency) || !/^[A-Z]{3}$/.test(destinationCurrency)) {
      return jsonResponse({ success: false, error: "Currencies must be valid three-letter codes" }, 400);
    }
    if (sourceCurrency === destinationCurrency) {
      return jsonResponse({ success: true, provider: "fincra", source_currency: sourceCurrency,
        destination_currency: destinationCurrency, rate: 1, rate_timestamp: new Date().toISOString() });
    }

    const pair = `${sourceCurrency}-${destinationCurrency}`;
    const response = await fincraRequest<any>(`/quotes/treasury-orders/rates?currencyPair=${encodeURIComponent(pair)}&perPage=100`);
    const rates = response?.data?.rates;
    if (!Array.isArray(rates)) {
      return jsonResponse({ success: false, error: "Fincra did not return an FX rates list" }, 502);
    }

    // A remittance sends source funds to the destination. Prefer Fincra's sell
    // side for the base/source currency; do not silently invert a missing pair.
    const match = rates.find((item: any) =>
      String(item.baseCurrency).toUpperCase() === sourceCurrency &&
      String(item.quoteCurrency).toUpperCase() === destinationCurrency &&
      String(item.side).toLowerCase() === "sell"
    );
    const rate = Number(match?.price);
    if (!Number.isFinite(rate) || rate <= 0) {
      return jsonResponse({ success: false, error: `Fincra has no sell rate for ${pair}`, error_code: "RATE_UNAVAILABLE" }, 422);
    }

    return jsonResponse({
      success: true,
      provider: "fincra",
      source_currency: sourceCurrency,
      destination_currency: destinationCurrency,
      rate,
      rate_timestamp: response?.data?.pagination?.timestamp ?? new Date().toISOString(),
    });
  } catch (error) {
    console.error("Fincra FX lookup failed", error instanceof FincraApiError ? {
      status: error.status, code: error.code,
    } : { message: error instanceof Error ? error.message : "Unknown error" });
    const status = error instanceof FincraApiError ? (error.status >= 400 && error.status < 500 ? 422 : 502) : 500;
    return jsonResponse({ success: false, error: error instanceof Error ? error.message : "Fincra FX lookup failed" }, status);
  }
});

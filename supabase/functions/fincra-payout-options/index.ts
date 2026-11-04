import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.58.0";
import { fincraRequest, FincraApiError } from "../_shared/fincra.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// Explicitly documented Fincra payout corridors. Provider availability is
// still checked live via /core/banks before offering a route to a user.
const CORRIDORS = [
  { country_code: "NG", country_name: "Nigeria", currency: "NGN", methods: ["bank_account"] },
  { country_code: "GH", country_name: "Ghana", currency: "GHS", methods: ["bank_account", "mobile_money_wallet"] },
  { country_code: "KE", country_name: "Kenya", currency: "KES", methods: ["bank_account", "mobile_money_wallet"] },
  { country_code: "UG", country_name: "Uganda", currency: "UGX", methods: ["bank_account", "mobile_money_wallet"] },
  { country_code: "TZ", country_name: "Tanzania", currency: "TZS", methods: ["bank_account", "mobile_money_wallet"] },
  { country_code: "ZM", country_name: "Zambia", currency: "ZMW", methods: ["bank_account", "mobile_money_wallet"] },
  { country_code: "ZA", country_name: "South Africa", currency: "ZAR", methods: ["bank_account"] },
  { country_code: "EG", country_name: "Egypt", currency: "EGP", methods: ["bank_account", "mobile_money_wallet", "cash_pick_up"] },
  { country_code: "CI", country_name: "Côte d’Ivoire", currency: "XOF", methods: ["bank_account", "mobile_money_wallet"] },
  { country_code: "SN", country_name: "Senegal", currency: "XOF", methods: ["bank_account", "mobile_money_wallet"] },
  { country_code: "CM", country_name: "Cameroon", currency: "XAF", methods: ["bank_account", "mobile_money_wallet"] },
  { country_code: "US", country_name: "United States", currency: "USD", methods: ["bank_account"] },
  { country_code: "GB", country_name: "United Kingdom", currency: "GBP", methods: ["bank_account"] },
  { country_code: "EU", country_name: "Eurozone", currency: "EUR", methods: ["bank_account"] },
] as const;

function jsonResponse(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "GET") return jsonResponse({ success: false, error: "Method not allowed" }, 405);

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
    const { data: { user }, error } = await authClient.auth.getUser();
    if (error || !user) return jsonResponse({ success: false, error: "Unauthorized" }, 401);

    const query = new URL(req.url).searchParams;
    const action = query.get("action") ?? "countries";
    const country = (query.get("country") ?? "").toUpperCase();
    const currency = (query.get("currency") ?? "").toUpperCase();
    const method = query.get("payment_destination") ?? query.get("paymentDestination") ?? "";

    if (action === "countries") {
      return jsonResponse({ success: true, provider: "fincra", countries: CORRIDORS });
    }
    if (action !== "providers" || (!country && !currency)) {
      return jsonResponse({ success: false, error: "Use action=providers and provide country or currency" }, 400);
    }
    if (method && !["bank_account", "mobile_money_wallet", "cash_pick_up"].includes(method)) {
      return jsonResponse({ success: false, error: "Unsupported payment_destination filter" }, 400);
    }

    const supported = CORRIDORS.filter(c =>
      (!country || c.country_code === country) && (!currency || c.currency === currency)
    );
    if (supported.length === 0) {
      return jsonResponse({ success: false, error: "Fincra corridor is not configured", error_code: "UNSUPPORTED_CORRIDOR" }, 422);
    }
    const methods = [...new Set(supported.flatMap(c => c.methods))];
    const destinations = method ? [method] : methods;
    const results = await Promise.all(destinations.map(async paymentDestination => {
      if (!methods.includes(paymentDestination as any)) return { payment_destination: paymentDestination, providers: [] };
      const params = new URLSearchParams();
      if (country) params.set("country", country);
      if (currency) params.set("currency", currency);
      params.set("paymentDestination", paymentDestination);
      const response = await fincraRequest<any>(`/core/banks?${params.toString()}`);
      if (!response?.success || !Array.isArray(response?.data)) {
        throw new Error(`Fincra provider list failed for ${paymentDestination}`);
      }
      return { payment_destination: paymentDestination, providers: response.data };
    }));

    return jsonResponse({
      success: true, provider: "fincra",
      corridor: supported[0],
      payment_destinations: results,
      source: "Fincra /core/banks live response",
    });
  } catch (error) {
    console.error("fincra-payout-options failed", error instanceof FincraApiError ? { status: error.status, code: error.code } : error);
    const status = error instanceof FincraApiError && error.status >= 400 && error.status < 500 ? 422 : 502;
    return jsonResponse({ success: false, error: error instanceof Error ? error.message : "Fincra payout options failed" }, status);
  }
});

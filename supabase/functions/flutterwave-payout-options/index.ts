import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.58.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
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

  if (req.method !== "GET") {
    return jsonResponse({ success: false, error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Supabase server configuration is missing");
    }
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const url = new URL(req.url);
    const action = url.searchParams.get("action");
    const country = url.searchParams.get("country");

    // =======================================================
    // GET /flutterwave-payout-options?action=countries
    // Returns all countries where mobile_money_supported = true
    // =======================================================
    if (action === "countries" || (!action && !country)) {
      const { data: countries, error } = await supabase
        .from("payout_corridor_countries")
        .select("country_code, country_name, currency, mobile_money_supported, cash_pickup_supported, bank_supported")
        .order("country_name");

      if (error) {
        return jsonResponse({ success: false, error: error.message }, 500);
      }

      const filtered = (countries ?? []).filter((c: any) => c.mobile_money_supported || c.bank_supported);

      return jsonResponse({
        success: true,
        source_country: "GB",
        source_currency: "GBP",
        countries: filtered,
      });
    }

    // =======================================================
    // GET /flutterwave-payout-options?action=networks&country=GH
    // Returns mobile money networks for a specific country
    // =======================================================
    if (action === "networks" || (country && !action)) {
      const countryCode = (country || "").toUpperCase();
      if (!countryCode || !/^[A-Z]{2}$/.test(countryCode)) {
        return jsonResponse({ success: false, error: "Invalid country code" }, 400);
      }

      const { data: networks, error } = await supabase
        .from("payout_corridor_networks")
        .select("network_code, network_name")
        .eq("country_code", countryCode)
        .order("network_name");

      if (error) {
        return jsonResponse({ success: false, error: error.message }, 500);
      }

      const { data: countryInfo } = await supabase
        .from("payout_corridor_countries")
        .select("country_code, country_name, currency, mobile_money_supported, bank_supported")
        .eq("country_code", countryCode)
        .maybeSingle();

      return jsonResponse({
        success: true,
        country: countryInfo ?? null,
        networks: networks ?? [],
      });
    }

    // =======================================================
    // GET /flutterwave-payout-options?action=banks&country=GH
    // Returns cached bank list for a specific country
    // =======================================================
    if (action === "banks") {
      const countryCode = (country || "").toUpperCase();
      if (!countryCode || !/^[A-Z]{2}$/.test(countryCode)) {
        return jsonResponse({ success: false, error: "Invalid country code" }, 400);
      }

      const { data: banks, error } = await supabase
        .from("payout_corridor_banks")
        .select("bank_code, bank_name")
        .eq("country_code", countryCode)
        .order("bank_name");

      if (error) {
        return jsonResponse({ success: false, error: error.message }, 500);
      }

      const { data: countryInfo } = await supabase
        .from("payout_corridor_countries")
        .select("country_code, country_name, currency, bank_supported")
        .eq("country_code", countryCode)
        .maybeSingle();

      return jsonResponse({
        success: true,
        country: countryInfo ?? null,
        banks: banks ?? [],
      });
    }

    // =======================================================
    // GET /flutterwave-payout-options?action=all&country=GH
    // Returns both networks and banks for a country in one call
    // =======================================================
    if (action === "all") {
      const countryCode = (country || "").toUpperCase();
      if (!countryCode || !/^[A-Z]{2}$/.test(countryCode)) {
        return jsonResponse({ success: false, error: "Invalid country code" }, 400);
      }

      const { data: networks, error: netError } = await supabase
        .from("payout_corridor_networks")
        .select("network_code, network_name")
        .eq("country_code", countryCode)
        .order("network_name");

      if (netError) {
        return jsonResponse({ success: false, error: netError.message }, 500);
      }

      const { data: banks, error: bankError } = await supabase
        .from("payout_corridor_banks")
        .select("bank_code, bank_name")
        .eq("country_code", countryCode)
        .order("bank_name");

      if (bankError) {
        return jsonResponse({ success: false, error: bankError.message }, 500);
      }

      const { data: countryInfo } = await supabase
        .from("payout_corridor_countries")
        .select("country_code, country_name, currency, mobile_money_supported, cash_pickup_supported, bank_supported")
        .eq("country_code", countryCode)
        .maybeSingle();

      return jsonResponse({
        success: true,
        country: countryInfo ?? null,
        networks: networks ?? [],
        banks: banks ?? [],
      });
    }

    return jsonResponse({ success: false, error: "Unsupported action" }, 400);
  } catch (error) {
    console.error("Payout options error:", error);
    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : "Unexpected error",
    }, 500);
  }
});

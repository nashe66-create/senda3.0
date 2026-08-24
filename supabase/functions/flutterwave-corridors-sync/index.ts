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

// Static ISO 3166-1 country list — this is geography, not a Flutterwave-specific fact.
// The discovery pool is the full set of African countries we check against Flutterwave.
const COUNTRY_DISCOVERY_CODES = [
  "AO", "BF", "BI", "CM", "CI", "CD", "CG", "EG", "ET", "GH",
  "GN", "KE", "LR", "MW", "ML", "MZ", "NG", "RW", "SN", "SL",
  "SO", "ZA", "TZ", "UG", "ZM",
];

const COUNTRY_NAMES: Record<string, string> = {
  AO: "Angola", BF: "Burkina Faso", BI: "Burundi", CM: "Cameroon", CI: "Côte d'Ivoire",
  CD: "DR Congo", CG: "Congo", EG: "Egypt", ET: "Ethiopia", GH: "Ghana",
  GN: "Guinea", KE: "Kenya", LR: "Liberia", MW: "Malawi", ML: "Mali",
  MZ: "Mozambique", NG: "Nigeria", RW: "Rwanda", SN: "Senegal", SL: "Sierra Leone",
  SO: "Somalia", ZA: "South Africa", TZ: "Tanzania", UG: "Uganda", ZM: "Zambia",
};

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

type NetworkResult = {
  networks: any[];
  error: string | null;
  httpStatus: number | null;
};

type BankResult = {
  banks: any[];
  error: string | null;
  httpStatus: number | null;
};

async function getMobileNetworks(country: string, accessToken: string): Promise<NetworkResult> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(
      `${FLW_BASE_URL}/mobile-networks?country=${encodeURIComponent(country)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Trace-Id": crypto.randomUUID(),
        },
        signal: controller.signal,
      },
    );
    clearTimeout(timeout);

    const text = await response.text();
    let data: any = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw_response: text }; }

    if (!response.ok) {
      const errMsg = data?.message ?? data?.error?.message ?? `HTTP ${response.status}`;
      console.error(`Mobile networks for ${country} failed: ${response.status} — ${errMsg}`);
      return { networks: [], error: errMsg, httpStatus: response.status };
    }

    const networks = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);
    return { networks, error: null, httpStatus: response.status };
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : "Network error";
    console.error(`Mobile networks for ${country} threw: ${errMsg}`);
    return { networks: [], error: errMsg, httpStatus: null };
  }
}

function extractCurrency(networks: any[], countryCode: string): string {
  for (const net of networks) {
    const cur = net?.currency ?? net?.currency_code;
    if (cur) return String(cur).toUpperCase();
  }
  // Fallback: derive from known country-currency mappings
  const fallback: Record<string, string> = {
    GH: "GHS", KE: "KES", TZ: "TZS", CM: "XAF", CI: "XOF",
    SN: "XOF", RW: "RWF", MW: "MWK", ET: "ETB", UG: "UGX", ZM: "ZMW",
    NG: "NGN", ZA: "ZAR",
  };
  return fallback[countryCode] || "";
}

async function getBanks(country: string, accessToken: string): Promise<BankResult> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(
      `${FLW_BASE_URL}/banks?country=${encodeURIComponent(country)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Trace-Id": crypto.randomUUID(),
        },
        signal: controller.signal,
      },
    );
    clearTimeout(timeout);

    const text = await response.text();
    let data: any = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw_response: text }; }

    if (!response.ok) {
      const errMsg = data?.message ?? data?.error?.message ?? `HTTP ${response.status}`;
      console.error(`Banks for ${country} failed: ${response.status} — ${errMsg}`);
      return { banks: [], error: errMsg, httpStatus: response.status };
    }

    const banks = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);
    return { banks, error: null, httpStatus: response.status };
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : "Network error";
    console.error(`Banks for ${country} threw: ${errMsg}`);
    return { banks: [], error: errMsg, httpStatus: null };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ success: false, error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Supabase server configuration is missing");
    }
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const accessToken = await getAccessToken();
    const now = new Date().toISOString();

    let checked = 0;
    let enabled = 0;
    let disabled = 0;
    let bankEnabled = 0;
    let errors = 0;
    const results: Array<{ code: string; mobile_money: boolean; banks: boolean; networks: number; bank_count: number; error: string | null }> = [];
    const errorDetails: Array<{ code: string; error: string; http_status: number | null }> = [];

    // Process in batches of 5
    const batchSize = 5;
    for (let i = 0; i < COUNTRY_DISCOVERY_CODES.length; i += batchSize) {
      const batch = COUNTRY_DISCOVERY_CODES.slice(i, i + batchSize);

      const batchResults = await Promise.all(
        batch.map(async (code) => {
          try {
            const { networks, error, httpStatus } = await getMobileNetworks(code, accessToken);
            const { banks, error: bankError, httpStatus: bankHttpStatus } = await getBanks(code, accessToken);
            checked++;

            if (error && bankError) {
              errors++;
              errorDetails.push({ code, error, http_status: httpStatus });
              if (bankError) errorDetails.push({ code, error: `banks: ${bankError}`, http_status: bankHttpStatus });
              results.push({ code, mobile_money: false, banks: false, networks: 0, bank_count: 0, error });
              return { code, mobile_money: false, banks: false, networks: 0, bank_count: 0, error };
            }

            const hasMobileMoney = networks.length > 0;
            const hasBanks = banks.length > 0;
            const currency = extractCurrency(networks, code);
            const countryName = COUNTRY_NAMES[code] || code;

            // Upsert country
            await supabase
              .from("payout_corridor_countries")
              .upsert({
                country_code: code,
                country_name: countryName,
                currency,
                mobile_money_supported: hasMobileMoney,
                cash_pickup_supported: false,
                bank_supported: hasBanks,
                last_synced_at: now,
              }, { onConflict: "country_code" });

            if (hasMobileMoney) {
              enabled++;
              for (const net of networks) {
                const networkCode = String(net?.code ?? net?.network ?? net?.provider_code ?? "").trim();
                const networkName = String(net?.name ?? net?.network_name ?? net?.provider ?? "").trim();

                if (networkCode) {
                  await supabase
                    .from("payout_corridor_networks")
                    .upsert({
                      country_code: code,
                      network_code: networkCode,
                      network_name: networkName || networkCode,
                      last_synced_at: now,
                    }, { onConflict: "country_code,network_code" });
                }
              }
            } else {
              disabled++;
            }

            if (hasBanks) {
              bankEnabled++;
              for (const bank of banks) {
                const bankCode = String(bank?.code ?? bank?.bank_code ?? "").trim();
                const bankName = String(bank?.name ?? bank?.bank_name ?? "").trim();

                if (bankCode) {
                  await supabase
                    .from("payout_corridor_banks")
                    .upsert({
                      country_code: code,
                      bank_code: bankCode,
                      bank_name: bankName || bankCode,
                      last_synced_at: now,
                    }, { onConflict: "country_code,bank_code" });
                }
              }
            }

            const result = { code, mobile_money: hasMobileMoney, banks: hasBanks, networks: networks.length, bank_count: banks.length, error: null as string | null };
            results.push(result);
            return result;
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : "Unexpected error";
            console.error(`Country discovery failed for ${code}:`, errMsg);
            errors++;
            errorDetails.push({ code, error: errMsg, http_status: null });
            const result = { code, mobile_money: false, banks: false, networks: 0, bank_count: 0, error: errMsg };
            results.push(result);
            return result;
          }
        }),
      );

      results.push(...batchResults);
    }

    console.log("Corridor sync complete:", JSON.stringify({
      checked,
      enabled,
      disabled,
      bankEnabled,
    }));

    return jsonResponse({
      success: true,
      summary: {
        countries_checked: checked,
        countries_with_mobile_money: enabled,
        countries_without: disabled,
        countries_with_banks: bankEnabled,
        countries_with_errors: errors,
      },
      results,
      error_details: errorDetails.length > 0 ? errorDetails : undefined,
    });
  } catch (error) {
    console.error("Corridor sync error:", error);
    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : "Unexpected error",
    }, 500);
  }
});

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

// Flutterwave does not publish a general "supported countries" discovery endpoint.
// These lists are the ISO 3166-1 alpha-2 enums Flutterwave's own API reference
// declares as valid values for the "country" query parameter of /mobile-networks
// and /banks respectively — the most authoritative per-capability country lists
// currently available. A country absent from a list is not treated as supported
// for that capability, regardless of any other list it may appear in.
const MOBILE_MONEY_COUNTRY_CODES = [
  "CG", "CM", "CI", "EG", "ET", "GA", "GH", "KE", "MW", "RW",
  "SN", "TZ", "TD", "UG", "ZM",
];

const BANK_COUNTRY_CODES = [
  "CM", "CI", "CG", "EG", "ET", "GA", "GH", "IN", "KE", "MW",
  "NG", "RW", "SL", "SN", "TD", "TZ", "UG", "US", "ZA", "ZM",
];

const COUNTRY_DISCOVERY_CODES = Array.from(
  new Set<string>([...MOBILE_MONEY_COUNTRY_CODES, ...BANK_COUNTRY_CODES]),
).sort();

const COUNTRY_NAMES: Record<string, string> = {
  CG: "Congo", CM: "Cameroon", CI: "Côte d'Ivoire", EG: "Egypt", ET: "Ethiopia",
  GA: "Gabon", GH: "Ghana", IN: "India", KE: "Kenya", MW: "Malawi",
  NG: "Nigeria", RW: "Rwanda", SL: "Sierra Leone", SN: "Senegal", TD: "Chad",
  TZ: "Tanzania", UG: "Uganda", US: "United States", ZA: "South Africa", ZM: "Zambia",
};

// Flutterwave's /mobile-networks and /banks responses carry no currency field
// (per the API's published response schema), so currency cannot be derived from
// either response. This explicit ISO country->currency mapping is the sole
// currency source; it is never guessed from a network or bank record.
const COUNTRY_CURRENCY: Record<string, string> = {
  CG: "XAF", CM: "XAF", CI: "XOF", EG: "EGP", ET: "ETB",
  GA: "XAF", GH: "GHS", IN: "INR", KE: "KES", MW: "MWK",
  NG: "NGN", RW: "RWF", SL: "SLL", SN: "XOF", TD: "XAF",
  TZ: "TZS", UG: "UGX", US: "USD", ZA: "ZAR", ZM: "ZMW",
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
            const supportsMobileMoney = MOBILE_MONEY_COUNTRY_CODES.includes(code);
            const supportsBanks = BANK_COUNTRY_CODES.includes(code);

            const { networks, error, httpStatus } = supportsMobileMoney
              ? await getMobileNetworks(code, accessToken)
              : { networks: [] as any[], error: null as string | null, httpStatus: null as number | null };
            const { banks, error: bankError, httpStatus: bankHttpStatus } = supportsBanks
              ? await getBanks(code, accessToken)
              : { banks: [] as any[], error: null as string | null, httpStatus: null as number | null };
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
            const currency = COUNTRY_CURRENCY[code] || "";
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

            // Canonical Flutterwave identifier is the "network" field; "name" is display-only.
            const currentNetworkCodes = new Set<string>();
            if (hasMobileMoney) {
              enabled++;
              for (const net of networks) {
                const networkCode = String(net?.network ?? "").trim();
                const networkName = String(net?.name ?? "").trim();

                if (networkCode) {
                  currentNetworkCodes.add(networkCode);
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

            // Reconcile stale networks for this country only (never a global delete).
            if (supportsMobileMoney && !error) {
              let staleQuery = supabase.from("payout_corridor_networks").delete().eq("country_code", code);
              if (currentNetworkCodes.size > 0) {
                const keepList = `(${[...currentNetworkCodes].map((n) => `"${n.replace(/"/g, '')}"`).join(",")})`;
                staleQuery = staleQuery.not("network_code", "in", keepList);
              }
              await staleQuery;
            }

            const currentBankCodes = new Set<string>();
            if (hasBanks) {
              bankEnabled++;
              for (const bank of banks) {
                const bankCode = String(bank?.code ?? "").trim();
                const bankName = String(bank?.name ?? "").trim();

                if (bankCode) {
                  currentBankCodes.add(bankCode);
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

            // Reconcile stale banks for this country only (never a global delete).
            if (supportsBanks && !bankError) {
              let staleQuery = supabase.from("payout_corridor_banks").delete().eq("country_code", code);
              if (currentBankCodes.size > 0) {
                const keepList = `(${[...currentBankCodes].map((b) => `"${b.replace(/"/g, '')}"`).join(",")})`;
                staleQuery = staleQuery.not("bank_code", "in", keepList);
              }
              await staleQuery;
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

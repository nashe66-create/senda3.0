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

async function flutterwaveRequest(accessToken: string, method: string, path: string, body?: unknown) {
  const response = await fetch(`${FLW_BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Trace-Id": crypto.randomUUID(),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  const text = await response.text();
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw_response: text }; }
  return { response, data };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ success: false, error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ success: false, error: "Supabase configuration missing" }, 500);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ success: false, error: "Unauthorized" }, 401);

    const authClient = createClient(supabaseUrl, serviceRoleKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: userError } = await authClient.auth.getUser();
    if (userError || !user) return jsonResponse({ success: false, error: "Unauthorized" }, 401);

    const payload = await req.json().catch(() => null) as {
      provider_customer_id?: string;
      card?: { number: string; cvv: string; expiry_month: string; expiry_year: string };
      billing_address?: Record<string, string>;
    } | null;

    if (!payload?.card) return jsonResponse({ success: false, error: "Missing card payload" }, 400);

    const accessToken = await getAccessToken();
    const profile = await authClient.from("profiles").select("email, full_name, phone, flutterwave_customer_id").eq("id", user.id).maybeSingle();
    const customerId = profile.data?.flutterwave_customer_id ?? null;

    let resolvedCustomerId = customerId;
    if (!resolvedCustomerId) {
      const customerPayload = {
        email: profile.data?.email ?? user.email,
        name: (profile.data?.full_name ?? "Senda User").trim(),
        phone: profile.data?.phone ?? "",
      };
      const { response: customerResponse, data: customerData } = await flutterwaveRequest(accessToken, "POST", "/customers", customerPayload);
      if (!customerResponse.ok || !customerData?.data?.id) {
        return jsonResponse({ success: false, error: customerData?.message ?? "Unable to create Flutterwave customer" }, 400);
      }
      resolvedCustomerId = String(customerData.data.id);
      await authClient.from("profiles").update({ flutterwave_customer_id: resolvedCustomerId }).eq("id", user.id);
    }

    const paymentMethodPayload = {
      customer_id: resolvedCustomerId,
      type: "card",
      card: {
        number: payload.card.number,
        cvv: payload.card.cvv,
        expiry_month: payload.card.expiry_month,
        expiry_year: payload.card.expiry_year,
      },
      billing_address: payload.billing_address ?? {
        line1: "1 Senda Street",
        city: "London",
        state: "Greater London",
        postal_code: "SW1A 1AA",
        country: "GB",
      },
    };

    const { response: methodResponse, data: methodData } = await flutterwaveRequest(accessToken, "POST", "/payment-methods", paymentMethodPayload);
    if (!methodResponse.ok || !methodData?.data?.id) {
      return jsonResponse({ success: false, error: methodData?.message ?? "Unable to create saved card payment method" }, 400);
    }

    return jsonResponse({
      success: true,
      provider_customer_id: resolvedCustomerId,
      provider_payment_method_id: String(methodData.data.id),
      brand: methodData?.data?.card?.brand ?? methodData?.data?.brand ?? null,
      last4: methodData?.data?.card?.last4 ?? methodData?.data?.last_4 ?? null,
    });
  } catch (error) {
    console.error("Flutterwave payment method error:", error);
    return jsonResponse({ success: false, error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
});

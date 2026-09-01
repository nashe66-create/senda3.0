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
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-Trace-Id": crypto.randomUUID(),
  };
  if (method === "POST") headers["X-Idempotency-Key"] = crypto.randomUUID();

  const response = await fetch(`${FLW_BASE_URL}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  const text = await response.text();
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw_response: text }; }

  return { response, data };
}



const NONCE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function generateNonce(): string {
  let nonce = "";
  const randomBytes = new Uint8Array(12);

  while (nonce.length < 12) {
    crypto.getRandomValues(randomBytes);
    for (const randomByte of randomBytes) {
      if (randomByte < 248) {
        nonce += NONCE_ALPHABET[randomByte % NONCE_ALPHABET.length];
        if (nonce.length === 12) return nonce;
      }
    }
  }

  return nonce;
}

/**
 * AES-256-GCM encrypt a string using the FLW_ENCRYPTION_KEY (base64-encoded 32-byte key).
 * The Flutterwave nonce is a 12-character ASCII string and its UTF-8 bytes are the IV.
 * Returns base64 ciphertext.
 */
async function encryptField(plaintext: string, nonce: string): Promise<string> {
  const encryptionKey = Deno.env.get("FLW_ENCRYPTION_KEY");
  if (!encryptionKey) throw new Error("FLW_ENCRYPTION_KEY is not configured");

  const keyBytes = Uint8Array.from(atob(encryptionKey), (c) => c.charCodeAt(0));
  const nonceBytes = new TextEncoder().encode(nonce);

  const cryptoKey = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["encrypt"]);

  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonceBytes },
    cryptoKey,
    encoded,
  );

  const ctBytes = new Uint8Array(ciphertext);
  let binary = "";
  for (const byte of ctBytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
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

    const serviceClient = createClient(supabaseUrl, serviceRoleKey);

    let payload: {
      transaction_id: string;
      amount: number;
      reference: string;
      card: { number: string; cvv: string; expiry_month: string; expiry_year: string };
      billing_address?: Record<string, string>;
    };
    try { payload = await req.json(); } catch {
      return jsonResponse({ success: false, error: "Invalid JSON request body" }, 400);
    }

    if (!payload.transaction_id || !payload.amount || !payload.reference || !payload.card) {
      return jsonResponse({
        success: false,
        error: "Missing required fields: transaction_id, amount, reference, card",
      }, 400);
    }

    // Verify the transaction belongs to this user and get plan info
    const { data: transaction } = await supabase
      .from("transactions")
      .select("id, plan_id, user_id, amount_gbp, payment_reference")
      .eq("id", payload.transaction_id)
      .eq("user_id", userId)
      .maybeSingle();

    if (!transaction) {
      return jsonResponse({ success: false, error: "Transaction not found" }, 404);
    }

    if (payload.reference !== transaction.payment_reference) {
      return jsonResponse({ success: false, error: "Payment reference does not match the transaction" }, 400);
    }

    // Verify the plan is in awaiting_payment status and quote is locked
    const { data: plan } = await serviceClient
      .from("plans")
      .select("id, status, quote_locked_at, customer_pays, payment_status")
      .eq("id", transaction.plan_id)
      .maybeSingle();

    if (!plan) {
      return jsonResponse({ success: false, error: "Plan not found" }, 404);
    }

    if (plan.status !== "awaiting_payment") {
      return jsonResponse({
        success: false,
        error: "Payment can only be initiated for orders in the awaiting_payment state",
        error_code: "INVALID_PLAN_STATUS",
        current_status: plan.status,
      }, 400);
    }

    if (!plan.quote_locked_at) {
      return jsonResponse({
        success: false, error: "Quote must be locked before payment", error_code: "QUOTE_NOT_LOCKED" }, 400);
    }

    // Verify the charge amount matches the locked customer_pays
    if (Math.abs(Number(payload.amount) - Number(plan.customer_pays)) > 0.01) {
      return jsonResponse({
        success: false,
        error: `Charge amount ${payload.amount} does not match locked quote amount ${plan.customer_pays}`,
        error_code: "AMOUNT_MISMATCH",
      }, 400);
    }

    // Look up the user's profile for customer details
    const { data: profile } = await supabase
      .from("profiles")
      .select("email, full_name, phone, country, flutterwave_customer_id, flutterwave_sender_id, kyc_status")
      .eq("id", userId)
      .maybeSingle();

    if (!profile) {
      return jsonResponse({ success: false, error: "Profile not found" }, 404);
    }

    if (!profile.flutterwave_sender_id || profile.kyc_status !== "verified") {
      return jsonResponse({
        success: false,
        error: "Payment cannot proceed until authoritative KYC verification is available.",
      }, 403);
    }

    // The KYC gate has passed; atomically claim the single payment initiation.
    const { data: claimedPlan, error: claimError } = await serviceClient
      .from("plans")
      .update({ status: "payment_processing", payment_status: "processing" })
      .eq("id", transaction.plan_id)
      .eq("status", "awaiting_payment")
      .select("id")
      .maybeSingle();

    if (claimError) throw claimError;
    if (!claimedPlan) {
      return jsonResponse({
        success: false,
        error: "Payment initiation is already in progress or no longer available.",
        error_code: "PAYMENT_ALREADY_PROCESSING",
      }, 409);
    }

    // Generate one single-use nonce for this card-encryption request.
    const nonce = generateNonce();

    // Encrypt card fields
    const [encryptedNumber, encryptedCvv, encryptedExpiryMonth, encryptedExpiryYear] = await Promise.all([
      encryptField(payload.card.number, nonce),
      encryptField(payload.card.cvv, nonce),
      encryptField(payload.card.expiry_month, nonce),
      encryptField(payload.card.expiry_year, nonce),
    ]);

    // Deterministic idempotency key
    const idempotencyKey = `SENDA-PAY-${transaction.plan_id}`;

    const { error: idempotencyError } = await serviceClient
      .from("transactions")
      .update({ idempotency_key: idempotencyKey })
      .eq("id", payload.transaction_id);

    if (idempotencyError) {
      console.error("Failed to store idempotency key:", idempotencyError);
    }

    // Build customer object from profile data
    const customer: Record<string, unknown> = {
      email: profile.email,
    };
    if (profile.full_name) {
      const nameParts = profile.full_name.trim().split(/\s+/);
      customer.name = {
        first: nameParts[0] || "",
        last: nameParts.slice(1).join(" ") || "",
      };
    }
    if (profile.phone) {
      customer.phone = { country_code: "44", number: profile.phone.replace(/^\+44/, "") };
    }
    if (payload.billing_address) {
      customer.address = payload.billing_address;
    }

    const chargePayload = {
      amount: payload.amount,
      currency: "GBP",
      reference: payload.reference,
      payment_method: {
        type: "card",
        card: {
          nonce,
          encrypted_card_number: encryptedNumber,
          encrypted_cvv: encryptedCvv,
          encrypted_expiry_month: encryptedExpiryMonth,
          encrypted_expiry_year: encryptedExpiryYear,
        },
      },
      redirect_url: "https://senda.app/payment/callback",
      customer,
    };

    const accessToken = await getAccessToken();
    const { response, data } = await flutterwaveRequest(
      accessToken, "POST", "/orchestration/direct-charges", chargePayload
    );

    if (!response.ok) {
      await serviceClient
        .from("transactions")
        .update({ status: "failed" })
        .eq("id", payload.transaction_id);
      await serviceClient
        .from("plans")
        .update({ status: "payment_failed", payment_status: "failed" })
        .eq("id", transaction.plan_id)
        .eq("status", "payment_processing");
    }

    // Store charge ID and next_action on the transaction
    const updateData: Record<string, unknown> = {
      flutterwave_charge_id: data?.data?.id ?? null,
      next_action_type: data?.data?.next_action?.type ?? null,
    };

    if (data?.data?.card?.last_4) {
      updateData.card_last4 = data.data.card.last_4;
    }
    if (data?.data?.card?.network) {
      updateData.card_network = data.data.card.network;
    }

    await serviceClient
      .from("transactions")
      .update(updateData)
      .eq("id", payload.transaction_id);

    return jsonResponse({
      success: response.ok,
      status: data?.data?.status ?? null,
      charge_id: data?.data?.id ?? null,
      next_action: data?.data?.next_action ?? null,
    }, response.status);
  } catch (error) {
    console.error("Flutterwave collect-card error:", error);
    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : "Unexpected error",
    }, 500);
  }
});

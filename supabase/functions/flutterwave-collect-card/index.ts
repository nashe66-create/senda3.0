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

async function flutterwaveRequest(accessToken: string, method: string, path: string, body?: unknown, idempotencyKey?: string) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-Trace-Id": crypto.randomUUID(),
  };
  if (method === "POST") headers["X-Idempotency-Key"] = idempotencyKey ?? crypto.randomUUID();

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

  let recoveryContext: {
    transactionId: string;
    planId: string;
    mayFailSafelyBeforeProvider: boolean;
  } | null = null;
  let providerRequestStarted = false;

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
      .select("id, plan_id, user_id, amount_gbp, payment_reference, status, idempotency_key, flutterwave_charge_id")
      .eq("id", payload.transaction_id)
      .eq("user_id", userId)
      .maybeSingle();

    if (!transaction) {
      return jsonResponse({ success: false, error: "Transaction not found" }, 404);
    }

    if (payload.reference !== transaction.payment_reference) {
      return jsonResponse({ success: false, error: "Payment reference does not match the transaction" }, 400);
    }

    // Never submit another charge when this transaction already has a charge
    // ID, or when an earlier attempt is still pending with an idempotency key.
    if (transaction.flutterwave_charge_id || (transaction.status === "pending" && transaction.idempotency_key)) {
      return jsonResponse({
        success: false,
        error: "This payment was already submitted and is being checked. Do not submit it again.",
        error_code: "PAYMENT_REQUIRES_RECONCILIATION",
        charge_id: transaction.flutterwave_charge_id ?? null,
      }, 409);
    }

    // Verify the plan is in awaiting_payment status and quote is locked
    const { data: plan } = await serviceClient
      .from("plans")
      .select("id, status, quote_locked_at, quote_expires_at, customer_pays, payment_status")
      .eq("id", transaction.plan_id)
      .maybeSingle();

    if (!plan) {
      return jsonResponse({ success: false, error: "Plan not found" }, 404);
    }

    if (plan.status !== "awaiting_payment" && plan.status !== "payment_processing" && plan.status !== "payment_failed") {
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

    recoveryContext = {
      transactionId: transaction.id,
      planId: transaction.plan_id,
      mayFailSafelyBeforeProvider: transaction.status === "pending"
        && !transaction.idempotency_key
        && !transaction.flutterwave_charge_id,
    };

    // The KYC gate has passed; atomically claim the single payment initiation.
    if (plan.status === "awaiting_payment" || plan.status === "payment_failed") {
      const { data: claimedPlan, error: claimError } = await serviceClient
        .from("plans")
        .update({ status: "payment_processing", payment_status: "processing" })
        .eq("id", transaction.plan_id)
        .in("status", ["awaiting_payment", "payment_failed"])
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
    const idempotencyKey = transaction.idempotency_key ?? `SENDA-PAY-${transaction.plan_id}`;

    const { error: idempotencyError } = await serviceClient
      .from("transactions")
      .update({ idempotency_key: idempotencyKey })
      .eq("id", payload.transaction_id);

    if (idempotencyError) throw idempotencyError;

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
      redirect_url: `${(Deno.env.get("SENDA_APP_URL") ?? "https://senda3.pages.dev").replace(/\/+$/, "")}/collect/${encodeURIComponent(payload.transaction_id)}?payment_return=1`,
      customer,
    };

    const accessToken = await getAccessToken();
    // From this point the provider may receive the request even if the network
    // times out. Such outcomes must be reconciled, not marked as failed.
    providerRequestStarted = true;
    const { response, data } = await flutterwaveRequest(
      accessToken, "POST", "/orchestration/direct-charges", chargePayload, idempotencyKey
    );

    if (!response.ok) {
      const providerChargeId = data?.data?.id ?? null;
      const providerStatus = String(data?.data?.status ?? "").toLowerCase();
      console.error("Flutterwave direct charge did not return a successful HTTP response", {
        endpoint: "/orchestration/direct-charges",
        status: response.status,
        error_code: data?.error?.code ?? data?.code ?? null,
        error_message: data?.error?.message ?? data?.message ?? null,
        error_type: data?.error?.type ?? null,
        has_charge_id: Boolean(providerChargeId),
        provider_status: providerStatus || null,
      });

      // A definite provider-declared failure is terminal. A conflict, server
      // error, or response carrying a charge ID is ambiguous and must be
      // reconciled by reference instead of inviting a duplicate payment.
      if (providerStatus === "failed" || (!providerChargeId && response.status >= 400 && response.status < 500 && response.status !== 409)) {
        await serviceClient
          .from("transactions")
          .update({ status: "failed" })
          .eq("id", payload.transaction_id);
        await serviceClient
          .from("plans")
          .update({ status: "payment_failed", payment_status: "failed" })
          .eq("id", transaction.plan_id)
          .eq("status", "payment_processing");
        return jsonResponse({
          success: false,
          status: "failed",
          error: data?.error?.message ?? data?.message ?? "Flutterwave rejected the payment request",
        }, response.status);
      }

      await serviceClient
        .from("transactions")
        .update({
          flutterwave_charge_id: providerChargeId,
          next_action_type: data?.data?.next_action?.type ?? null,
        })
        .eq("id", payload.transaction_id);

      return jsonResponse({
        success: true,
        status: providerStatus || "pending",
        charge_id: providerChargeId,
        next_action: data?.data?.next_action ?? null,
        confirmation_pending: true,
        error: "The provider did not confirm the final payment state. Senda is checking the payment; do not submit it again.",
      }, 202);
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

    // If the request may have reached Flutterwave, leave it pending so the
    // verification endpoint can recover it by the unique payment reference.
    if (recoveryContext && (providerRequestStarted || !recoveryContext.mayFailSafelyBeforeProvider)) {
      return jsonResponse({
        success: true,
        status: "pending",
        charge_id: null,
        next_action: null,
        confirmation_pending: true,
        error: "The payment request may have reached Flutterwave. Senda is checking its status; do not submit it again.",
      }, 202);
    }

    // Only roll back when we know no prior attempt existed and no provider
    // request was started. Never overwrite a status already changed by a webhook.
    if (recoveryContext?.mayFailSafelyBeforeProvider) {
      try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL");
        const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        if (supabaseUrl && serviceRoleKey) {
          const cleanupClient = createClient(supabaseUrl, serviceRoleKey);
          await cleanupClient
            .from("transactions")
            .update({ status: "failed", idempotency_key: null })
            .eq("id", recoveryContext.transactionId)
            .eq("status", "pending");
          await cleanupClient
            .from("plans")
            .update({ status: "payment_failed", payment_status: "failed" })
            .eq("id", recoveryContext.planId)
            .eq("status", "payment_processing");
        }
      } catch (cleanupError) {
        console.error("Could not safely restore pre-payment state:", cleanupError);
      }
    }

    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : "Unexpected error",
    }, 500);
  }
});

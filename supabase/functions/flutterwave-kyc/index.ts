import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.58.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const TOKEN_URL = "https://idp.flutterwave.com/realms/flutterwave/protocol/openid-connect/token";
const FLW_BASE_URL = Deno.env.get("FLW_BASE_URL") ?? "";
const SANDBOX_KYC_ENABLED =
  Deno.env.get("SENDA_KYC_SANDBOX_MODE") === "true" &&
  FLW_BASE_URL === "https://developersandbox-api.flutterwave.com";

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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    if (!action) {
      return jsonResponse({
        success: false,
        error: "Missing action",
        supported_actions: ["submit", "get"],
      }, 400);
    }

    const accessToken = await getAccessToken();

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

    // =======================================================
    // SUBMIT KYC
    // =======================================================
    if (req.method === "POST" && action === "submit") {
      let payload: Record<string, unknown>;
      try { payload = await req.json(); } catch {
        return jsonResponse({ success: false, error: "Invalid JSON request body" }, 400);
      }

      const { name, email, phone, address, date_of_birth, national_identification } = payload;

      if (!name || !email || !phone || !address || !date_of_birth || !national_identification) {
        return jsonResponse({ success: false, error: "Missing required KYC fields: name, email, phone, address, date_of_birth, national_identification" }, 400);
      }

      // Fetch existing profile to check if sender already exists
      const { data: existingProfile } = await supabase
        .from("profiles")
        .select("flutterwave_sender_id")
        .eq("id", userId)
        .maybeSingle();

      if (existingProfile?.flutterwave_sender_id) {
        return jsonResponse({
          success: false,
          error: "KYC already submitted. To update your details, please contact support.",
        }, 409);
      }

      // Create the transfer sender entity via POST /transfers/senders.
      // This is the only Flutterwave call needed — the sender_id is required
      // for GBP-source transfers. The /customers endpoint is not needed for this flow.
      const senderPayload = {
        type: "bank_gbp",
        name,
        email,
        phone,
        address,
        date_of_birth,
        national_identification,
      };

      const { response: senderResp, data: senderData } = await flutterwaveRequest(
        accessToken, "POST", "/transfers/senders", senderPayload
      );

      let senderId: string | null = null;
      if (senderResp.ok && senderData?.data?.id) {
        senderId = String(senderData.data.id);
      }

      if (!senderId) {
        return jsonResponse({
          success: false,
          error: "Flutterwave sender creation failed",
        }, 502);
      }

      // Store KYC fields and sender_id on profile
      const updateData: Record<string, unknown> = {
        kyc_national_id_type: (national_identification as any)?.type ?? null,
        kyc_national_id_number: (national_identification as any)?.identifier ?? null,
        kyc_national_id_expiry: (national_identification as any)?.expiration_date ?? null,
        kyc_date_of_birth: date_of_birth ?? null,
        kyc_address: address ?? null,
        kyc_submitted_at: new Date().toISOString(),
        kyc_status: SANDBOX_KYC_ENABLED ? "verified" : "submitted",
        kyc_verified_at: SANDBOX_KYC_ENABLED ? new Date().toISOString() : null,
        flutterwave_sender_id: senderId,
      };

      const { error: updateError } = await serviceClient
        .from("profiles")
        .update(updateData)
        .eq("id", userId);

      if (updateError) {
        console.error("Failed to update profile with KYC data:", updateError);
      }

      return jsonResponse({
        success: true,
        sender_id: senderId,
        kyc_status: SANDBOX_KYC_ENABLED ? "verified" : "submitted",
        verification_mode: SANDBOX_KYC_ENABLED ? "sandbox" : "provider_pending",
        message: SANDBOX_KYC_ENABLED
          ? "Sandbox KYC verification enabled for testing."
          : "KYC was submitted. Provider verification is pending confirmation.",
      });
    }

    // =======================================================
    // GET KYC STATUS
    // =======================================================
    if (req.method === "GET" && action === "get") {
      const { data: profile } = await supabase
        .from("profiles")
        .select("kyc_status, kyc_submitted_at, kyc_verified_at, flutterwave_sender_id")
        .eq("id", userId)
        .maybeSingle();

      if (!profile) {
        return jsonResponse({ success: false, error: "Profile not found" }, 404);
      }

      return jsonResponse({
        success: true,
        kyc_status: profile.kyc_status,
        kyc_submitted_at: profile.kyc_submitted_at,
        kyc_verified_at: profile.kyc_verified_at,
        has_sender_id: Boolean(profile.flutterwave_sender_id),
        verification_mode: profile.kyc_status === "submitted"
          ? "provider_pending"
          : profile.kyc_status === "verified" && FLW_BASE_URL === "https://developersandbox-api.flutterwave.com"
          ? "sandbox"
          : null,
      });
    }

    return jsonResponse({
      success: false,
      error: "Unsupported KYC operation",
      supported_actions: ["submit", "get"],
    }, 400);
  } catch (error) {
    console.error("Flutterwave KYC error:", error);
    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : "Unexpected error",
    }, 500);
  }
});

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

function getProviderErrorMessage(data: any): string {
  if (typeof data?.message === "string") return data.message;
  if (typeof data?.error === "string") return data.error;
  if (typeof data?.error?.message === "string") return data.error.message;
  return "Account setup failed. Please try again.";
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

      // Extract nested structures from the MVP form submission
      const { name, phone, address, date_of_birth, country_of_residence } = payload as any;

      // Validate that form submitted the required fields
      if (!name || !phone || !address || !date_of_birth) {
        return jsonResponse({
          success: false,
          error: "Missing required account setup fields: name, phone, address, date_of_birth",
        }, 400);
      }

      // Validate name structure
      if (typeof name !== "object" || !name.first || !name.last) {
        return jsonResponse({
          success: false,
          error: "Invalid name structure: first and last name are required",
        }, 400);
      }

      // Validate phone structure
      if (typeof phone !== "object" || !phone.number) {
        return jsonResponse({
          success: false,
          error: "Invalid phone structure: phone number is required",
        }, 400);
      }

      // Validate address structure
      if (typeof address !== "object" || !address.line1 || !address.city || !address.postal_code) {
        return jsonResponse({
          success: false,
          error: "Invalid address structure: line1, city, and postal_code are required",
        }, 400);
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
          error: "Account already set up. To update your details, please contact support.",
        }, 409);
      }

      // Get the authenticated user's email from auth record
      const userEmail = user.email;
      if (!userEmail) {
        return jsonResponse({
          success: false,
          error: "Your Senda account does not have an email address. Please update your account email in settings and try again.",
        }, 400);
      }

      // Flatten name: combine first, middle (optional), and last name
      const fullName = `${name.first} ${name.middle || ""}${name.middle ? " " : ""}${name.last}`.trim();

      // Flatten phone: format as full phone number with country code
      const countryCode = phone.country_code || "44";
      const phoneNumber = String(phone.number).replace(/^\+/, "").replace(/^0/, "");
      const fullPhone = `+${countryCode}${phoneNumber}`;

      // Format address for Flutterwave
      const addressLine = [address.line1, address.line2].filter(Boolean).join(", ");
      const flwAddress = {
        line1: address.line1,
        line2: address.line2 || "",
        city: address.city,
        state: address.state || "",
        postal_code: address.postal_code,
        country: address.country || "GB",
      };

      // Create the transfer sender entity via POST /transfers/senders.
      // This is the only Flutterwave call needed — the sender_id is required
      // for GBP-source transfers. The /customers endpoint is not needed for this flow.
      // For MVP, we submit without national_identification; Flutterwave may accept it
      // or return validation error if national_id is mandatory (not just recommended).
      const senderPayload = {
        type: "bank_gbp",
        name: fullName,
        email: userEmail,
        phone: fullPhone,
        address: flwAddress,
        date_of_birth,
        // national_identification is omitted for MVP sender creation flow
      };

      // DIAGNOSTIC LOGGING (safe, non-sensitive)
      console.log("=== FLUTTERWAVE SENDER CREATION ===");
      console.log("Endpoint: POST /transfers/senders");
      console.log("Base URL:", FLW_BASE_URL);
      console.log("Payload structure (non-sensitive):", {
        type: senderPayload.type,
        name: "[redacted]",
        email: userEmail ? "[present]" : "[missing]",
        phone: "[redacted phone]",
        address: {
          line1: "[redacted]",
          line2: "[redacted]",
          city: "[redacted]",
          state: "[redacted]",
          postal_code: "[redacted]",
          country: senderPayload.address.country,
        },
        date_of_birth: "[redacted]",
        has_national_identification: false,
      });
      console.log("Actual payload keys:", Object.keys(senderPayload));

      const { response: senderResp, data: senderData } = await flutterwaveRequest(
        accessToken, "POST", "/transfers/senders", senderPayload
      );

      // DIAGNOSTIC LOGGING (capture exact response)
      console.log("=== FLUTTERWAVE RESPONSE ===");
      console.log("HTTP Status:", senderResp.status);
      console.log("Response Body:", {
        status: senderData?.status,
        error: senderData?.error,
        message: senderData?.message,
        validation_errors: senderData?.validation_errors,
        errors: senderData?.errors,
      });

      let senderId: string | null = null;
      if (senderResp.ok && senderData?.data?.id) {
        senderId = String(senderData.data.id);
      }

      if (!senderId) {
        // Log the full Flutterwave error for debugging
        console.error("Flutterwave sender creation failed:", {
          status: senderResp.status,
          error: senderData?.error,
          message: senderData?.message,
          validation_errors: senderData?.validation_errors,
          errors: senderData?.errors,
        });

        // Return diagnostic info to frontend for troubleshooting
        return jsonResponse({
          success: false,
          error: getProviderErrorMessage(senderData),
          // Diagnostics for debugging
          _flutterwave_response: {
            status: senderResp.status,
            error: senderData?.error,
            message: senderData?.message,
            validation_errors: senderData?.validation_errors,
            errors: senderData?.errors,
          },
        }, senderResp.status || 502);
      }

      // Store sender details and mark as submitted. Identity document fields remain
      // in the schema but are not populated for this MVP flow.
      const updateData: Record<string, unknown> = {
        kyc_date_of_birth: date_of_birth ?? null,
        kyc_address: flwAddress,
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
        console.error("Failed to update profile with sender data:", updateError);
      }

      return jsonResponse({
        success: true,
        sender_id: senderId,
        kyc_status: SANDBOX_KYC_ENABLED ? "verified" : "submitted",
        verification_mode: SANDBOX_KYC_ENABLED ? "sandbox" : "provider_pending",
        message: SANDBOX_KYC_ENABLED
          ? "Account setup complete for sandbox testing."
          : "Account setup complete. You can now send money.",
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

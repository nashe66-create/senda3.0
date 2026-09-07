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

function isValidCalendarDate(value: unknown): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function calculateAge(dateOfBirth: string): number | null {
  if (!isValidCalendarDate(dateOfBirth)) return null;
  const [year, month, day] = dateOfBirth.split("-").map(Number);
  const today = new Date();
  let age = today.getUTCFullYear() - year;
  const birthdayPassed = today.getUTCMonth() + 1 > month ||
    (today.getUTCMonth() + 1 === month && today.getUTCDate() >= day);
  if (!birthdayPassed) age -= 1;
  return age;
}

function isFutureDate(value: string): boolean {
  if (!isValidCalendarDate(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  const today = new Date();
  const todayStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  return date > todayStart;
}

function normalizeUkPhone(value: unknown): string | null {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.startsWith("44")) return digits.slice(2);
  if (digits.startsWith("0")) return digits.slice(1);
  return digits;
}

function logSenderRuntimeDiagnostics(senderPayload: {
  type: string;
  name: { first: string; last: string };
  email: string;
  phone: { country_code: string; number: string };
  address: {
    line1: string;
    line2?: string;
    city: string;
    state?: string;
    postal_code: string;
    country: string;
  };
  date_of_birth: string;
}) {
  const nameWords = `${senderPayload.name.first} ${senderPayload.name.last}`.trim().split(/\s+/).filter(Boolean);
  const nameText = `${senderPayload.name.first} ${senderPayload.name.last}`.trim();
  const emailParts = senderPayload.email.split("@");
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(senderPayload.email);
  const phoneDigits = senderPayload.phone.number.replace(/\D/g, "");
  const dateFormatValid = /^\d{4}-\d{2}-\d{2}$/.test(senderPayload.date_of_birth);
  const validCalendarDate = isValidCalendarDate(senderPayload.date_of_birth);
  const dateOfBirth = validCalendarDate ? new Date(`${senderPayload.date_of_birth}T00:00:00Z`) : null;

  console.log("=== FLUTTERWAVE SENDER RUNTIME DIAGNOSTICS ===", {
    NAME: {
      type: typeof senderPayload.name,
      word_count: nameWords.length,
      character_count: nameText.length,
      first_component_present: Boolean(senderPayload.name.first),
      last_component_present: Boolean(senderPayload.name.last),
      unsupported_or_special_characters: /[^\p{L}\p{M}\s.'-]/u.test(nameText),
    },
    EMAIL: {
      valid_email_format: emailValid,
      character_count: senderPayload.email.length,
      domain_present: emailParts.length === 2 && Boolean(emailParts[1]),
    },
    PHONE: {
      type: typeof senderPayload.phone,
      country_code: senderPayload.phone.country_code,
      digit_count: phoneDigits.length,
      valid_phone_characters: /^\d+$/.test(senderPayload.phone.number),
    },
    ADDRESS: {
      type: typeof senderPayload.address,
      line1_present: Boolean(senderPayload.address.line1),
      line1_character_count: senderPayload.address.line1.length,
      line2_present: Boolean(senderPayload.address.line2),
      line2_character_count: senderPayload.address.line2?.length ?? 0,
      city_present: Boolean(senderPayload.address.city),
      city_character_count: senderPayload.address.city.length,
      state_present: Boolean(senderPayload.address.state),
      state_character_count: senderPayload.address.state?.length ?? 0,
      postal_code_present: Boolean(senderPayload.address.postal_code),
      postal_code_gb_format_valid: /^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/i.test(senderPayload.address.postal_code),
      country: senderPayload.address.country,
      country_length: senderPayload.address.country.length,
    },
    DATE_OF_BIRTH: {
      type: typeof senderPayload.date_of_birth,
      exact_yyyy_mm_dd_format: dateFormatValid,
      valid_calendar_date: validCalendarDate,
      future_date: isFutureDate(senderPayload.date_of_birth),
      age: calculateAge(senderPayload.date_of_birth),
    },
    OUTBOUND_JSON_KEYS: Object.keys(senderPayload),
    NATIONAL_IDENTIFICATION_ABSENT: !Object.prototype.hasOwnProperty.call(senderPayload, "national_identification"),
    HAS_NATIONAL_IDENTIFICATION_ABSENT: !Object.prototype.hasOwnProperty.call(senderPayload, "has_national_identification"),
  });
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

      if (!isValidCalendarDate(String(date_of_birth)) || isFutureDate(String(date_of_birth))) {
        return jsonResponse({
          success: false,
          error: "Invalid date of birth: use a valid date in YYYY-MM-DD format that is not in the future",
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

      const phoneNumber = normalizeUkPhone(phone.number);
      if (!phoneNumber || !/^7\d{9}$/.test(phoneNumber)) {
        return jsonResponse({
          success: false,
          error: "Invalid UK phone number",
        }, 400);
      }

      const flwAddress = {
        line1: String(address.line1).trim(),
        ...(address.line2 ? { line2: String(address.line2).trim() } : {}),
        city: String(address.city).trim(),
        ...(address.state ? { state: String(address.state).trim() } : {}),
        postal_code: String(address.postal_code).trim(),
        country: "GB",
      };

      // Create the transfer sender entity via POST /transfers/senders.
      // This is the only Flutterwave call needed — the sender_id is required
      // for GBP-source transfers. The /customers endpoint is not needed for this flow.
      // National identification is intentionally omitted for the Senda MVP flow.
      const senderPayload = {
        type: "bank_gbp",
        name: {
          first: String(name.first).trim(),
          last: `${name.middle ? `${String(name.middle).trim()} ` : ""}${String(name.last).trim()}`.trim(),
        },
        email: userEmail,
        phone: {
          country_code: "44",
          number: phoneNumber,
        },
        address: flwAddress,
        date_of_birth: String(date_of_birth),
      };

      // DIAGNOSTIC LOGGING (safe, non-sensitive)
      console.log("=== FLUTTERWAVE SENDER CREATION ===");
      console.log("Endpoint: POST /transfers/senders");
      console.log("Base URL:", FLW_BASE_URL);
      console.log("Payload structure (non-sensitive):", {
        type: senderPayload.type,
        name: { first: "[redacted]", last: "[redacted]" },
        email: userEmail ? "[present]" : "[missing]",
        phone: { country_code: "44", number: "[redacted]" },
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
      logSenderRuntimeDiagnostics(senderPayload);

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

      // A successful provider sender response is the authoritative acceptance signal
      // for this flow. Identity document fields remain unused for the MVP.
      const updateData: Record<string, unknown> = {
        kyc_date_of_birth: date_of_birth ?? null,
        kyc_address: flwAddress,
        kyc_submitted_at: new Date().toISOString(),
        kyc_status: "verified",
        kyc_verified_at: new Date().toISOString(),
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
        kyc_status: "verified",
        verification_mode: SANDBOX_KYC_ENABLED ? "sandbox" : "provider_verified",
        message: "Account setup complete. You can now send money.",
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
        verification_mode: profile.kyc_status === "verified"
          ? FLW_BASE_URL === "https://developersandbox-api.flutterwave.com" ? "sandbox" : "provider_verified"
          : profile.kyc_status === "submitted" ? "provider_pending" : null,
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

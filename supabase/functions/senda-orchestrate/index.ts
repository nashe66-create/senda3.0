import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.58.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
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
  if (method === "POST" && idempotencyKey) {
    headers["X-Idempotency-Key"] = idempotencyKey;
  }

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

async function getWalletBalance(accessToken: string, currency: string): Promise<number | null> {
  const { response, data } = await flutterwaveRequest(accessToken, "GET", `/wallets/${currency}/balance`);
  const balance = data?.data?.available_balance ?? data?.data?.balance;
  if (!response.ok || balance === undefined || balance === null) return null;
  return Number(balance);
}

function mapTransferStatus(flwStatus: string): { status: string; providerStatus: string } {
  const upper = flwStatus.toUpperCase();
  let internalStatus = "processing";
  if (upper === "COMPLETED" || upper === "SUCCESSFUL") {
    internalStatus = "completed";
  } else if (upper === "FAILED" || upper === "CANCELLED") {
    internalStatus = "failed";
  } else if (upper === "NEW" || upper === "PENDING") {
    internalStatus = "submitted";
  }
  return { status: internalStatus, providerStatus: upper };
}

function customerFriendlyFailure(reason: string | null | undefined): string {
  if (!reason) return "The transfer could not be completed. Please try again or contact Senda support.";
  const lower = reason.toLowerCase();
  if (lower.includes("insufficient") && lower.includes("balance")) {
    return "Senda's wallet balance was insufficient to complete this transfer. Please try again later.";
  }
  if (lower.includes("recipient") || lower.includes("account")) {
    return "The recipient account details may be incorrect. Please verify the recipient information and try again.";
  }
  if (lower.includes("network") || lower.includes("timeout") || lower.includes("unavailable")) {
    return "A network issue prevented the transfer. Please try again.";
  }
  if (lower.includes("compliance") || lower.includes("verification") || lower.includes("kyc")) {
    return "Additional verification is required for this transfer. Please contact Senda support.";
  }
  return "The transfer could not be completed. Please try a different payout method or contact Senda support.";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
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

    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    if (!action) {
      return jsonResponse({
        success: false,
        error: "Missing action parameter",
        supported_actions: ["lock-quote", "release-payouts", "confirm-payouts", "retry-payout", "cancel-order", "recalc-order-status"],
      }, 400);
    }

    // Service-role client for DB operations that need to bypass RLS
    const serviceClient = createClient(supabaseUrl, serviceRoleKey);

    // =======================================================
    // LOCK QUOTE
    // =======================================================
    if (action === "lock-quote") {
      let payload: { plan_id: string };
      try { payload = await req.json(); } catch {
        return jsonResponse({ success: false, error: "Invalid JSON request body" }, 400);
      }

      if (!payload.plan_id) {
        return jsonResponse({ success: false, error: "Missing plan_id" }, 400);
      }

      const { data: plan, error: planError } = await supabase
        .from("plans")
        .select("id, status, quote_expires_at, quote_locked_at, user_id")
        .eq("id", payload.plan_id)
        .eq("user_id", userId)
        .maybeSingle();

      if (planError || !plan) {
        return jsonResponse({ success: false, error: "Plan not found" }, 404);
      }

      if (plan.status !== "quoted") {
        return jsonResponse({
          success: false,
          error: "Quote can only be locked from the quoted state",
          error_code: "INVALID_STATUS",
        }, 400);
      }

      if (plan.quote_locked_at) {
        return jsonResponse({
          success: false,
          error: "Quote is already locked",
          error_code: "ALREADY_LOCKED",
        }, 400);
      }

      const now = new Date();
      if (plan.quote_expires_at && new Date(plan.quote_expires_at) < now) {
        return jsonResponse({
          success: false,
          error: "Quote has expired. Please request a new quote.",
          error_code: "QUOTE_EXPIRED",
        }, 410);
      }

      // Lock the quote and transition to awaiting_payment
      await serviceClient
        .from("plans")
        .update({
          quote_locked_at: now.toISOString(),
          status: "awaiting_payment",
          payment_status: "pending",
        })
        .eq("id", payload.plan_id);

      // Create recipient snapshots for all commitments
      const { data: commitments } = await serviceClient
        .from("commitments")
        .select(`
          id, recipient_id, receiving_method,
          recipient:recipients(
            id, name, country, receiving_method, phone,
            mobile_money_network, mobile_money_provider,
            bank_code, account_number, destination_country,
            currency, flutterwave_recipient_id, verification_status
          )
        `)
        .eq("plan_id", payload.plan_id);

      if (commitments) {
        for (const c of commitments) {
          const recipient = c.recipient as any;
          const snapshot = recipient ? {
            name: recipient.name,
            phone: recipient.phone ?? "",
            country: recipient.country ?? "",
            receiving_method: recipient.receiving_method ?? c.receiving_method,
            mobile_money_network: recipient.mobile_money_network ?? null,
            mobile_money_provider: recipient.mobile_money_provider ?? null,
            bank_code: recipient.bank_code ?? null,
            account_number: recipient.account_number ?? null,
            destination_country: recipient.destination_country ?? recipient.country ?? null,
            currency: recipient.currency ?? null,
            flutterwave_recipient_id: recipient.flutterwave_recipient_id ?? null,
            verification_status: recipient.verification_status ?? "pending",
          } : null;

          const payoutMethod = c.receiving_method === "bank_account" ? "bank"
            : c.receiving_method === "mobile_money" ? "mobile_money"
            : c.receiving_method === "cash_pickup" ? "cash_pickup"
            : "mobile_money";

          await serviceClient
            .from("commitments")
            .update({
              recipient_snapshot: snapshot,
              payout_method: payoutMethod,
              status: "ready",
            })
            .eq("id", c.id);
        }
      }

      return jsonResponse({
        success: true,
        plan_id: payload.plan_id,
        status: "awaiting_payment",
        quote_locked_at: now.toISOString(),
      });
    }

    // =======================================================
    // RELEASE PAYOUTS
    // =======================================================
    if (action === "release-payouts") {
      let payload: { plan_id: string };
      try { payload = await req.json(); } catch {
        return jsonResponse({ success: false, error: "Invalid JSON request body" }, 400);
      }

      if (!payload.plan_id) {
        return jsonResponse({ success: false, error: "Missing plan_id" }, 400);
      }

      const { data: plan, error: planError } = await supabase
        .from("plans")
        .select("id, status, payment_status, quote_locked_at, customer_pays, user_id")
        .eq("id", payload.plan_id)
        .eq("user_id", userId)
        .maybeSingle();

      if (planError || !plan) {
        return jsonResponse({ success: false, error: "Plan not found" }, 404);
      }

      if (plan.status !== "funded") {
        return jsonResponse({
          success: false,
          error: "Payouts can only be released for funded orders",
          error_code: "NOT_FUNDED",
          current_status: plan.status,
        }, 400);
      }

      if (plan.payment_status !== "successful") {
        return jsonResponse({
          success: false,
          error: "Payment must be successful before releasing payouts",
          error_code: "PAYMENT_NOT_SUCCESSFUL",
        }, 400);
      }

      if (!plan.quote_locked_at) {
        return jsonResponse({
          success: false,
          error: "Quote must be locked before releasing payouts",
          error_code: "QUOTE_NOT_LOCKED",
        }, 400);
      }

      // Verify the transaction is successful
      const { data: transaction } = await serviceClient
        .from("transactions")
        .select("id, status, completed_at")
        .eq("plan_id", payload.plan_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!transaction || transaction.status !== "successful" || !transaction.completed_at) {
        return jsonResponse({
          success: false,
          error: "No successful verified transaction found for this order",
          error_code: "NO_VERIFIED_TRANSACTION",
        }, 400);
      }

      // Fetch ready commitments with snapshots
      const { data: commitments } = await serviceClient
        .from("commitments")
        .select(`
          id, amount_gbp, amount_destination, fx_rate, destination_currency,
          payout_method, recipient_snapshot, status, idempotency_key,
          flutterwave_transfer_id
        `)
        .eq("plan_id", payload.plan_id)
        .in("status", ["ready", "pending"]);

      if (!commitments || commitments.length === 0) {
        return jsonResponse({
          success: false,
          error: "No ready payouts to release",
        }, 400);
      }

      // Verify corridor support for each payout method
      const { data: corridor } = await serviceClient
        .from("payout_corridor_countries")
        .select("mobile_money_supported, cash_pickup_supported, bank_supported")
        .eq("country_code", (plan as any).destination_country ?? "")
        .maybeSingle();

      const accessToken = await getAccessToken();
      const payouts: Array<{
        commitment_id: string;
        recipient_name: string;
        status: string;
        transfer_id: string | null;
        error?: string;
      }> = [];

      let submitted = 0;
      let failed = 0;
      let skipped = 0;
      const errors: string[] = [];

      for (const c of commitments) {
        const snapshot = c.recipient_snapshot as any;
        const recipientName = snapshot?.name ?? "Unknown";

        // Check corridor support
        if (c.payout_method === "bank" && corridor && !corridor.bank_supported) {
          failed++;
          errors.push(`${recipientName}: Bank transfers are not supported for this corridor`);
          payouts.push({ commitment_id: c.id, recipient_name: recipientName, status: "failed", transfer_id: null, error: "Bank not supported for this corridor" });
          continue;
        }
        if (c.payout_method === "mobile_money" && corridor && !corridor.mobile_money_supported) {
          failed++;
          errors.push(`${recipientName}: Mobile money is not supported for this corridor`);
          payouts.push({ commitment_id: c.id, recipient_name: recipientName, status: "failed", transfer_id: null, error: "Mobile money not supported for this corridor" });
          continue;
        }
        if (c.payout_method === "cash_pickup" && corridor && !corridor.cash_pickup_supported) {
          failed++;
          errors.push(`${recipientName}: Cash pickup is not supported for this corridor`);
          payouts.push({ commitment_id: c.id, recipient_name: recipientName, status: "failed", transfer_id: null, error: "Cash pickup not supported for this corridor" });
          continue;
        }

        // Deterministic idempotency key
        const idempotencyKey = `SENDA-PAYOUT-${c.id}`;

        // Skip if already has a transfer ID (idempotent retry)
        if (c.flutterwave_transfer_id) {
          skipped++;
          payouts.push({ commitment_id: c.id, recipient_name: recipientName, status: "submitted", transfer_id: c.flutterwave_transfer_id });
          continue;
        }

        // Store idempotency key before the API call
        await serviceClient
          .from("commitments")
          .update({ idempotency_key: idempotencyKey, status: "submitted" })
          .eq("id", c.id);

        // Build transfer payload from snapshot
        const nameParts = (snapshot?.name ?? "").trim().split(/\s+/);
        const firstName = nameParts[0] || "";
        const lastName = nameParts.slice(1).join(" ") || "";
        const countryCode = snapshot?.destination_country ?? snapshot?.country ?? "";

        let transferPath: string;
        let transferPayload: Record<string, unknown>;

        if (c.payout_method === "bank" || c.payout_method === "mobile_money") {
          // Flutterwave transfers by recipient_id reuse the recipient created earlier
          // (its type/currency/network/bank details already validated at creation time).
          const recipientId = snapshot?.flutterwave_recipient_id;
          const isVerified = snapshot?.verification_status === "verified";
          if (!recipientId || !isVerified) {
            const errorMsg = "This recipient needs attention before a payout can be made. Please update the recipient details.";
            failed++;
            errors.push(`${recipientName}: ${errorMsg}`);
            await serviceClient
              .from("commitments")
              .update({
                status: "failed",
                failure_reason: errorMsg,
                failure_reason_display: errorMsg,
              })
              .eq("id", c.id);
            payouts.push({ commitment_id: c.id, recipient_name: recipientName, status: "failed", transfer_id: null, error: errorMsg });
            continue;
          }

          transferPath = "/transfers";
          transferPayload = {
            action: "deferred",
            reference: `senda-${c.id.substring(0, 18)}`,
            narration: `Senda transfer to ${snapshot?.name ?? "recipient"}`,
            payment_instruction: {
              source_currency: "GBP",
              amount: {
                applies_to: "source_currency",
                value: Number(c.amount_gbp),
              },
              recipient_id: recipientId,
            },
          };
        } else {
          // cash_pickup (inline; not part of the active recipient-creation flow)
          transferPath = "/direct-transfers";
          transferPayload = {
            action: "deferred",
            type: `cash_pickup_${c.destination_currency.toLowerCase()}`,
            reference: `senda-${c.id.substring(0, 18)}`,
            narration: `Senda transfer to ${snapshot?.name ?? "recipient"}`,
            payment_instruction: {
              source_currency: "GBP",
              amount: {
                applies_to: "source_currency",
                value: Number(c.amount_gbp),
              },
              recipient: {
                name: { first: firstName, last: lastName },
                cash_pickup: {
                  country: countryCode,
                },
              },
              destination_currency: c.destination_currency,
            },
          };
        }

        try {
          const { response, data } = await flutterwaveRequest(
            accessToken, "POST", transferPath, transferPayload, idempotencyKey
          );

          const transferId = data?.data?.id ?? null;
          const flwStatus = data?.data?.status ?? "";
          const { status: internalStatus, providerStatus } = mapTransferStatus(flwStatus);

          if (transferId) {
            await serviceClient
              .from("commitments")
              .update({
                flutterwave_transfer_id: String(transferId),
                status: "submitted",
                provider_status: providerStatus,
              })
              .eq("id", c.id);

            submitted++;
            payouts.push({ commitment_id: c.id, recipient_name: recipientName, status: "submitted", transfer_id: String(transferId) });
          } else if (!response.ok) {
            const errorMsg = data?.message ?? "Transfer creation failed";
            const displayMsg = customerFriendlyFailure(errorMsg);
            await serviceClient
              .from("commitments")
              .update({
                status: "failed",
                failure_reason: errorMsg,
                failure_reason_display: displayMsg,
              })
              .eq("id", c.id);

            failed++;
            errors.push(`${recipientName}: ${displayMsg}`);
            payouts.push({ commitment_id: c.id, recipient_name: recipientName, status: "failed", transfer_id: null, error: displayMsg });
          }
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : "Transfer creation failed";
          const displayMsg = customerFriendlyFailure(errorMsg);
          await serviceClient
            .from("commitments")
            .update({
              status: "failed",
              failure_reason: errorMsg,
              failure_reason_display: displayMsg,
            })
            .eq("id", c.id);

          failed++;
          errors.push(`${recipientName}: ${displayMsg}`);
          payouts.push({ commitment_id: c.id, recipient_name: recipientName, status: "failed", transfer_id: null, error: displayMsg });
        }
      }

      // Transition plan to payouts_processing
      await serviceClient
        .from("plans")
        .update({ status: "payouts_processing" })
        .eq("id", payload.plan_id);

      return jsonResponse({
        success: true,
        plan_id: payload.plan_id,
        total: commitments.length,
        submitted,
        failed,
        skipped,
        errors,
        payouts,
      });
    }

    // =======================================================
    // CONFIRM PAYOUTS
    // =======================================================
    if (action === "confirm-payouts") {
      let payload: { plan_id: string };
      try { payload = await req.json(); } catch {
        return jsonResponse({ success: false, error: "Invalid JSON request body" }, 400);
      }

      if (!payload.plan_id) {
        return jsonResponse({ success: false, error: "Missing plan_id" }, 400);
      }

      const { data: plan } = await supabase
        .from("plans")
        .select("id, status, user_id")
        .eq("id", payload.plan_id)
        .eq("user_id", userId)
        .maybeSingle();

      if (!plan) {
        return jsonResponse({ success: false, error: "Plan not found" }, 404);
      }

      const { data: commitments } = await serviceClient
        .from("commitments")
        .select("id, amount_gbp, flutterwave_transfer_id, status, recipient_snapshot")
        .eq("plan_id", payload.plan_id)
        .eq("status", "submitted");

      if (!commitments || commitments.length === 0) {
        return jsonResponse({ success: false, error: "No submitted payouts to confirm" }, 400);
      }

      const accessToken = await getAccessToken();
      const payouts: any[] = [];
      let confirmed = 0;
      let failed = 0;
      const errors: string[] = [];

      for (const c of commitments) {
        if (!c.flutterwave_transfer_id) {
          failed++;
          errors.push("Missing transfer ID");
          continue;
        }

        // Check wallet balance before confirming
        const balance = await getWalletBalance(accessToken, "GBP");
        if (balance !== null && balance < Number(c.amount_gbp)) {
          const displayMsg = "Senda's wallet balance was insufficient to complete this transfer. Please try again later.";
          await serviceClient
            .from("commitments")
            .update({
              status: "failed",
              failure_reason: "Insufficient wallet balance",
              failure_reason_display: displayMsg,
            })
            .eq("id", c.id);

          failed++;
          errors.push(displayMsg);
          payouts.push({ commitment_id: c.id, status: "failed", error: displayMsg });
          continue;
        }

        try {
          const { response, data } = await flutterwaveRequest(
            accessToken, "PUT", `/transfers/${c.flutterwave_transfer_id}`,
            { action: "instant" }
          );

          const flwStatus = data?.data?.status ?? "";
          const { status: internalStatus, providerStatus } = mapTransferStatus(flwStatus);

          const updateData: Record<string, unknown> = {
            status: internalStatus,
            provider_status: providerStatus,
          };

          if (internalStatus === "failed") {
            updateData.failure_reason = data?.message ?? "Transfer failed";
            updateData.failure_reason_display = customerFriendlyFailure(data?.message);
            failed++;
            errors.push(`${(c.recipient_snapshot as any)?.name ?? "Unknown"}: ${updateData.failure_reason_display}`);
          } else if (internalStatus === "completed") {
            confirmed++;
          }

          await serviceClient
            .from("commitments")
            .update(updateData)
            .eq("id", c.id);

          payouts.push({ commitment_id: c.id, status: internalStatus });
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : "Transfer confirmation failed";
          const displayMsg = customerFriendlyFailure(errorMsg);
          await serviceClient
            .from("commitments")
            .update({
              status: "failed",
              failure_reason: errorMsg,
              failure_reason_display: displayMsg,
            })
            .eq("id", c.id);

          failed++;
          errors.push(displayMsg);
          payouts.push({ commitment_id: c.id, status: "failed", error: displayMsg });
        }
      }

      return jsonResponse({
        success: true,
        plan_id: payload.plan_id,
        total: commitments.length,
        confirmed,
        failed,
        errors,
        payouts,
      });
    }

    // =======================================================
    // RETRY PAYOUT
    // =======================================================
    if (action === "retry-payout") {
      let payload: { commitment_id: string; payout_method: string };
      try { payload = await req.json(); } catch {
        return jsonResponse({ success: false, error: "Invalid JSON request body" }, 400);
      }

      if (!payload.commitment_id || !payload.payout_method) {
        return jsonResponse({ success: false, error: "Missing commitment_id or payout_method" }, 400);
      }

      const { data: commitment } = await supabase
        .from("commitments")
        .select(`
          id, plan_id, amount_gbp, destination_currency, recipient_snapshot,
          status, user_id,
          plan:plans(id, status, payment_status, quote_locked_at, destination_country)
        `)
        .eq("id", payload.commitment_id)
        .eq("user_id", userId)
        .maybeSingle();

      if (!commitment) {
        return jsonResponse({ success: false, error: "Commitment not found" }, 404);
      }

      if (commitment.status !== "failed") {
        return jsonResponse({
          success: false,
          error: "Only failed payouts can be retried",
          error_code: "NOT_FAILED",
        }, 400);
      }

      const plan = commitment.plan as any;
      if (!plan || plan.status !== "partially_failed" && plan.status !== "funded" && plan.status !== "payouts_processing") {
        return jsonResponse({
          success: false,
          error: "Order must be in a state that allows retry",
          error_code: "INVALID_ORDER_STATUS",
        }, 400);
      }

      // Verify corridor support for new method
      const { data: corridor } = await serviceClient
        .from("payout_corridor_countries")
        .select("mobile_money_supported, cash_pickup_supported, bank_supported")
        .eq("country_code", plan.destination_country ?? "")
        .maybeSingle();

      if (payload.payout_method === "bank" && corridor && !corridor.bank_supported) {
        return jsonResponse({ success: false, error: "Bank transfers are not supported for this corridor" }, 400);
      }
      if (payload.payout_method === "mobile_money" && corridor && !corridor.mobile_money_supported) {
        return jsonResponse({ success: false, error: "Mobile money is not supported for this corridor" }, 400);
      }
      if (payload.payout_method === "cash_pickup" && corridor && !corridor.cash_pickup_supported) {
        return jsonResponse({ success: false, error: "Cash pickup is not supported for this corridor" }, 400);
      }

      const snapshot = commitment.recipient_snapshot as any;
      if (
        (payload.payout_method === "mobile_money" || payload.payout_method === "bank") &&
        (!snapshot?.flutterwave_recipient_id || snapshot?.verification_status !== "verified")
      ) {
        return jsonResponse({
          success: false,
          error: "This recipient needs attention before a payout can be made. Please update the recipient details.",
        }, 400);
      }

      const idempotencyKey = `SENDA-PAYOUT-RETRY-${commitment.id}-${payload.payout_method}`;

      // Update commitment with new method and reset status
      await serviceClient
        .from("commitments")
        .update({
          payout_method: payload.payout_method,
          status: "submitted",
          idempotency_key: idempotencyKey,
          flutterwave_transfer_id: null,
          failure_reason: null,
          failure_reason_display: null,
        })
        .eq("id", commitment.id);

      const accessToken = await getAccessToken();
      const nameParts = (snapshot?.name ?? "").trim().split(/\s+/);
      const firstName = nameParts[0] || "";
      const lastName = nameParts.slice(1).join(" ") || "";
      const countryCode = snapshot?.destination_country ?? snapshot?.country ?? "";

      let transferPath: string;
      let transferPayload: Record<string, unknown>;

      if (payload.payout_method === "bank" || payload.payout_method === "mobile_money") {
        transferPath = "/transfers";
        transferPayload = {
          action: "deferred",
          reference: `senda-r${commitment.id.substring(0, 16)}`,
          narration: `Senda retry to ${snapshot?.name ?? "recipient"}`,
          payment_instruction: {
            source_currency: "GBP",
            amount: { applies_to: "source_currency", value: Number(commitment.amount_gbp) },
            recipient_id: snapshot.flutterwave_recipient_id,
          },
        };
      } else {
        transferPath = "/direct-transfers";
        transferPayload = {
          action: "deferred",
          type: `cash_pickup_${commitment.destination_currency.toLowerCase()}`,
          reference: `senda-r${commitment.id.substring(0, 16)}`,
          narration: `Senda retry to ${snapshot?.name ?? "recipient"}`,
          payment_instruction: {
            source_currency: "GBP",
            amount: { applies_to: "source_currency", value: Number(commitment.amount_gbp) },
            recipient: {
              name: { first: firstName, last: lastName },
              cash_pickup: { country: countryCode },
            },
            destination_currency: commitment.destination_currency,
          },
        };
      }

      try {
        const { response, data } = await flutterwaveRequest(
          accessToken, "POST", transferPath, transferPayload, idempotencyKey
        );

        const transferId = data?.data?.id ?? null;
        const flwStatus = data?.data?.status ?? "";
        const { status: internalStatus, providerStatus } = mapTransferStatus(flwStatus);

        if (transferId) {
          await serviceClient
            .from("commitments")
            .update({
              flutterwave_transfer_id: String(transferId),
              status: "submitted",
              provider_status: providerStatus,
            })
            .eq("id", commitment.id);

          // Confirm immediately since order is already funded
          const { data: confirmData } = await flutterwaveRequest(
            accessToken, "PUT", `/transfers/${String(transferId)}`,
            { action: "instant" }
          );

          const confirmFlwStatus = confirmData?.data?.status ?? "";
          const { status: confirmStatus, providerStatus: confirmProvider } = mapTransferStatus(confirmFlwStatus);

          const updateData: Record<string, unknown> = {
            status: confirmStatus,
            provider_status: confirmProvider,
          };

          if (confirmStatus === "failed") {
            updateData.failure_reason = confirmData?.message ?? "Transfer failed";
            updateData.failure_reason_display = customerFriendlyFailure(confirmData?.message);
          }

          await serviceClient
            .from("commitments")
            .update(updateData)
            .eq("id", commitment.id);

          return jsonResponse({
            success: true,
            commitment_id: commitment.id,
            status: confirmStatus,
            transfer_id: String(transferId),
          });
        } else {
          const errorMsg = data?.message ?? "Transfer creation failed";
          const displayMsg = customerFriendlyFailure(errorMsg);
          await serviceClient
            .from("commitments")
            .update({
              status: "failed",
              failure_reason: errorMsg,
              failure_reason_display: displayMsg,
            })
            .eq("id", commitment.id);

          return jsonResponse({ success: false, error: displayMsg }, 502);
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Transfer failed";
        const displayMsg = customerFriendlyFailure(errorMsg);
        await serviceClient
          .from("commitments")
          .update({
            status: "failed",
            failure_reason: errorMsg,
            failure_reason_display: displayMsg,
          })
          .eq("id", commitment.id);

        return jsonResponse({ success: false, error: displayMsg }, 502);
      }
    }

    // =======================================================
    // CANCEL ORDER
    // =======================================================
    if (action === "cancel-order") {
      let payload: { plan_id: string };
      try { payload = await req.json(); } catch {
        return jsonResponse({ success: false, error: "Invalid JSON request body" }, 400);
      }

      if (!payload.plan_id) {
        return jsonResponse({ success: false, error: "Missing plan_id" }, 400);
      }

      const { data: plan } = await supabase
        .from("plans")
        .select("id, status, user_id")
        .eq("id", payload.plan_id)
        .eq("user_id", userId)
        .maybeSingle();

      if (!plan) {
        return jsonResponse({ success: false, error: "Plan not found" }, 404);
      }

      const cancellableStates = ["draft", "quoted", "awaiting_payment", "funded"];
      if (!cancellableStates.includes(plan.status)) {
        return jsonResponse({
          success: false,
          error: "This order cannot be cancelled in its current state. Payouts may have already been submitted.",
          error_code: "NOT_CANCELLABLE",
        }, 400);
      }

      // If funded, check that no payouts have been submitted
      if (plan.status === "funded") {
        const { data: submittedPayouts } = await serviceClient
          .from("commitments")
          .select("id")
          .eq("plan_id", payload.plan_id)
          .in("status", ["submitted", "processing", "completed"]);

        if (submittedPayouts && submittedPayouts.length > 0) {
          return jsonResponse({
            success: false,
            error: "Cannot cancel: some payouts have already been submitted",
            error_code: "PAYOUTS_SUBMITTED",
          }, 400);
        }
      }

      await serviceClient
        .from("plans")
        .update({ status: "cancelled" })
        .eq("id", payload.plan_id);

      return jsonResponse({
        success: true,
        plan_id: payload.plan_id,
        status: "cancelled",
      });
    }

    // =======================================================
    // RECALC ORDER STATUS
    // =======================================================
    if (action === "recalc-order-status") {
      let payload: { plan_id: string };
      try { payload = await req.json(); } catch {
        return jsonResponse({ success: false, error: "Invalid JSON request body" }, 400);
      }

      if (!payload.plan_id) {
        return jsonResponse({ success: false, error: "Missing plan_id" }, 400);
      }

      const { data: plan } = await supabase
        .from("plans")
        .select("id, status, user_id")
        .eq("id", payload.plan_id)
        .eq("user_id", userId)
        .maybeSingle();

      if (!plan) {
        return jsonResponse({ success: false, error: "Plan not found" }, 404);
      }

      const { data: commitments } = await serviceClient
        .from("commitments")
        .select("status")
        .eq("plan_id", payload.plan_id);

      if (!commitments || commitments.length === 0) {
        return jsonResponse({ success: true, plan_id: payload.plan_id, status: plan.status });
      }

      const total = commitments.length;
      const completed = commitments.filter((c: any) => c.status === "completed").length;
      const failed = commitments.filter((c: any) => c.status === "failed").length;
      const processing = commitments.filter((c: any) => c.status === "submitted" || c.status === "processing").length;

      let newStatus = plan.status;
      if (completed === total) {
        newStatus = "completed";
      } else if (failed === total) {
        newStatus = "failed";
      } else if (processing > 0) {
        newStatus = "payouts_processing";
      } else if (completed > 0 && failed > 0 && processing === 0) {
        newStatus = "partially_failed";
      }

      if (newStatus !== plan.status) {
        await serviceClient
          .from("plans")
          .update({ status: newStatus })
          .eq("id", payload.plan_id);
      }

      return jsonResponse({
        success: true,
        plan_id: payload.plan_id,
        status: newStatus,
        total,
        completed,
        failed,
        processing,
      });
    }

    return jsonResponse({
      success: false,
      error: "Unsupported action",
      supported_actions: ["lock-quote", "release-payouts", "confirm-payouts", "retry-payout", "cancel-order", "recalc-order-status"],
    }, 400);
  } catch (error) {
    console.error("senda-orchestrate error:", error);
    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : "Unexpected error",
    }, 500);
  }
});

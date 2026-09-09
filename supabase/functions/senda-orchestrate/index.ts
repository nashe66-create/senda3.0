import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.58.0";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey"
};
const TOKEN_URL = "https://idp.flutterwave.com/realms/flutterwave/protocol/openid-connect/token";
const FLW_BASE_URL = (()=>{
  const v = Deno.env.get("FLW_BASE_URL") ?? "";
  return /^https:\/\/[^ ]*flutterwave\.com/i.test(v) ? v : "https://developersandbox-api.flutterwave.com";
})();
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}
async function getAccessToken() {
  const clientId = Deno.env.get("FLW_CLIENT_ID");
  const clientSecret = Deno.env.get("FLW_CLIENT_SECRET");
  if (!clientId) throw new Error("FLW_CLIENT_ID is not configured");
  if (!clientSecret) throw new Error("FLW_CLIENT_SECRET is not configured");
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json"
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials"
    })
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch  {
    data = {
      raw_response: text
    };
  }
  if (!response.ok || !data?.access_token) {
    throw new Error(data?.error_description ?? data?.message ?? "Flutterwave authentication failed");
  }
  return data.access_token;
}
async function flutterwaveRequest(accessToken, method, path, body, idempotencyKey) {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-Trace-Id": crypto.randomUUID()
  };
  const testScenario = Deno.env.get("FLW_TEST_SCENARIO");
  if (testScenario && FLW_BASE_URL.includes("developersandbox-api.flutterwave.com")) {
    headers["X-Scenario-Key"] = testScenario;
  }
  if (idempotencyKey) {
    headers["X-Idempotency-Key"] = idempotencyKey;
  }
  const response = await fetch(`${FLW_BASE_URL}${path}`, {
    method,
    headers,
    ...body !== undefined ? {
      body: JSON.stringify(body)
    } : {}
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch  {
    data = {
      raw_response: text
    };
  }
  return {
    response,
    data
  };
}
function diagnosticResponseShape(data) {
  const root = data && typeof data === "object" ? data : {};
  const nested = root.data && typeof root.data === "object" ? root.data : {};
  // Flutterwave v4 error responses use { status, error: { code, message } } rather than flat root fields.
  const errorObj = root.error && typeof root.error === "object" ? root.error : {};
  return {
    response_root_keys: Object.keys(root),
    response_data_keys: Object.keys(nested),
    response_error_keys: Object.keys(errorObj),
    root_status: typeof root.status === "string" ? root.status : null,
    error_type: typeof root.error === "string" ? root.error : null,
    error_code: typeof root.code === "string" ? root.code : typeof root.error_code === "string" ? root.error_code : typeof errorObj.code === "string" ? errorObj.code : null,
    provider_message: typeof root.message === "string" ? root.message : typeof errorObj.message === "string" ? errorObj.message : null,
    provider_data_status: typeof nested.status === "string" ? nested.status : null,
    provider_data_contains_id: typeof nested.id === "string"
  };
}
async function getWalletBalance(accessToken, currency) {
  const { response, data } = await flutterwaveRequest(accessToken, "GET", `/wallets/${currency}/balance`);
  const balance = data?.data?.available_balance ?? data?.data?.balance;
  if (!response.ok || balance === undefined || balance === null) return null;
  return Number(balance);
}
function sandboxTestScenarioActive() {
  const testScenario = Deno.env.get("FLW_TEST_SCENARIO");
  return Boolean(testScenario) && FLW_BASE_URL.includes("developersandbox-api.flutterwave.com");
}
function mapTransferStatus(flwStatus) {
  const upper = flwStatus.toUpperCase();
  let internalStatus = "processing";
  if (upper === "COMPLETED" || upper === "SUCCESSFUL") {
    internalStatus = "completed";
  } else if (upper === "FAILED" || upper === "CANCELLED") {
    internalStatus = "failed";
  } else if (upper === "NEW" || upper === "PENDING") {
    internalStatus = "submitted";
  }
  return {
    status: internalStatus,
    providerStatus: upper
  };
}
function customerFriendlyFailure(reason) {
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
async function verifiedSenderId(supabase, userId) {
  const { data: profile } = await supabase.from("profiles").select("flutterwave_sender_id, kyc_status").eq("id", userId).maybeSingle();
  return profile?.kyc_status === "verified" && profile?.flutterwave_sender_id ? profile.flutterwave_sender_id : null;
}
async function requireTransferReconciliation(serviceClient, attemptId, commitmentId, errorMessage) {
  const activeStatuses = [
    "creating",
    "creating_unknown",
    "submitted",
    "confirming",
    "confirming_unknown",
    "processing"
  ];
  await serviceClient.from("transfer_attempts").update({
    status: "reconciliation_required",
    error_message: errorMessage,
    last_checked_at: new Date().toISOString()
  }).eq("id", attemptId).in("status", activeStatuses);
  await serviceClient.from("commitments").update({
    status: "reconciliation_required"
  }).eq("id", commitmentId).in("status", activeStatuses);
}
async function createAttemptTransfer(supabase, serviceClient, accessToken, userId, commitmentId, payoutMethod, isRetry) {
  const senderId = await verifiedSenderId(supabase, userId);
  if (!senderId) return {
    success: false,
    error: "Payouts require an authoritative KYC verification signal. Sender creation alone is not sufficient."
  };
  const { data: claimed, error: claimError } = await supabase.rpc("claim_transfer_creation", {
    p_commitment_id: commitmentId,
    p_payout_method: payoutMethod,
    p_request_fingerprint: `${payoutMethod}:${commitmentId}`,
    p_is_retry: isRetry
  });
  const attempt = claimed?.[0];
  if (claimError || !attempt) {
    return {
      success: false,
      error: "This payout is no longer eligible to be submitted. It may already be in progress or require reconciliation."
    };
  }
  const snapshot = attempt.recipient_snapshot;
  if (!snapshot?.flutterwave_recipient_id) {
    const { error: recordError } = await serviceClient.rpc("record_transfer_creation_result", {
      p_attempt_id: attempt.attempt_id,
      p_provider_transfer_id: null,
      p_provider_status: null,
      p_definitive_failure: true,
      p_error_message: "Recipient is not valid for a Flutterwave payout."
    });
    if (recordError) {
      await requireTransferReconciliation(serviceClient, attempt.attempt_id, commitmentId, "Recipient validation result could not be recorded and requires reconciliation.");
    }
    return {
      success: false,
      error: "Recipient is not valid for a Flutterwave payout."
    };
  }
  const transferPayload = {
    action: "deferred",
    reference: attempt.provider_reference,
    narration: `Senda transfer to ${snapshot.name ?? "recipient"}`,
    payment_instruction: {
      recipient_id: snapshot.flutterwave_recipient_id,
      source_currency: "GBP",
      amount: {
        applies_to: "source_currency",
        value: Number(attempt.amount_gbp)
      },
      sender_id: senderId
    }
  };
  try {
    const { response, data } = await flutterwaveRequest(accessToken, "POST", "/transfers", transferPayload, attempt.idempotency_key);
    const transferId = data?.data?.id ? String(data.data.id) : null;
    const providerStatus = data?.data?.status ?? null;
    const { error: recordError } = await serviceClient.rpc("record_transfer_creation_result", {
      p_attempt_id: attempt.attempt_id,
      p_provider_transfer_id: transferId,
      p_provider_status: providerStatus,
      p_definitive_failure: !response.ok,
      p_error_message: response.ok ? null : data?.message ?? "Transfer creation was rejected"
    });
    if (recordError) {
      await requireTransferReconciliation(serviceClient, attempt.attempt_id, commitmentId, "Transfer creation result could not be recorded and requires reconciliation.");
      return {
        success: false,
        error: "Transfer creation outcome requires reconciliation before any retry."
      };
    }
    if (!response.ok || !transferId) {
      return {
        success: false,
        error: response.ok ? "Flutterwave returned no transfer ID; reconciliation is required." : customerFriendlyFailure(data?.message)
      };
    }
    return {
      success: true,
      transfer_id: transferId,
      status: providerStatus
    };
  } catch (error) {
    const { error: recordError } = await serviceClient.rpc("record_transfer_creation_result", {
      p_attempt_id: attempt.attempt_id,
      p_provider_transfer_id: null,
      p_provider_status: null,
      p_definitive_failure: false,
      p_error_message: error instanceof Error ? error.message : "Transfer creation outcome is unknown"
    });
    if (recordError) {
      await requireTransferReconciliation(serviceClient, attempt.attempt_id, commitmentId, "Transfer creation outcome could not be recorded and requires reconciliation.");
    }
    return {
      success: false,
      error: "Transfer submission outcome is unknown and requires reconciliation before any retry."
    };
  }
}
async function releaseAttemptBackedPayouts(supabase, serviceClient, accessToken, userId, planId) {
  const { data: plan } = await supabase.from("plans").select("id, status, payment_status, quote_locked_at, destination_country").eq("id", planId).eq("user_id", userId).maybeSingle();
  if (!plan || plan.status !== "funded" || plan.payment_status !== "successful" || !plan.quote_locked_at) {
    return {
      success: false,
      status: 400,
      error: "Payouts can only be released for a funded order with a locked quote"
    };
  }
  const { data: transaction } = await serviceClient.from("transactions").select("id").eq("plan_id", planId).eq("status", "successful").not("completed_at", "is", null).maybeSingle();
  if (!transaction) {
    return {
      success: false,
      status: 400,
      error: "Payouts require a successful verified customer collection"
    };
  }
  const { data: commitments } = await serviceClient.from("commitments").select("id, payout_method, recipient_snapshot").eq("plan_id", planId).in("status", [
    "ready",
    "pending"
  ]);
  if (!commitments?.length) return {
    success: false,
    status: 400,
    error: "No ready payouts to release"
  };
  const { data: corridor } = await serviceClient.from("payout_corridor_countries").select("mobile_money_supported, cash_pickup_supported, bank_supported").eq("country_code", plan.destination_country ?? "").maybeSingle();
  const payouts = [];
  for (const commitment of commitments){
    const supported = corridor && (commitment.payout_method === "bank" ? corridor.bank_supported : commitment.payout_method === "mobile_money" ? corridor.mobile_money_supported : false);
    if (!supported) {
      const error = "The selected payout method is not supported for this corridor.";
      await serviceClient.from("commitments").update({
        status: "failed",
        failure_reason: error,
        failure_reason_display: error
      }).eq("id", commitment.id).in("status", [
        "ready",
        "pending"
      ]);
      payouts.push({
        commitment_id: commitment.id,
        status: "failed",
        error
      });
      continue;
    }
    const result = await createAttemptTransfer(supabase, serviceClient, accessToken, userId, commitment.id, commitment.payout_method, false);
    payouts.push({
      commitment_id: commitment.id,
      ...result
    });
  }
  const submitted = payouts.filter((p)=>p.success).length;
  const failed = payouts.length - submitted;
  return {
    success: true,
    plan_id: planId,
    total: payouts.length,
    submitted,
    failed,
    skipped: 0,
    errors: payouts.filter((p)=>p.error).map((p)=>p.error),
    payouts
  };
}
async function confirmAttemptBackedPayouts(supabase, serviceClient, accessToken, planId) {
  const { data: commitments } = await serviceClient.from("commitments").select("id").eq("plan_id", planId).eq("status", "submitted");
  if (!commitments?.length) return {
    success: false,
    status: 400,
    error: "No submitted payouts to confirm"
  };
  const payouts = [];
  for (const commitment of commitments){
    const { data: claimed } = await supabase.rpc("claim_transfer_confirmation", {
      p_commitment_id: commitment.id
    });
    const attempt = claimed?.[0];
    if (!attempt) continue;
    try {
      const { response, data } = await flutterwaveRequest(accessToken, "PUT", `/transfers/${attempt.provider_transfer_id}`, {
        initiate: true
      }, `SENDA-PAYOUT-CONFIRM-${attempt.attempt_id}`);
      // Sandbox scenario transfers can resolve to a non-NEW state before this PUT arrives, which
      // Flutterwave rejects with error 302400 "Transfer status not NEW". This is a Sandbox-only
      // timing artifact of the test scenario engine, not a production failure mode: production
      // transfers stay NEW until Senda explicitly initiates them. In that narrow Sandbox case,
      // fall back to GET to read the already-resolved authoritative status instead of failing.
      const alreadyResolvedInSandbox = !response.ok && sandboxTestScenarioActive() && data?.error?.code === "302400";
      if (!response.ok && !alreadyResolvedInSandbox) {
        console.error("Flutterwave transfer confirmation diagnostic", {
          provider_transfer_id: String(attempt.provider_transfer_id),
          http_status: response.status,
          ...diagnosticResponseShape(data)
        });
      }
      let providerStatus = data?.data?.status ?? null;
      let definitiveFailure = !response.ok && !alreadyResolvedInSandbox;
      let errorMessage = response.ok || alreadyResolvedInSandbox ? null : data?.error?.message ?? data?.message ?? "Transfer confirmation was rejected";
      if (response.ok || alreadyResolvedInSandbox) {
        const verification = await flutterwaveRequest(accessToken, "GET", `/transfers/${attempt.provider_transfer_id}`);
        if (!verification.response.ok || !verification.data?.data) {
          providerStatus = null;
          definitiveFailure = false;
          errorMessage = "Transfer confirmation status could not be verified.";
        } else {
          providerStatus = verification.data.data.status ?? null;
        }
      }
      const { error: recordError } = await serviceClient.rpc("record_transfer_confirmation_result", {
        p_attempt_id: attempt.attempt_id,
        p_provider_status: providerStatus,
        p_definitive_failure: definitiveFailure,
        p_error_message: errorMessage
      });
      if (recordError) {
        await requireTransferReconciliation(serviceClient, attempt.attempt_id, commitment.id, "Transfer confirmation result could not be recorded and requires reconciliation.");
        payouts.push({
          commitment_id: commitment.id,
          status: "reconciliation_required",
          error: "Confirmation outcome requires reconciliation before any retry."
        });
        continue;
      }
      payouts.push({
        commitment_id: commitment.id,
        status: providerStatus ?? (response.ok ? "processing" : "failed")
      });
    } catch (error) {
      const { error: recordError } = await serviceClient.rpc("record_transfer_confirmation_result", {
        p_attempt_id: attempt.attempt_id,
        p_provider_status: null,
        p_definitive_failure: false,
        p_error_message: error instanceof Error ? error.message : "Transfer confirmation outcome is unknown"
      });
      if (recordError) {
        await requireTransferReconciliation(serviceClient, attempt.attempt_id, commitment.id, "Transfer confirmation outcome could not be recorded and requires reconciliation.");
        payouts.push({
          commitment_id: commitment.id,
          status: "reconciliation_required",
          error: "Confirmation outcome requires reconciliation before any retry."
        });
      } else {
        payouts.push({
          commitment_id: commitment.id,
          status: "confirming_unknown",
          error: "Confirmation outcome is unknown and requires reconciliation."
        });
      }
    }
  }
  return {
    success: true,
    plan_id: planId,
    total: commitments.length,
    confirmed: payouts.filter((p)=>p.status === "COMPLETED" || p.status === "SUCCESSFUL").length,
    failed: payouts.filter((p)=>p.status === "failed").length,
    errors: payouts.filter((p)=>p.error).map((p)=>p.error),
    payouts
  };
}
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders
    });
  }
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Supabase server configuration is missing");
    }
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({
        success: false,
        error: "Unauthorized"
      }, 401);
    }
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      global: {
        headers: {
          Authorization: authHeader
        }
      }
    });
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return jsonResponse({
        success: false,
        error: "Unauthorized"
      }, 401);
    }
    const userId = user.id;
    const url = new URL(req.url);
    const action = url.searchParams.get("action");
    if (!action) {
      return jsonResponse({
        success: false,
        error: "Missing action parameter",
        supported_actions: [
          "lock-quote",
          "release-payouts",
          "confirm-payouts",
          "send-money",
          "retry-payout",
          "cancel-order",
          "recalc-order-status"
        ]
      }, 400);
    }
    // Service-role client for DB operations that need to bypass RLS
    const serviceClient = createClient(supabaseUrl, serviceRoleKey);
    // =======================================================
    // LOCK QUOTE
    // =======================================================
    if (action === "lock-quote") {
      let payload;
      try {
        payload = await req.json();
      } catch  {
        return jsonResponse({
          success: false,
          error: "Invalid JSON request body"
        }, 400);
      }
      if (!payload.plan_id) {
        return jsonResponse({
          success: false,
          error: "Missing plan_id"
        }, 400);
      }
      const { data: plan, error: planError } = await supabase.from("plans").select("id, status, quote_expires_at, quote_locked_at, user_id").eq("id", payload.plan_id).eq("user_id", userId).maybeSingle();
      if (planError || !plan) {
        return jsonResponse({
          success: false,
          error: "Plan not found"
        }, 404);
      }
      if (plan.status !== "quoted") {
        return jsonResponse({
          success: false,
          error: "Quote can only be locked from the quoted state",
          error_code: "INVALID_STATUS"
        }, 400);
      }
      if (plan.quote_locked_at) {
        return jsonResponse({
          success: false,
          error: "Quote is already locked",
          error_code: "ALREADY_LOCKED"
        }, 400);
      }
      const now = new Date();
      if (plan.quote_expires_at && new Date(plan.quote_expires_at) < now) {
        return jsonResponse({
          success: false,
          error: "Quote has expired. Please request a new quote.",
          error_code: "QUOTE_EXPIRED"
        }, 410);
      }
      // Lock the quote and transition to awaiting_payment.
      const { data: lockedPlan, error: lockError } = await serviceClient.from("plans").update({
        quote_locked_at: now.toISOString(),
        status: "awaiting_payment",
        payment_status: "pending"
      }).eq("id", payload.plan_id).select("id").maybeSingle();
      if (lockError || !lockedPlan) {
        console.error("Failed to lock quote:", lockError);
        return jsonResponse({
          success: false,
          error: "The quote could not be locked. No payment was started.",
          error_code: "QUOTE_LOCK_FAILED"
        }, 500);
      }
      // Create recipient snapshots for all commitments
      const { data: commitments } = await serviceClient.from("commitments").select(`
          id, recipient_id, receiving_method,
          recipient:recipients(
            id, name, country, receiving_method, phone,
            mobile_money_network, mobile_money_provider,
            bank_code, account_number, destination_country,
            currency, flutterwave_recipient_id, verification_status
          )
        `).eq("plan_id", payload.plan_id);
      if (commitments) {
        for (const c of commitments){
          const recipient = c.recipient;
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
            verification_status: recipient.verification_status ?? "pending"
          } : null;
          const payoutMethod = c.receiving_method === "bank_account" ? "bank" : c.receiving_method === "mobile_money" ? "mobile_money" : c.receiving_method === "cash_pickup" ? "cash_pickup" : "mobile_money";
          await serviceClient.from("commitments").update({
            recipient_snapshot: snapshot,
            payout_method: payoutMethod,
            status: "ready"
          }).eq("id", c.id);
        }
      }
      return jsonResponse({
        success: true,
        plan_id: payload.plan_id,
        status: "awaiting_payment",
        quote_locked_at: now.toISOString()
      });
    }
    // =======================================================
    // RELEASE PAYOUTS
    // =======================================================
    if (action === "release-payouts") {
      let payload;
      try {
        payload = await req.json();
      } catch  {
        return jsonResponse({
          success: false,
          error: "Invalid JSON request body"
        }, 400);
      }
      if (!payload.plan_id) {
        return jsonResponse({
          success: false,
          error: "Missing plan_id"
        }, 400);
      }
      const releaseResult = await releaseAttemptBackedPayouts(supabase, serviceClient, await getAccessToken(), userId, payload.plan_id);
      return jsonResponse(releaseResult, releaseResult.success ? 200 : releaseResult.status ?? 400);
      const { data: plan, error: planError } = await supabase.from("plans").select("id, status, payment_status, quote_locked_at, customer_pays, user_id").eq("id", payload.plan_id).eq("user_id", userId).maybeSingle();
      if (planError || !plan) {
        return jsonResponse({
          success: false,
          error: "Plan not found"
        }, 404);
      }
      if (plan.status !== "funded") {
        return jsonResponse({
          success: false,
          error: "Payouts can only be released for funded orders",
          error_code: "NOT_FUNDED",
          current_status: plan.status
        }, 400);
      }
      if (plan.payment_status !== "successful") {
        return jsonResponse({
          success: false,
          error: "Payment must be successful before releasing payouts",
          error_code: "PAYMENT_NOT_SUCCESSFUL"
        }, 400);
      }
      if (!plan.quote_locked_at) {
        return jsonResponse({
          success: false,
          error: "Quote must be locked before releasing payouts",
          error_code: "QUOTE_NOT_LOCKED"
        }, 400);
      }
      // Verify the transaction is successful
      const { data: transaction } = await serviceClient.from("transactions").select("id, status, completed_at").eq("plan_id", payload.plan_id).order("created_at", {
        ascending: false
      }).limit(1).maybeSingle();
      if (!transaction || transaction.status !== "successful" || !transaction.completed_at) {
        return jsonResponse({
          success: false,
          error: "No successful verified transaction found for this order",
          error_code: "NO_VERIFIED_TRANSACTION"
        }, 400);
      }
      // Fetch ready commitments with snapshots
      const { data: commitments } = await serviceClient.from("commitments").select(`
          id, amount_gbp, amount_destination, fx_rate, destination_currency,
          payout_method, recipient_snapshot, status, idempotency_key,
          flutterwave_transfer_id
        `).eq("plan_id", payload.plan_id).in("status", [
        "ready",
        "pending"
      ]);
      if (!commitments || commitments.length === 0) {
        return jsonResponse({
          success: false,
          error: "No ready payouts to release"
        }, 400);
      }
      // Verify corridor support for each payout method
      const { data: corridor } = await serviceClient.from("payout_corridor_countries").select("mobile_money_supported, cash_pickup_supported, bank_supported").eq("country_code", plan.destination_country ?? "").maybeSingle();
      const accessToken = await getAccessToken();
      const payouts = [];
      let submitted = 0;
      let failed = 0;
      let skipped = 0;
      const errors = [];
      for (const c of commitments){
        const snapshot = c.recipient_snapshot;
        const recipientName = snapshot?.name ?? "Unknown";
        // Check corridor support
        if (c.payout_method === "bank" && corridor && !corridor.bank_supported) {
          failed++;
          errors.push(`${recipientName}: Bank transfers are not supported for this corridor`);
          payouts.push({
            commitment_id: c.id,
            recipient_name: recipientName,
            status: "failed",
            transfer_id: null,
            error: "Bank not supported for this corridor"
          });
          continue;
        }
        if (c.payout_method === "mobile_money" && corridor && !corridor.mobile_money_supported) {
          failed++;
          errors.push(`${recipientName}: Mobile money is not supported for this corridor`);
          payouts.push({
            commitment_id: c.id,
            recipient_name: recipientName,
            status: "failed",
            transfer_id: null,
            error: "Mobile money not supported for this corridor"
          });
          continue;
        }
        if (c.payout_method === "cash_pickup" && corridor && !corridor.cash_pickup_supported) {
          failed++;
          errors.push(`${recipientName}: Cash pickup is not supported for this corridor`);
          payouts.push({
            commitment_id: c.id,
            recipient_name: recipientName,
            status: "failed",
            transfer_id: null,
            error: "Cash pickup not supported for this corridor"
          });
          continue;
        }
        // Deterministic idempotency key
        const idempotencyKey = `SENDA-PAYOUT-${c.id}`;
        // Skip if already has a transfer ID (idempotent retry)
        if (c.flutterwave_transfer_id) {
          skipped++;
          payouts.push({
            commitment_id: c.id,
            recipient_name: recipientName,
            status: "submitted",
            transfer_id: c.flutterwave_transfer_id
          });
          continue;
        }
        // Store idempotency key before the API call
        await serviceClient.from("commitments").update({
          idempotency_key: idempotencyKey,
          status: "submitted"
        }).eq("id", c.id);
        // Build transfer payload from snapshot
        const nameParts = (snapshot?.name ?? "").trim().split(/\s+/);
        const firstName = nameParts[0] || "";
        const lastName = nameParts.slice(1).join(" ") || "";
        const countryCode = snapshot?.destination_country ?? snapshot?.country ?? "";
        let transferPath;
        let transferPayload;
        if (c.payout_method === "bank" || c.payout_method === "mobile_money") {
          // Flutterwave transfers by recipient_id reuse the recipient created earlier
          // (its type/currency/network/bank details already validated at creation time).
          const recipientId = snapshot?.flutterwave_recipient_id;
          const isVerified = snapshot?.verification_status === "verified";
          if (!recipientId || !isVerified) {
            const errorMsg = "This recipient needs attention before a payout can be made. Please update the recipient details.";
            failed++;
            errors.push(`${recipientName}: ${errorMsg}`);
            await serviceClient.from("commitments").update({
              status: "failed",
              failure_reason: errorMsg,
              failure_reason_display: errorMsg
            }).eq("id", c.id);
            payouts.push({
              commitment_id: c.id,
              recipient_name: recipientName,
              status: "failed",
              transfer_id: null,
              error: errorMsg
            });
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
                value: Number(c.amount_gbp)
              },
              recipient_id: recipientId
            }
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
                value: Number(c.amount_gbp)
              },
              recipient: {
                name: {
                  first: firstName,
                  last: lastName
                },
                cash_pickup: {
                  country: countryCode
                }
              },
              destination_currency: c.destination_currency
            }
          };
        }
        try {
          const { response, data } = await flutterwaveRequest(accessToken, "POST", transferPath, transferPayload, idempotencyKey);
          const transferId = data?.data?.id ?? null;
          const flwStatus = data?.data?.status ?? "";
          const { status: internalStatus, providerStatus } = mapTransferStatus(flwStatus);
          if (transferId) {
            await serviceClient.from("commitments").update({
              flutterwave_transfer_id: String(transferId),
              status: "submitted",
              provider_status: providerStatus
            }).eq("id", c.id);
            submitted++;
            payouts.push({
              commitment_id: c.id,
              recipient_name: recipientName,
              status: "submitted",
              transfer_id: String(transferId)
            });
          } else if (!response.ok) {
            const errorMsg = data?.message ?? "Transfer creation failed";
            const displayMsg = customerFriendlyFailure(errorMsg);
            await serviceClient.from("commitments").update({
              status: "failed",
              failure_reason: errorMsg,
              failure_reason_display: displayMsg
            }).eq("id", c.id);
            failed++;
            errors.push(`${recipientName}: ${displayMsg}`);
            payouts.push({
              commitment_id: c.id,
              recipient_name: recipientName,
              status: "failed",
              transfer_id: null,
              error: displayMsg
            });
          }
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : "Transfer creation failed";
          const displayMsg = customerFriendlyFailure(errorMsg);
          await serviceClient.from("commitments").update({
            status: "failed",
            failure_reason: errorMsg,
            failure_reason_display: displayMsg
          }).eq("id", c.id);
          failed++;
          errors.push(`${recipientName}: ${displayMsg}`);
          payouts.push({
            commitment_id: c.id,
            recipient_name: recipientName,
            status: "failed",
            transfer_id: null,
            error: displayMsg
          });
        }
      }
      // Transition plan to payouts_processing
      await serviceClient.from("plans").update({
        status: "payouts_processing"
      }).eq("id", payload.plan_id);
      return jsonResponse({
        success: true,
        plan_id: payload.plan_id,
        total: commitments.length,
        submitted,
        failed,
        skipped,
        errors,
        payouts
      });
    }
    // =======================================================
    // CONFIRM PAYOUTS
    // =======================================================
    if (action === "confirm-payouts") {
      let payload;
      try {
        payload = await req.json();
      } catch  {
        return jsonResponse({
          success: false,
          error: "Invalid JSON request body"
        }, 400);
      }
      if (!payload.plan_id) {
        return jsonResponse({
          success: false,
          error: "Missing plan_id"
        }, 400);
      }
      const confirmResult = await confirmAttemptBackedPayouts(supabase, serviceClient, await getAccessToken(), payload.plan_id);
      return jsonResponse(confirmResult, confirmResult.success ? 200 : confirmResult.status ?? 400);
      const { data: plan } = await supabase.from("plans").select("id, status, user_id").eq("id", payload.plan_id).eq("user_id", userId).maybeSingle();
      if (!plan) {
        return jsonResponse({
          success: false,
          error: "Plan not found"
        }, 404);
      }
      const { data: commitments } = await serviceClient.from("commitments").select("id, amount_gbp, flutterwave_transfer_id, status, recipient_snapshot").eq("plan_id", payload.plan_id).eq("status", "submitted");
      if (!commitments || commitments.length === 0) {
        return jsonResponse({
          success: false,
          error: "No submitted payouts to confirm"
        }, 400);
      }
      const accessToken = await getAccessToken();
      const payouts = [];
      let confirmed = 0;
      let failed = 0;
      const errors = [];
      for (const c of commitments){
        if (!c.flutterwave_transfer_id) {
          failed++;
          errors.push("Missing transfer ID");
          continue;
        }
        // Check wallet balance before confirming
        const balance = await getWalletBalance(accessToken, "GBP");
        if (balance !== null && balance < Number(c.amount_gbp)) {
          const displayMsg = "Senda's wallet balance was insufficient to complete this transfer. Please try again later.";
          await serviceClient.from("commitments").update({
            status: "failed",
            failure_reason: "Insufficient wallet balance",
            failure_reason_display: displayMsg
          }).eq("id", c.id);
          failed++;
          errors.push(displayMsg);
          payouts.push({
            commitment_id: c.id,
            status: "failed",
            error: displayMsg
          });
          continue;
        }
        try {
          const { response, data } = await flutterwaveRequest(accessToken, "PUT", `/transfers/${c.flutterwave_transfer_id}`, {
            initiate: true
          });
          const flwStatus = data?.data?.status ?? "";
          const { status: internalStatus, providerStatus } = mapTransferStatus(flwStatus);
          const updateData = {
            status: internalStatus,
            provider_status: providerStatus
          };
          if (internalStatus === "failed") {
            updateData.failure_reason = data?.message ?? "Transfer failed";
            updateData.failure_reason_display = customerFriendlyFailure(data?.message);
            failed++;
            errors.push(`${c.recipient_snapshot?.name ?? "Unknown"}: ${updateData.failure_reason_display}`);
          } else if (internalStatus === "completed") {
            confirmed++;
          }
          await serviceClient.from("commitments").update(updateData).eq("id", c.id);
          payouts.push({
            commitment_id: c.id,
            status: internalStatus
          });
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : "Transfer confirmation failed";
          const displayMsg = customerFriendlyFailure(errorMsg);
          await serviceClient.from("commitments").update({
            status: "failed",
            failure_reason: errorMsg,
            failure_reason_display: displayMsg
          }).eq("id", c.id);
          failed++;
          errors.push(displayMsg);
          payouts.push({
            commitment_id: c.id,
            status: "failed",
            error: displayMsg
          });
        }
      }
      return jsonResponse({
        success: true,
        plan_id: payload.plan_id,
        total: commitments.length,
        confirmed,
        failed,
        errors,
        payouts
      });
    }
    // =======================================================
    // SEND MONEY — customer-facing action combining release + confirm
    // =======================================================
    if (action === "send-money") {
      let payload;
      try {
        payload = await req.json();
      } catch  {
        return jsonResponse({
          success: false,
          error: "Invalid JSON request body"
        }, 400);
      }
      if (!payload.plan_id) {
        return jsonResponse({
          success: false,
          error: "Missing plan_id"
        }, 400);
      }
      const accessToken = await getAccessToken();
      const releaseResult = await releaseAttemptBackedPayouts(supabase, serviceClient, accessToken, userId, payload.plan_id);
      if (!releaseResult.success) {
        return jsonResponse(releaseResult, releaseResult.status ?? 400);
      }
      // Confirm every commitment now sitting at 'submitted' for this plan (claim_transfer_confirmation
      // is per-commitment atomic, so this is safe even if some were already submitted earlier).
      const confirmResult = await confirmAttemptBackedPayouts(supabase, serviceClient, accessToken, payload.plan_id);
      const confirmPayouts = confirmResult.success ? confirmResult.payouts : [];
      const payouts = releaseResult.payouts.map((rp)=>{
        const confirmed = confirmPayouts.find((cp)=>cp.commitment_id === rp.commitment_id);
        if (confirmed) return {
          commitment_id: rp.commitment_id,
          status: confirmed.status,
          error: confirmed.error ?? null
        };
        return {
          commitment_id: rp.commitment_id,
          status: rp.success ? "submitted" : "failed",
          error: rp.error ?? null
        };
      });
      return jsonResponse({
        success: true,
        plan_id: payload.plan_id,
        total: payouts.length,
        errors: payouts.filter((p)=>p.error).map((p)=>p.error),
        payouts
      });
    }
    // =======================================================
    // RETRY PAYOUT
    // =======================================================
    if (action === "retry-payout") {
      let payload;
      try {
        payload = await req.json();
      } catch  {
        return jsonResponse({
          success: false,
          error: "Invalid JSON request body"
        }, 400);
      }
      if (!payload.commitment_id || !payload.payout_method) {
        return jsonResponse({
          success: false,
          error: "Missing commitment_id or payout_method"
        }, 400);
      }
      const { data: retryCommitment } = await supabase.from("commitments").select("plan_id, payout_method").eq("id", payload.commitment_id).eq("user_id", userId).maybeSingle();
      if (!retryCommitment) return jsonResponse({
        success: false,
        error: "Commitment not found"
      }, 404);
      if (payload.payout_method !== retryCommitment.payout_method) {
        return jsonResponse({
          success: false,
          error: "A payout retry must use the recipient's verified payout method"
        }, 400);
      }
      const retryResult = await createAttemptTransfer(supabase, serviceClient, await getAccessToken(), userId, payload.commitment_id, payload.payout_method, true);
      return jsonResponse(retryResult, retryResult.success ? 200 : 409);
      const { data: commitment } = await supabase.from("commitments").select(`
          id, plan_id, amount_gbp, destination_currency, recipient_snapshot,
          status, user_id,
          plan:plans(id, status, payment_status, quote_locked_at, destination_country)
        `).eq("id", payload.commitment_id).eq("user_id", userId).maybeSingle();
      if (!commitment) {
        return jsonResponse({
          success: false,
          error: "Commitment not found"
        }, 404);
      }
      if (commitment.status !== "failed") {
        return jsonResponse({
          success: false,
          error: "Only failed payouts can be retried",
          error_code: "NOT_FAILED"
        }, 400);
      }
      const plan = commitment.plan;
      if (!plan || plan.status !== "partially_failed" && plan.status !== "funded" && plan.status !== "payouts_processing") {
        return jsonResponse({
          success: false,
          error: "Order must be in a state that allows retry",
          error_code: "INVALID_ORDER_STATUS"
        }, 400);
      }
      // Verify corridor support for new method
      const { data: corridor } = await serviceClient.from("payout_corridor_countries").select("mobile_money_supported, cash_pickup_supported, bank_supported").eq("country_code", plan.destination_country ?? "").maybeSingle();
      if (payload.payout_method === "bank" && corridor && !corridor.bank_supported) {
        return jsonResponse({
          success: false,
          error: "Bank transfers are not supported for this corridor"
        }, 400);
      }
      if (payload.payout_method === "mobile_money" && corridor && !corridor.mobile_money_supported) {
        return jsonResponse({
          success: false,
          error: "Mobile money is not supported for this corridor"
        }, 400);
      }
      if (payload.payout_method === "cash_pickup" && corridor && !corridor.cash_pickup_supported) {
        return jsonResponse({
          success: false,
          error: "Cash pickup is not supported for this corridor"
        }, 400);
      }
      const snapshot = commitment.recipient_snapshot;
      if ((payload.payout_method === "mobile_money" || payload.payout_method === "bank") && (!snapshot?.flutterwave_recipient_id || snapshot?.verification_status !== "verified")) {
        return jsonResponse({
          success: false,
          error: "This recipient needs attention before a payout can be made. Please update the recipient details."
        }, 400);
      }
      const idempotencyKey = `SENDA-PAYOUT-RETRY-${commitment.id}-${payload.payout_method}`;
      // Update commitment with new method and reset status
      await serviceClient.from("commitments").update({
        payout_method: payload.payout_method,
        status: "submitted",
        idempotency_key: idempotencyKey,
        flutterwave_transfer_id: null,
        failure_reason: null,
        failure_reason_display: null
      }).eq("id", commitment.id);
      const accessToken = await getAccessToken();
      const nameParts = (snapshot?.name ?? "").trim().split(/\s+/);
      const firstName = nameParts[0] || "";
      const lastName = nameParts.slice(1).join(" ") || "";
      const countryCode = snapshot?.destination_country ?? snapshot?.country ?? "";
      let transferPath;
      let transferPayload;
      if (payload.payout_method === "bank" || payload.payout_method === "mobile_money") {
        transferPath = "/transfers";
        transferPayload = {
          action: "deferred",
          reference: `senda-r${commitment.id.substring(0, 16)}`,
          narration: `Senda retry to ${snapshot?.name ?? "recipient"}`,
          payment_instruction: {
            source_currency: "GBP",
            amount: {
              applies_to: "source_currency",
              value: Number(commitment.amount_gbp)
            },
            recipient_id: snapshot.flutterwave_recipient_id
          }
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
            amount: {
              applies_to: "source_currency",
              value: Number(commitment.amount_gbp)
            },
            recipient: {
              name: {
                first: firstName,
                last: lastName
              },
              cash_pickup: {
                country: countryCode
              }
            },
            destination_currency: commitment.destination_currency
          }
        };
      }
      try {
        const { response, data } = await flutterwaveRequest(accessToken, "POST", transferPath, transferPayload, idempotencyKey);
        const transferId = data?.data?.id ?? null;
        const flwStatus = data?.data?.status ?? "";
        const { status: internalStatus, providerStatus } = mapTransferStatus(flwStatus);
        if (transferId) {
          await serviceClient.from("commitments").update({
            flutterwave_transfer_id: String(transferId),
            status: "submitted",
            provider_status: providerStatus
          }).eq("id", commitment.id);
          // Confirm immediately since order is already funded
          const { data: confirmData } = await flutterwaveRequest(accessToken, "PUT", `/transfers/${String(transferId)}`, {
            initiate: true
          });
          const confirmFlwStatus = confirmData?.data?.status ?? "";
          const { status: confirmStatus, providerStatus: confirmProvider } = mapTransferStatus(confirmFlwStatus);
          const updateData = {
            status: confirmStatus,
            provider_status: confirmProvider
          };
          if (confirmStatus === "failed") {
            updateData.failure_reason = confirmData?.message ?? "Transfer failed";
            updateData.failure_reason_display = customerFriendlyFailure(confirmData?.message);
          }
          await serviceClient.from("commitments").update(updateData).eq("id", commitment.id);
          return jsonResponse({
            success: true,
            commitment_id: commitment.id,
            status: confirmStatus,
            transfer_id: String(transferId)
          });
        } else {
          const errorMsg = data?.message ?? "Transfer creation failed";
          const displayMsg = customerFriendlyFailure(errorMsg);
          await serviceClient.from("commitments").update({
            status: "failed",
            failure_reason: errorMsg,
            failure_reason_display: displayMsg
          }).eq("id", commitment.id);
          return jsonResponse({
            success: false,
            error: displayMsg
          }, 502);
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Transfer failed";
        const displayMsg = customerFriendlyFailure(errorMsg);
        await serviceClient.from("commitments").update({
          status: "failed",
          failure_reason: errorMsg,
          failure_reason_display: displayMsg
        }).eq("id", commitment.id);
        return jsonResponse({
          success: false,
          error: displayMsg
        }, 502);
      }
    }
    // =======================================================
    // CANCEL ORDER
    // =======================================================
    if (action === "cancel-order") {
      let payload;
      try {
        payload = await req.json();
      } catch  {
        return jsonResponse({
          success: false,
          error: "Invalid JSON request body"
        }, 400);
      }
      if (!payload.plan_id) {
        return jsonResponse({
          success: false,
          error: "Missing plan_id"
        }, 400);
      }
      const { data: plan } = await supabase.from("plans").select("id, status, user_id").eq("id", payload.plan_id).eq("user_id", userId).maybeSingle();
      if (!plan) {
        return jsonResponse({
          success: false,
          error: "Plan not found"
        }, 404);
      }
      const cancellableStates = [
        "draft",
        "quoted",
        "awaiting_payment",
        "funded"
      ];
      if (!cancellableStates.includes(plan.status)) {
        return jsonResponse({
          success: false,
          error: "This order cannot be cancelled in its current state. Payouts may have already been submitted.",
          error_code: "NOT_CANCELLABLE"
        }, 400);
      }
      // If funded, check that no payouts have been submitted
      if (plan.status === "funded") {
        const { data: submittedPayouts } = await serviceClient.from("commitments").select("id").eq("plan_id", payload.plan_id).in("status", [
          "submitted",
          "processing",
          "completed"
        ]);
        if (submittedPayouts && submittedPayouts.length > 0) {
          return jsonResponse({
            success: false,
            error: "Cannot cancel: some payouts have already been submitted",
            error_code: "PAYOUTS_SUBMITTED"
          }, 400);
        }
      }
      await serviceClient.from("plans").update({
        status: "cancelled"
      }).eq("id", payload.plan_id);
      return jsonResponse({
        success: true,
        plan_id: payload.plan_id,
        status: "cancelled"
      });
    }
    // =======================================================
    // RECALC ORDER STATUS
    // =======================================================
    if (action === "recalc-order-status") {
      let payload;
      try {
        payload = await req.json();
      } catch  {
        return jsonResponse({
          success: false,
          error: "Invalid JSON request body"
        }, 400);
      }
      if (!payload.plan_id) {
        return jsonResponse({
          success: false,
          error: "Missing plan_id"
        }, 400);
      }
      const { data: plan } = await supabase.from("plans").select("id, status, user_id").eq("id", payload.plan_id).eq("user_id", userId).maybeSingle();
      if (!plan) {
        return jsonResponse({
          success: false,
          error: "Plan not found"
        }, 404);
      }
      const { data: commitments } = await serviceClient.from("commitments").select("status").eq("plan_id", payload.plan_id);
      if (!commitments || commitments.length === 0) {
        return jsonResponse({
          success: true,
          plan_id: payload.plan_id,
          status: plan.status
        });
      }
      const total = commitments.length;
      const completed = commitments.filter((c)=>c.status === "completed").length;
      const failed = commitments.filter((c)=>c.status === "failed").length;
      const processing = commitments.filter((c)=>c.status === "submitted" || c.status === "processing").length;
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
        await serviceClient.from("plans").update({
          status: newStatus
        }).eq("id", payload.plan_id);
      }
      return jsonResponse({
        success: true,
        plan_id: payload.plan_id,
        status: newStatus,
        total,
        completed,
        failed,
        processing
      });
    }
    return jsonResponse({
      success: false,
      error: "Unsupported action",
      supported_actions: [
        "lock-quote",
        "release-payouts",
        "confirm-payouts",
        "retry-payout",
        "cancel-order",
        "recalc-order-status"
      ]
    }, 400);
  } catch (error) {
    console.error("senda-orchestrate error:", error);
    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : "Unexpected error"
    }, 500);
  }
});

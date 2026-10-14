import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.58.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
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

async function flutterwaveGet(accessToken: string, path: string) {
  const response = await fetch(`${FLW_BASE_URL}${path}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Trace-Id": crypto.randomUUID(),
    },
  });

  const text = await response.text();
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw_response: text }; }

  return { ok: response.ok, status: response.status, data };
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

    const url = new URL(req.url);
    const transactionId = url.searchParams.get("transaction_id");

    if (!transactionId) {
      return jsonResponse({ success: false, error: "Missing transaction_id parameter" }, 400);
    }

    // Look up the charge ID from the transaction
    const { data: transaction } = await supabase
      .from("transactions")
      .select("flutterwave_charge_id, amount_gbp, payment_reference, status, plan_id, created_at")
      .eq("id", transactionId)
      .eq("user_id", userId)
      .maybeSingle();

    if (!transaction) {
      return jsonResponse({ success: false, error: "Transaction not found" }, 404);
    }

    const accessToken = await getAccessToken();
    let chargeId = transaction.flutterwave_charge_id;

    // Recover the provider charge for previously submitted requests where the
    // app lost the charge ID. Match the provider's unique reference exactly.
    if (!chargeId && transaction.payment_reference) {
      const listResult = await flutterwaveGet(
        accessToken,
        `/charges?reference=${encodeURIComponent(transaction.payment_reference)}&size=10`,
      );
      if (!listResult.ok) {
        return jsonResponse({
          success: false,
          error: "Failed to look up the payment with Flutterwave",
        }, 502);
      }

      const matchingCharges = Array.isArray(listResult.data?.data)
        ? listResult.data.data.filter((item: any) => item?.reference === transaction.payment_reference && item?.id)
        : [];

      if (matchingCharges.length !== 1) {
        if (matchingCharges.length === 0 && transaction.status === "pending") {
          const { data: processingPlan } = await serviceClient
            .from("plans")
            .select("id, status, updated_at")
            .eq("id", transaction.plan_id)
            .maybeSingle();
          const lastPaymentStateChange = Date.parse(String(processingPlan?.updated_at ?? ""));
          const oldPendingRequestHasNoProviderCharge =
            processingPlan?.status === "payment_processing" &&
            Number.isFinite(lastPaymentStateChange) &&
            Date.now() - lastPaymentStateChange > 30 * 60 * 1000;

          // The plan timestamp is updated when payment_processing begins. Using
          // it avoids racing a new submission whose transaction itself is old.
          if (oldPendingRequestHasNoProviderCharge) {
            const { data: failedTransaction, error: failTransactionError } = await serviceClient
              .from("transactions")
              .update({ status: "failed", idempotency_key: null })
              .eq("id", transactionId)
              .eq("status", "pending")
              .is("flutterwave_charge_id", null)
              .select("id")
              .maybeSingle();

            if (!failTransactionError && failedTransaction) {
              await serviceClient
                .from("plans")
                .update({ status: "quoted", payment_status: "pending", quote_locked_at: null })
                .eq("id", transaction.plan_id)
                .eq("status", "payment_processing");

              return jsonResponse({
                success: true,
                verified: true,
                status: "failed",
                charge_status: "not_found",
                charge_lookup: "not_found_after_grace_period",
              });
            }
          }
        }

        return jsonResponse({
          success: true,
          verified: false,
          status: transaction.status,
          charge_status: "pending",
          charge_lookup: matchingCharges.length === 0 ? "not_found_yet" : "ambiguous",
        });
      }

      chargeId = String(matchingCharges[0].id);
      const { error: saveChargeIdError } = await serviceClient
        .from("transactions")
        .update({ flutterwave_charge_id: chargeId })
        .eq("id", transactionId)
        .is("flutterwave_charge_id", null);
      if (saveChargeIdError) {
        console.error("Could not save recovered Flutterwave charge ID:", saveChargeIdError);
        return jsonResponse({ success: false, error: "Payment was found but could not be linked safely" }, 500);
      }
    }

    if (!chargeId) {
      return jsonResponse({
        success: true,
        verified: false,
        status: transaction.status,
        charge_status: "pending",
        charge_lookup: "missing_reference",
      });
    }

    const { ok, data } = await flutterwaveGet(accessToken, `/charges/${encodeURIComponent(chargeId)}`);

    if (!ok) {
      return jsonResponse({
        success: false,
        error: "Failed to verify charge with Flutterwave",
      }, 502);
    }

    const chargeData = data?.data ?? {};
    const chargeStatus = String(chargeData.status ?? "").toLowerCase();

    // Re-verify: check status === 'succeeded' AND amount/currency/reference match
    const amountMatches = Number(chargeData.amount) === Number(transaction.amount_gbp);
    const referenceMatches = chargeData.reference === transaction.payment_reference;

    let dbStatus = transaction.status;
    let verified = false;

    if (chargeStatus === "succeeded" && amountMatches && referenceMatches) {
      const { data: plan } = await serviceClient
        .from("plans")
        .select("id, status, quote_locked_at, customer_pays")
        .eq("id", transaction.plan_id)
        .maybeSingle();
      const amountMatchesQuote = plan && Math.abs(Number(chargeData.amount) - Number(plan.customer_pays)) <= 0.01;
      const currencyMatches = String(chargeData.currency ?? "GBP").toUpperCase() === "GBP";

      if (plan?.quote_locked_at && amountMatchesQuote && currencyMatches) {
        dbStatus = "successful";
        verified = true;
        await serviceClient
          .from("plans")
          .update({ payment_status: "successful", status: "funded" })
          .eq("id", transaction.plan_id)
          .in("status", ["awaiting_payment", "payment_processing"]);
      } else {
        // The provider reports a successful charge, but one of Senda's
        // amount/currency/quote checks failed. Never label a potentially
        // collected payment as a normal failure or permit another payment.
        console.error("Flutterwave charge requires payment reconciliation", {
          transaction_id: transactionId,
          charge_id: chargeId,
          amount_matches: amountMatches,
          quote_amount_matches: Boolean(amountMatchesQuote),
          currency_matches: currencyMatches,
          quote_locked: Boolean(plan?.quote_locked_at),
        });
      }
    } else if (chargeStatus === "failed" || chargeStatus === "voided") {
      dbStatus = "failed";
      verified = true;
    }

    if (verified && dbStatus !== transaction.status) {
      const updateData: Record<string, unknown> = { status: dbStatus };
      if (dbStatus === "successful") {
        updateData.completed_at = new Date().toISOString();
      }
      if (chargeData.card?.last_4) updateData.card_last4 = chargeData.card.last_4;
      if (chargeData.card?.network) updateData.card_network = chargeData.card.network;

      await serviceClient
        .from("transactions")
        .update(updateData)
        .eq("id", transactionId);

    }

    if (dbStatus === "failed" && transaction.plan_id && (chargeStatus === "failed" || chargeStatus === "voided")) {
      // The provider has confirmed no money was collected, so unlock the plan
      // for a fresh quote/payment attempt instead of reusing the old transaction.
      await serviceClient
        .from("plans")
        .update({ payment_status: "pending", status: "quoted", quote_locked_at: null })
        .eq("id", transaction.plan_id)
        .in("status", ["awaiting_payment", "payment_processing", "payment_failed"]);
    }

    return jsonResponse({
      success: true,
      verified,
      status: dbStatus,
      charge_status: chargeStatus,
      next_action: chargeData.next_action ?? null,
      amount_matches: amountMatches,
      reference_matches: referenceMatches,
    });
  } catch (error) {
    console.error("Flutterwave charge-verify error:", error);
    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : "Unexpected error",
    }, 500);
  }
});

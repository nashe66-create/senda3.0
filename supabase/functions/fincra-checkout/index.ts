import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.58.0";
import { FincraApiError, createFincraCheckout, getFincraCheckoutByReference } from "../_shared/fincra.ts";
import { invokeFincraFunction } from "../_shared/internal-functions.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function jsonResponse(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function statusForReconciliation(checkout: Record<string, unknown>): string | null {
  const status = String(
    checkout.status ??
      checkout.paymentStatus ??
      checkout.payment_status ??
      "",
  ).toLowerCase();

  const statusMap: Record<string, string> = {
    pending: "pending",
    initiated: "pending",
    processing: "processing",
    in_progress: "processing",
    successful: "successful",
    success: "successful",
    completed: "successful",
    paid: "successful",
    failed: "failed",
    failure: "failed",
    cancelled: "failed",
    canceled: "failed",
    reversed: "reversed",
    refunded: "reversed",
  };

  return statusMap[status] ?? null;
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

    if (req.method === "GET") {
      const reference = new URL(req.url).searchParams.get("reference");
      if (!reference) {
        return jsonResponse({ success: false, error: "Missing reference query parameter" }, 400);
      }

      let { data: transaction, error: transactionError } = await supabase
        .from("transactions")
        .select("id, plan_id, fincra_checkout_reference, fincra_collection_reference")
        .eq("user_id", user.id)
        .eq("fincra_checkout_reference", reference)
        .maybeSingle();

      if (!transaction && !transactionError) {
        const collectionLookup = await supabase
          .from("transactions")
          .select("id, plan_id, fincra_checkout_reference, fincra_collection_reference")
          .eq("user_id", user.id)
          .eq("fincra_collection_reference", reference)
          .maybeSingle();
        transaction = collectionLookup.data;
        transactionError = collectionLookup.error;
      }

      if (transactionError || !transaction) {
        return jsonResponse({ success: false, error: "Payment transaction not found" }, 404);
      }

      const checkout = await getFincraCheckoutByReference<Record<string, unknown>>(reference);
      const status = statusForReconciliation(checkout);
      let reconciliation: Record<string, unknown> | null = null;
      let advancementError: string | null = null;

      if (status) {
        const amountValue = checkout.amount ?? checkout.paidAmount ?? checkout.paid_amount ?? checkout.chargedAmount;
        const amount = amountValue == null ? null : Number(amountValue);
        const digest = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(JSON.stringify(checkout)),
        );
        const eventId = `checkout-poll:${reference}:${Array.from(new Uint8Array(digest))
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join("")}`;
        const supabaseUrl = Deno.env.get("SUPABASE_URL");
        const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        if (!supabaseUrl || !serviceRoleKey) {
          throw new Error("Supabase server configuration is missing");
        }
        const serviceClient = createClient(supabaseUrl, serviceRoleKey);
        const { data: result, error: reconciliationError } = await serviceClient.rpc("apply_fincra_webhook_event", {
          p_event_id: eventId,
          p_event_type: "checkout.status.poll",
          p_reference: reference,
          p_stage: "collection",
          p_provider_status: status,
          p_amount: amount !== null && Number.isFinite(amount) ? amount : null,
          p_currency: checkout.currency == null ? null : String(checkout.currency),
          p_payload: checkout,
        });
        if (reconciliationError) {
          throw new Error(`Failed to reconcile verified checkout status: ${reconciliationError.message}`);
        }
        reconciliation = result as Record<string, unknown> | null;
      }

      const verified = Boolean(status && (reconciliation?.applied || reconciliation?.duplicate) && !reconciliation?.reason);
      if (verified && status === "successful") {
        try {
          await invokeFincraFunction("fincra-conversion", { plan_id: transaction.plan_id });
        } catch (error) {
          advancementError = error instanceof Error ? error.message : "Conversion initiation failed";
          console.error("Fincra collection was confirmed but conversion initiation failed:", error);
        }
      }

      return jsonResponse({
        success: true,
        data: {
          transaction_id: transaction.id,
          plan_id: transaction.plan_id,
          checkout,
          status,
          verified,
          reason: reconciliation?.reason ?? null,
          advancement_error: advancementError,
          reconciliation,
        },
      });
    }

    if (req.method !== "POST") {
      return jsonResponse({ success: false, error: "Method not allowed" }, 405);
    }

    let payload: {
      plan_id?: string;
      redirectUrl?: string;
      callbackUrl?: string;
      paymentMethod?: string;
    };

    try {
      payload = await req.json();
    } catch {
      return jsonResponse({ success: false, error: "Invalid JSON request body" }, 400);
    }

    if (!payload.plan_id) {
      return jsonResponse({ success: false, error: "Missing required field: plan_id" }, 400);
    }

    const { data: plan, error: planError } = await supabase
      .from("plans")
      .select("id, user_id, customer_pays, status, payment_status, quote_locked_at, quote_expires_at")
      .eq("id", payload.plan_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (planError || !plan) {
      return jsonResponse({ success: false, error: "Plan not found" }, 404);
    }

    const amount = Number(plan.customer_pays ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      return jsonResponse({ success: false, error: "Quote amount must be greater than zero" }, 400);
    }

    if (
      !plan.quote_locked_at ||
      !["awaiting_payment", "payment_processing", "payment_failed"].includes(plan.status) ||
      !["pending", "processing", "failed"].includes(plan.payment_status)
    ) {
      return jsonResponse({
        success: false,
        error: "A locked, unpaid quote is required before checkout",
        error_code: "INVALID_PLAN_PAYMENT_STATE",
      }, 409);
    }

    if (plan.quote_expires_at && new Date(plan.quote_expires_at).getTime() <= Date.now()) {
      return jsonResponse({
        success: false,
        error: "The quote has expired. Request a new quote before checkout.",
        error_code: "QUOTE_EXPIRED",
      }, 409);
    }

    const { data: existingTransaction, error: existingTransactionError } = await supabase
      .from("transactions")
      .select("id, amount_gbp, payment_reference, status, fincra_checkout_reference, fincra_collection_reference")
      .eq("plan_id", plan.id)
      .eq("user_id", user.id)
      .in("status", ["pending", "processing", "successful"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingTransactionError) {
      throw new Error(`Failed to load payment transaction: ${existingTransactionError.message}`);
    }

    if (existingTransaction?.status === "successful") {
      return jsonResponse({ success: false, error: "This plan has already been paid" }, 409);
    }

    let transaction = existingTransaction;
    if (transaction && Math.abs(Number(transaction.amount_gbp) - amount) > 0.01) {
      return jsonResponse({
        success: false,
        error: "Existing payment transaction does not match the locked quote",
        error_code: "TRANSACTION_AMOUNT_MISMATCH",
      }, 409);
    }

    if (!transaction) {
      const { data: createdTransaction, error: createTransactionError } = await supabase
        .from("transactions")
        .insert({
          plan_id: plan.id,
          user_id: user.id,
          amount_gbp: amount,
          status: "pending",
        })
        .select("id, amount_gbp, payment_reference, status, fincra_checkout_reference, fincra_collection_reference")
        .single();

      if (createTransactionError || !createdTransaction) {
        throw new Error(`Failed to create payment transaction: ${createTransactionError?.message ?? "No transaction returned"}`);
      }
      transaction = createdTransaction;
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("email, full_name, phone")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) {
      throw new Error(`Failed to load customer profile: ${profileError.message}`);
    }
    const customerEmail = profile?.email ?? user.email;
    if (!customerEmail) {
      return jsonResponse({
        success: false,
        error: "A customer email address is required to start checkout",
        error_code: "CUSTOMER_EMAIL_REQUIRED",
      }, 400);
    }

    const reference = String(
      transaction.fincra_checkout_reference ??
        transaction.fincra_collection_reference ??
        `senda-${transaction.payment_reference ?? transaction.id}`,
    );
    const { error: transactionUpdateError } = await supabase
      .from("transactions")
      .update({
        fincra_checkout_reference: reference,
        fincra_collection_reference: reference,
        fincra_checkout_status: "pending",
        fincra_collection_status: "pending",
        status: "pending",
      })
      .eq("id", transaction.id);

    if (transactionUpdateError) {
      throw new Error(`Failed to persist Fincra checkout reference: ${transactionUpdateError.message}`);
    }

    const { error: planUpdateError } = await supabase
      .from("plans")
      .update({
        fincra_collection_reference: reference,
        fincra_collection_status: "pending",
        payment_status: "processing",
        status: "payment_processing",
      })
      .eq("id", plan.id)
      .eq("user_id", user.id);

    if (planUpdateError) {
      throw new Error(`Failed to persist checkout state: ${planUpdateError.message}`);
    }

    const checkout = await createFincraCheckout({
      amount,
      currency: "GBP",
      business: Deno.env.get("FINCRA_BUSINESS_ID") ?? undefined,
      merchantReference: reference,
      reference,
      description: `Senda remittance plan ${plan.id}`,
      redirectUrl: payload.redirectUrl,
      callbackUrl: payload.callbackUrl,
      paymentMethod: payload.paymentMethod ?? "card",
      customer: {
        name: profile?.full_name ?? "Senda customer",
        email: customerEmail,
        phone: profile?.phone ?? null,
      },
      metadata: {
        plan_id: plan.id,
        user_id: user.id,
      },
    }, reference);

    return jsonResponse({
      success: true,
      data: {
        plan_id: plan.id,
        transaction_id: transaction.id,
        reference,
        amount,
        currency: "GBP",
        fincra: checkout,
      },
    });
  } catch (error) {
    if (error instanceof FincraApiError) {
      return jsonResponse({
        success: false,
        error: error.message,
        error_code: "FINCRA_CHECKOUT_FAILED",
      }, 502);
    }

    const message = error instanceof Error ? error.message : "Unexpected checkout error";
    return jsonResponse({ success: false, error: message }, 500);
  }
});

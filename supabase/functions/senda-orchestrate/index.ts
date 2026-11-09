import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.58.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function jsonResponse(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ success: false, error: "Method not allowed" }, 405);
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

    const action = new URL(req.url).searchParams.get("action");
    if (!action) {
      return jsonResponse({
        success: false,
        error: "Missing action parameter",
        supported_actions: ["lock-quote", "cancel-order", "recalc-order-status"],
      }, 400);
    }

    if (!["lock-quote", "cancel-order", "recalc-order-status"].includes(action)) {
      return jsonResponse({
        success: false,
        error: "Legacy Flutterwave money movement is disabled. Use the Fincra lifecycle endpoints.",
        error_code: "LEGACY_ORCHESTRATION_DISABLED",
        migration_status: "in_progress",
      }, 410);
    }

    let payload: { plan_id?: string };
    try {
      payload = await req.json();
    } catch {
      return jsonResponse({ success: false, error: "Invalid JSON request body" }, 400);
    }

    if (!payload.plan_id) {
      return jsonResponse({ success: false, error: "Missing plan_id" }, 400);
    }

    const { data: plan, error: planError } = await supabase
      .from("plans")
      .select("id, user_id, status, payment_status, quote_expires_at, quote_locked_at")
      .eq("id", payload.plan_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (planError || !plan) {
      return jsonResponse({ success: false, error: "Plan not found" }, 404);
    }

    if (action === "lock-quote") {
      if (plan.status === "awaiting_payment" && plan.quote_locked_at && plan.payment_status === "pending") {
        return jsonResponse({
          success: true,
          plan_id: plan.id,
          status: plan.status,
          quote_locked_at: plan.quote_locked_at,
        });
      }

      if (plan.status !== "quoted" || plan.quote_locked_at) {
        return jsonResponse({
          success: false,
          error: "Quote can only be locked from the quoted state",
          error_code: "INVALID_PLAN_STATE",
        }, 409);
      }

      const now = new Date();
      if (plan.quote_expires_at && new Date(plan.quote_expires_at).getTime() <= now.getTime()) {
        return jsonResponse({
          success: false,
          error: "Quote has expired. Please request a new quote.",
          error_code: "QUOTE_EXPIRED",
        }, 410);
      }

      const { data: commitments, error: commitmentsError } = await supabase
        .from("commitments")
        .select("id, recipient_snapshot, payout_method")
        .eq("plan_id", plan.id)
        .eq("user_id", user.id);

      if (commitmentsError) {
        throw new Error(`Failed to validate plan commitments: ${commitmentsError.message}`);
      }

      if (!commitments?.length || commitments.some((commitment: { recipient_snapshot: unknown; payout_method: string | null }) => !commitment.recipient_snapshot || !commitment.payout_method)) {
        return jsonResponse({
          success: false,
          error: "Every commitment requires its quote-time recipient snapshot and payout method.",
          error_code: "INCOMPLETE_PAYOUT_SNAPSHOT",
        }, 409);
      }

      const { error: readyError } = await supabase
        .from("commitments")
        .update({ status: "ready" })
        .eq("plan_id", plan.id)
        .eq("user_id", user.id)
        .in("status", ["pending", "ready"]);

      if (readyError) {
        throw new Error(`Failed to prepare commitments: ${readyError.message}`);
      }

      const lockedAt = now.toISOString();
      const { data: lockedPlan, error: lockError } = await supabase
        .from("plans")
        .update({
          quote_locked_at: lockedAt,
          status: "awaiting_payment",
          payment_status: "pending",
        })
        .eq("id", plan.id)
        .eq("user_id", user.id)
        .eq("status", "quoted")
        .is("quote_locked_at", null)
        .select("id")
        .maybeSingle();

      if (lockError) {
        throw new Error(`Failed to lock quote: ${lockError.message}`);
      }
      if (!lockedPlan) {
        return jsonResponse({
          success: false,
          error: "Plan state changed while locking the quote. Refresh and retry.",
          error_code: "QUOTE_LOCK_RACE",
        }, 409);
      }

      return jsonResponse({
        success: true,
        plan_id: plan.id,
        status: "awaiting_payment",
        quote_locked_at: lockedAt,
      });
    }

    if (action === "cancel-order") {
      if (plan.payment_status === "successful") {
        return jsonResponse({
          success: false,
          error: "A funded order cannot be cancelled without a verified refund.",
          error_code: "REFUND_REQUIRED",
        }, 409);
      }

      const cancellableStates = ["draft", "quoted", "awaiting_payment", "payment_failed"];
      if (!cancellableStates.includes(plan.status)) {
        return jsonResponse({
          success: false,
          error: "This order cannot be cancelled in its current state.",
          error_code: "NOT_CANCELLABLE",
        }, 409);
      }

      const { data: cancelledPlan, error: cancelError } = await supabase
        .from("plans")
        .update({ status: "cancelled" })
        .eq("id", plan.id)
        .eq("user_id", user.id)
        .in("status", cancellableStates)
        .select("id")
        .maybeSingle();

      if (cancelError) {
        throw new Error(`Failed to cancel order: ${cancelError.message}`);
      }
      if (!cancelledPlan) {
        return jsonResponse({
          success: false,
          error: "Order state changed before it could be cancelled.",
          error_code: "CANCEL_STATE_CHANGED",
        }, 409);
      }

      return jsonResponse({ success: true, plan_id: plan.id, status: "cancelled" });
    }

    const { data: commitments, error: commitmentsError } = await supabase
      .from("commitments")
      .select("status")
      .eq("plan_id", plan.id)
      .eq("user_id", user.id);

    if (commitmentsError) {
      throw new Error(`Failed to load commitment statuses: ${commitmentsError.message}`);
    }

    const total = commitments?.length ?? 0;
    const completed = commitments?.filter((commitment: { status: string }) => commitment.status === "completed").length ?? 0;
    const failed = commitments?.filter((commitment: { status: string }) => ["failed", "resolution"].includes(commitment.status)).length ?? 0;
    const processing = commitments?.filter((commitment: { status: string }) => [
      "creating",
      "creating_unknown",
      "submitted",
      "confirming",
      "confirming_unknown",
      "processing",
      "reconciliation_required",
    ].includes(commitment.status)).length ?? 0;

    let nextStatus = plan.status;
    if (plan.payment_status === "successful" && total > 0) {
      if (completed === total) {
        nextStatus = "completed";
      } else if (failed === total) {
        nextStatus = "failed";
      } else if (processing > 0) {
        nextStatus = "payouts_processing";
      } else if (completed > 0 && failed > 0) {
        nextStatus = "partially_failed";
      }
    }

    if (nextStatus !== plan.status && !["cancelled", "completed"].includes(plan.status)) {
      const { error: updateError } = await supabase
        .from("plans")
        .update({ status: nextStatus })
        .eq("id", plan.id)
        .eq("user_id", user.id)
        .eq("payment_status", "successful");
      if (updateError) {
        throw new Error(`Failed to recalculate plan status: ${updateError.message}`);
      }
    }

    return jsonResponse({
      success: true,
      plan_id: plan.id,
      status: nextStatus,
      total,
      completed,
      failed,
      processing,
    });
  } catch (error) {
    console.error("Senda orchestration failed:", error);
    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : "Unexpected orchestration error",
    }, 500);
  }
});

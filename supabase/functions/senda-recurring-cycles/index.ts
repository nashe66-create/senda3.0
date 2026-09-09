import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.58.0";

function jsonResponse(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function nextRunDate(value: string, recurring: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  const day = date.getUTCDate();

  if (recurring === "weekly") date.setUTCDate(day + 7);
  else if (recurring === "biweekly") date.setUTCDate(day + 14);
  else date.setUTCMonth(date.getUTCMonth() + 1);

  return date.toISOString().slice(0, 10);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const cronSecret = Deno.env.get("SENDA_RECURRING_CRON_SECRET");
  if (!cronSecret || req.headers.get("x-senda-cron-secret") !== cronSecret) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "Supabase server configuration is missing" }, 500);
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey);
  const today = new Date().toISOString().slice(0, 10);
  const { data: duePlans, error: plansError } = await serviceClient
    .from("plans")
    .select("id, user_id, name, recurring, next_run_date, pricing_mode, destination_country, destination_currency")
    .eq("status", "completed")
    .neq("recurring", "one_off")
    .not("next_run_date", "is", null)
    .lte("next_run_date", today)
    .limit(100);

  if (plansError) return jsonResponse({ error: plansError.message }, 500);

  const created: string[] = [];
  const skipped: string[] = [];

  for (const plan of duePlans ?? []) {
    const runDate = String(plan.next_run_date);
    const followingDate = nextRunDate(runDate, plan.recurring);
    const { data: claimedPlan, error: claimError } = await serviceClient
      .from("plans")
      .update({ next_run_date: followingDate })
      .eq("id", plan.id)
      .eq("status", "completed")
      .eq("next_run_date", runDate)
      .select("id")
      .maybeSingle();

    if (claimError || !claimedPlan) {
      skipped.push(plan.id);
      continue;
    }

    const { data: sourceCommitments, error: commitmentsError } = await serviceClient
      .from("commitments")
      .select("recipient_id, user_id, amount_gbp, amount_destination, destination_currency, receiving_method")
      .eq("plan_id", plan.id);

    if (commitmentsError || !sourceCommitments?.length) {
      await serviceClient
        .from("plans")
        .update({ next_run_date: runDate })
        .eq("id", plan.id)
        .eq("next_run_date", followingDate);
      skipped.push(plan.id);
      continue;
    }

    const { data: newPlan, error: newPlanError } = await serviceClient
      .from("plans")
      .insert({
        user_id: plan.user_id,
        name: `${plan.name} - ${runDate}`,
        status: "draft",
        recurring: "one_off",
        next_run_date: null,
        pricing_mode: plan.pricing_mode,
        destination_country: plan.destination_country,
        destination_currency: plan.destination_currency,
        total_recipients: sourceCommitments.length,
        destination_currencies: plan.destination_currency ? [plan.destination_currency] : [],
      })
      .select("id")
      .single();

    if (newPlanError || !newPlan) {
      await serviceClient
        .from("plans")
        .update({ next_run_date: runDate })
        .eq("id", plan.id)
        .eq("next_run_date", followingDate);
      skipped.push(plan.id);
      continue;
    }

    const { error: cloneError } = await serviceClient.from("commitments").insert(
      sourceCommitments.map((commitment) => ({
        plan_id: newPlan.id,
        user_id: commitment.user_id,
        recipient_id: commitment.recipient_id,
        amount_gbp: commitment.amount_gbp,
        amount_destination: commitment.amount_destination,
        destination_currency: commitment.destination_currency,
        receiving_method: commitment.receiving_method,
        fx_rate: 0,
        status: "pending",
      })),
    );

    if (cloneError) {
      await serviceClient.from("plans").delete().eq("id", newPlan.id).eq("status", "draft");
      await serviceClient
        .from("plans")
        .update({ next_run_date: runDate })
        .eq("id", plan.id)
        .eq("next_run_date", followingDate);
      skipped.push(plan.id);
      continue;
    }

    created.push(newPlan.id);
  }

  return jsonResponse({ success: true, today, created, skipped });
});

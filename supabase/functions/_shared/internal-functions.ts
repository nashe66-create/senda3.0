import { createClient } from "npm:@supabase/supabase-js@2.58.0";

export async function invokeFincraFunction(
  functionName: "fincra-conversion" | "fincra-payout",
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Supabase server configuration is missing");
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
      "x-senda-internal-key": serviceRoleKey,
    },
    body: JSON.stringify(payload),
  });
  const result = await response.json();
  if (!response.ok || !result?.success) {
    throw new Error(result?.error ?? `${functionName} request failed (${response.status})`);
  }
  return result as Record<string, unknown>;
}

export async function invokeReadyFincraPayouts(planId: string): Promise<void> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Supabase server configuration is missing");
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { data: commitments, error } = await supabase
    .from("commitments")
    .select("id")
    .eq("plan_id", planId)
    .eq("status", "ready");
  if (error) {
    throw new Error(`Could not load ready commitments for Fincra payout: ${error.message}`);
  }

  for (const commitment of commitments ?? []) {
    await invokeFincraFunction("fincra-payout", { commitment_id: commitment.id });
  }
}

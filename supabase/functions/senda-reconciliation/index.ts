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
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ success: false, error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const authHeader = req.headers.get("Authorization");
    if (!supabaseUrl || !serviceRoleKey || !authHeader) return jsonResponse({ success: false, error: "Unauthorized" }, 401);

    const authClient = createClient(supabaseUrl, serviceRoleKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: userError } = await authClient.auth.getUser();
    if (userError || !user) return jsonResponse({ success: false, error: "Unauthorized" }, 401);

    const payload = await req.json().catch(() => null) as { action?: string; plan_id?: string; commitment_id?: string; resolution_reason?: string } | null;
    if (payload?.action === "resolve") {
      if (!payload.commitment_id || !payload.resolution_reason?.trim()) {
        return jsonResponse({ success: false, error: "Missing commitment_id or resolution_reason" }, 400);
      }
      const { data, error } = await authClient.rpc("resolve_failed_commitment", {
        p_commitment_id: payload.commitment_id,
        p_resolution_reason: payload.resolution_reason.trim(),
      });
      if (error) throw error;
      if (!data?.length) return jsonResponse({ success: false, error: "Only failed payouts can be moved to resolution" }, 409);
      return jsonResponse({ success: true, resolution: data[0] });
    }
    if (!payload?.plan_id) return jsonResponse({ success: false, error: "Missing plan_id" }, 400);

    const serviceClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: plan } = await serviceClient.from("plans").select("id").eq("id", payload.plan_id).eq("user_id", user.id).maybeSingle();
    if (!plan) return jsonResponse({ success: false, error: "Remittance order not found" }, 404);

    const { data, error } = await serviceClient.rpc("evaluate_financial_reconciliation", { p_plan_id: payload.plan_id });
    if (error) throw error;
    const result = data?.[0] ?? null;
    return jsonResponse({ success: true, plan_id: payload.plan_id, reconciliation: result });
  } catch (error) {
    console.error("Senda reconciliation error:", error);
    return jsonResponse({ success: false, error: "Unable to evaluate reconciliation" }, 500);
  }
});
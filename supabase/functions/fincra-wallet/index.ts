import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { FincraApiError, getFincraWallet, listFincraWallets } from "../_shared/fincra.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, X-Senda-Internal-Secret",
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

  if (req.method !== "GET") {
    return jsonResponse({ success: false, error: "Method not allowed" }, 405);
  }

  try {
    const internalSecret = Deno.env.get("FINCRA_WALLET_INTERNAL_SECRET");
    if (!internalSecret) {
      return jsonResponse({ success: false, error: "Wallet endpoint is not configured for external access" }, 503);
    }

    if (req.headers.get("x-senda-internal-secret") !== internalSecret) {
      return jsonResponse({ success: false, error: "Unauthorized" }, 401);
    }

    const url = new URL(req.url);
    const action = url.searchParams.get("action") ?? "balance";
    const walletId = url.searchParams.get("wallet_id") ?? Deno.env.get("FINCRA_WALLET_ID");

    if (action === "list") {
      const wallets = await listFincraWallets();
      return jsonResponse({ success: true, data: wallets });
    }

    if (!walletId) {
      return jsonResponse({ success: false, error: "wallet_id or FINCRA_WALLET_ID is required" }, 400);
    }

    const wallet = await getFincraWallet(walletId);
    return jsonResponse({ success: true, data: wallet });
  } catch (error) {
    if (error instanceof FincraApiError) {
      return jsonResponse({ success: false, error: error.message, error_code: "FINCRA_WALLET_FAILED" }, 502);
    }

    const message = error instanceof Error ? error.message : "Wallet lookup failed";
    return jsonResponse({ success: false, error: message }, 500);
  }
});

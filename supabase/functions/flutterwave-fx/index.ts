import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

const TOKEN_URL =
  "https://idp.flutterwave.com/realms/flutterwave/protocol/openid-connect/token";

const FX_URL =
  "https://developersandbox-api.flutterwave.com/transfers/rates";

function jsonResponse(
  data: Record<string, unknown>,
  status = 200,
) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

Deno.serve(async (req: Request) => {
  // ---------------------------------------------------------
  // CORS
  // ---------------------------------------------------------
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  try {
    // ---------------------------------------------------------
    // Read request body
    // ---------------------------------------------------------
    let body: Record<string, unknown> = {};

    if (req.method !== "GET") {
      try {
        body = await req.json();
      } catch {
        return jsonResponse(
          {
            success: false,
            error: "Invalid JSON request body",
          },
          400,
        );
      }
    }

    // ---------------------------------------------------------
    // Currency
    // ---------------------------------------------------------
    const sourceCurrency = String(
      body.source_currency ??
        body.sourceCurrency ??
        "GBP",
    ).toUpperCase();

    const destinationCurrency = String(
      body.destination_currency ??
        body.destinationCurrency ??
        "NGN",
    ).toUpperCase();

    // ---------------------------------------------------------
    // Amount
    //
    // If no amount is supplied, use 1.
    // ---------------------------------------------------------
    const amount = Number(body.amount ?? 1);

    if (!Number.isFinite(amount) || amount <= 0) {
      return jsonResponse(
        {
          success: false,
          error: "Amount must be greater than zero",
        },
        400,
      );
    }

    // ---------------------------------------------------------
    // OAuth credentials
    // ---------------------------------------------------------
    const clientId = Deno.env.get("FLW_CLIENT_ID");
    const clientSecret = Deno.env.get("FLW_CLIENT_SECRET");

    if (!clientId) {
      console.error("FLW_CLIENT_ID is missing");

      return jsonResponse(
        {
          success: false,
          error: "FLW_CLIENT_ID is not configured",
        },
        503,
      );
    }

    if (!clientSecret) {
      console.error("FLW_CLIENT_SECRET is missing");

      return jsonResponse(
        {
          success: false,
          error: "FLW_CLIENT_SECRET is not configured",
        },
        503,
      );
    }

    // ---------------------------------------------------------
    // STEP 1
    // Get Flutterwave OAuth access token
    // ---------------------------------------------------------
    const tokenResponse = await fetch(TOKEN_URL, {
      method: "POST",

      headers: {
        "Content-Type":
          "application/x-www-form-urlencoded",
        Accept: "application/json",
      },

      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "client_credentials",
      }),
    });

    const tokenText = await tokenResponse.text();

    let tokenData: any = {};

    try {
      tokenData = tokenText
        ? JSON.parse(tokenText)
        : {};
    } catch {
      tokenData = {
        raw_response: tokenText,
      };
    }

    console.log(
      "Flutterwave OAuth:",
      JSON.stringify({
        http_status: tokenResponse.status,
        has_access_token:
          Boolean(tokenData?.access_token),
        expires_in:
          tokenData?.expires_in ?? null,
      }),
    );

    // ---------------------------------------------------------
    // OAuth failed
    // ---------------------------------------------------------
    if (
      !tokenResponse.ok ||
      !tokenData?.access_token
    ) {
      console.error(
        "Flutterwave OAuth failed:",
        JSON.stringify(tokenData),
      );

      return jsonResponse(
        {
          success: false,
          error:
            tokenData?.error_description ??
            tokenData?.message ??
            "Flutterwave authentication failed",

          flutterwave_status:
            tokenResponse.status,

          flutterwave_response: tokenData,
        },
        502,
      );
    }

    const accessToken =
      tokenData.access_token;

    // ---------------------------------------------------------
    // STEP 2
    // Ask Flutterwave for the FX rate
    // ---------------------------------------------------------
    const traceId = crypto.randomUUID();
    const idempotencyKey = crypto.randomUUID();

    const fxResponse = await fetch(FX_URL, {
      method: "POST",

      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",

        "X-Trace-Id": traceId,

        "X-Idempotency-Key":
          idempotencyKey,
      },

      body: JSON.stringify({
        source: {
          currency: sourceCurrency,
        },

        destination: {
          currency: destinationCurrency,
          amount: amount,
        },

        precision: 6,
      }),
    });

    const fxText = await fxResponse.text();

    let fxData: any = {};

    try {
      fxData = fxText
        ? JSON.parse(fxText)
        : {};
    } catch {
      fxData = {
        raw_response: fxText,
      };
    }

    console.log(
      "Flutterwave FX:",
      JSON.stringify({
        http_status: fxResponse.status,
        response: fxData,
      }),
    );

    // ---------------------------------------------------------
    // FX request failed
    // ---------------------------------------------------------
    if (!fxResponse.ok) {
      return jsonResponse(
        {
          success: false,

          error:
            fxData?.message ??
            fxData?.error?.message ??
            "Unable to fetch FX rate",

          flutterwave_status:
            fxResponse.status,

          flutterwave_response:
            fxData,
        },
        fxResponse.status || 502,
      );
    }

    // ---------------------------------------------------------
    // Extract returned data
    // ---------------------------------------------------------
    const data =
      fxData?.data ??
      fxData;

    const rate =
      data?.rate ??
      data?.exchange_rate ??
      data?.conversion_rate ??
      data?.rate_card?.rate ??
      null;

    const rateId =
      data?.id ??
      data?.rate_id ??
      null;

    const sourceAmount =
      data?.source?.amount ??
      data?.source_amount ??
      amount;

    const destinationAmount =
      data?.destination?.amount ??
      data?.destination_amount ??
      null;

    const returnedSourceCurrency =
      data?.source?.currency ??
      sourceCurrency;

    const returnedDestinationCurrency =
      data?.destination?.currency ??
      destinationCurrency;

    // ---------------------------------------------------------
    // Make absolutely sure we received a rate
    // ---------------------------------------------------------
    if (
      rate === null ||
      rate === undefined
    ) {
      console.error(
        "No FX rate found in Flutterwave response:",
        JSON.stringify(fxData),
      );

      return jsonResponse(
        {
          success: false,

          error:
            "Flutterwave responded successfully but no FX rate was returned",

          source_currency:
            sourceCurrency,

          destination_currency:
            destinationCurrency,

          flutterwave_status:
            fxResponse.status,

          flutterwave_response:
            fxData,
        },
        502,
      );
    }

    // ---------------------------------------------------------
    // SUCCESS
    // ---------------------------------------------------------
    return jsonResponse({
      success: true,

      source_currency:
        returnedSourceCurrency,

      destination_currency:
        returnedDestinationCurrency,

      amount: sourceAmount,

      rate: rate,

      destination_amount:
        destinationAmount,

      rate_id: rateId,

      provider: "flutterwave",

      trace_id: traceId,
    });
  } catch (error) {
    console.error(
      "FX function unexpected error:",
      error,
    );

    return jsonResponse(
      {
        success: false,

        error:
          error instanceof Error
            ? error.message
            : "Unexpected error",
      },
      500,
    );
  }
});

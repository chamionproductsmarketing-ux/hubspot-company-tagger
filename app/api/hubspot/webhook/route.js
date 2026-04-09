// app/api/hubspot/webhook/route.js
import { tagCompanyFromDeal, verifyWebhookSignature } from "@/lib/hubspot";

export const runtime = "nodejs";

export async function POST(req) {
  const rawBody = await req.text();

  // --- Signature verification (HubSpot v3) ---
  const signature = req.headers.get("x-hubspot-signature-v3") || "";
  const timestamp = req.headers.get("x-hubspot-request-timestamp") || "";
  const requestUri = `https://${req.headers.get("host")}${new URL(req.url).pathname}`;

  const valid = await verifyWebhookSignature(
    rawBody,
    signature,
    requestUri,
    "POST",
    timestamp
  );

  if (!valid) {
    console.error("Webhook signature verification failed");
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }

  // --- Parse events ---
  let events;
  try {
    events = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!Array.isArray(events)) events = [events];

  // --- Process each deal stage change ---
  const triggerStage = process.env.DEAL_STAGE_TRIGGER; // optional filter
  const results = [];

  for (const event of events) {
    if (
      event.subscriptionType !== "deal.propertyChange" ||
      event.propertyName !== "dealstage"
    ) {
      continue;
    }

    // If a specific trigger stage is configured, only act on that stage
    if (triggerStage && event.propertyValue !== triggerStage) {
      continue;
    }

    const dealId = String(event.objectId);

    try {
      const result = await tagCompanyFromDeal(dealId);
      results.push({ dealId, success: true, ...result });
    } catch (err) {
      console.error(`Webhook error for deal ${dealId}: ${err.message}`);
      results.push({ dealId, success: false, error: err.message });
    }
  }

  return Response.json({
    received: events.length,
    processed: results.length,
    results,
  });
}

import { tagCompanyFromDeal } from "@/lib/hubspot";

export const runtime = "nodejs";

export async function POST(req) {
  const rawBody = await req.text();

  let events;
  try {
    events = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!Array.isArray(events)) events = [events];

  const triggerStage = process.env.DEAL_STAGE_TRIGGER;
  const results = [];

  for (const event of events) {
    if (
      event.subscriptionType !== "deal.propertyChange" ||
      event.propertyName !== "dealstage"
    ) continue;

    if (triggerStage && event.propertyValue !== triggerStage) continue;

    const dealId = String(event.objectId);
    try {
      const result = await tagCompanyFromDeal(dealId);
      results.push({ dealId, success: true, ...result });
    } catch (err) {
      console.error(`Webhook error for deal ${dealId}: ${err.message}`);
      results.push({ dealId, success: false, error: err.message });
    }
  }

  return Response.json({ received: events.length, processed: results.length, results });
}

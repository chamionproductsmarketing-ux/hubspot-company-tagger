import { getAccessToken } from "@/lib/token";
import { INVOICE_PIPELINE } from "@/lib/hubspot";

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const token = await getAccessToken();
  const after = searchParams.get("after") || null;

  // Get invoice deals sorted by most recent
  const searchBody = {
    filterGroups: [{ filters: [{ propertyName: "pipeline", operator: "EQ", value: INVOICE_PIPELINE }] }],
    sorts: [{ propertyName: "createdate", direction: "DESCENDING" }],
    limit: 10,
    properties: ["pipeline", "dealname", "createdate"],
  };
  if (after) searchBody.after = after;

  const searchRes = await fetch("https://api.hubapi.com/crm/v3/objects/deals/search", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(searchBody),
  });
  const deals = await searchRes.json();

  const results = [];
  for (const deal of (deals.results || []).slice(0, 5)) {
    const assocRes = await fetch(
      `https://api.hubapi.com/crm/v3/objects/deals/${deal.id}/associations/line_items`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const assoc = await assocRes.json();
    const lineItemIds = (assoc.results || []).map(r => r.id);

    let lineItems = [];
    if (lineItemIds.length > 0) {
      const batchRes = await fetch("https://api.hubapi.com/crm/v3/objects/line_items/batch/read", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          properties: ["name", "supplier_id", "product_group_id"],
          inputs: lineItemIds.slice(0, 3).map(id => ({ id })),
        }),
      });
      const batch = await batchRes.json();
      lineItems = (batch.results || []).map(item => ({
        id: item.id,
        name: item.properties?.name,
        supplier_id: item.properties?.supplier_id,
        product_group_id: item.properties?.product_group_id,
      }));
    }

    results.push({
      dealId: deal.id,
      dealName: deal.properties?.dealname,
      created: deal.properties?.createdate,
      lineItemCount: lineItemIds.length,
      lineItems,
    });
  }

  return Response.json({
    total: deals.total,
    showing: results.length,
    results,
  });
}

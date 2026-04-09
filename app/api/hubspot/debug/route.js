import { getAccessToken } from "@/lib/token";
import { INVOICE_PIPELINE } from "@/lib/hubspot";

export async function GET(req) {
  const token = await getAccessToken();

  const searchRes = await fetch("https://api.hubapi.com/crm/v3/objects/deals/search", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      filterGroups: [{ filters: [{ propertyName: "pipeline", operator: "EQ", value: INVOICE_PIPELINE }] }],
      limit: 3,
      properties: ["pipeline", "dealname"],
    }),
  });
  const deals = await searchRes.json();

  const results = [];
  for (const deal of deals.results || []) {
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
          properties: ["name", "supplier_id", "product_group_id", "quantity", "price"],
          inputs: lineItemIds.slice(0, 5).map(id => ({ id })),
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
      lineItemCount: lineItemIds.length,
      lineItems,
    });
  }

  return Response.json(results);
}

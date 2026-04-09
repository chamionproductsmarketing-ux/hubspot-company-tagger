// app/api/hubspot/status/route.js
// Quick health check — verifies HubSpot token is valid and properties exist

const HUBSPOT_BASE = "https://api.hubapi.com";

export async function GET() {
  const checks = {};

  // 1. Token check
  try {
    const res = await fetch(
      `${HUBSPOT_BASE}/crm/v3/properties/companies/categories_purchased`,
      {
        headers: {
          Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`,
        },
      }
    );
    if (res.ok) {
      const data = await res.json();
      checks.categories_purchased = {
        status: "ok",
        type: data.fieldType,
        options: data.options?.length || 0,
      };
    } else {
      checks.categories_purchased = { status: "error", code: res.status };
    }
  } catch (err) {
    checks.categories_purchased = { status: "error", message: err.message };
  }

  // 2. vendors_purchased
  try {
    const res = await fetch(
      `${HUBSPOT_BASE}/crm/v3/properties/companies/vendors_purchased`,
      {
        headers: {
          Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`,
        },
      }
    );
    if (res.ok) {
      const data = await res.json();
      checks.vendors_purchased = {
        status: "ok",
        type: data.fieldType,
        options: data.options?.length || 0,
      };
    } else {
      checks.vendors_purchased = { status: "error", code: res.status };
    }
  } catch (err) {
    checks.vendors_purchased = { status: "error", message: err.message };
  }

  const allOk = Object.values(checks).every((c) => c.status === "ok");

  return Response.json({
    healthy: allOk,
    checks,
    env: {
      HUBSPOT_ACCESS_TOKEN: process.env.HUBSPOT_ACCESS_TOKEN ? "set" : "MISSING",
      HUBSPOT_WEBHOOK_SECRET: process.env.HUBSPOT_WEBHOOK_SECRET ? "set" : "not set (signatures disabled)",
      DEAL_STAGE_TRIGGER: process.env.DEAL_STAGE_TRIGGER || "any stage change",
    },
  });
}

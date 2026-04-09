// app/api/hubspot/backfill/route.js
import { backfillAllDeals } from "@/lib/hubspot";

export const maxDuration = 300; // Vercel Pro = 5 min; Hobby = 60s

export async function GET(req) {
  // Simple auth guard — pass ?key=YOUR_SECRET or set BACKFILL_KEY env var
  const { searchParams } = new URL(req.url);
  const key = searchParams.get("key");
  const expected = process.env.BACKFILL_KEY;

  if (expected && key !== expected) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  console.log("Starting backfill...");
  const result = await backfillAllDeals();

  return Response.json({
    message: "Backfill complete",
    ...result,
  });
}

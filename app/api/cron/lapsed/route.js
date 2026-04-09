import { runLapsedCheck } from "@/lib/lapsed";

export const maxDuration = 300;

export async function GET(req) {
  const authHeader = req.headers.get("authorization");
  const { searchParams } = new URL(req.url);
  const key = searchParams.get("key");
  const expected = process.env.BACKFILL_KEY;
  const cronSecret = process.env.CRON_SECRET;

  const isVercelCron = authHeader === `Bearer ${cronSecret}`;
  const isManual = expected && key === expected;

  if (!isVercelCron && !isManual) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  console.log("Starting lapsed category/vendor check...");
  const result = await runLapsedCheck();

  return Response.json({ message: "Lapsed check complete", ...result });
}

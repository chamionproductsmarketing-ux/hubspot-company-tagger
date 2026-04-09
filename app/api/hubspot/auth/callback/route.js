export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  if (!code) return Response.json({ error: "No code parameter" }, { status: 400 });

  const tokenRes = await fetch("https://api.hubapi.com/oauth/v1/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: process.env.HUBSPOT_CLIENT_ID,
      client_secret: process.env.HUBSPOT_CLIENT_SECRET,
      redirect_uri: process.env.HUBSPOT_REDIRECT_URI,
      code,
    }),
  });
  const tokens = await tokenRes.json();
  if (!tokenRes.ok) return Response.json({ error: "Token exchange failed", detail: tokens }, { status: 400 });

  return new Response(`<html><body style="font-family:system-ui;padding:2rem;max-width:720px">
    <h1>OAuth Complete!</h1>
    <h2>Access Token</h2>
    <textarea style="width:100%;height:100px">${tokens.access_token}</textarea>
    <h2>Refresh Token</h2>
    <textarea style="width:100%;height:100px">${tokens.refresh_token}</textarea>
    <pre>${JSON.stringify(tokens,null,2)}</pre>
    <p>Copy both into Vercel env vars and redeploy.</p>
  </body></html>`, { headers: { "Content-Type": "text/html" } });
}

export default function Home() {
  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui, sans-serif", maxWidth: 720 }}>
      <h1>HubSpot Company Tagger</h1>
      <p>
        Webhook middleware for Champion Products — automatically tags Company records
        with <strong>Categories Purchased</strong> and <strong>Vendors Purchased</strong> based
        on deal line items synced from P21.
      </p>
      <h2>Endpoints</h2>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "2px solid #ccc" }}>
            <th style={{ padding: "8px" }}>Route</th>
            <th style={{ padding: "8px" }}>Method</th>
            <th style={{ padding: "8px" }}>Purpose</th>
          </tr>
        </thead>
        <tbody>
          <tr style={{ borderBottom: "1px solid #eee" }}>
            <td style={{ padding: "8px" }}><code>/api/hubspot/status</code></td>
            <td style={{ padding: "8px" }}>GET</td>
            <td style={{ padding: "8px" }}>Health check — verifies token &amp; properties</td>
          </tr>
          <tr style={{ borderBottom: "1px solid #eee" }}>
            <td style={{ padding: "8px" }}><code>/api/hubspot/webhook</code></td>
            <td style={{ padding: "8px" }}>POST</td>
            <td style={{ padding: "8px" }}>Receives HubSpot deal.propertyChange webhooks</td>
          </tr>
          <tr>
            <td style={{ padding: "8px" }}><code>/api/hubspot/backfill</code></td>
            <td style={{ padding: "8px" }}>GET</td>
            <td style={{ padding: "8px" }}>One-time scan of all deals to backfill tags</td>
          </tr>
        </tbody>
      </table>
    </main>
  );
}

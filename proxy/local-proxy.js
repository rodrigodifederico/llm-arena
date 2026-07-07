// Optional tiny local CORS proxy (§2.2). Run with: npm run proxy
// Forwards POST/GET to ?target=<url>, passing through headers from the browser.
// Keys never leave your machine.
import http from "node:http";

const PORT = 8787;

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", req.headers["access-control-request-headers"] || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.writeHead(204).end();

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const target = url.searchParams.get("target");
  if (url.pathname !== "/proxy" || !target || !/^https?:\/\//.test(target)) {
    return res.writeHead(400).end("Usage: /proxy?target=<absolute url>");
  }

  const chunks = [];
  for await (const c of req) chunks.push(c);

  // Forward all request headers except browser-specific or hop-by-hop ones
  const headers = {
    "Content-Type": "application/json",
  };
  for (const [key, value] of Object.entries(req.headers)) {
    const lowerKey = key.toLowerCase();
    if ([
      "host",
      "connection",
      "origin",
      "referer",
      "sec-fetch-dest",
      "sec-fetch-mode",
      "sec-fetch-site",
      "sec-ch-ua",
      "sec-ch-ua-mobile",
      "sec-ch-ua-platform",
      "user-agent",
      "accept-encoding",
      "content-length"
    ].includes(lowerKey)) {
      continue;
    }
    headers[key] = value;
  }

  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body: chunks.length ? Buffer.concat(chunks) : undefined,
    });
    res.writeHead(upstream.status, { "Content-Type": upstream.headers.get("content-type") ?? "application/json" });
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (e) {
    res.writeHead(502).end(JSON.stringify({ error: `proxy failed: ${String(e)}` }));
  }
});

server.listen(PORT, () => console.log(`LLM Arena proxy on http://localhost:${PORT}/proxy?target=<url>`));


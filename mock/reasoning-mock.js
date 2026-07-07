// Mock of a REASONING model (DeepSeek-pro style): leaves message.content EMPTY
// and puts the answer in message.reasoning_content — the exact failure the
// replay showed. Reuses the move logic from mock-llm.js.
import http from "node:http";

const PORT = Number(process.argv[2] ?? 9998);

function decide(system, user) {
  if (system.includes("STANDOFF")) {
    const ammo = Number(/YOU:\s+\d+ lives, (\d+) ammo/.exec(user)?.[1] ?? 0);
    return { move: ammo >= 1 ? "shoot" : "reload" };
  }
  if (system.includes("ARENA CLASH")) {
    const m = /Your unit ([AB]\d) \(/.exec(user);
    const unit = m ? m[1] : "A1";
    const targets = /VALID enemy targets[^:]*: ([^\n(]+)/.exec(user)?.[1].trim().split(/,\s*/) ?? [];
    if (targets.length) return { unit, type: "attack", target: targets[0] };
    return { unit, type: "pass" };
  }
  if (system.includes("HEX DOMINION")) return { commands: [] };
  if (system.includes("PHASE 1")) {
    return { placements: [
      { ship: "carrier", cells: [[0,0],[0,1],[0,2],[0,3],[0,4]] },
      { ship: "battleship", cells: [[2,0],[2,1],[2,2],[2,3]] },
      { ship: "cruiser", cells: [[4,0],[4,1],[4,2]] },
      { ship: "submarine", cells: [[6,0],[6,1],[6,2]] },
      { ship: "destroyer", cells: [[7,6],[7,7]] },
    ]};
  }
  if (system.includes("PHASE 2")) {
    const n = Number(/your shot #(\d+)/.exec(user)?.[1] ?? 1) - 1;
    return { fire: [Math.floor(n / 8) % 8, n % 8] };
  }
  return { move: "reload" };
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.writeHead(204).end();
  if (req.url.startsWith("/v1/models")) {
    return res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ data: [{ id: "reasoner-pro" }] }));
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  let body = {};
  try { body = JSON.parse(Buffer.concat(chunks).toString() || "{}"); } catch {}
  const system = body.messages?.find((m) => m.role === "system")?.content ?? "";
  const user = body.messages?.find((m) => m.role === "user")?.content ?? "";
  const envelope = JSON.stringify({ reasoning: "reasoning-model output", action: decide(system, user), notes: "" });
  await new Promise((r) => setTimeout(r, 40));
  // THE BUG SCENARIO: content empty, JSON only in reasoning_content
  res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({
    choices: [{ message: { role: "assistant", content: "", reasoning_content: envelope }, finish_reason: "stop" }],
    usage: { prompt_tokens: Math.ceil((system.length + user.length) / 4), completion_tokens: Math.ceil(envelope.length / 4) + 400 },
  }));
});
server.listen(PORT, () => console.log(`reasoning-mock on http://localhost:${PORT}/v1`));

// Mock OpenAI-compatible LLM server for e2e testing LLM Arena.
// Plays a legal (dumb) move for every game by inspecting the prompts.
import http from "node:http";

const PORT = Number(process.argv[2] ?? 9999);

function decide(system, user) {
  if (system.includes("STANDOFF")) {
    // shoot when possible, else reload — guarantees the match actually ends
    const ammo = Number(/YOU:\s+\d+ lives, (\d+) ammo/.exec(user)?.[1] ?? 0);
    return { move: ammo >= 1 ? "shoot" : "reload" };
  }
  if (system.includes("ARENA CLASH")) {
    const m = /Your unit ([AB]\d) \(/.exec(user);
    const unit = m ? m[1] : "A1";
    const legal = /LEGAL ACTION TYPES[^:]*: ([^\n]+)/.exec(user)?.[1].trim().split(/,\s*/) ?? [];
    const targets = /VALID enemy targets[^:]*: ([^\n(]+)/.exec(user)?.[1].trim().split(/,\s*/) ?? [];
    // heal a wounded ally when possible (exercises heal animations)
    if (legal.includes("heal")) {
      const team = /YOUR TEAM:\s*(\[[\s\S]*?\])\s*\n\s*ENEMY TEAM:/.exec(user)?.[1];
      try {
        const allies = JSON.parse(team ?? "[]");
        const wounded = allies.filter((a) => {
          const [cur, max] = String(a.hp).split("/").map(Number);
          return a.alive && cur < max;
        });
        if (wounded.length) return { unit, type: "heal", target: wounded[0].id };
      } catch {}
    }
    // otherwise use the signature ability when affordable, else basic attack
    if (legal.includes("special") && targets.length) return { unit, type: "special", target: targets[0] };
    if (targets.length) return { unit, type: "attack", target: targets[0] };
    return { unit, type: "pass" };
  }
  if (system.includes("HEX DOMINION")) {
    return { commands: [] };
  }
  if (system.includes("PHASE 1")) {
    return {
      placements: [
        { ship: "carrier", cells: [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]] },
        { ship: "battleship", cells: [[2, 0], [2, 1], [2, 2], [2, 3]] },
        { ship: "cruiser", cells: [[4, 0], [4, 1], [4, 2]] },
        { ship: "submarine", cells: [[6, 0], [6, 1], [6, 2]] },
        { ship: "destroyer", cells: [[7, 6], [7, 7]] },
      ],
    };
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
    return res.writeHead(200, { "Content-Type": "application/json" }).end(
      JSON.stringify({ data: [{ id: "mock-fighter-1" }, { id: "mock-fighter-2" }] }),
    );
  }

  const chunks = [];
  for await (const c of req) chunks.push(c);
  let body = {};
  try { body = JSON.parse(Buffer.concat(chunks).toString() || "{}"); } catch {}
  const system = body.messages?.find((m) => m.role === "system")?.content ?? "";
  const user = body.messages?.find((m) => m.role === "user")?.content ?? "";

  const action = decide(system, user);
  const content = JSON.stringify({
    reasoning: "Mock player: choosing a simple legal move.",
    action,
    notes: "mock notes",
  });

  await new Promise((r) => setTimeout(r, 30)); // a little fake latency

  res.writeHead(200, { "Content-Type": "application/json" }).end(
    JSON.stringify({
      choices: [{ message: { role: "assistant", content } }],
      usage: {
        prompt_tokens: Math.ceil((system.length + user.length) / 4),
        completion_tokens: Math.ceil(content.length / 4),
      },
    }),
  );
});

server.listen(PORT, () => console.log(`mock LLM on http://localhost:${PORT}/v1`));

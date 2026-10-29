import { DurableObject } from "cloudflare:workers";

const MAX_CENTS = (9 * 5 * 4000 + 27 * 5) * 10000;
const SCORE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const json = (body, status = 200) => Response.json(body, {status});

class RequestError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

async function readScore(request) {
  if (request.headers.get("Content-Type")?.split(";")[0].trim() !== "application/json") {
    throw new RequestError("Send application/json.", 415);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new RequestError("Missing score.");
  const chunks = []; let length = 0;
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 512) { await reader.cancel(); throw new RequestError("Score is too large.", 413); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let score;
  try { score = JSON.parse(new TextDecoder("utf-8", {fatal:true}).decode(bytes)); }
  catch { throw new RequestError("Invalid score JSON."); }
  if (!score || typeof score.id !== "string" || !SCORE_ID.test(score.id) ||
      typeof score.initials !== "string" || !/^[A-Z0-9]{3}$/.test(score.initials) ||
      !Number.isSafeInteger(score.cents) || score.cents <= 0 || score.cents > MAX_CENTS || score.cents % 5 !== 0) {
    throw new RequestError("Use a spin ID, three uppercase letters or numbers, and a valid payout in cents.");
  }
  return {id:score.id.toLowerCase(), initials:score.initials, cents:score.cents};
}

export class SlotLeaderboard extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS scores (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      initials TEXT NOT NULL,
      cents INTEGER NOT NULL
    )`);
  }

  scores() {
    return this.sql.exec("SELECT id, initials, cents FROM scores ORDER BY cents DESC, sequence ASC LIMIT 3").toArray();
  }

  async fetch(request) {
    if (request.method === "GET") return json({scores:this.scores()});
    try {
      const score = await readScore(request);
      const result = this.ctx.storage.transactionSync(() => {
        const existing = this.sql.exec("SELECT initials, cents FROM scores WHERE id = ?", score.id).toArray()[0];
        if (existing && (existing.initials !== score.initials || existing.cents !== score.cents)) {
          throw new RequestError("That spin was already recorded with different details.", 409);
        }
        let scores = this.scores();
        if (!existing && (scores.length < 3 || score.cents > scores[2].cents)) {
          this.sql.exec("INSERT INTO scores (id, initials, cents) VALUES (?, ?, ?)", score.id, score.initials, score.cents);
          this.sql.exec("DELETE FROM scores WHERE id NOT IN (SELECT id FROM scores ORDER BY cents DESC, sequence ASC LIMIT 3)");
          scores = this.scores();
        }
        const rank = scores.findIndex(entry => entry.id === score.id) + 1;
        return {scores, rank, accepted:rank > 0};
      });
      return json(result);
    } catch (error) {
      if (error instanceof RequestError) return json({error:error.message}, error.status);
      throw error;
    }
  }
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    const origin = request.headers.get("Origin");
    const allowed = (env.ALLOWED_ORIGINS || "").split(",").map(value => value.trim());
    const cors = {"Cache-Control":"no-store", "Vary":"Origin"};
    if (origin && allowed.includes(origin)) cors["Access-Control-Allow-Origin"] = origin;
    const reply = response => new Response(response.body, {status:response.status, headers:{...Object.fromEntries(response.headers), ...cors}});
    if (origin && !allowed.includes(origin)) return reply(json({error:"Origin not allowed."}, 403));
    if (path === "/health" && request.method === "GET") return reply(json({ok:true}));
    if (path !== "/v1/scores") return reply(json({error:"Not found."}, 404));
    if (request.method === "OPTIONS") {
      if (!origin) return reply(json({error:"Origin required."}, 403));
      return reply(new Response(null, {status:204, headers:{
        "Access-Control-Allow-Methods":"GET, POST, OPTIONS",
        "Access-Control-Allow-Headers":"Content-Type"
      }}));
    }
    if (!["GET", "POST"].includes(request.method)) return reply(json({error:"Method not allowed."}, 405));
    if (request.method === "POST" && !origin) return reply(json({error:"Origin required."}, 403));
    try {
      return reply(await env.SLOT_LEADERBOARD.getByName("siberian-wolf.v1").fetch(request));
    } catch {
      return reply(json({error:"Leaderboard temporarily unavailable."}, 503));
    }
  }
};

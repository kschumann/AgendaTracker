/**
 * Meeting Tracker — API Worker
 *
 * Static files (index.html, etc.) are served automatically from the
 * `assets` binding configured in wrangler.jsonc -- this script only
 * needs to handle the save/load API routes. Any request that doesn't
 * match one of them, or match a static file, falls through to the
 * assets binding.
 *
 * Routes:
 *   POST /api/state          create a new saved record, returns { uuid }
 *   GET  /api/state/:uuid    fetch a saved record, 404 if not found
 *   PUT  /api/state/:uuid    update an existing record, 404 if it doesn't exist
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 50 * 1024; // 50 KB is generous headroom for 20 events + settings

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname === "/api/state" && request.method === "POST") {
      return handleCreate(request, env);
    }

    const stateMatch = pathname.match(/^\/api\/state\/([^/]+)$/);
    if (stateMatch) {
      const uuid = stateMatch[1];
      if (request.method === "GET") return handleGet(uuid, env);
      if (request.method === "PUT") return handleUpdate(uuid, request, env);
    }

    // Not an API route -- let the static assets binding handle it
    // (this also covers index.html itself and any 404s for real files).
    return env.ASSETS.fetch(request);
  }
};

async function readJsonBody(request) {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    throw new Error("payload too large");
  }
  return JSON.parse(text);
}

function isValidState(data) {
  return !!data
    && typeof data === "object"
    && typeof data.tz === "string"
    && typeof data.span === "number"
    && Array.isArray(data.events);
}

function jsonError(message, status) {
  return Response.json({ error: message }, { status: status });
}

async function handleCreate(request, env) {
  let data;
  try {
    data = await readJsonBody(request);
  } catch (e) {
    return jsonError("Invalid request body.", 400);
  }
  if (!isValidState(data)) {
    return jsonError("Malformed timeline state.", 400);
  }

  const uuid = crypto.randomUUID();
  await env.TIMELINE_KV.put(uuid, JSON.stringify(data));
  return Response.json({ uuid: uuid });
}

async function handleGet(uuid, env) {
  if (!UUID_RE.test(uuid)) {
    return jsonError("Not found.", 404);
  }
  const raw = await env.TIMELINE_KV.get(uuid);
  if (raw === null) {
    return jsonError("Not found.", 404);
  }
  return new Response(raw, { headers: { "content-type": "application/json" } });
}

async function handleUpdate(uuid, request, env) {
  if (!UUID_RE.test(uuid)) {
    return jsonError("Not found.", 404);
  }
  const existing = await env.TIMELINE_KV.get(uuid);
  if (existing === null) {
    return jsonError("Not found.", 404);
  }

  let data;
  try {
    data = await readJsonBody(request);
  } catch (e) {
    return jsonError("Invalid request body.", 400);
  }
  if (!isValidState(data)) {
    return jsonError("Malformed timeline state.", 400);
  }

  await env.TIMELINE_KV.put(uuid, JSON.stringify(data));
  return Response.json({ ok: true });
}

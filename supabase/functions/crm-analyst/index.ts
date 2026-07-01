import { Hono } from "hono";

const app = new Hono();

app.get("/crm-analyst/health", (c) => c.json({ ok: true }));

Deno.serve(app.fetch);

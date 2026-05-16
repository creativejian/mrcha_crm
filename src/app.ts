import { Hono } from "hono";

export const app = new Hono();

app.get("/api/health", (c) =>
  c.json({
    ok: true,
    service: "mrcha-crm",
  }),
);

app.notFound((c) =>
  c.json(
    {
      error: "Not found",
    },
    404,
  ),
);

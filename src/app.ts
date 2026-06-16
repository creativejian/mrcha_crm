import { Hono } from "hono";

import { catalog } from "./routes/catalog";
import { vehicles } from "./routes/vehicles";

export const app = new Hono();

app.get("/api/health", (c) =>
  c.json({
    ok: true,
    service: "mrcha-crm",
  }),
);

app.route("/api/vehicles", vehicles);
app.route("/api/catalog", catalog);

app.notFound((c) =>
  c.json(
    {
      error: "Not found",
    },
    404,
  ),
);

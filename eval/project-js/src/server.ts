import express from "express";
import { z } from "zod";
import { fetchPrice } from "./prices.js";
import { Store } from "./store.js";

const AddBody = z.object({ sku: z.string(), name: z.string(), quantity: z.number().int().positive() });

export function createApp(store = new Store()) {
  const app = express();
  app.use(express.json());

  app.get("/items", (_req, res) => {
    res.json(store.list());
  });

  app.post("/items", (req, res) => {
    const body = AddBody.parse(req.body);
    res.status(201).json(store.add(body.sku, body.name, body.quantity));
  });

  app.delete("/items/:sku", (req, res) => {
    const quantity = Number(req.query.quantity ?? 1);
    res.json(store.remove(req.params.sku, quantity));
  });

  app.get("/items/:sku/price", async (req, res) => {
    res.json({ price: await fetchPrice(req.params.sku) });
  });

  return app;
}

if (process.argv[1]?.endsWith("server.js")) {
  createApp().listen(Number(process.env.PORT ?? 3000));
}

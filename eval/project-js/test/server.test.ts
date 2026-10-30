import { describe, expect, it } from "vitest";
import { createApp } from "../src/server.js";

describe("createApp", () => {
  it("lists no items at first", async () => {
    const app = createApp();
    const server = app.listen(0);
    const { port } = server.address() as { port: number };
    const res = await fetch(`http://127.0.0.1:${port}/items`);
    expect(await res.json()).toEqual([]);
    server.close();
  });
});

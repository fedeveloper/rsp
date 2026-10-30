import { describe, it, expect } from "vitest";
import { twice } from "../src/math";

describe("twice", () => {
  it("doubles", () => expect(twice(2)).toBe(4));
});

import { describe, expect, test } from "bun:test";
import { getBucket } from "./viewport.js";

describe("getBucket — shortest-side phone detection", () => {
  test("portrait phone is phone", () => {
    expect(getBucket(375, 667)).toBe("phone");
  });

  test("LANDSCAPE phone is still phone (rotation must not flip bucket)", () => {
    expect(getBucket(667, 375)).toBe("phone");
    expect(getBucket(852, 393)).toBe("phone"); // iPhone 15 landscape
  });

  test("portrait tablet is tablet", () => {
    expect(getBucket(768, 1024)).toBe("tablet");
  });

  test("landscape tablet is tablet", () => {
    expect(getBucket(1024, 768)).toBe("tablet");
  });

  test("desktop is desktop", () => {
    expect(getBucket(1440, 900)).toBe("desktop");
    expect(getBucket(1280, 800)).toBe("desktop");
  });

  test("narrow desktop window is tablet", () => {
    expect(getBucket(1100, 900)).toBe("tablet");
  });

  test("boundaries: 600 shortest side leaves phone; 1280 width enters desktop", () => {
    expect(getBucket(599, 900)).toBe("phone");
    expect(getBucket(600, 900)).toBe("tablet");
    expect(getBucket(1279, 900)).toBe("tablet");
    expect(getBucket(1280, 900)).toBe("desktop");
  });
});

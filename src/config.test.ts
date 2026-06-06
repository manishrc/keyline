import { describe, expect, test } from "bun:test";
import { pickBucket } from "./config.js";
import type { ByBucket } from "./types.js";

describe("pickBucket — responsive config resolution", () => {
  test("flat config passes through unchanged for every bucket", () => {
    const flat = { count: 12, gutter: 16 };
    expect(pickBucket(flat, "phone")).toBe(flat);
    expect(pickBucket(flat, "tablet")).toBe(flat);
    expect(pickBucket(flat, "desktop")).toBe(flat);
  });

  test("undefined passes through", () => {
    expect(pickBucket(undefined, "desktop")).toBeUndefined();
  });

  test("false (family disabled) passes through", () => {
    expect(pickBucket(false as const, "phone")).toBe(false);
  });

  test("exact bucket match wins", () => {
    const cfg = {
      phone: { count: 4 },
      tablet: { count: 8 },
      desktop: { count: 12 },
    };
    expect(pickBucket(cfg, "phone")).toEqual({ count: 4 });
    expect(pickBucket(cfg, "tablet")).toEqual({ count: 8 });
    expect(pickBucket(cfg, "desktop")).toEqual({ count: 12 });
  });

  test("missing bucket falls back to nearest SMALLER bucket (mobile-first)", () => {
    const cfg = { phone: { count: 4 }, desktop: { count: 12 } };
    expect(pickBucket(cfg, "tablet")).toEqual({ count: 4 });
  });

  test("desktop falls back to tablet, then phone", () => {
    expect(pickBucket({ tablet: { count: 8 } }, "desktop")).toEqual({
      count: 8,
    });
    expect(pickBucket({ phone: { count: 4 } }, "desktop")).toEqual({
      count: 4,
    });
  });

  test("no smaller bucket → falls back to nearest LARGER", () => {
    const cfg = { desktop: { count: 12 } };
    expect(pickBucket(cfg, "phone")).toEqual({ count: 12 });
    expect(pickBucket(cfg, "tablet")).toEqual({ count: 12 });
  });

  test("per-bucket false disables just that bucket", () => {
    const cfg: ByBucket<{ count: number } | false> = {
      phone: false,
      desktop: { count: 12 },
    };
    expect(pickBucket(cfg, "phone")).toBe(false);
    expect(pickBucket(cfg, "desktop")).toEqual({ count: 12 });
  });

  test("family config keys are never mistaken for bucket records", () => {
    // { count, gutter } shares no keys with phone/tablet/desktop.
    const flat = { count: 6 };
    expect(pickBucket(flat, "tablet")).toBe(flat);
  });
});

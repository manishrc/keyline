/**
 * Viewport buckets — phone / tablet / desktop.
 *
 * Phone is detected by the SHORTEST viewport side (< 600px), not the width.
 * A phone in landscape is still a phone; rotating must not flip the bucket
 * (which would reload per-bucket config and guides mid-session). Tablets
 * fail the shortest-side check in both orientations.
 */

export type Bucket = "phone" | "tablet" | "desktop";

export function getBucket(
  w = typeof window !== "undefined" ? window.innerWidth : 1280,
  h = typeof window !== "undefined" ? window.innerHeight : 800,
): Bucket {
  if (Math.min(w, h) < 600) return "phone";
  if (w < 1280) return "tablet";
  return "desktop";
}

/** Watch for bucket changes on resize. Returns an unsubscribe. */
export function watchBucket(
  cb: (bucket: Bucket, prev: Bucket) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  let current = getBucket();
  const onResize = () => {
    const next = getBucket();
    if (next === current) return;
    const prev = current;
    current = next;
    cb(next, prev);
  };
  window.addEventListener("resize", onResize);
  return () => window.removeEventListener("resize", onResize);
}

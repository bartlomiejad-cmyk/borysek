/**
 * Normalize `regenerated_main_image` for view layer.
 * The DB stores the sentinel `"__imported__"` to mark that the main image
 * came from CSV import (real URL lives in `pinned_main_url`). The sentinel
 * must never be rendered as an `<img src>`.
 */
export function resolveRegenUrl(v: string | null | undefined): string | null {
  if (!v) return null;
  if (v === "__imported__") return null;
  return v;
}
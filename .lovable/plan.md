## Problem

Bulk visualization worker crashes with `column enrichments.review_status does not exist`. Toast: „Wizualizacje produktowe: nie powiodło się — … Ostatni błąd: column enrichments.review_status does not exist".

`review_status` is a column on `source_products` (schema confirmed via DB query — `enrichments` has no such column). Every other place in the code correctly reads/updates it on `source_products`. Only `commitVisualization` in `src/lib/pim/_workers.server.ts` (~lines 3292–3333) reads and updates it on `enrichments`, so each visualization commit fails and FAL never produces output for the product.

## Fix

Edit `src/lib/pim/_workers.server.ts` `commitVisualization`:

1. Remove `review_status` from the `enrichments` SELECT (keep `ai_gallery_urls, image_meta`).
2. When a visualization fails viz QC, load current `review_status` from `source_products` (`.eq('id', e.source_product_id)`) and, if not already `REJECTED`/`NEEDS_REVIEW`, update `source_products.review_status = 'NEEDS_REVIEW'` — do not write it into the enrichments update payload.
3. Keep the `ai_gallery_urls` + `image_meta.viz_qc` update on `enrichments` as before.

No schema migration, no UI changes — the field already lives on `source_products` everywhere else. Behavior (demoting APPROVED → NEEDS_REVIEW on failed viz QC) stays identical, just on the correct table.

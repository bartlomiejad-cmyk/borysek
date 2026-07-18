
CREATE OR REPLACE FUNCTION public.apply_variant_groups_tx(
  p_project_id uuid,
  p_groups jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  g              jsonb;
  v_parent_id    uuid;
  v_variant_ids  uuid[];
  v_base_name    text;
  v_base_kod     text;
  v_synth        boolean;
  v_parent_lock  boolean;
  v_parent_kod   text;
  v_src_id       uuid;
  v_src_nazwa    text;
  v_src_kod      text;
  v_src_cat      text;
  v_src_raw      jsonb;
  v_new_parent   uuid;
  v_new_kod      text;
  v_updated_ids  uuid[];
  v_batch        uuid[];
  v_variants     int := 0;
  v_synthetic    int := 0;
  v_all_ids      jsonb := '[]'::jsonb;
BEGIN
  -- Ownership guard mirrors public.projects RLS (auth.uid() = user_id).
  IF NOT EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = p_project_id AND p.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  -- Serialize concurrent applies against the same project.
  PERFORM pg_advisory_xact_lock(hashtext(p_project_id::text));

  FOR g IN SELECT * FROM jsonb_array_elements(COALESCE(p_groups, '[]'::jsonb)) LOOP
    v_parent_id := NULLIF(g->>'parentId','')::uuid;
    v_variant_ids := ARRAY(
      SELECT (elem)::uuid
      FROM jsonb_array_elements_text(COALESCE(g->'variantIds','[]'::jsonb)) AS elem
    );
    v_base_name := COALESCE(g->>'baseName','');
    v_base_kod  := NULLIF(g->>'baseKod','');
    v_synth     := COALESCE((g->>'createSyntheticParent')::boolean, false);
    v_parent_kod := NULL;

    IF v_parent_id IS NOT NULL THEN
      SELECT sp.manual_lock, sp.kod
        INTO v_parent_lock, v_parent_kod
        FROM public.source_products sp
       WHERE sp.id = v_parent_id AND sp.project_id = p_project_id;
      IF v_parent_lock IS TRUE THEN
        CONTINUE; -- do not touch locked parent
      END IF;
      v_parent_kod := COALESCE(v_parent_kod, v_base_kod);

    ELSIF v_synth AND array_length(v_variant_ids, 1) IS NOT NULL THEN
      v_src_id := v_variant_ids[1];
      SELECT sp.id, sp.nazwa, sp.kod, sp.category, sp.raw
        INTO v_src_id, v_src_nazwa, v_src_kod, v_src_cat, v_src_raw
        FROM public.source_products sp
       WHERE sp.id = v_src_id AND sp.project_id = p_project_id;
      IF v_src_id IS NULL THEN
        CONTINUE; -- stale id from a stale preview
      END IF;

      INSERT INTO public.source_products
        (project_id, ext_id, nazwa, kod, ean, category, row_kind, parent_sku, raw)
      VALUES
        (
          p_project_id,
          NULL,
          COALESCE(NULLIF(v_base_name,''), v_src_nazwa),
          v_base_kod,
          NULL,
          v_src_cat,
          'main',
          NULL,
          COALESCE(v_src_raw, '{}'::jsonb)
            || jsonb_build_object('_synthetic_parent', true, '_synthetic_from', v_src_id)
        )
      RETURNING id, kod INTO v_new_parent, v_new_kod;

      v_synthetic := v_synthetic + 1;
      v_parent_kod := COALESCE(v_new_kod, v_base_kod);

      INSERT INTO public.enrichments (source_product_id, project_id, status, match_type)
      VALUES (v_new_parent, p_project_id, 'PENDING', 'NO_MATCH')
      ON CONFLICT (source_product_id) DO NOTHING;
    ELSE
      v_parent_kod := v_base_kod;
    END IF;

    -- Mark variant rows (skip manual_lock).
    WITH upd AS (
      UPDATE public.source_products sp
         SET row_kind = 'variant',
             parent_sku = v_parent_kod,
             excluded = true,
             excluded_reason = 'variant',
             excluded_at = now()
       WHERE sp.project_id = p_project_id
         AND sp.id = ANY(v_variant_ids)
         AND sp.manual_lock IS NOT TRUE
      RETURNING sp.id
    )
    SELECT COALESCE(array_agg(id), '{}'::uuid[]) INTO v_batch FROM upd;

    v_variants := v_variants + COALESCE(array_length(v_batch, 1), 0);
    IF array_length(v_batch, 1) IS NOT NULL THEN
      v_all_ids := v_all_ids || to_jsonb(v_batch);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'variants', v_variants,
    'syntheticParents', v_synthetic,
    'groups', jsonb_array_length(COALESCE(p_groups,'[]'::jsonb)),
    'variantIds', v_all_ids
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.apply_variant_groups_tx(uuid, jsonb) TO authenticated;

-- Atomic apply of pattern-detected variant groups. Mirrors the former TS
-- applyVariantGroups semantics exactly, but transactionally: either every group is
-- classified or none (no partial application on mid-loop failure — known error class #4).
-- The function ALREADY EXISTS in the live DB (see src/integrations/supabase/types.ts:792-795);
-- this migration is CREATE OR REPLACE so the repo reflects DB state. If the deployed body
-- differs from this spec, this spec is authoritative and overwrites it.
CREATE OR REPLACE FUNCTION public.apply_variant_groups_tx(
  p_project_id uuid,
  p_groups jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  g jsonb;
  v_parent_id uuid;
  v_variant_ids uuid[];
  v_base_name text;
  v_base_kod text;
  v_create_synth boolean;
  v_parent_kod text;
  v_parent_locked boolean;
  v_parent_existing_kod text;
  v_src public.source_products%ROWTYPE;
  v_new_parent uuid;
  v_affected uuid[] := '{}';
  v_variant_count int := 0;
  v_synth_count int := 0;
  r_updated uuid;
BEGIN
  -- Serialize concurrent applies for the same project.
  PERFORM pg_advisory_xact_lock(hashtext(p_project_id::text));

  -- Ownership guard: caller must own the project. Same predicate as the RLS policies
  -- "own projects ..." on public.projects (auth.uid() = projects.user_id).
  IF NOT EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = p_project_id AND p.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'not authorized for project %', p_project_id USING ERRCODE = '42501';
  END IF;

  FOR g IN SELECT * FROM jsonb_array_elements(COALESCE(p_groups, '[]'::jsonb))
  LOOP
    v_parent_id    := NULLIF(g->>'parentId', '')::uuid;
    v_variant_ids  := ARRAY(
      SELECT jsonb_array_elements_text(COALESCE(g->'variantIds', '[]'::jsonb))
    )::uuid[];
    v_base_name    := g->>'baseName';
    v_base_kod     := g->>'baseKod';
    v_create_synth := COALESCE((g->>'createSyntheticParent')::boolean, false);

    IF v_parent_id IS NOT NULL THEN
      -- Existing parent: skip the WHOLE group when the parent is manual-locked.
      SELECT manual_lock, kod INTO v_parent_locked, v_parent_existing_kod
      FROM public.source_products
      WHERE id = v_parent_id AND project_id = p_project_id;

      IF v_parent_locked IS TRUE THEN
        CONTINUE;
      END IF;

      v_parent_kod := COALESCE(v_parent_existing_kod, v_base_kod);
    ELSIF v_create_synth AND array_length(v_variant_ids, 1) IS NOT NULL THEN
      -- Clone the FIRST variant row into a fresh row_kind='main' synthetic parent.
      SELECT * INTO v_src
      FROM public.source_products
      WHERE id = v_variant_ids[1] AND project_id = p_project_id;

      IF NOT FOUND THEN
        CONTINUE;
      END IF;

      INSERT INTO public.source_products (project_id, row_kind, nazwa, kod, category, raw)
      VALUES (
        p_project_id,
        'main',
        COALESCE(NULLIF(v_base_name, ''), v_src.nazwa),
        v_base_kod,
        v_src.category,
        COALESCE(v_src.raw, '{}'::jsonb)
          || jsonb_build_object('_synthetic_parent', true, '_synthetic_from', v_src.id)
      )
      RETURNING id INTO v_new_parent;

      -- Seed the parent enrichment. ON CONFLICT keeps this idempotent per parent.
      INSERT INTO public.enrichments (source_product_id, project_id, status, match_type)
      VALUES (v_new_parent, p_project_id, 'PENDING', 'NO_MATCH')
      ON CONFLICT (source_product_id) DO NOTHING;

      v_synth_count := v_synth_count + 1;
      -- Synthetic parent kod IS baseKod (mirrors TS COALESCE(new_kod, baseKod)).
      v_parent_kod := v_base_kod;
    ELSE
      v_parent_kod := v_base_kod;
    END IF;

    -- Mark variants; never touch manual-locked rows.
    FOR r_updated IN
      UPDATE public.source_products
      SET row_kind = 'variant',
          parent_sku = v_parent_kod,
          excluded = true,
          excluded_reason = 'variant',
          excluded_at = now()
      WHERE project_id = p_project_id
        AND id = ANY(v_variant_ids)
        AND manual_lock IS NOT TRUE
      RETURNING id
    LOOP
      v_affected := array_append(v_affected, r_updated);
      v_variant_count := v_variant_count + 1;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'variants', v_variant_count,
    'syntheticParents', v_synth_count,
    'groups', jsonb_array_length(COALESCE(p_groups, '[]'::jsonb)),
    'variantIds', COALESCE((SELECT jsonb_agg(x) FROM unnest(v_affected) AS x), '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_variant_groups_tx(uuid, jsonb) TO authenticated;
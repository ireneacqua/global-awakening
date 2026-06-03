-- ============================================================================
-- Candela per i rituali (Batch D #10) — 2026-06-03
-- Riferimento: docs/superpowers/specs/2026-06-03-rituali-candela-design.md
-- Additivo, non-breaking, idempotente. candles = array jsonb di session_id
-- (stesso pattern di participants). RPC toggle SECURITY DEFINER (trustful,
-- come join_ritual: usa session_id opaco, niente hash).
-- ============================================================================

ALTER TABLE rituals ADD COLUMN IF NOT EXISTS candles jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE OR REPLACE FUNCTION toggle_ritual_candle(
  p_ritual_id  bigint,
  p_session_id text
)
RETURNS SETOF rituals
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_session_id IS NULL OR p_session_id = '' THEN
    RAISE EXCEPTION 'session_required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM rituals WHERE id = p_ritual_id) THEN
    RAISE EXCEPTION 'ritual_not_found';
  END IF;

  RETURN QUERY
    UPDATE rituals
       SET candles = CASE
         WHEN candles @> to_jsonb(array[p_session_id]) THEN
           coalesce(
             (SELECT jsonb_agg(e) FROM jsonb_array_elements(candles) e
               WHERE e <> to_jsonb(p_session_id)),
             '[]'::jsonb)
         ELSE
           candles || to_jsonb(p_session_id)
       END
     WHERE id = p_ritual_id
     RETURNING *;
END;
$$;
GRANT EXECUTE ON FUNCTION toggle_ritual_candle(bigint,text) TO anon;

-- Verifica post-apply (da REST anon):
--   POST /rpc/toggle_ritual_candle {p_ritual_id:<X>, p_session_id:'s1'} -> candles contiene 's1'
--   ripetere -> candles NON contiene 's1'

-- ============================================================================
-- Rituali Step B — anti-impersonazione (B6 / VULN-4 RITUALI_AUDIT.md)
-- Riferimento: docs/superpowers/specs/2026-06-03-rituali-step-b-anti-impersonazione-design.md
-- Validazione CONDIZIONALE: se il nickname dichiarato esiste in profiles,
-- l'hash deve combaciare; altrimenti (guest) si procede. Contenuti pubblici.
-- Idempotente. Rollout staged: BLOCCO 1 ora, BLOCCO 2 dopo deploy client.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- BLOCCO 1 — FASE 1 (eseguire ORA): overload con p_password_hash (non-breaking)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION create_ritual(
  p_creator         text,
  p_creator_id      text,
  p_name            text,
  p_description     text,
  p_type            text,
  p_sacred_number   int,
  p_date            date,
  p_time            time,
  p_duration        int,
  p_password_hash   text
)
RETURNS SETOF rituals
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Anti-impersonazione condizionale (solo se il creator è un nick registrato)
  IF EXISTS (SELECT 1 FROM profiles WHERE nickname = p_creator) THEN
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE nickname = p_creator AND password_hash = p_password_hash) THEN
      RAISE EXCEPTION 'Auth failed';
    END IF;
  END IF;

  IF coalesce(trim(p_name), '') = '' THEN
    RAISE EXCEPTION 'name_required';
  END IF;
  IF p_duration IS NULL OR p_duration < 1 OR p_duration > 1440 THEN
    RAISE EXCEPTION 'duration_out_of_range';
  END IF;

  RETURN QUERY
    INSERT INTO rituals (
      creator, creator_id, name, description, type,
      sacred_number, date, time, duration, participants, energy
    )
    VALUES (
      coalesce(nullif(p_creator, ''), 'Anonymous'),
      p_creator_id,
      p_name,
      coalesce(p_description, ''),
      coalesce(p_type, 'consciousness'),
      coalesce(p_sacred_number, 11),
      p_date,
      p_time,
      p_duration,
      jsonb_build_array(p_creator_id),
      0
    )
    RETURNING *;
END;
$$;
GRANT EXECUTE ON FUNCTION create_ritual(text,text,text,text,text,int,date,time,int,text) TO anon;

CREATE OR REPLACE FUNCTION create_ritual_comment(
  p_ritual_id        bigint,
  p_author_nickname  text,
  p_content          text,
  p_password_hash    text
)
RETURNS SETOF ritual_comments
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Anti-impersonazione condizionale
  IF EXISTS (SELECT 1 FROM profiles WHERE nickname = p_author_nickname) THEN
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE nickname = p_author_nickname AND password_hash = p_password_hash) THEN
      RAISE EXCEPTION 'Auth failed';
    END IF;
  END IF;

  IF coalesce(trim(p_content), '') = '' THEN
    RAISE EXCEPTION 'content_required';
  END IF;
  IF length(p_content) > 2000 THEN
    RAISE EXCEPTION 'content_too_long';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM rituals WHERE id = p_ritual_id) THEN
    RAISE EXCEPTION 'ritual_not_found';
  END IF;

  RETURN QUERY
    INSERT INTO ritual_comments (ritual_id, author_nickname, content)
    VALUES (p_ritual_id,
            coalesce(nullif(p_author_nickname, ''), 'Anonymous'),
            p_content)
    RETURNING *;
END;
$$;
GRANT EXECUTE ON FUNCTION create_ritual_comment(bigint,text,text,text) TO anon;

-- ----------------------------------------------------------------------------
-- BLOCCO 2 — FASE 3 (eseguire SOLO dopo il deploy del client): chiude VULN-4
--   rimuove le firme vecchie senza hash (impersonabili)
-- ----------------------------------------------------------------------------
-- DROP FUNCTION IF EXISTS create_ritual(text,text,text,text,text,int,date,time,int);
-- DROP FUNCTION IF EXISTS create_ritual_comment(bigint,text,text);

-- ----------------------------------------------------------------------------
-- BLOCCO 3 — Verifica (post FASE 3, da REST anon)
-- ----------------------------------------------------------------------------
-- POST /rpc/create_ritual (10 arg, p_creator=<nick registrato>, hash errato) -> 'Auth failed'
-- POST /rpc/create_ritual (10 arg, p_creator=<guest libero>, hash null)       -> 200, riga creata
-- POST /rpc/create_ritual (9 arg, vecchia firma)                              -> 404 (function non trovata)

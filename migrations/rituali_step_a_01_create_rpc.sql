-- ============================================================================
-- Rituali — Step A · 01 · Create RPC SECURITY DEFINER
-- ----------------------------------------------------------------------------
-- Eseguire questo file PRIMA di pushare il client modificato a main.
-- Le RPC create qui non rompono il client attuale: convivono con i
-- direct-write esistenti finché 02_drop_policies non viene eseguito.
--
-- Idempotente: usa CREATE OR REPLACE. Eseguibile più volte senza danno.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) create_ritual — ritorna la riga creata (per UX immediata)
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
  p_duration        int
)
RETURNS SETOF rituals
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
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
GRANT EXECUTE ON FUNCTION create_ritual(text,text,text,text,text,int,date,time,int) TO anon;

-- ----------------------------------------------------------------------------
-- 2) join_ritual — append idempotente all'array participants (jsonb)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION join_ritual(
  p_ritual_id  bigint,
  p_session_id text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  UPDATE rituals
     SET participants = participants || jsonb_build_array(p_session_id)
   WHERE id = p_ritual_id
     AND p_session_id IS NOT NULL
     AND p_session_id <> ''
     AND NOT (participants @> jsonb_build_array(p_session_id));
END;
$$;
GRANT EXECUTE ON FUNCTION join_ritual(bigint,text) TO anon;

-- ----------------------------------------------------------------------------
-- 3) send_ritual_energy — incremento controllato del campo energy
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION send_ritual_energy(
  p_ritual_id bigint,
  p_amount    int DEFAULT 10
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  IF p_amount IS NULL OR p_amount < 1 OR p_amount > 100 THEN
    RAISE EXCEPTION 'energy_out_of_range';
  END IF;
  UPDATE rituals SET energy = coalesce(energy, 0) + p_amount
   WHERE id = p_ritual_id;
END;
$$;
GRANT EXECUTE ON FUNCTION send_ritual_energy(bigint,int) TO anon;

-- ----------------------------------------------------------------------------
-- 4) create_ritual_comment — ritorna riga creata
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_ritual_comment(
  p_ritual_id        bigint,
  p_author_nickname  text,
  p_content          text
)
RETURNS SETOF ritual_comments
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
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
GRANT EXECUTE ON FUNCTION create_ritual_comment(bigint,text,text) TO anon;

-- ----------------------------------------------------------------------------
-- 5) cleanup_expired_rituals — sostituisce il loop client-side
-- ----------------------------------------------------------------------------
-- I rituali memorizzano date (date) e time (time without timezone) trattati
-- come UTC dal client (`new Date(`${r.date}T${r.time}Z`)`).
-- Endtime = (date + time) UTC + duration minuti.
--
-- Ritorna il numero di rituali cancellati.
CREATE OR REPLACE FUNCTION cleanup_expired_rituals()
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_count int;
BEGIN
  WITH expired AS (
    DELETE FROM rituals
     WHERE (date + time) + make_interval(mins => coalesce(duration, 0))
           < (now() AT TIME ZONE 'UTC')::timestamp
     RETURNING id
  )
  SELECT count(*) INTO v_count FROM expired;
  RETURN coalesce(v_count, 0);
END;
$$;
GRANT EXECUTE ON FUNCTION cleanup_expired_rituals() TO anon;

-- ============================================================================
-- VERIFICA POST-APPLY
-- ============================================================================
-- Dopo aver eseguito lo script, verificare che le RPC siano callable:
--
--   SELECT * FROM create_ritual('TestNick','test-sess-id','Test','desc',
--             'consciousness',11,'2099-12-31','12:00',5);
--   SELECT cleanup_expired_rituals();  -- deve tornare 0 o n
--
-- E pulire l'eventuale ritual di test:
--   DELETE FROM rituals WHERE creator='TestNick' AND creator_id='test-sess-id';

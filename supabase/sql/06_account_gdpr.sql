-- ============================================================================
-- Account GDPR — D2 export + D3 eliminazione (self-service)
-- Riferimento: docs/superpowers/specs/2026-06-03-account-gdpr-export-delete-design.md
-- Pattern: RPC SECURITY DEFINER autenticate (nickname, password_hash) come Step B
--          (get_my_messages). Solo utenti registrati. Additive, non-breaking.
-- Idempotente: CREATE OR REPLACE. Eseguibile più volte senza danno.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) export_my_account — ritorna tutti i dati dell'utente come unico jsonb
--    profile esclude password_hash (mai esportato).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.export_my_account(
  p_nickname      text,
  p_password_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email  text;
  v_sid    text;
  v_result jsonb;
BEGIN
  SELECT email, session_id INTO v_email, v_sid
    FROM profiles
   WHERE nickname = p_nickname AND password_hash = p_password_hash;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Auth failed';
  END IF;

  SELECT jsonb_build_object(
    'exported_at', now(),
    'profile', (SELECT to_jsonb(p) - 'password_hash'
                  FROM profiles p WHERE p.nickname = p_nickname),
    'private_messages', coalesce((SELECT jsonb_agg(to_jsonb(m))
                  FROM private_messages m
                 WHERE m.sender_name = p_nickname OR m.receiver_name = p_nickname), '[]'::jsonb),
    'consciousness_posts', coalesce((SELECT jsonb_agg(to_jsonb(c))
                  FROM consciousness_posts c WHERE c.author_nickname = p_nickname), '[]'::jsonb),
    'consciousness_comments', coalesce((SELECT jsonb_agg(to_jsonb(c))
                  FROM consciousness_comments c WHERE c.author_nickname = p_nickname), '[]'::jsonb),
    'ritual_comments', coalesce((SELECT jsonb_agg(to_jsonb(rc))
                  FROM ritual_comments rc WHERE rc.author_nickname = p_nickname), '[]'::jsonb),
    'rituals_created', coalesce((SELECT jsonb_agg(to_jsonb(r))
                  FROM rituals r WHERE r.creator = p_nickname OR r.creator_id = v_sid), '[]'::jsonb),
    'telepathy_scores', coalesce((SELECT jsonb_agg(to_jsonb(ts))
                  FROM telepathy_scores ts WHERE ts.user_id = v_email), '[]'::jsonb),
    'notifications', coalesce((SELECT jsonb_agg(to_jsonb(n))
                  FROM notifications n WHERE n.user_nickname = p_nickname), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END $$;

GRANT EXECUTE ON FUNCTION public.export_my_account(text, text) TO anon;

-- ----------------------------------------------------------------------------
-- 2) delete_my_account — anonimizza i contenuti pubblici, cancella i dati
--    personali/privati e la riga profiles. Tutto nel corpo unico = transazione.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_my_account(
  p_nickname      text,
  p_password_hash text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
  v_sid   text;
BEGIN
  SELECT email, session_id INTO v_email, v_sid
    FROM profiles
   WHERE nickname = p_nickname AND password_hash = p_password_hash;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Auth failed';
  END IF;

  -- (a) Anonimizza i contenuti pubblici (preserva i thread altrui)
  UPDATE consciousness_posts    SET author_nickname = 'Utente eliminato' WHERE author_nickname = p_nickname;
  UPDATE consciousness_comments SET author_nickname = 'Utente eliminato' WHERE author_nickname = p_nickname;
  UPDATE ritual_comments        SET author_nickname = 'Utente eliminato' WHERE author_nickname = p_nickname;
  UPDATE rituals                SET creator         = 'Utente eliminato' WHERE creator = p_nickname;
  UPDATE chat_messages          SET user_name       = 'Utente eliminato' WHERE user_name = p_nickname;

  -- (b) Cancella i dati personali/privati
  DELETE FROM private_messages WHERE sender_name = p_nickname OR receiver_name = p_nickname;
  DELETE FROM notifications    WHERE user_nickname = p_nickname;

  IF v_email IS NOT NULL AND v_email <> '' THEN
    DELETE FROM telepathy_scores WHERE user_id = v_email;
    DELETE FROM magic_links      WHERE email   = v_email;
    DELETE FROM password_resets  WHERE email   = v_email;
  END IF;

  -- Effimeri telepatia/presenza con colonne note (TTL breve, session_id opachi).
  -- telepathy_matches/telepathy_chat NON toccati: si auto-puliscono a TTL <5min
  -- e contengono solo id effimeri + simboli, non PII persistente identificabile.
  IF v_sid IS NOT NULL AND v_sid <> '' THEN
    DELETE FROM online_users      WHERE id = v_sid;
    DELETE FROM telepathy_queue   WHERE id = v_sid;
    DELETE FROM telepathy_invites WHERE from_id = v_sid OR to_id = v_sid;
  END IF;

  -- (c) Cancella l'identità
  DELETE FROM profiles WHERE nickname = p_nickname AND password_hash = p_password_hash;
END $$;

GRANT EXECUTE ON FUNCTION public.delete_my_account(text, text) TO anon;

-- ----------------------------------------------------------------------------
-- VERIFICA POST-APPLY (da Studio)
--   SELECT export_my_account('NickInesistente','x');   -> errore 'Auth failed'
--   SELECT delete_my_account('NickInesistente','x');    -> errore 'Auth failed'
-- ----------------------------------------------------------------------------

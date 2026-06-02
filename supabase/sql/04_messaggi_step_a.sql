-- ============================================================================
-- Messaggi privati — Step A "trustful" (chiude UPDATE/DELETE/INSERT arbitrari)
-- Riferimento: global-awakening/MESSAGGI_AUDIT.md (VULN-1..5)
-- Schema verificato vs DB live 2026-06-02:
--   private_messages(id, sender_id, sender_name, receiver_name, content, is_read, created_at)
--   notifications(id, user_nickname, type, message, read, created_at)
-- Pattern identico a Rituali Step A: RPC SECURITY DEFINER + drop policy aperte,
-- SELECT pubblica mantenuta (Step A NON chiude VULN-1 lettura né VULN-4 impersonation).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- BLOCCO 1 — RPC (non breaking: convivono col direct-write attuale)
-- ----------------------------------------------------------------------------

-- A.1 — invio messaggio: valida input, inserisce, crea la notifica server-side
CREATE OR REPLACE FUNCTION public.send_private_message(
  p_sender_id     text,
  p_sender_name   text,
  p_receiver_name text,
  p_content       text
)
RETURNS private_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_msg private_messages%ROWTYPE;
  v_clean_content text;
BEGIN
  v_clean_content := btrim(p_content);
  IF v_clean_content IS NULL OR v_clean_content = '' THEN
    RAISE EXCEPTION 'Empty content';
  END IF;
  IF p_sender_name IS NULL OR p_sender_name = '' THEN
    RAISE EXCEPTION 'Empty sender_name';
  END IF;
  IF p_receiver_name IS NULL OR p_receiver_name = '' THEN
    RAISE EXCEPTION 'Empty receiver_name';
  END IF;
  IF length(v_clean_content) > 2000 THEN
    RAISE EXCEPTION 'Content too long';
  END IF;

  INSERT INTO private_messages (sender_id, sender_name, receiver_name, content, is_read)
  VALUES (p_sender_id, p_sender_name, p_receiver_name, v_clean_content, false)
  RETURNING * INTO v_msg;

  -- Mantiene la notifica che oggi viene creata client-side (messaggio hardcoded IT,
  -- come in app.html sendPrivateMessage).
  INSERT INTO notifications (user_nickname, type, message)
  VALUES (p_receiver_name, 'private_message',
          p_sender_name || ' ti ha inviato un messaggio privato');

  RETURN v_msg;
END $$;

GRANT EXECUTE ON FUNCTION public.send_private_message(text, text, text, text) TO anon;

-- A.2 — segna come letto: solo is_read=true, solo per il destinatario auto-dichiarato
CREATE OR REPLACE FUNCTION public.mark_message_read(
  p_message_id     uuid,
  p_receiver_name  text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE private_messages
     SET is_read = true
   WHERE id = p_message_id
     AND receiver_name = p_receiver_name;
END $$;

GRANT EXECUTE ON FUNCTION public.mark_message_read(uuid, text) TO anon;

-- ----------------------------------------------------------------------------
-- BLOCCO 2 — RICOGNIZIONE policy (eseguito 2026-06-02)
-- ----------------------------------------------------------------------------
-- SELECT policyname, cmd, roles, qual, with_check FROM pg_policies WHERE tablename = 'private_messages';
-- Risultato reale: UNA sola policy
--   "Allow all for anon" | cmd=ALL | roles={public} | qual=true | with_check=true
-- → porta aperta a tutto (lettura E scrittura) per chiunque.

-- ----------------------------------------------------------------------------
-- BLOCCO 3 — APPLICATO 2026-06-02: drop della policy ALL aperta + SELECT-only pubblica
-- ----------------------------------------------------------------------------
ALTER TABLE private_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all for anon" ON private_messages;

CREATE POLICY private_messages_select_public
  ON private_messages
  FOR SELECT
  TO public
  USING (true);
-- Esito: RLS ON + solo policy SELECT → scritture anon negate per default; scrivono solo
-- le RPC SECURITY DEFINER del BLOCCO 1. Lettura pubblica mantenuta (Step A NON chiude
-- VULN-1 lettura né VULN-4 impersonation → Step B).

-- ----------------------------------------------------------------------------
-- BLOCCO 4 — Verifica post-apply (da REST anon, atteso dopo il drop)
-- ----------------------------------------------------------------------------
-- POST   /rest/v1/private_messages           -> 401/403 (insert diretto bloccato)
-- PATCH  /rest/v1/private_messages?id=eq.X    -> 200 con body [] (RLS filtra, 0 righe) o 401/403
-- DELETE /rest/v1/private_messages?id=eq.X    -> 200 con body [] o 401/403
-- POST   /rest/v1/rpc/send_private_message    -> 200 (RPC funziona)
-- GET    /rest/v1/private_messages?select=*   -> 200 (SELECT pubblica resta, per la UI)

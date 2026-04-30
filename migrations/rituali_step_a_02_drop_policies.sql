-- ============================================================================
-- Rituali — Step A · 02 · Drop policy aperte INSERT/UPDATE/DELETE
-- ----------------------------------------------------------------------------
-- ⚠ DA ESEGUIRE SOLO DOPO:
--   1) `01_create_rpc.sql` applicato
--   2) Client modificato (uso RPC) deployato a main e live su GitHub Pages
--
-- Eseguire prima del deploy del client rompe il sito perché blocca i
-- direct-write che il vecchio client fa via REST.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- STEP 0 · INVENTARIO POLICY ESISTENTI (eseguire PRIMA, copiare l'output)
-- ----------------------------------------------------------------------------
-- Lanciare questa query per ottenere i nomi reali delle policy da droppare.
-- I CREATE POLICY del progetto Supabase potrebbero avere nomi diversi da
-- quelli ipotizzati sotto.
--
--   SELECT schemaname, tablename, policyname, cmd, roles, qual, with_check
--     FROM pg_policies
--    WHERE tablename IN ('rituals','ritual_comments')
--    ORDER BY tablename, cmd, policyname;
--
-- Atteso pattern: una o più policy "Allow all"/"anon all"/"public all" con
-- qual = 'true' che coprono ALL/INSERT/UPDATE/DELETE.

-- ----------------------------------------------------------------------------
-- STEP 1 · DROP delle policy aperte
-- ----------------------------------------------------------------------------
-- ⚠ Sostituire i nomi nei DROP qui sotto con quelli ottenuti da pg_policies.
-- I nomi commentati sono i pattern presunti dall'audit telepathy precedente,
-- ma vanno verificati e adattati.

-- ESEMPI da personalizzare (commentati per evitare esecuzioni accidentali):
--
--   DROP POLICY IF EXISTS "Allow all" ON rituals;
--   DROP POLICY IF EXISTS "anon all" ON rituals;
--   DROP POLICY IF EXISTS "Enable read access for all users" ON rituals;
--   DROP POLICY IF EXISTS "Allow all" ON ritual_comments;
--   DROP POLICY IF EXISTS "anon all" ON ritual_comments;

-- ⚠ Decommentare e adattare ai nomi reali prima di eseguire.

-- ----------------------------------------------------------------------------
-- STEP 2 · ENABLE RLS (se non già attivo) e ricostruire SOLO policy SELECT
-- ----------------------------------------------------------------------------
ALTER TABLE rituals          ENABLE ROW LEVEL SECURITY;
ALTER TABLE ritual_comments  ENABLE ROW LEVEL SECURITY;

-- SELECT pubblica (la UI legge tutto il pubblico)
DROP POLICY IF EXISTS rituals_select_public ON rituals;
CREATE POLICY rituals_select_public
  ON rituals FOR SELECT
  TO anon
  USING (true);

DROP POLICY IF EXISTS ritual_comments_select_public ON ritual_comments;
CREATE POLICY ritual_comments_select_public
  ON ritual_comments FOR SELECT
  TO anon
  USING (true);

-- ⚠ Da qui NON ci sono policy INSERT / UPDATE / DELETE per anon.
-- Tutte le scritture passano OBBLIGATORIAMENTE per le RPC SECURITY DEFINER
-- create in 01_create_rpc.sql.

-- ----------------------------------------------------------------------------
-- VERIFICA POST-APPLY
-- ----------------------------------------------------------------------------
-- 1) Direct-write devono tornare 401/403:
--    curl -X DELETE 'https://vxzxdkcluyrcftsnxxza.supabase.co/rest/v1/rituals?id=eq.999' \
--         -H 'apikey: <ANON>' -H 'Authorization: Bearer <ANON>'
--    → atteso: response con error "permission denied" o "no policy", riga ancora viva.
--
-- 2) RPC funzionano:
--    curl -X POST 'https://vxzxdkcluyrcftsnxxza.supabase.co/rest/v1/rpc/create_ritual' \
--         -H 'apikey: <ANON>' -H 'Authorization: Bearer <ANON>' \
--         -H 'Content-Type: application/json' \
--         -d '{"p_creator":"…","p_creator_id":"…",…}'
--    → atteso: 200 con riga creata.
--
-- 3) E2E rituali deve tornare 13/13:
--    npx serve . -p 4321 &
--    node test-rituali.js

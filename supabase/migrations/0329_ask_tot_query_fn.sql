-- 0329_ask_tot_query_fn.sql
-- Postgres helper for Ask Tot's run_sql tool — executes a read-only SELECT
-- against the public schema. Called only by the service-role backend
-- (ask-tot.js); no client-role grant.
--
-- Security model:
--   • ask-tot.js pre-validates the SQL before calling this (SELECT-only,
--     no dangerous keywords, no system schemas). This function re-checks for
--     defence-in-depth.
--   • SECURITY DEFINER + SET search_path = public prevents schema injection.
--   • Caller injects scope filters (store_numbers CTE) for non-admin users.
--   • 200-row hard cap baked into the execution wrapper.

CREATE OR REPLACE FUNCTION public.ask_tot_query(sql_query text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  norm   text;
  result jsonb;
BEGIN
  -- Strip comments, then normalise whitespace
  norm := regexp_replace(sql_query, '\/\*[\s\S]*?\*\/', '', 'g');
  norm := regexp_replace(norm, '--[^\n]*', '', 'g');
  norm := trim(norm);

  -- Must begin with SELECT or WITH
  IF norm !~* '^\s*(SELECT|WITH)\s' THEN
    RETURN jsonb_build_object('error', 'Only SELECT queries are allowed.');
  END IF;

  -- Reject mutation / privilege-escalation keywords
  IF norm ~* '\y(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|GRANT|REVOKE|COPY|EXECUTE|EXEC|SET_CONFIG|PG_READ_FILE|PG_WRITE_FILE|PG_LS_DIR|PG_READ_BINARY_FILE)\y' THEN
    RETURN jsonb_build_object('error', 'Query contains disallowed keywords.');
  END IF;

  -- Reject cross-schema access to system tables
  IF norm ~* '\y(auth\.|vault\.|storage\.|pg_catalog\.|information_schema\.|pg_toast\.)' THEN
    RETURN jsonb_build_object('error', 'Access to system schemas is not permitted.');
  END IF;

  BEGIN
    EXECUTE format(
      'SELECT jsonb_agg(row_to_json(_t)) FROM (%s) _t',
      format('SELECT * FROM (%s) _inner LIMIT 200', sql_query)
    )
    INTO result;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('error', SQLERRM, 'hint', SQLSTATE);
  END;

  RETURN jsonb_build_object(
    'rows',  COALESCE(result, '[]'::jsonb),
    'count', jsonb_array_length(COALESCE(result, '[]'::jsonb))
  );
END;
$$;

-- Restrict: only the service-role backend may call this.
REVOKE ALL ON FUNCTION public.ask_tot_query(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ask_tot_query(text) TO service_role;

NOTIFY pgrst, 'reload schema';

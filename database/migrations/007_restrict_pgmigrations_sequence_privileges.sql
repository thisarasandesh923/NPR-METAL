-- Up Migration
-- =============================================================================
-- Migration 007: Restrict public.pgmigrations_id_seq Privileges
-- Project: NPR Metal Crusher — Billing & Management System
-- Scope:
--   • Explicitly revokes ALL sequence privileges (USAGE, SELECT, UPDATE) on
--     public.pgmigrations_id_seq from PUBLIC, anon, authenticated, and
--     npr_app_user so non-administrative roles cannot inspect, advance (nextval),
--     or reset (setval) the migration history sequence.
--   • Preserves full administrative privileges for the migration/schema owner
--     role (postgres) and leaves application sequences, tables, RLS policies,
--     and database-wide default privileges unchanged.
-- =============================================================================

DO $$
DECLARE
    v_role TEXT;
BEGIN
    IF to_regclass('public.pgmigrations_id_seq') IS NOT NULL THEN
        REVOKE ALL ON SEQUENCE public.pgmigrations_id_seq FROM PUBLIC;

        FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'npr_app_user']
        LOOP
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
                EXECUTE format(
                    'REVOKE ALL ON SEQUENCE public.pgmigrations_id_seq FROM %I',
                    v_role
                );
            END IF;
        END LOOP;
    END IF;
END
$$;

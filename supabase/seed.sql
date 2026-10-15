-- Synthetic seed data for LOCAL development only (`supabase db reset`).
-- `supabase db push` does not run this file, so it never reaches production.
--
-- Phase 1 needs no seed rows: the permission catalog is created by the
-- migration, and the first owner is created through /setup.
-- Phase 2+ will add clearly labelled synthetic courses and candidates here
-- (emails on the reserved example.test domain, never real people).
select 1;

-- ============================================================================
-- HARNAIS LOCAL — UNIQUEMENT pour tester hors Supabase (CI, machine locale).
-- NE JAMAIS exécuter sur un projet Supabase : le schéma auth y existe déjà.
-- Recrée le strict minimum : rôles PostgREST, schéma auth, auth.uid().
-- ============================================================================

create role anon nologin;
create role authenticated nologin;
create role service_role nologin;

create schema if not exists auth;

-- Version minimale d'auth.users (colonnes utilisées par Nganda POS et les tests)
create table auth.users (
  id                  uuid primary key default gen_random_uuid(),
  instance_id         uuid,
  aud                 text,
  role                text,
  email               text,
  phone               text,
  encrypted_password  text,
  email_confirmed_at  timestamptz,
  raw_user_meta_data  jsonb not null default '{}'::jsonb,
  raw_app_meta_data   jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Implémentation de référence de auth.uid() (identique à Supabase)
create or replace function auth.uid()
returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid;
$$;

-- Privilèges par défaut équivalents à ceux d'un projet Supabase
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public
  grant select, insert, update, delete on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant usage, select on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant execute on functions to anon, authenticated, service_role;

-- Bouchons pgcrypto pour l'exécution LOCALE uniquement
-- (pgcrypto est activée par `create extension` dans 01_schema.sql sur Supabase).
create or replace function public.gen_random_bytes(n integer)
returns bytea language sql volatile as $$
  select decode(string_agg(lpad(to_hex(floor(random() * 256)::int), 2, '0'), ''), 'hex')
  from generate_series(1, n);
$$;
create or replace function public.crypt(text, text)
returns text language sql immutable as $$ select 'crypt_stub_local' $$;
create or replace function public.gen_salt(text)
returns text language sql immutable as $$ select 'salt_stub_local' $$;

-- =============================================================================
-- PharmaIQ — Row-Level Security (isolation multi-tenant au niveau BASE)
-- -----------------------------------------------------------------------------
-- À exécuter APRÈS chaque `prisma migrate deploy` :
--     pnpm db:rls
--
-- Principe : chaque table métier porte `pharmacyId`. Une politique unique
-- `tenant_isolation` n'autorise lecture ET écriture que sur les lignes du tenant
-- courant. Le tenant courant est résolu par `app.current_pharmacy_id()` qui
-- accepte DEUX sources :
--   1. le GUC `app.pharmacy_id`, posé par `SET LOCAL` dans chaque transaction
--      applicative (chemin Prisma — voir packages/db/src/tenant.ts) ;
--   2. le claim `app_metadata.pharmacy_id` du JWT Supabase (chemin PostgREST /
--      client Supabase).
--
-- Le `pharmacyId` provient TOUJOURS de la session serveur, jamais du client.
-- =============================================================================

create schema if not exists app;
grant usage on schema app to public;

-- -----------------------------------------------------------------------------
-- 1. Résolution du tenant courant
-- -----------------------------------------------------------------------------
create or replace function app.current_pharmacy_id() returns uuid
language sql
stable
as $$
  select coalesce(
    -- Chemin applicatif (Prisma) : SET LOCAL app.pharmacy_id = '<uuid>'
    nullif(current_setting('app.pharmacy_id', true), '')::uuid,
    -- Chemin Supabase : claim JWT app_metadata.pharmacy_id
    nullif(
      nullif(current_setting('request.jwt.claims', true), '')::jsonb
        -> 'app_metadata' ->> 'pharmacy_id',
      ''
    )::uuid
  );
$$;

comment on function app.current_pharmacy_id() is
  'Tenant de la session courante. NULL => aucune ligne visible (RLS bloque tout).';

-- -----------------------------------------------------------------------------
-- 2. Politique d'isolation sur toutes les tables métier
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
  tenant_tables text[] := array[
    'Branch', 'User', 'Invitation', 'Category', 'Product', 'Stock',
    'StockMovement', 'Supplier', 'Purchase', 'PurchaseItem', 'Sale', 'SaleItem',
    'Customer', 'Alert', 'Recommendation', 'Counter', 'AuditLog'
  ];
begin
  foreach t in array tenant_tables loop
    if to_regclass(format('public.%I', t)) is null then
      raise notice 'Table % absente — migration Prisma non appliquée ?', t;
      continue;
    end if;

    execute format('alter table public.%I enable row level security', t);
    -- FORCE : la politique s'applique aussi au propriétaire de la table.
    -- Seul un rôle BYPASSRLS (jobs système) y échappe.
    execute format('alter table public.%I force row level security', t);
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format(
      'create policy tenant_isolation on public.%I
         using ("pharmacyId" = app.current_pharmacy_id())
         with check ("pharmacyId" = app.current_pharmacy_id())', t);
  end loop;
end
$$;

-- Le tenant racine lui-même : la pharmacie ne voit que sa propre fiche.
-- (La CRÉATION d'une pharmacie passe par le client admin BYPASSRLS — inscription.)
alter table public."Pharmacy" enable row level security;
alter table public."Pharmacy" force row level security;
drop policy if exists tenant_isolation on public."Pharmacy";
create policy tenant_isolation on public."Pharmacy"
  using (id = app.current_pharmacy_id())
  with check (id = app.current_pharmacy_id());

-- -----------------------------------------------------------------------------
-- 3. Privilèges du rôle applicatif
-- -----------------------------------------------------------------------------
-- Le rôle applicatif NE DOIT PAS être superutilisateur ni propriétaire des
-- tables avec BYPASSRLS. Création (une seule fois, avec un mot de passe fort) :
--
--     create role pharmaiq_app login password '...' nobypassrls;
--
-- puis pointer DATABASE_URL sur ce rôle.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'pharmaiq_app') then
    grant usage on schema public to pharmaiq_app;
    grant select, insert, update, delete on all tables in schema public to pharmaiq_app;
    grant usage, select on all sequences in schema public to pharmaiq_app;
    alter default privileges in schema public
      grant select, insert, update, delete on tables to pharmaiq_app;
    alter default privileges in schema public
      grant usage, select on sequences to pharmaiq_app;
  else
    raise notice 'Rôle pharmaiq_app absent — privilèges non accordés.';
  end if;

  -- Supabase : rôle des utilisateurs authentifiés (accès via PostgREST).
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant usage on schema public to authenticated;
    grant select, insert, update, delete on all tables in schema public to authenticated;
    grant usage, select on all sequences in schema public to authenticated;
  end if;

  -- Le rôle anonyme ne doit toucher à aucune donnée métier.
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on all tables in schema public from anon;
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- 4. Recherche floue des produits (rapprochement des lignes de reçus)
-- -----------------------------------------------------------------------------
create extension if not exists pg_trgm;

create index if not exists product_name_trgm_idx
  on public."Product" using gin (name gin_trgm_ops);
create index if not exists product_dci_trgm_idx
  on public."Product" using gin (dci gin_trgm_ops);

-- -----------------------------------------------------------------------------
-- 5. Vérification
-- -----------------------------------------------------------------------------
-- Doit lister toutes les tables métier avec rowsecurity = true :
--   select relname, relrowsecurity, relforcerowsecurity
--   from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r';

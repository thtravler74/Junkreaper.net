-- ClutterQuote schema. The app talks to Postgres with the service-role key from
-- server code only; RLS is still enabled so the anon/authenticated keys can never
-- read another tenant's data, and owner policies allow direct dashboard reads.

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  name text not null,
  phone text not null default '',
  email text not null,
  brand_color text not null default '#16a34a',
  logo_url text,
  allowed_origins text[] not null default '{}',
  owner_emails text[] not null default '{}',
  pricing jsonb not null,
  service_area jsonb not null,
  scheduling jsonb not null,
  deposit jsonb not null,
  created_at timestamptz not null default now()
);

-- Credentials and integration state live apart from the tenant row so no
-- policy that exposes tenants can ever expose them. No RLS policies: service role only.
create table public.tenant_integrations (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  stripe_account_id text unique,
  data jsonb not null default '{}'
);

create table public.photo_analyses (
  id uuid primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  provider text not null,
  model text not null,
  photo_keys text[] not null default '{}',
  raw jsonb not null,
  lines jsonb not null,
  loose_yd3 numeric not null,
  loose_lbs numeric not null,
  uncertainty numeric not null,
  created_at timestamptz not null default now()
);

create table public.quotes (
  id uuid primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  analysis_id uuid references public.photo_analyses (id),
  zip text not null,
  input jsonb not null,
  result jsonb not null,
  low_cents integer generated always as ((result ->> 'lowCents')::integer) stored,
  high_cents integer generated always as ((result ->> 'highCents')::integer) stored,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index quotes_tenant_created on public.quotes (tenant_id, created_at desc);

create table public.bookings (
  id uuid primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  quote_id uuid not null references public.quotes (id),
  status text not null check (status in ('pending_payment', 'confirmed', 'cancelled', 'expired')),
  slot_key text not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  customer jsonb not null,
  deposit_cents integer not null default 0,
  platform_fee_cents integer not null default 0,
  checkout_session_id text unique,
  payment_intent_id text,
  hold_expires_at timestamptz,
  calendar_event_id text,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);
create index bookings_tenant_window on public.bookings (tenant_id, window_start);
create index bookings_tenant_slot on public.bookings (tenant_id, slot_key);

-- Capacity-safe insert. A transaction-scoped advisory lock per (tenant, slot)
-- serializes concurrent attempts on the same window, so two customers can't both
-- take its last crew.
create or replace function public.create_booking_if_available(p_booking jsonb, p_capacity integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := (p_booking ->> 'tenant_id')::uuid;
  v_slot text := p_booking ->> 'slot_key';
  v_taken integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text || '|' || v_slot, 0));

  select count(*) into v_taken
  from bookings
  where tenant_id = v_tenant
    and slot_key = v_slot
    and (status = 'confirmed' or (status = 'pending_payment' and (hold_expires_at is null or hold_expires_at > now())));

  if v_taken >= p_capacity then
    return false;
  end if;

  insert into bookings (id, tenant_id, quote_id, status, slot_key, window_start, window_end, customer,
                        deposit_cents, platform_fee_cents, checkout_session_id, hold_expires_at, created_at)
  values ((p_booking ->> 'id')::uuid, v_tenant, (p_booking ->> 'quote_id')::uuid, p_booking ->> 'status', v_slot,
          (p_booking ->> 'window_start')::timestamptz, (p_booking ->> 'window_end')::timestamptz, p_booking -> 'customer',
          (p_booking ->> 'deposit_cents')::integer, (p_booking ->> 'platform_fee_cents')::integer,
          p_booking ->> 'checkout_session_id', (p_booking ->> 'hold_expires_at')::timestamptz,
          (p_booking ->> 'created_at')::timestamptz);
  return true;
end;
$$;
revoke all on function public.create_booking_if_available(jsonb, integer) from public, anon, authenticated;

-- Row-level security
alter table public.tenants enable row level security;
alter table public.tenant_integrations enable row level security;
alter table public.photo_analyses enable row level security;
alter table public.quotes enable row level security;
alter table public.bookings enable row level security;

create or replace function public.is_tenant_owner(p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from tenants t
    where t.id = p_tenant and lower(auth.jwt() ->> 'email') = any (select lower(e) from unnest(t.owner_emails) e)
  );
$$;

create policy "owners read their tenant" on public.tenants for select to authenticated using (public.is_tenant_owner(id));
create policy "owners read analyses" on public.photo_analyses for select to authenticated using (public.is_tenant_owner(tenant_id));
create policy "owners read quotes" on public.quotes for select to authenticated using (public.is_tenant_owner(tenant_id));
create policy "owners read bookings" on public.bookings for select to authenticated using (public.is_tenant_owner(tenant_id));

-- Private bucket for customer photos; served to owners through signed URLs only.
insert into storage.buckets (id, name, public) values ('quote-photos', 'quote-photos', false)
on conflict (id) do nothing;

-- Plataforma VIP V163
-- Control administrativo de renovaciones, pagos manuales y comunicaciones.
--
-- Estas tablas NO forman parte del acceso público de las integrantes. Solo una
-- cuenta que ya pase la función existente public.es_admin() puede consultarlas
-- o modificarlas. La clave publicable del navegador sigue protegida por RLS.

begin;

create table if not exists public.vip_control_membresias (
  member_id text primary key,
  plan_key text not null default 'Básico',
  founder_active boolean not null default false,
  founder_month integer not null default 0 check (founder_month between 0 and 24),
  founder_total integer not null default 3 check (founder_total between 1 and 24),
  founder_price numeric(12,2) not null default 0 check (founder_price >= 0),
  regular_price numeric(12,2) not null default 0 check (regular_price >= 0),
  next_renewal date,
  price_change_date date,
  grace_until date,
  last_payment date,
  payment_link text not null default '',
  notes text not null default '',
  status text not null default 'active' check (status in ('active','grace','suspended')),
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vip_control_pagos (
  id bigint generated always as identity primary key,
  member_id text not null,
  amount numeric(12,2) not null default 0 check (amount >= 0),
  kind text not null default 'manual',
  note text not null default '',
  paid_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

create table if not exists public.vip_control_comunicaciones (
  id bigint generated always as identity primary key,
  member_id text not null,
  template_key text not null,
  phone text not null default '',
  rendered_text text not null default '',
  status text not null default 'opened' check (status in ('opened','copied','sent')),
  managed_by text not null default 'Administración',
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

create index if not exists vip_control_membresias_next_renewal_idx
  on public.vip_control_membresias (next_renewal);
create index if not exists vip_control_membresias_status_idx
  on public.vip_control_membresias (status);
create index if not exists vip_control_pagos_member_date_idx
  on public.vip_control_pagos (member_id, paid_at desc);
create index if not exists vip_control_comunicaciones_member_date_idx
  on public.vip_control_comunicaciones (member_id, created_at desc);

alter table public.vip_control_membresias enable row level security;
alter table public.vip_control_pagos enable row level security;
alter table public.vip_control_comunicaciones enable row level security;

revoke all on table public.vip_control_membresias from anon;
revoke all on table public.vip_control_pagos from anon;
revoke all on table public.vip_control_comunicaciones from anon;

grant select, insert, update, delete on table public.vip_control_membresias to authenticated;
grant select, insert, update, delete on table public.vip_control_pagos to authenticated;
grant select, insert, update, delete on table public.vip_control_comunicaciones to authenticated;
grant usage, select on sequence public.vip_control_pagos_id_seq to authenticated;
grant usage, select on sequence public.vip_control_comunicaciones_id_seq to authenticated;

drop policy if exists "v163_admin_control_membresias" on public.vip_control_membresias;
create policy "v163_admin_control_membresias"
on public.vip_control_membresias
for all
to authenticated
using ((select public.es_admin()) is true)
with check ((select public.es_admin()) is true);

drop policy if exists "v163_admin_control_pagos" on public.vip_control_pagos;
create policy "v163_admin_control_pagos"
on public.vip_control_pagos
for all
to authenticated
using ((select public.es_admin()) is true)
with check ((select public.es_admin()) is true);

drop policy if exists "v163_admin_control_comunicaciones" on public.vip_control_comunicaciones;
create policy "v163_admin_control_comunicaciones"
on public.vip_control_comunicaciones
for all
to authenticated
using ((select public.es_admin()) is true)
with check ((select public.es_admin()) is true);

comment on table public.vip_control_membresias is
  'Control administrativo V163: precio fundador, renovación, gracia y estado por miembro.';
comment on table public.vip_control_pagos is
  'Historial administrativo de pagos manuales confirmados desde V163.';
comment on table public.vip_control_comunicaciones is
  'Historial administrativo de mensajes preparados o copiados desde V163.';

commit;

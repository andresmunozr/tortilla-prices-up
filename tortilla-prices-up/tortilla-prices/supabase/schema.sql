-- Ejecutar en Supabase → SQL Editor
create table if not exists public.tortilla_prices (
  id                  bigint primary key,
  state               text    not null,
  city                text    not null,
  year                int     not null,
  month               int     not null check (month between 1 and 12),
  day                 int     not null,
  store_type          text    not null check (store_type in ('Mom and Pop Store', 'Big Retail Store')),
  price_per_kilogram  numeric
);
create index if not exists tortilla_prices_state_idx on public.tortilla_prices (state, id);

-- Acceso con la clave anónima (igual que el repo students). Ajusta si necesitas más control.
alter table public.tortilla_prices enable row level security;
create policy "anon all" on public.tortilla_prices for all using (true) with check (true);

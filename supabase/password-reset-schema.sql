begin;

-- One-time password reset tokens (store hashes only).
-- Run once in the Supabase SQL editor after auth-schema.sql.

create table if not exists public.password_reset_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users (id) on delete cascade,
  token_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  constraint password_reset_tokens_hash_chk check (char_length(token_hash) >= 32)
);

create unique index if not exists password_reset_tokens_hash_key
  on public.password_reset_tokens (token_hash);

create index if not exists password_reset_tokens_user_idx
  on public.password_reset_tokens (user_id);

alter table public.password_reset_tokens enable row level security;
revoke all on public.password_reset_tokens from anon, authenticated;
grant select, insert, update, delete on public.password_reset_tokens to service_role;

notify pgrst, 'reload schema';
commit;

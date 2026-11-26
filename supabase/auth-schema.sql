begin;

-- Intrisal account holders (password and/or Google). Passwords are scrypt hashes only.
create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) >= 1),
  email text not null,
  auth_provider text not null default 'password'
    check (auth_provider in ('password', 'google')),
  password_hash text,
  google_sub text,
  hear_about text,
  hear_about_other text,
  created_at timestamptz not null default now(),
  constraint app_users_email_lower_chk check (email = lower(email)),
  constraint app_users_password_chk check (
    (auth_provider = 'password' and password_hash is not null)
    or (auth_provider = 'google' and password_hash is null)
  ),
  constraint app_users_google_sub_chk check (
    (auth_provider = 'google' and google_sub is not null)
    or (auth_provider = 'password' and google_sub is null)
  ),
  constraint app_users_hear_chk check (
    (
      auth_provider = 'google'
      and hear_about is null
      and hear_about_other is null
    )
    or (
      auth_provider = 'password'
      and hear_about in ('social_media', 'friends_family', 'other')
      and (
        (hear_about <> 'other' and hear_about_other is null)
        or (hear_about = 'other' and hear_about_other is not null and char_length(trim(hear_about_other)) >= 1)
      )
    )
  )
);

create unique index if not exists app_users_email_key on public.app_users (email);
create unique index if not exists app_users_google_sub_key on public.app_users (google_sub)
  where google_sub is not null;

alter table public.app_users enable row level security;
revoke all on public.app_users from anon, authenticated;
grant select, insert, update on public.app_users to service_role;

notify pgrst, 'reload schema';
commit;

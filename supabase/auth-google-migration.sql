begin;

-- Run once in the Supabase SQL editor if app_users already exists from the earlier schema.

alter table public.app_users
  add column if not exists auth_provider text,
  add column if not exists google_sub text;

update public.app_users
set auth_provider = 'password'
where auth_provider is null;

alter table public.app_users
  alter column auth_provider set default 'password',
  alter column auth_provider set not null;

alter table public.app_users
  alter column password_hash drop not null;

alter table public.app_users
  alter column hear_about drop not null;

-- Replace older check constraints with provider-aware ones.
alter table public.app_users drop constraint if exists app_users_other_detail_chk;
alter table public.app_users drop constraint if exists app_users_password_chk;
alter table public.app_users drop constraint if exists app_users_google_sub_chk;
alter table public.app_users drop constraint if exists app_users_hear_chk;
alter table public.app_users drop constraint if exists app_users_auth_provider_chk;

alter table public.app_users
  add constraint app_users_auth_provider_chk
    check (auth_provider in ('password', 'google')),
  add constraint app_users_password_chk check (
    (auth_provider = 'password' and password_hash is not null)
    or (auth_provider = 'google' and password_hash is null)
  ),
  add constraint app_users_google_sub_chk check (
    (auth_provider = 'google' and google_sub is not null)
    or (auth_provider = 'password' and google_sub is null)
  ),
  add constraint app_users_hear_chk check (
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
  );

create unique index if not exists app_users_google_sub_key on public.app_users (google_sub)
  where google_sub is not null;

notify pgrst, 'reload schema';
commit;

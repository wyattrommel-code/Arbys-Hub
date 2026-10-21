begin;

-- Hub sessions are verified by the server. Browsers do not access this table
-- directly; the resource API enforces store, role, and visibility on every call.
create table public.hub_resources (
  id uuid primary key default gen_random_uuid(),
  store_id text not null check (length(btrim(store_id)) > 0),
  title text not null check (length(btrim(title)) between 1 and 160),
  category text not null check (category in ('equipment', 'learner_hub', 'sops', 'training', 'other')),
  summary text not null default '' check (length(summary) <= 500),
  notes text not null default '' check (length(notes) <= 30000),
  url text not null default '' check (length(url) <= 2000 and (url = '' or url ~* '^https?://')),
  visibility text not null default 'team' check (visibility in ('team', 'managers')),
  pinned boolean not null default false,
  archived boolean not null default false,
  object_path text,
  file_name text,
  file_size bigint,
  mime_type text,
  version integer not null default 1 check (version > 0),
  created_by text not null,
  updated_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hub_resources_content_required check (
    length(btrim(summary)) > 0 or length(btrim(notes)) > 0 or url <> '' or object_path is not null
  ),
  constraint hub_resources_attachment_complete check (
    (object_path is null and file_name is null and file_size is null and mime_type is null)
    or (object_path is not null and file_name is not null and mime_type is not null
      and file_size is not null and file_size between 1 and 4194304
      and object_path like store_id || '/' || id::text || '/%')
  )
);

create index hub_resources_store_library_idx on public.hub_resources (store_id, archived, pinned desc, updated_at desc);

alter table public.hub_resources enable row level security;
revoke all on table public.hub_resources from public, anon, authenticated;
grant select, insert, update, delete on table public.hub_resources to service_role;

-- No public Storage policies: all uploads use the server client; downloads
-- receive a short-lived signed URL after checking the resource's permissions.
-- A restrictive policy also blocks this bucket if an older permissive policy
-- grants access across all buckets. Other buckets keep their existing rules.
create policy hub_resources_server_only on storage.objects
  as restrictive for all to anon, authenticated
  using (bucket_id <> 'hub-resources')
  with check (bucket_id <> 'hub-resources');

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'hub-resources', 'hub-resources', false, 4194304,
  array[
    'application/pdf', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain', 'text/csv', 'image/jpeg', 'image/png', 'image/webp'
  ]::text[]
);

commit;

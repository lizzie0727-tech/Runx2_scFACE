-- Run once in Supabase SQL Editor. The papers table is visible only to signed-in users.
create extension if not exists pgcrypto;
create table if not exists public.papers (
  id uuid primary key default gen_random_uuid(),
  source_key text unique not null,
  doi text unique,
  pmid text unique,
  title text not null,
  authors text not null default '',
  journal text not null default '',
  publication_year text not null default '',
  url text not null default '',
  topic text not null default 'Other',
  figures text not null default '',
  methods text not null default '',
  key_finding text not null default '',
  runx2_value text not null default '',
  figure_cards jsonb not null default '[]'::jsonb,
  stars smallint not null default 3 check (stars between 1 and 5),
  verification_status text not null default 'paper_confirmed_figure_pending'
    check (verification_status in ('original_figures_checked','paper_confirmed_figure_pending','historical_metadata_unverified')),
  provenance text not null default 'atlas_v4_6',
  added_at timestamptz not null default now()
);
create table if not exists public.reading_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  paper_id uuid not null references public.papers(id) on delete cascade,
  status text not null default 'unread' check (status in ('unread','reading','read')),
  notes text not null default '',
  updated_at timestamptz not null default now(),
  primary key (user_id,paper_id)
);
create index if not exists papers_added_idx on public.papers(added_at desc);
create index if not exists progress_user_idx on public.reading_progress(user_id);
alter table public.papers enable row level security;
alter table public.reading_progress enable row level security;
revoke all on public.papers from anon;
revoke all on public.reading_progress from anon;
grant select on public.papers to authenticated;
grant select,insert,update,delete on public.reading_progress to authenticated;
drop policy if exists "authenticated read papers" on public.papers;
create policy "authenticated read papers" on public.papers for select to authenticated using (true);
drop policy if exists "own progress select" on public.reading_progress;
create policy "own progress select" on public.reading_progress for select to authenticated using ((select auth.uid())=user_id);
drop policy if exists "own progress insert" on public.reading_progress;
create policy "own progress insert" on public.reading_progress for insert to authenticated with check ((select auth.uid())=user_id);
drop policy if exists "own progress update" on public.reading_progress;
create policy "own progress update" on public.reading_progress for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
drop policy if exists "own progress delete" on public.reading_progress;
create policy "own progress delete" on public.reading_progress for delete to authenticated using ((select auth.uid())=user_id);
-- For a truly private *single-person* library, set Supabase Auth > Sign In / Providers > Email > disable signups,
-- then invite/create only your account. Do not rely on the login page alone to restrict registrations.
-- Private PDF bucket; object name is <auth.uid()>/<paper uuid>/<filename>.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('paper-pdfs','paper-pdfs',false,26214400,array['application/pdf'])
on conflict(id) do update set public=false;
drop policy if exists "own pdf read" on storage.objects;
create policy "own pdf read" on storage.objects for select to authenticated
 using (bucket_id='paper-pdfs' and (storage.foldername(name))[1]=(select auth.uid())::text);
drop policy if exists "own pdf upload" on storage.objects;
create policy "own pdf upload" on storage.objects for insert to authenticated
 with check (bucket_id='paper-pdfs' and (storage.foldername(name))[1]=(select auth.uid())::text);
drop policy if exists "own pdf delete" on storage.objects;
create policy "own pdf delete" on storage.objects for delete to authenticated
 using (bucket_id='paper-pdfs' and (storage.foldername(name))[1]=(select auth.uid())::text);

-- JobPilot Global v2 — core schema (Spec sections 3-4)
create extension if not exists vector;

create table profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text, phone text, country text,
  resume_text text, resume_file_url text,
  resume_embedding vector(1536),
  target_roles text[] default '{}',
  target_countries text[] default '{}',
  open_to_remote boolean default true,
  work_authorization jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create table ats_boards (
  id bigint generated always as identity primary key,
  company text not null, ats_type text not null
    check (ats_type in ('greenhouse','lever','ashby','smartrecruiters','workable','other')),
  slug text not null, careers_url text,
  active boolean default true, last_polled_at timestamptz,
  unique (ats_type, slug)
);

create table jobs (
  id bigint generated always as identity primary key,
  board_id bigint references ats_boards(id),
  source text not null, external_id text,
  title text not null, company text not null,
  location text, remote_type text default 'unknown',
  visa_signal text default 'unknown',
  scam_score int default 0,
  currency text, ctc_range text,
  jd_text text, jd_embedding vector(1536),
  apply_url text not null, posted_at timestamptz, scraped_at timestamptz default now(),
  active boolean default true,
  unique (source, external_id)
);
create index jobs_active_posted on jobs (active, posted_at desc);

create table match_scores (
  user_id uuid references profiles(user_id) on delete cascade,
  job_id bigint references jobs(id) on delete cascade,
  score int check (score between 0 and 100),
  verdict text, gaps jsonb,
  created_at timestamptz default now(),
  primary key (user_id, job_id)
);

create table application_kits (
  id bigint generated always as identity primary key,
  user_id uuid references profiles(user_id) on delete cascade,
  job_id bigint references jobs(id) on delete cascade,
  bullets jsonb, cover_letter text, screening_answers jsonb, keywords jsonb,
  created_at timestamptz default now(),
  unique (user_id, job_id)
);

create table applications (
  id bigint generated always as identity primary key,
  user_id uuid references profiles(user_id) on delete cascade,
  job_id bigint references jobs(id),
  kit_id bigint references application_kits(id),
  ats_type text, portal text,
  status text default 'draft',
  submitted_at timestamptz, last_nudge_at timestamptz,
  created_at timestamptz default now()
);

create table subscriptions (
  user_id uuid primary key references profiles(user_id) on delete cascade,
  plan text default 'free',
  credits_remaining int default 15,
  provider text, provider_sub_id text, renews_at timestamptz
);

create table funnel_events (
  id bigint generated always as identity primary key,
  user_id uuid, event text not null, payload jsonb,
  created_at timestamptz default now()
);

create table selector_maps (
  ats_type text primary key, version int default 1,
  map jsonb not null, updated_at timestamptz default now()
);

alter table profiles enable row level security;
alter table match_scores enable row level security;
alter table application_kits enable row level security;
alter table applications enable row level security;
alter table subscriptions enable row level security;
alter table funnel_events enable row level security;
alter table jobs enable row level security;
alter table ats_boards enable row level security;
alter table selector_maps enable row level security;

create policy "own profile" on profiles for all using (auth.uid() = user_id);
create policy "own scores" on match_scores for select using (auth.uid() = user_id);
create policy "own kits" on application_kits for all using (auth.uid() = user_id);
create policy "own apps" on applications for all using (auth.uid() = user_id);
create policy "own sub" on subscriptions for select using (auth.uid() = user_id);
create policy "own events" on funnel_events for insert with check (auth.uid() = user_id);
create policy "jobs readable" on jobs for select using (true);
create policy "boards readable" on ats_boards for select using (true);
create policy "maps readable" on selector_maps for select using (true);

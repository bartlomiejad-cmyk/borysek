
create type public.main_image_rule as enum ('ONLY_A','A_AND_B_EXISTING','COMPOSITE_A_AND_B');

create table public.media_technical_settings (
  project_id uuid primary key references public.projects(id) on delete cascade,
  component_a text not null default '',
  component_b text,
  main_image_rule public.main_image_rule not null default 'ONLY_A',
  target_resolution int not null default 2560 check (target_resolution between 512 and 4096),
  padding_percent  int not null default 70  check (padding_percent  between 30 and 95),
  max_gallery_images int not null default 5 check (max_gallery_images between 0 and 12),
  apply_shadow boolean not null default true,
  custom_style_prompt text,
  updated_at timestamptz not null default now()
);

alter table public.media_technical_settings enable row level security;

create policy "mts via project" on public.media_technical_settings
  for all using (exists (select 1 from public.projects p
    where p.id = media_technical_settings.project_id and p.user_id = auth.uid()))
  with check (exists (select 1 from public.projects p
    where p.id = media_technical_settings.project_id and p.user_id = auth.uid()));

create trigger touch_mts before update on public.media_technical_settings
  for each row execute function public.touch_updated_at();

alter table public.enrichments
  add column if not exists ai_gallery_urls jsonb not null default '[]'::jsonb,
  add column if not exists media_classification jsonb not null default '{}'::jsonb;

-- Cover foreign keys reported by Supabase performance advisor.

create index if not exists idx_label_campaigns_song_id on public.label_campaigns(song_id);
create index if not exists idx_label_content_campaign_id on public.label_content(campaign_id);
create index if not exists idx_label_content_song_id on public.label_content(song_id);
create index if not exists idx_social_reports_top_post_id on public.social_reports(top_post_id);

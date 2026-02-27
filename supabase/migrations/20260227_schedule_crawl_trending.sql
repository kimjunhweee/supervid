SELECT cron.schedule(
  'crawl-trending-daily',
  '0 0 * * *',
  $$SELECT net.http_post(
    url:='https://vnbzejgxskzzhtintbgb.supabase.co/functions/v1/crawl-trending',
    headers:='{"Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZuYnplamd4c2t6emh0aW50YmdiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTU5MTI5NSwiZXhwIjoyMDg3MTY3Mjk1fQ.Zgk5XJzZigPgJiboJ7AkRhkdbijwwvoTWXDL7EYQpfQ","Content-Type":"application/json"}'::jsonb,
    body:='{}'::jsonb
  );$$
);

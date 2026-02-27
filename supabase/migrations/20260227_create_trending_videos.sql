CREATE TABLE IF NOT EXISTS trending_videos (
  id TEXT NOT NULL,
  title TEXT,
  channel_id TEXT,
  channel_title TEXT,
  subscriber_count BIGINT DEFAULT 0,
  view_count BIGINT DEFAULT 0,
  like_count BIGINT DEFAULT 0,
  comment_count BIGINT DEFAULT 0,
  published_at TIMESTAMPTZ,
  thumbnail TEXT,
  duration TEXT,
  duration_seconds INT DEFAULT 0,
  region_code TEXT DEFAULT 'KR',
  rank INT,
  crawled_date DATE NOT NULL DEFAULT CURRENT_DATE,
  PRIMARY KEY (id, crawled_date)
);

CREATE INDEX idx_trending_crawled_date ON trending_videos (crawled_date DESC);

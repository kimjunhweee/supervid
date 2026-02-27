-- 영상 upsert 시 keywords 배열을 덮어쓰지 않고 병합하는 트리거
CREATE OR REPLACE FUNCTION merge_video_keywords()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.keywords IS NOT NULL THEN
    NEW.keywords = ARRAY(SELECT DISTINCT unnest(array_cat(OLD.keywords, NEW.keywords)));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_merge_keywords
BEFORE UPDATE ON videos
FOR EACH ROW
EXECUTE FUNCTION merge_video_keywords();

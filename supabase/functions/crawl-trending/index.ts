import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const YOUTUBE_API_KEY = Deno.env.get('YOUTUBE_API_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ISO 8601 duration → 초 변환 (PT4M30S → 270)
function parseDuration(iso: string): number {
  if (!iso) return 0;
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (parseInt(m[1] || '0') * 3600) + (parseInt(m[2] || '0') * 60) + parseInt(m[3] || '0');
}

Deno.serve(async () => {
  try {
    const regionCode = 'KR';

    // 1. YouTube 인기급상승 영상 50개 조회
    const videosRes = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet,contentDetails&chart=mostPopular&regionCode=${regionCode}&maxResults=50&key=${YOUTUBE_API_KEY}`
    );
    const videosData = await videosRes.json();

    if (!videosData.items || videosData.items.length === 0) {
      return new Response(JSON.stringify({ collected: 0 }), { status: 200 });
    }

    // 2. 채널 구독자 수 일괄 조회
    const uniqueChannelIds = [...new Set(videosData.items.map((v: any) => v.snippet.channelId))] as string[];
    const channelMap: Record<string, number> = {};

    for (let i = 0; i < uniqueChannelIds.length; i += 50) {
      const chunk = uniqueChannelIds.slice(i, i + 50).join(',');
      const channelRes = await fetch(
        `https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${chunk}&key=${YOUTUBE_API_KEY}`
      );
      const channelData = await channelRes.json();
      for (const ch of (channelData.items || [])) {
        channelMap[ch.id] = parseInt(ch.statistics.subscriberCount) || 0;
      }
    }

    // 3. 데이터 가공
    const today = new Date().toISOString().slice(0, 10);
    const videos = videosData.items.map((v: any, idx: number) => {
      const duration = v.contentDetails?.duration || '';
      return {
        id: v.id,
        title: v.snippet.title,
        channel_id: v.snippet.channelId,
        channel_title: v.snippet.channelTitle,
        subscriber_count: channelMap[v.snippet.channelId] || 0,
        view_count: parseInt(v.statistics.viewCount) || 0,
        like_count: parseInt(v.statistics.likeCount) || 0,
        comment_count: parseInt(v.statistics.commentCount) || 0,
        published_at: v.snippet.publishedAt,
        thumbnail: v.snippet.thumbnails?.high?.url || v.snippet.thumbnails?.default?.url,
        duration,
        duration_seconds: parseDuration(duration),
        region_code: regionCode,
        rank: idx + 1,
        crawled_date: today,
      };
    });

    // 4. Supabase에 upsert
    const { error: upsertError } = await supabase
      .from('trending_videos')
      .upsert(videos, { onConflict: 'id,crawled_date', ignoreDuplicates: false });

    if (upsertError) {
      console.error('[crawl-trending] upsert error:', upsertError);
      return new Response(JSON.stringify({ error: upsertError.message }), { status: 500 });
    }

    console.log(`[crawl-trending] 완료: ${videos.length}개 저장 (${today})`);
    return new Response(JSON.stringify({ collected: videos.length, date: today }), { status: 200 });

  } catch (err) {
    console.error('[crawl-trending] error:', err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});

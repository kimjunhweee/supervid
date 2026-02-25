import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const YOUTUBE_API_KEY = Deno.env.get('YOUTUBE_API_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

Deno.serve(async () => {
  try {
    // 1. 가장 오래 전에 수집된 키워드 선택
    const { data: keywordRow, error: kwError } = await supabase
      .from('keywords')
      .select('*')
      .order('last_crawled_at', { ascending: true, nullsFirst: true })
      .limit(1)
      .single();

    if (kwError || !keywordRow) {
      return new Response(JSON.stringify({ error: 'No keywords found' }), { status: 500 });
    }

    const keyword = keywordRow.keyword;
    console.log(`[crawl] 키워드: ${keyword}`);

    // 2. YouTube Search API 호출
    const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(keyword)}&type=video&maxResults=50&key=${YOUTUBE_API_KEY}`;
    const searchRes = await fetch(searchUrl);
    const searchData = await searchRes.json();

    if (!searchData.items || searchData.items.length === 0) {
      return new Response(JSON.stringify({ keyword, collected: 0 }), { status: 200 });
    }

    const videoIds = searchData.items.map((item: any) => item.id.videoId).join(',');

    // 3. 영상 통계 + 채널 ID 조회
    const statsUrl = `https://www.googleapis.com/youtube/v3/videos?part=statistics,contentDetails,snippet&id=${videoIds}&key=${YOUTUBE_API_KEY}`;
    const statsRes = await fetch(statsUrl);
    const statsData = await statsRes.json();

    if (!statsData.items) {
      return new Response(JSON.stringify({ keyword, collected: 0 }), { status: 200 });
    }

    // 4. 채널 구독자 수 조회
    const channelIds = [...new Set(statsData.items.map((v: any) => v.snippet.channelId))].join(',');
    const channelUrl = `https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${channelIds}&key=${YOUTUBE_API_KEY}`;
    const channelRes = await fetch(channelUrl);
    const channelData = await channelRes.json();

    const channelMap: Record<string, number> = {};
    for (const ch of (channelData.items || [])) {
      channelMap[ch.id] = parseInt(ch.statistics.subscriberCount) || 0;
    }

    // ISO 8601 duration → 초 변환 (PT4M30S → 270)
    function parseDuration(iso: string): number {
      if (!iso) return 0;
      const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
      if (!m) return 0;
      return (parseInt(m[1] || '0') * 3600) + (parseInt(m[2] || '0') * 60) + parseInt(m[3] || '0');
    }

    // 5. 데이터 가공
    const videos = statsData.items.map((v: any) => {
      const viewCount = parseInt(v.statistics.viewCount) || 0;
      const subscriberCount = channelMap[v.snippet.channelId] || 0;
      const duration = v.contentDetails?.duration || '';
      return {
        id: v.id,
        title: v.snippet.title,
        channel_id: v.snippet.channelId,
        channel_title: v.snippet.channelTitle,
        subscriber_count: subscriberCount,
        view_count: viewCount,
        like_count: parseInt(v.statistics.likeCount) || 0,
        comment_count: parseInt(v.statistics.commentCount) || 0,
        published_at: v.snippet.publishedAt,
        thumbnail: v.snippet.thumbnails?.high?.url || v.snippet.thumbnails?.default?.url,
        duration,
        duration_seconds: parseDuration(duration),
        view_to_sub_ratio: subscriberCount > 0 ? Math.round(viewCount / subscriberCount) : 0,
        keywords: [keyword],
        crawled_at: new Date().toISOString(),
      };
    });

    // 6. Supabase에 upsert
    const { error: upsertError } = await supabase
      .from('videos')
      .upsert(videos, { onConflict: 'id', ignoreDuplicates: false });

    if (upsertError) {
      console.error('[crawl] upsert error:', upsertError);
      return new Response(JSON.stringify({ error: upsertError.message }), { status: 500 });
    }

    // 7. 키워드 수집 시간 업데이트
    await supabase
      .from('keywords')
      .update({ last_crawled_at: new Date().toISOString(), video_count: videos.length })
      .eq('id', keywordRow.id);

    console.log(`[crawl] 완료: ${keyword} (${videos.length}개)`);
    return new Response(JSON.stringify({ keyword, collected: videos.length }), { status: 200 });

  } catch (err) {
    console.error('[crawl] error:', err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});

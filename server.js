const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const { createClient } = require('@supabase/supabase-js');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

// ===== Supabase 초기화 =====
let supabase = null;
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY,
        { auth: { persistSession: false } }
    );
    console.log('Supabase 연결됨');
} else {
    console.log('Supabase 환경변수 없음 — DB 저장 비활성화 (localStorage 모드)');
}

async function ensureUser(user) {
    if (!supabase) return;
    const { error } = await supabase
        .from('user_data')
        .upsert(
            { google_id: user.id, email: user.email, name: user.name },
            { onConflict: 'google_id', ignoreDuplicates: true }
        );
    if (error) console.error('ensureUser 오류:', error.message);
    // 접속할 때마다 last_login_at 갱신
    await supabase
        .from('user_data')
        .update({ last_login_at: new Date().toISOString() })
        .eq('google_id', user.id);
}

// ===== Supabase 캐시 헬퍼 =====
const CACHE_TTL = 30 * 60 * 1000;
const TRENDING_CACHE_TTL = 2 * 60 * 60 * 1000;
const SUGGEST_CACHE_TTL = 24 * 60 * 60 * 1000;
const CH_AVG_CACHE_TTL = 2 * 60 * 60 * 1000;

async function getCached(key) {
    if (!supabase) return null;
    try {
        const { data } = await supabase
            .from('api_cache')
            .select('data, expires_at')
            .eq('key', key)
            .single();
        if (!data) return null;
        if (new Date(data.expires_at) < new Date()) return null;
        return data.data;
    } catch { return null; }
}

async function setCache(key, value, ttlMs = CACHE_TTL) {
    if (!supabase) return;
    try {
        const expires_at = new Date(Date.now() + ttlMs).toISOString();
        await supabase
            .from('api_cache')
            .upsert({ key, data: value, expires_at }, { onConflict: 'key' });
    } catch { /* ignore */ }
}

// ===== Express 앱 =====
const app = express();

const ALLOWED_ORIGINS = [
    'http://localhost:3000',
    'https://supervid.vercel.app'
];
app.use(cors({
    origin: (origin, callback) => {
        if (!origin || ALLOWED_ORIGINS.includes(origin)) callback(null, true);
        else callback(new Error('CORS 차단: ' + origin));
    },
    credentials: true
}));

// ===== Rate Limiting =====
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15분
    max: 20,
    message: { error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
    standardHeaders: true,
    legacyHeaders: false
});

const apiLimiter = rateLimit({
    windowMs: 60 * 1000, // 1분
    max: 60,
    message: { error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
    standardHeaders: true,
    legacyHeaders: false
});

app.use('/api/auth', authLimiter);
app.use('/api/youtube', apiLimiter);

app.use(express.json());
app.use(cookieParser());
app.use(express.static('.'));

const JWT_SECRET = process.env.JWT_SECRET || 'supervid-jwt-fallback-secret';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);
const API_KEY = process.env.YOUTUBE_API_KEY;

const COOKIE_OPTS = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000
};

// ===== API 사용량 추적 =====
const API_DAILY_LIMIT = 10000;
const apiUsage = { date: '', units: 0, breakdown: {} };

async function trackUnits(category, units) {
    const today = new Date().toISOString().slice(0, 10);

    // 인메모리 업데이트 (기존 로직 유지)
    if (apiUsage.date !== today) {
        apiUsage.date = today;
        apiUsage.units = 0;
        apiUsage.breakdown = {};
    }
    apiUsage.units += units;
    apiUsage.breakdown[category] = (apiUsage.breakdown[category] || 0) + units;

    // Supabase 영속화
    if (!supabase) return;
    const key = `api_usage|${today}`;
    try {
        const cached = await getCached(key);
        const current = cached || { units: 0, breakdown: {} };
        current.units += units;
        current.breakdown[category] = (current.breakdown[category] || 0) + units;
        await setCache(key, current, 48 * 60 * 60 * 1000);
    } catch { /* 실패해도 인메모리에는 기록됨 */ }
}

// ===== 인증 라우트 =====

app.get('/api/config', (req, res) => {
    res.json({ googleClientId: GOOGLE_CLIENT_ID });
});

app.post('/api/auth/google', async (req, res) => {
    const { credential } = req.body;
    if (!credential) return res.status(400).json({ error: '토큰이 필요합니다' });

    try {
        const ticket = await googleClient.verifyIdToken({
            idToken: credential,
            audience: GOOGLE_CLIENT_ID
        });
        const payload = ticket.getPayload();
        const user = {
            id: payload.sub,
            email: payload.email,
            name: payload.name,
            picture: payload.picture
        };

        await ensureUser(user);
        const token = jwt.sign(user, JWT_SECRET, { expiresIn: '7d' });
        res.cookie('auth_token', token, COOKIE_OPTS);
        res.json({ user });
    } catch (err) {
        res.status(401).json({ error: '토큰 검증 실패: ' + err.message });
    }
});

app.get('/api/auth/me', async (req, res) => {
    const token = req.cookies.auth_token;
    if (!token) return res.status(401).json({ error: '로그인이 필요합니다' });
    try {
        const user = jwt.verify(token, JWT_SECRET);
        await ensureUser(user);
        res.json({ user });
    } catch {
        res.status(401).json({ error: '로그인이 필요합니다' });
    }
});

app.post('/api/auth/logout', (req, res) => {
    res.clearCookie('auth_token');
    res.json({ success: true });
});

// ===== 인증 미들웨어 =====
function requireAuth(req, res, next) {
    const token = req.cookies.auth_token;
    if (!token) return res.status(401).json({ error: '로그인이 필요합니다' });
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch {
        res.status(401).json({ error: '로그인이 필요합니다' });
    }
}

// ===== 사용자 데이터 저장/로드 =====

app.get('/api/data', requireAuth, async (req, res) => {
    if (!supabase) return res.json({ noDb: true });

    const { data, error } = await supabase
        .from('user_data')
        .select('contents, refs, ref_folders, upload_goal, weekly_goal, yt_channel, updated_at')
        .eq('google_id', req.user.id)
        .single();

    if (error) {
        if (error.code === 'PGRST116') return res.json(null);
        return res.status(500).json({ error: error.message });
    }
    res.json(data);
});

app.put('/api/data', requireAuth, async (req, res) => {
    if (!supabase) return res.json({ noDb: true });

    const allowed = ['contents', 'refs', 'ref_folders', 'upload_goal', 'weekly_goal', 'yt_channel'];
    const patch = {};
    for (const key of allowed) {
        if (req.body[key] !== undefined) patch[key] = req.body[key];
    }

    if (Object.keys(patch).length === 0) return res.status(400).json({ error: '변경할 데이터가 없습니다' });

    patch.google_id = req.user.id;
    patch.updated_at = new Date().toISOString();

    const { error } = await supabase
        .from('user_data')
        .upsert(patch, { onConflict: 'google_id' });

    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
});

// ===== API 사용량 조회 =====
app.get('/api/youtube/usage', requireAuth, async (req, res) => {
    const today = new Date().toISOString().slice(0, 10);

    // Supabase에서 영속화된 사용량 조회
    if (supabase) {
        try {
            const cached = await getCached(`api_usage|${today}`);
            if (cached) {
                return res.json({
                    date: today,
                    used: cached.units,
                    limit: API_DAILY_LIMIT,
                    remaining: Math.max(0, API_DAILY_LIMIT - cached.units),
                    breakdown: cached.breakdown
                });
            }
        } catch { /* Supabase 실패 시 인메모리 폴백 */ }
    }

    // 인메모리 폴백
    if (apiUsage.date !== today) {
        apiUsage.date = today;
        apiUsage.units = 0;
        apiUsage.breakdown = {};
    }
    res.json({
        date: apiUsage.date,
        used: apiUsage.units,
        limit: API_DAILY_LIMIT,
        remaining: Math.max(0, API_DAILY_LIMIT - apiUsage.units),
        breakdown: apiUsage.breakdown
    });
});

// ===== 채널 통계 =====
app.get('/api/youtube/channel', requireAuth, async (req, res) => {
    const { channelId } = req.query;
    if (!channelId) return res.status(400).json({ error: 'channelId가 필요합니다' });

    const cacheKey = `channel:${channelId}`;
    if (!req.query.refresh) {
        const cached = await getCached(cacheKey);
        if (cached) return res.json(cached);
    }

    try {
        const response = await fetch(
            `https://www.googleapis.com/youtube/v3/channels?part=statistics,snippet&id=${encodeURIComponent(channelId)}&key=${API_KEY}`
        );
        trackUnits('채널 조회', 1);
        const data = await response.json();

        if (data.error) return res.status(400).json({ error: data.error.message });
        if (!data.items || data.items.length === 0) return res.status(404).json({ error: '채널을 찾을 수 없습니다' });

        const channel = data.items[0];
        const result = {
            title: channel.snippet.title,
            thumbnail: channel.snippet.thumbnails.default.url,
            subscriberCount: parseInt(channel.statistics.subscriberCount),
            viewCount: parseInt(channel.statistics.viewCount),
            videoCount: parseInt(channel.statistics.videoCount)
        };
        await setCache(cacheKey, result, CH_AVG_CACHE_TTL); // 2시간
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ===== 최근 영상 목록 =====
const VIDEOS_CACHE_TTL = 60 * 60 * 1000; // 1시간

app.get('/api/youtube/videos', requireAuth, async (req, res) => {
    const { channelId } = req.query;
    if (!channelId) return res.status(400).json({ error: 'channelId가 필요합니다' });

    const cacheKey = `videos:${channelId}`;
    if (!req.query.refresh) {
        const cached = await getCached(cacheKey);
        if (cached) return res.json(cached);
    }

    try {
        const channelRes = await fetch(
            `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${encodeURIComponent(channelId)}&key=${API_KEY}`
        );
        trackUnits('채널 조회', 1);
        const channelData = await channelRes.json();

        if (!channelData.items || channelData.items.length === 0) {
            return res.status(404).json({ error: '채널을 찾을 수 없습니다' });
        }

        const uploadsPlaylistId = channelData.items[0].contentDetails.relatedPlaylists.uploads;

        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
        const cutoff = sixMonthsAgo.toISOString();

        let allPlaylistItems = [];
        let pageToken = '';
        let done = false;

        for (let page = 0; page < 4 && !done; page++) {
            const tokenParam = pageToken ? `&pageToken=${pageToken}` : '';
            const playlistRes = await fetch(
                `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${uploadsPlaylistId}&maxResults=50${tokenParam}&key=${API_KEY}`
            );
            trackUnits('영상 목록', 1);
            const playlistData = await playlistRes.json();

            if (!playlistData.items || playlistData.items.length === 0) break;

            for (const item of playlistData.items) {
                if (item.snippet.publishedAt < cutoff) { done = true; break; }
                allPlaylistItems.push(item);
            }

            pageToken = playlistData.nextPageToken || '';
            if (!pageToken) break;
        }

        if (allPlaylistItems.length === 0) return res.json([]);

        let allVideos = [];
        for (let i = 0; i < allPlaylistItems.length; i += 50) {
            const chunk = allPlaylistItems.slice(i, i + 50);
            const videoIds = chunk.map(item => item.snippet.resourceId.videoId).join(',');
            const videosRes = await fetch(
                `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet,contentDetails&id=${videoIds}&key=${API_KEY}`
            );
            trackUnits('영상 통계', 1);
            const videosData = await videosRes.json();
            if (videosData.items) allVideos.push(...videosData.items);
        }

        const videos = allVideos.map(v => ({
            id: v.id,
            title: v.snippet.title,
            thumbnail: v.snippet.thumbnails.medium.url,
            publishedAt: v.snippet.publishedAt,
            viewCount: parseInt(v.statistics.viewCount || 0),
            likeCount: parseInt(v.statistics.likeCount || 0),
            commentCount: parseInt(v.statistics.commentCount || 0),
            duration: v.contentDetails ? v.contentDetails.duration : null
        }));

        await setCache(cacheKey, videos, VIDEOS_CACHE_TTL); // 1시간
        res.json(videos);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ===== YouTube 검색 =====
app.get('/api/youtube/search', requireAuth, async (req, res) => {
    const { q, order = 'viewCount', maxResults = '12', videoDuration, pages = '1', pageToken: inputPageToken } = req.query;
    if (!q || !q.trim()) return res.status(400).json({ error: '검색어(q)가 필요합니다' });

    const pageCount = Math.min(Math.max(parseInt(pages) || 1, 1), 3);
    const perPage = Math.min(parseInt(maxResults) || 12, 50);

    const cacheKey = `search|${q}|${order}|${perPage}|${videoDuration || ''}|${pageCount}|${inputPageToken || ''}`;
    const cached = await getCached(cacheKey);
    if (cached) return res.json(cached);

    try {
        const durationParam = videoDuration ? `&videoDuration=${encodeURIComponent(videoDuration)}` : '';
        let allSearchItems = [];
        let pageToken = inputPageToken || '';

        for (let p = 0; p < pageCount; p++) {
            const tokenParam = pageToken ? `&pageToken=${pageToken}` : '';
            const searchRes = await fetch(
                `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&q=${encodeURIComponent(q)}&order=${encodeURIComponent(order)}&maxResults=${perPage}${durationParam}${tokenParam}&key=${API_KEY}`
            );
            trackUnits('콘텐츠 검색', 100);
            const searchData = await searchRes.json();
            if (searchData.error) return res.status(400).json({ error: searchData.error.message });
            if (!searchData.items || searchData.items.length === 0) break;

            allSearchItems.push(...searchData.items);
            pageToken = searchData.nextPageToken || '';
            if (!pageToken) break;
        }

        if (allSearchItems.length === 0) return res.json({ videos: [], nextPageToken: null });

        let allVideoItems = [];
        for (let i = 0; i < allSearchItems.length; i += 50) {
            const chunk = allSearchItems.slice(i, i + 50);
            const videoIds = chunk.map(item => item.id.videoId).join(',');
            const videosRes = await fetch(
                `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${videoIds}&key=${API_KEY}`
            );
            trackUnits('영상 통계', 1);
            const videosData = await videosRes.json();
            if (videosData.items) allVideoItems.push(...videosData.items);
        }

        const uniqueChannelIds = [...new Set(allVideoItems.map(v => v.snippet.channelId))];
        const subMap = {};
        for (let i = 0; i < uniqueChannelIds.length; i += 50) {
            const chunk = uniqueChannelIds.slice(i, i + 50).join(',');
            const channelsRes = await fetch(
                `https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${chunk}&key=${API_KEY}`
            );
            trackUnits('채널 조회', 1);
            const channelsData = await channelsRes.json();
            (channelsData.items || []).forEach(ch => {
                subMap[ch.id] = parseInt(ch.statistics.subscriberCount || 0);
            });
        }

        const videos = allVideoItems.map(v => {
            const viewCount = parseInt(v.statistics.viewCount || 0);
            const subscriberCount = subMap[v.snippet.channelId] || 0;
            const viewToSubRatio = subscriberCount > 0 ? Math.round((viewCount / subscriberCount) * 100) : 0;
            return {
                id: v.id,
                title: v.snippet.title,
                description: v.snippet.description,
                thumbnail: v.snippet.thumbnails.medium.url,
                channelId: v.snippet.channelId,
                channelTitle: v.snippet.channelTitle,
                publishedAt: v.snippet.publishedAt,
                viewCount,
                likeCount: parseInt(v.statistics.likeCount || 0),
                commentCount: parseInt(v.statistics.commentCount || 0),
                subscriberCount,
                viewToSubRatio
            };
        });

        const result = { videos, nextPageToken: pageToken || null };
        await setCache(cacheKey, result, CACHE_TTL);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ===== DB 기반 하이브리드 검색 =====
async function triggerCrawlForKeyword(keyword) {
    if (!supabase) return;
    try {
        await supabase
            .from('keywords')
            .upsert({ keyword }, { onConflict: 'keyword', ignoreDuplicates: true });
    } catch { /* 무시 */ }
}

const DB_SEARCH_THRESHOLD = 20;

app.get('/api/db/search', requireAuth, async (req, res) => {
    const { q, order = 'viewCount', subMin, subMax, viewMin, viewMax, duration, offset = '0', limit = '50', pageToken: inputPageToken } = req.query;
    if (!q || !q.trim()) return res.status(400).json({ error: '검색어(q)가 필요합니다' });

    const keyword = q.trim();
    const offsetNum = parseInt(offset) || 0;
    const limitNum = Math.min(parseInt(limit) || 50, 200);

    // pageToken이 있으면 YouTube 폴백 모드 (loadMore)
    if (!inputPageToken && supabase) {
        try {
            let dbQuery = supabase
                .from('videos')
                .select('*', { count: 'exact' })
                .contains('keywords', [keyword]);

            if (parseInt(subMin) > 0) dbQuery = dbQuery.gte('subscriber_count', parseInt(subMin));
            if (parseInt(subMax) > 0) dbQuery = dbQuery.lte('subscriber_count', parseInt(subMax));
            if (parseInt(viewMin) > 0) dbQuery = dbQuery.gte('view_count', parseInt(viewMin));
            if (parseInt(viewMax) > 0) dbQuery = dbQuery.lte('view_count', parseInt(viewMax));
            if (duration === 'short')  dbQuery = dbQuery.lte('duration_seconds', 240);
            else if (duration === 'medium') dbQuery = dbQuery.gte('duration_seconds', 241).lte('duration_seconds', 1200);
            else if (duration === 'long')   dbQuery = dbQuery.gte('duration_seconds', 1201);

            if (order === 'date') dbQuery = dbQuery.order('published_at', { ascending: false });
            else dbQuery = dbQuery.order('view_count', { ascending: false });

            dbQuery = dbQuery.range(offsetNum, offsetNum + limitNum - 1);

            const { data: rows, count, error } = await dbQuery;
            if (!error && rows && rows.length >= DB_SEARCH_THRESHOLD) {
                let videos = rows.map(v => ({
                    id: v.id,
                    title: v.title,
                    channelId: v.channel_id,
                    channelTitle: v.channel_title,
                    subscriberCount: v.subscriber_count,
                    viewCount: v.view_count,
                    likeCount: v.like_count,
                    commentCount: v.comment_count,
                    publishedAt: v.published_at,
                    thumbnail: v.thumbnail,
                    duration: v.duration,
                    viewToSubRatio: v.view_to_sub_ratio,
                }));

                // velocity 정렬은 서버에서 계산
                if (order === 'velocity') {
                    videos.sort((a, b) => {
                        const daysA = Math.max(1, (Date.now() - new Date(a.publishedAt).getTime()) / 86400000);
                        const daysB = Math.max(1, (Date.now() - new Date(b.publishedAt).getTime()) / 86400000);
                        return (b.viewCount / Math.max(b.subscriberCount, 1)) / daysB
                             - (a.viewCount / Math.max(a.subscriberCount, 1)) / daysA;
                    });
                } else if (order === 'performance') {
                    videos.sort((a, b) => b.viewToSubRatio - a.viewToSubRatio);
                }

                return res.json({ videos, total: count, source: 'db', hasMore: offsetNum + limitNum < count });
            }
        } catch { /* DB 실패 시 YouTube 폴백 */ }
    }

    // YouTube 폴백 + 키워드 크롤링 트리거
    triggerCrawlForKeyword(keyword);

    try {
        const apiOrder = (order === 'performance' || order === 'velocity') ? 'viewCount' : order;
        const durationParam = duration ? `&videoDuration=${encodeURIComponent(duration)}` : '';
        const tokenParam = inputPageToken ? `&pageToken=${encodeURIComponent(inputPageToken)}` : '';

        const searchRes = await fetch(
            `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&q=${encodeURIComponent(keyword)}&order=${encodeURIComponent(apiOrder)}&maxResults=50${durationParam}${tokenParam}&key=${API_KEY}`
        );
        trackUnits('콘텐츠 검색', 100);
        const searchData = await searchRes.json();
        if (searchData.error) return res.status(400).json({ error: searchData.error.message });
        if (!searchData.items || searchData.items.length === 0) return res.json({ videos: [], source: 'youtube', hasMore: false });

        const videoIds = searchData.items.map(item => item.id.videoId).join(',');
        const videosRes = await fetch(
            `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${videoIds}&key=${API_KEY}`
        );
        trackUnits('영상 통계', 1);
        const videosData = await videosRes.json();

        const uniqueChannelIds = [...new Set((videosData.items || []).map(v => v.snippet.channelId))];
        const subMap = {};
        for (let i = 0; i < uniqueChannelIds.length; i += 50) {
            const chunk = uniqueChannelIds.slice(i, i + 50).join(',');
            const channelsRes = await fetch(`https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${chunk}&key=${API_KEY}`);
            trackUnits('채널 조회', 1);
            const channelsData = await channelsRes.json();
            (channelsData.items || []).forEach(ch => {
                subMap[ch.id] = parseInt(ch.statistics.subscriberCount || 0);
            });
        }

        const videos = (videosData.items || []).map(v => {
            const viewCount = parseInt(v.statistics.viewCount || 0);
            const subscriberCount = subMap[v.snippet.channelId] || 0;
            return {
                id: v.id,
                title: v.snippet.title,
                channelId: v.snippet.channelId,
                channelTitle: v.snippet.channelTitle,
                publishedAt: v.snippet.publishedAt,
                thumbnail: v.snippet.thumbnails.medium.url,
                viewCount,
                likeCount: parseInt(v.statistics.likeCount || 0),
                commentCount: parseInt(v.statistics.commentCount || 0),
                subscriberCount,
                viewToSubRatio: subscriberCount > 0 ? Math.round((viewCount / subscriberCount) * 100) : 0,
            };
        });

        // YouTube 결과를 바로 DB에 저장 (백그라운드)
        if (supabase && !inputPageToken) {
            const rows = videos.map(v => {
                const rawItem = (videosData.items || []).find(i => i.id === v.id);
                const durationIso = rawItem?.contentDetails?.duration || '';
                const durationSeconds = (() => {
                    const m = durationIso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
                    if (!m) return 0;
                    return (parseInt(m[1]||'0')*3600) + (parseInt(m[2]||'0')*60) + parseInt(m[3]||'0');
                })();
                return {
                    id: v.id,
                    title: v.title,
                    channel_id: v.channelId,
                    channel_title: v.channelTitle,
                    subscriber_count: v.subscriberCount,
                    view_count: v.viewCount,
                    like_count: v.likeCount,
                    comment_count: v.commentCount,
                    published_at: v.publishedAt,
                    thumbnail: v.thumbnail,
                    duration: durationIso,
                    duration_seconds: durationSeconds,
                    view_to_sub_ratio: v.viewToSubRatio,
                    keywords: [keyword],
                    crawled_at: new Date().toISOString(),
                };
            });
            supabase.from('videos').upsert(rows, { onConflict: 'id', ignoreDuplicates: false }).then(() => {}).catch(() => {});
        }

        return res.json({ videos, source: 'youtube', hasMore: !!searchData.nextPageToken, nextPageToken: searchData.nextPageToken || null });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ===== 트렌드 영상 =====
app.get('/api/youtube/trending', requireAuth, async (req, res) => {
    const { regionCode = 'KR', videoCategoryId, maxResults = '12' } = req.query;
    const perPage = Math.min(parseInt(maxResults) || 12, 50);

    const cacheKey = `trending|${regionCode}|${videoCategoryId || ''}|${perPage}`;
    const cached = await getCached(cacheKey);
    if (cached) return res.json(cached);

    try {
        const categoryParam = videoCategoryId ? `&videoCategoryId=${encodeURIComponent(videoCategoryId)}` : '';
        const videosRes = await fetch(
            `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet,contentDetails&chart=mostPopular&regionCode=${encodeURIComponent(regionCode)}&maxResults=${perPage}${categoryParam}&key=${API_KEY}`
        );
        trackUnits('트렌드 조회', 1);
        const videosData = await videosRes.json();
        if (videosData.error) return res.status(400).json({ error: videosData.error.message });
        if (!videosData.items || videosData.items.length === 0) return res.json([]);

        const uniqueChannelIds = [...new Set(videosData.items.map(v => v.snippet.channelId))];
        const subMap = {};
        for (let i = 0; i < uniqueChannelIds.length; i += 50) {
            const chunk = uniqueChannelIds.slice(i, i + 50).join(',');
            const channelsRes = await fetch(
                `https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${chunk}&key=${API_KEY}`
            );
            trackUnits('채널 조회', 1);
            const channelsData = await channelsRes.json();
            (channelsData.items || []).forEach(ch => {
                subMap[ch.id] = parseInt(ch.statistics.subscriberCount || 0);
            });
        }

        const videos = videosData.items.map(v => ({
            id: v.id,
            title: v.snippet.title,
            description: v.snippet.description,
            thumbnail: v.snippet.thumbnails.medium.url,
            channelId: v.snippet.channelId,
            channelTitle: v.snippet.channelTitle,
            publishedAt: v.snippet.publishedAt,
            duration: v.contentDetails ? v.contentDetails.duration : null,
            viewCount: parseInt(v.statistics.viewCount || 0),
            likeCount: parseInt(v.statistics.likeCount || 0),
            commentCount: parseInt(v.statistics.commentCount || 0),
            subscriberCount: subMap[v.snippet.channelId] || 0
        }));

        await setCache(cacheKey, videos, TRENDING_CACHE_TTL);
        res.json(videos);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ===== 트렌드 영상 (DB) =====
app.get('/api/trending-videos', requireAuth, async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);

    try {
        // 오늘 데이터 조회
        const today = new Date().toISOString().slice(0, 10);
        let { data, error } = await supabase
            .from('trending_videos')
            .select('*')
            .eq('crawled_date', today)
            .order('rank', { ascending: true })
            .limit(limit);

        // 오늘 데이터 없으면 가장 최근 날짜 fallback
        if (!error && (!data || data.length === 0)) {
            const { data: latest } = await supabase
                .from('trending_videos')
                .select('crawled_date')
                .order('crawled_date', { ascending: false })
                .limit(1);

            if (latest && latest.length > 0) {
                ({ data, error } = await supabase
                    .from('trending_videos')
                    .select('*')
                    .eq('crawled_date', latest[0].crawled_date)
                    .order('rank', { ascending: true })
                    .limit(limit));
            }
        }

        if (error) return res.status(500).json({ error: error.message });

        const videos = (data || []).map(v => ({
            id: v.id,
            title: v.title,
            channelId: v.channel_id,
            channelTitle: v.channel_title,
            subscriberCount: v.subscriber_count,
            viewCount: v.view_count,
            likeCount: v.like_count,
            commentCount: v.comment_count,
            publishedAt: v.published_at,
            thumbnail: v.thumbnail,
            duration: v.duration,
            rank: v.rank,
            crawledDate: v.crawled_date,
        }));

        res.json(videos);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ===== 키워드 연관 검색어 =====
app.get('/api/youtube/keyword-suggestions', requireAuth, async (req, res) => {
    const { q } = req.query;
    if (!q || !q.trim()) return res.status(400).json({ error: '검색어(q)가 필요합니다' });

    const cacheKey = `suggest|${q}`;
    const cached = await getCached(cacheKey);
    if (cached) return res.json(cached);

    try {
        const suggestRes = await fetch(
            `https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q=${encodeURIComponent(q)}&hl=ko`
        );
        if (!suggestRes.ok) return res.status(suggestRes.status).json({ error: '키워드 제안 API 요청 실패' });
        const buffer = await suggestRes.arrayBuffer();
        const text = new TextDecoder('euc-kr').decode(buffer);
        const data = JSON.parse(text);
        const suggestions = data[1] || [];

        await setCache(cacheKey, suggestions, SUGGEST_CACHE_TTL);
        res.json(suggestions);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ===== 채널 검색 =====
app.get('/api/youtube/search-channels', requireAuth, async (req, res) => {
    const { q, maxResults = '12' } = req.query;
    if (!q || !q.trim()) return res.status(400).json({ error: '검색어(q)가 필요합니다' });

    const perPage = Math.min(parseInt(maxResults) || 12, 50);
    const cacheKey = `ch|${q}|${perPage}`;
    const cached = await getCached(cacheKey);
    if (cached) return res.json(cached);

    try {
        const searchRes = await fetch(
            `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${encodeURIComponent(q)}&maxResults=${perPage}&key=${API_KEY}`
        );
        trackUnits('채널 검색', 100);
        const searchData = await searchRes.json();
        if (searchData.error) return res.status(400).json({ error: searchData.error.message });
        if (!searchData.items || searchData.items.length === 0) return res.json([]);

        const channelIds = searchData.items.map(item => item.id.channelId).join(',');
        const channelsRes = await fetch(
            `https://www.googleapis.com/youtube/v3/channels?part=statistics,snippet,brandingSettings&id=${channelIds}&key=${API_KEY}`
        );
        trackUnits('채널 조회', 1);
        const channelsData = await channelsRes.json();

        const channels = (channelsData.items || []).map(ch => ({
            id: ch.id,
            title: ch.snippet.title,
            description: ch.snippet.description,
            thumbnail: ch.snippet.thumbnails.medium?.url || ch.snippet.thumbnails.default?.url,
            customUrl: ch.snippet.customUrl || '',
            publishedAt: ch.snippet.publishedAt,
            subscriberCount: parseInt(ch.statistics.subscriberCount || 0),
            viewCount: parseInt(ch.statistics.viewCount || 0),
            videoCount: parseInt(ch.statistics.videoCount || 0),
            hiddenSubscriberCount: ch.statistics.hiddenSubscriberCount || false
        }));

        await setCache(cacheKey, channels, CACHE_TTL);
        res.json(channels);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ===== 아웃라이어 찾기 =====
async function getChannelAvgViews(channelId, uploadsPlaylistId) {
    const cacheKey = `ch-avg|${channelId}`;
    const cached = await getCached(cacheKey);
    if (cached) return cached;

    const playlistRes = await fetch(
        `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${uploadsPlaylistId}&maxResults=50&key=${API_KEY}`
    );
    trackUnits('아웃라이어 영상목록', 1);
    const playlistData = await playlistRes.json();

    if (!playlistData.items || playlistData.items.length === 0) return null;

    const videoIds = playlistData.items.map(item => item.snippet.resourceId.videoId).join(',');
    const videosRes = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${videoIds}&key=${API_KEY}`
    );
    trackUnits('아웃라이어 영상통계', 1);
    const videosData = await videosRes.json();

    if (!videosData.items || videosData.items.length === 0) return null;

    const views = videosData.items.map(v => parseInt(v.statistics.viewCount || 0)).sort((a, b) => a - b);
    const videoCount = views.length;
    const avgViews = Math.round(views.reduce((s, v) => s + v, 0) / videoCount);
    const medianViews = videoCount % 2 === 0
        ? Math.round((views[videoCount / 2 - 1] + views[videoCount / 2]) / 2)
        : views[Math.floor(videoCount / 2)];

    const result = { avgViews, medianViews, videoCount };
    await setCache(cacheKey, result, CH_AVG_CACHE_TTL);
    return result;
}

app.get('/api/youtube/outliers', requireAuth, async (req, res) => {
    const { q, maxResults = '10', minOutlierScore = '2' } = req.query;
    if (!q || !q.trim()) return res.status(400).json({ error: '검색어(q)가 필요합니다' });

    const limit = Math.min(parseInt(maxResults) || 10, 15);
    const minScore = parseFloat(minOutlierScore) || 2;

    const cacheKey = `outlier|${q}|${limit}|${minScore}`;
    const cached = await getCached(cacheKey);
    if (cached) return res.json(cached);

    try {
        const searchRes = await fetch(
            `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&q=${encodeURIComponent(q)}&order=viewCount&maxResults=15&key=${API_KEY}`
        );
        trackUnits('아웃라이어 검색', 100);
        const searchData = await searchRes.json();
        if (searchData.error) return res.status(400).json({ error: searchData.error.message });
        if (!searchData.items || searchData.items.length === 0) return res.json({ videos: [] });

        const videoIds = searchData.items.map(item => item.id.videoId).join(',');
        const videosRes = await fetch(
            `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${videoIds}&key=${API_KEY}`
        );
        trackUnits('아웃라이어 영상통계', 1);
        const videosData = await videosRes.json();
        if (!videosData.items || videosData.items.length === 0) return res.json({ videos: [] });

        const uniqueChannelIds = [...new Set(videosData.items.map(v => v.snippet.channelId))];
        const channelMap = {};
        for (let i = 0; i < uniqueChannelIds.length; i += 50) {
            const chunk = uniqueChannelIds.slice(i, i + 50).join(',');
            const channelsRes = await fetch(
                `https://www.googleapis.com/youtube/v3/channels?part=contentDetails,statistics&id=${chunk}&key=${API_KEY}`
            );
            trackUnits('아웃라이어 채널조회', 1);
            const channelsData = await channelsRes.json();
            (channelsData.items || []).forEach(ch => {
                channelMap[ch.id] = {
                    uploadsPlaylistId: ch.contentDetails.relatedPlaylists.uploads,
                    subscriberCount: parseInt(ch.statistics.subscriberCount || 0)
                };
            });
        }

        const channelAvgMap = {};
        for (const chId of uniqueChannelIds) {
            const chInfo = channelMap[chId];
            if (!chInfo) continue;
            try {
                const avg = await getChannelAvgViews(chId, chInfo.uploadsPlaylistId);
                if (avg) channelAvgMap[chId] = avg;
            } catch { /* skip */ }
        }

        const results = [];
        for (const v of videosData.items) {
            const chId = v.snippet.channelId;
            const chAvg = channelAvgMap[chId];
            if (!chAvg) continue;
            if (chAvg.videoCount < 5) continue;

            const viewCount = parseInt(v.statistics.viewCount || 0);
            const medianViews = chAvg.medianViews;
            if (medianViews <= 0) continue;

            const outlierScore = Math.round((viewCount / medianViews) * 10) / 10;
            if (outlierScore < minScore) continue;

            results.push({
                id: v.id,
                title: v.snippet.title,
                thumbnail: v.snippet.thumbnails.medium.url,
                channelId: chId,
                channelTitle: v.snippet.channelTitle,
                publishedAt: v.snippet.publishedAt,
                viewCount,
                likeCount: parseInt(v.statistics.likeCount || 0),
                commentCount: parseInt(v.statistics.commentCount || 0),
                subscriberCount: channelMap[chId]?.subscriberCount || 0,
                channelAvgViews: chAvg.avgViews,
                channelMedianViews: medianViews,
                outlierScore,
                channelVideoCount: chAvg.videoCount
            });
        }

        results.sort((a, b) => b.outlierScore - a.outlierScore);
        const finalResults = results.slice(0, limit);

        const result = { videos: finalResults };
        await setCache(cacheKey, result, CACHE_TTL);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ===== AI 채팅 (Gemini) =====
app.post('/api/ai/chat', requireAuth, async (req, res) => {
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) return res.status(503).json({ error: 'GEMINI_API_KEY가 설정되지 않았습니다' });

    const { messages, platform, contentType, context } = req.body;
    if (!Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ error: 'messages가 필요합니다' });
    }

    const platformLabel = { youtube: 'YouTube', instagram: 'Instagram', tiktok: 'TikTok', other: '기타' }[platform] || 'YouTube';
    const typeLabel = { long: '롱폼 영상', short: '숏츠/릴스' }[contentType] || '롱폼 영상';

    // 채널 컨텍스트 구성
    let channelContext = '';
    if (context) {
        if (context.channel) {
            const ch = context.channel;
            channelContext += `\n\n[크리에이터 채널 정보]
- 채널명: ${ch.name}
- 구독자: ${ch.subscribers}
- 총 조회수: ${ch.totalViews}
- 영상 수: ${ch.videoCount}`;
        }
        if (context.recentVideos && context.recentVideos.length > 0) {
            channelContext += `\n\n[조회수 높은 최근 영상]`;
            context.recentVideos.forEach((v, i) => {
                channelContext += `\n${i + 1}. "${v.title}" (조회수 ${v.views?.toLocaleString() || '?'})`;
            });
        }
        if (context.pipeline && context.pipeline.length > 0) {
            channelContext += `\n\n[현재 제작 중인 콘텐츠]`;
            context.pipeline.forEach(c => {
                channelContext += `\n- "${c.title}" (${c.status})`;
            });
        }
        if (context.previousChat && Array.isArray(context.previousChat) && context.previousChat.length > 0) {
            channelContext += `\n\n[이전 대화 기록]`;
            context.previousChat.forEach(m => {
                channelContext += `\n${m.role === 'user' ? '사용자' : 'AI'}: ${m.content}`;
            });
            channelContext += `\n위 대화에서 파악된 크리에이터 정보(타겟, 방향, 선호 등)를 기억하고 일관된 조언을 이어가세요.`;
        }
    }

    const systemInstruction = `당신은 ${platformLabel} ${typeLabel} 전문 콘텐츠 기획자입니다.
크리에이터의 막연한 아이디어를 클릭할 수밖에 없는 콘텐츠로 구체화하는 것이 당신의 역할입니다.
${channelContext}

# 채널 분석 기준
- 조회수 높은 영상의 공통점(주제, 제목 패턴, 포맷)을 파악하고 이를 근거로 조언하세요
- 구독자 대비 조회수 비율이 높은 영상은 알고리즘이 밀어준 콘텐츠입니다. 이런 패턴을 참고하세요
- 채널 규모에 맞는 현실적 전략을 제시하세요:
  · 1만 이하: 검색 유입 + 니치 공략, 키워드 중심 제목
  · 1만~10만: 기존 성공 포맷 변형 + 시리즈화
  · 10만 이상: 트렌드 선점 + 브랜딩 강화

# 대화 흐름
아래 3단계를 순서대로 진행하되, 각 단계는 해당 정보가 충분히 확보될 때까지 머무르세요.
사용자 메시지 1개 = 1단계가 아닙니다. 정보가 부족하면 같은 단계에서 추가 질문하세요.

1단계 — 방향 탐색: 누구를 위한 콘텐츠인지, 어떤 주제/감정/가치를 다룰지 파악. 타겟과 주제가 명확해질 때까지 이 단계에 머무르세요.
2단계 — 차별화: 같은 주제의 기존 영상과 뭐가 다른지, 첫 5초 후킹 전략. 차별점이 구체적으로 나올 때까지 진행하세요.
3단계 — 확정: 제목 후보 2~3개와 핵심 구성을 제안한 뒤 [IDEA_READY] 태그를 출력하세요.

- 단, 사용자가 처음부터 타겟/주제/차별점을 모두 갖춘 구체적 아이디어를 가져왔다면 바로 3단계로 가세요

# 응답 규칙
- 한 번에 질문은 최대 2개, 각 질문은 한 줄로 끝내세요
- 답변은 5문장 이내로 핵심만. 불필요한 인사, 칭찬, 반복 금지
- 조언할 때는 반드시 채널 데이터에서 근거를 들어 설명하세요 (예: "조회수 높은 영상 3개가 모두 ~패턴이니...")
- 한국어로 답변하세요

# 아이디어 확정
아이디어가 구체화되면 반드시 마지막에 다음 형식을 포함하세요:
[IDEA_READY: 구체화된 아이디어 한 문장 (타겟, 핵심 내용 포함)]`;

    const geminiMessages = messages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
    }));

    try {
        const geminiRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    system_instruction: { parts: [{ text: systemInstruction }] },
                    contents: geminiMessages
                })
            }
        );
        const data = await geminiRes.json();
        if (data.error) return res.status(500).json({ error: data.error.message });

        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const ideaMatch = text.match(/\[IDEA_READY:\s*(.+?)\]/s);

        res.json({
            content: text,
            idea: ideaMatch ? ideaMatch[1].trim() : null
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ===== 로컬 개발용 서버 실행 =====
if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`Supervid 서버 실행중: http://localhost:${PORT}`));
}

module.exports = app;

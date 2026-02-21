const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const { createClient } = require('@supabase/supabase-js');
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
app.use(cors({ origin: true, credentials: true }));
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
const apiUsage = { date: new Date().toISOString().slice(0, 10), units: 0, breakdown: {} };

function trackUnits(category, units) {
    const today = new Date().toISOString().slice(0, 10);
    if (apiUsage.date !== today) {
        apiUsage.date = today;
        apiUsage.units = 0;
        apiUsage.breakdown = {};
    }
    apiUsage.units += units;
    apiUsage.breakdown[category] = (apiUsage.breakdown[category] || 0) + units;
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
app.get('/api/youtube/usage', requireAuth, (req, res) => {
    const today = new Date().toISOString().slice(0, 10);
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

// ===== 로컬 개발용 서버 실행 =====
if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`Supervid 서버 실행중: http://localhost:${PORT}`));
}

module.exports = app;

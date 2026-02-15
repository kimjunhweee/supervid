const express = require('express');
const cors = require('cors');
const session = require('express-session');
const { OAuth2Client } = require('google-auth-library');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Session 설정
app.use(session({
    secret: process.env.SESSION_SECRET || 'supercontent-secret-key-' + Math.random().toString(36),
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: false, // localhost에서는 false
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7일
    }
}));

// 정적 파일 (인증 불필요 — 로그인 화면도 여기에 포함)
app.use(express.static('.'));

const API_KEY = process.env.YOUTUBE_API_KEY;

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

// ===== 검색 결과 캐시 =====
const searchCache = new Map();
const CACHE_TTL = 30 * 60 * 1000;

setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of searchCache) {
        const ttl = entry.ttl || CACHE_TTL;
        if (now - entry.time > ttl) searchCache.delete(key);
    }
}, 5 * 60 * 1000);
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

// 클라이언트에 Google Client ID 전달
app.get('/api/config', (req, res) => {
    res.json({ googleClientId: GOOGLE_CLIENT_ID });
});

// ===== 인증 라우트 =====

// Google ID 토큰 검증 → 세션 생성
app.post('/api/auth/google', async (req, res) => {
    const { credential } = req.body;
    if (!credential) return res.status(400).json({ error: '토큰이 필요합니다' });

    try {
        const ticket = await googleClient.verifyIdToken({
            idToken: credential,
            audience: GOOGLE_CLIENT_ID
        });
        const payload = ticket.getPayload();

        req.session.user = {
            id: payload.sub,
            email: payload.email,
            name: payload.name,
            picture: payload.picture
        };

        res.json({ user: req.session.user });
    } catch (err) {
        res.status(401).json({ error: '토큰 검증 실패: ' + err.message });
    }
});

// 현재 로그인 사용자 반환
app.get('/api/auth/me', (req, res) => {
    if (req.session.user) {
        res.json({ user: req.session.user });
    } else {
        res.status(401).json({ error: '로그인이 필요합니다' });
    }
});

// 로그아웃
app.post('/api/auth/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) return res.status(500).json({ error: '로그아웃 실패' });
        res.clearCookie('connect.sid');
        res.json({ success: true });
    });
});

// ===== 인증 미들웨어 (YouTube API 보호) =====
function requireAuth(req, res, next) {
    if (req.session && req.session.user) return next();
    res.status(401).json({ error: '로그인이 필요합니다' });
}

// API 사용량 조회
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

// 채널 통계 가져오기
app.get('/api/youtube/channel', requireAuth, async (req, res) => {
    const { channelId } = req.query;
    if (!channelId) return res.status(400).json({ error: 'channelId가 필요합니다' });

    try {
        const response = await fetch(
            `https://www.googleapis.com/youtube/v3/channels?part=statistics,snippet&id=${encodeURIComponent(channelId)}&key=${API_KEY}`
        );
        trackUnits('채널 조회', 1);
        const data = await response.json();

        if (data.error) return res.status(400).json({ error: data.error.message });
        if (!data.items || data.items.length === 0) return res.status(404).json({ error: '채널을 찾을 수 없습니다' });

        const channel = data.items[0];
        res.json({
            title: channel.snippet.title,
            thumbnail: channel.snippet.thumbnails.default.url,
            subscriberCount: parseInt(channel.statistics.subscriberCount),
            viewCount: parseInt(channel.statistics.viewCount),
            videoCount: parseInt(channel.statistics.videoCount)
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 최근 영상 목록 + 통계 가져오기
app.get('/api/youtube/videos', requireAuth, async (req, res) => {
    const { channelId } = req.query;
    if (!channelId) return res.status(400).json({ error: 'channelId가 필요합니다' });

    try {
        // 업로드 재생목록 ID 가져오기
        const channelRes = await fetch(
            `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${encodeURIComponent(channelId)}&key=${API_KEY}`
        );
        trackUnits('채널 조회', 1);
        const channelData = await channelRes.json();

        if (!channelData.items || channelData.items.length === 0) {
            return res.status(404).json({ error: '채널을 찾을 수 없습니다' });
        }

        const uploadsPlaylistId = channelData.items[0].contentDetails.relatedPlaylists.uploads;

        // 6개월 전 기준일 (이보다 오래된 영상은 가져오지 않음)
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
        const cutoff = sixMonthsAgo.toISOString();

        // 페이지네이션으로 영상 목록 가져오기 (페이지당 50개, 최대 4페이지 = 200개)
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

        if (allPlaylistItems.length === 0) {
            return res.json([]);
        }

        // 영상 통계 가져오기 (videos API는 한 번에 50개까지 → 청크로 나눠 요청)
        let allVideos = [];
        for (let i = 0; i < allPlaylistItems.length; i += 50) {
            const chunk = allPlaylistItems.slice(i, i + 50);
            const videoIds = chunk.map(item => item.snippet.resourceId.videoId).join(',');
            const videosRes = await fetch(
                `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet,contentDetails&id=${videoIds}&key=${API_KEY}`
            );
            trackUnits('영상 통계', 1);
            const videosData = await videosRes.json();
            if (videosData.items) {
                allVideos.push(...videosData.items);
            }
        }

        const videos = allVideos.map(v => ({
            id: v.id,
            title: v.snippet.title,
            thumbnail: v.snippet.thumbnails.medium.url,
            publishedAt: v.snippet.publishedAt,
            viewCount: parseInt(v.statistics.viewCount || 0),
            likeCount: parseInt(v.statistics.likeCount || 0),
            commentCount: parseInt(v.statistics.commentCount || 0)
        }));

        res.json(videos);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// YouTube 검색 (콘텐츠 탐색)
app.get('/api/youtube/search', requireAuth, async (req, res) => {
    const { q, order = 'viewCount', maxResults = '12', videoDuration, pages = '1', pageToken: inputPageToken } = req.query;
    if (!q || !q.trim()) return res.status(400).json({ error: '검색어(q)가 필요합니다' });

    const pageCount = Math.min(Math.max(parseInt(pages) || 1, 1), 3);
    const perPage = Math.min(parseInt(maxResults) || 12, 50);

    // 캐시 확인
    const cacheKey = `${q}|${order}|${perPage}|${videoDuration || ''}|${pageCount}|${inputPageToken || ''}`;
    const cached = searchCache.get(cacheKey);
    if (cached && Date.now() - cached.time < CACHE_TTL) {
        return res.json(cached.data);
    }

    try {
        // 1단계: 검색 → videoId 목록 (페이지네이션)
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

        // 2단계: 영상 상세 통계 (50개씩 청크)
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

        // 3단계: 채널 구독자 수 일괄 조회 (50개씩 청크)
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
        searchCache.set(cacheKey, { data: result, time: Date.now() });
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 트렌드 영상 (인기 급상승)
app.get('/api/youtube/trending', requireAuth, async (req, res) => {
    const { regionCode = 'KR', videoCategoryId, maxResults = '12' } = req.query;
    const perPage = Math.min(parseInt(maxResults) || 12, 50);

    // 캐시 확인 (2시간)
    const TRENDING_CACHE_TTL = 2 * 60 * 60 * 1000;
    const cacheKey = `trending|${regionCode}|${videoCategoryId || ''}|${perPage}`;
    const cached = searchCache.get(cacheKey);
    if (cached && Date.now() - cached.time < TRENDING_CACHE_TTL) {
        return res.json(cached.data);
    }

    try {
        const categoryParam = videoCategoryId ? `&videoCategoryId=${encodeURIComponent(videoCategoryId)}` : '';
        const videosRes = await fetch(
            `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&chart=mostPopular&regionCode=${encodeURIComponent(regionCode)}&maxResults=${perPage}${categoryParam}&key=${API_KEY}`
        );
        trackUnits('트렌드 조회', 1);
        const videosData = await videosRes.json();
        if (videosData.error) return res.status(400).json({ error: videosData.error.message });
        if (!videosData.items || videosData.items.length === 0) return res.json([]);

        // 채널 구독자 수 일괄 조회
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
            viewCount: parseInt(v.statistics.viewCount || 0),
            likeCount: parseInt(v.statistics.likeCount || 0),
            commentCount: parseInt(v.statistics.commentCount || 0),
            subscriberCount: subMap[v.snippet.channelId] || 0
        }));

        searchCache.set(cacheKey, { data: videos, time: Date.now(), ttl: TRENDING_CACHE_TTL });
        res.json(videos);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 키워드 연관 검색어 제안
app.get('/api/youtube/keyword-suggestions', requireAuth, async (req, res) => {
    const { q } = req.query;
    if (!q || !q.trim()) return res.status(400).json({ error: '검색어(q)가 필요합니다' });

    // 캐시 확인 (24시간)
    const SUGGEST_CACHE_TTL = 24 * 60 * 60 * 1000;
    const cacheKey = `suggest|${q}`;
    const cached = searchCache.get(cacheKey);
    if (cached && Date.now() - cached.time < SUGGEST_CACHE_TTL) {
        return res.json(cached.data);
    }

    try {
        const suggestRes = await fetch(
            `https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q=${encodeURIComponent(q)}&hl=ko`
        );
        if (!suggestRes.ok) {
            return res.status(suggestRes.status).json({ error: '키워드 제안 API 요청 실패' });
        }
        const buffer = await suggestRes.arrayBuffer();
        const text = new TextDecoder('euc-kr').decode(buffer);
        const data = JSON.parse(text);
        const suggestions = data[1] || [];

        searchCache.set(cacheKey, { data: suggestions, time: Date.now(), ttl: SUGGEST_CACHE_TTL });
        res.json(suggestions);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 채널 검색
app.get('/api/youtube/search-channels', requireAuth, async (req, res) => {
    const { q, maxResults = '12' } = req.query;
    if (!q || !q.trim()) return res.status(400).json({ error: '검색어(q)가 필요합니다' });

    const perPage = Math.min(parseInt(maxResults) || 12, 50);

    // 캐시 확인
    const cacheKey = `ch|${q}|${perPage}`;
    const cached = searchCache.get(cacheKey);
    if (cached && Date.now() - cached.time < CACHE_TTL) {
        return res.json(cached.data);
    }

    try {
        // 1단계: 채널 검색
        const searchRes = await fetch(
            `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${encodeURIComponent(q)}&maxResults=${perPage}&key=${API_KEY}`
        );
        trackUnits('채널 검색', 100);
        const searchData = await searchRes.json();
        if (searchData.error) return res.status(400).json({ error: searchData.error.message });
        if (!searchData.items || searchData.items.length === 0) return res.json([]);

        // 2단계: 채널 상세 통계
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

        searchCache.set(cacheKey, { data: channels, time: Date.now() });
        res.json(channels);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ===== 아웃라이어 찾기 =====

// 채널 평균/중앙값 캐시 (2시간 TTL)
const CH_AVG_CACHE_TTL = 2 * 60 * 60 * 1000;

async function getChannelAvgViews(channelId, uploadsPlaylistId) {
    const cacheKey = `ch-avg|${channelId}`;
    const cached = searchCache.get(cacheKey);
    if (cached && Date.now() - cached.time < CH_AVG_CACHE_TTL) {
        return cached.data;
    }

    // playlistItems 50개 (최근 영상 1페이지)
    const playlistRes = await fetch(
        `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${uploadsPlaylistId}&maxResults=50&key=${API_KEY}`
    );
    trackUnits('아웃라이어 영상목록', 1);
    const playlistData = await playlistRes.json();

    if (!playlistData.items || playlistData.items.length === 0) {
        return null;
    }

    const videoIds = playlistData.items.map(item => item.snippet.resourceId.videoId).join(',');
    const videosRes = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${videoIds}&key=${API_KEY}`
    );
    trackUnits('아웃라이어 영상통계', 1);
    const videosData = await videosRes.json();

    if (!videosData.items || videosData.items.length === 0) {
        return null;
    }

    const views = videosData.items.map(v => parseInt(v.statistics.viewCount || 0)).sort((a, b) => a - b);
    const videoCount = views.length;
    const avgViews = Math.round(views.reduce((s, v) => s + v, 0) / videoCount);
    const medianViews = videoCount % 2 === 0
        ? Math.round((views[videoCount / 2 - 1] + views[videoCount / 2]) / 2)
        : views[Math.floor(videoCount / 2)];

    const result = { avgViews, medianViews, videoCount };
    searchCache.set(cacheKey, { data: result, time: Date.now(), ttl: CH_AVG_CACHE_TTL });
    return result;
}

app.get('/api/youtube/outliers', requireAuth, async (req, res) => {
    const { q, maxResults = '10', minOutlierScore = '2' } = req.query;
    if (!q || !q.trim()) return res.status(400).json({ error: '검색어(q)가 필요합니다' });

    const limit = Math.min(parseInt(maxResults) || 10, 15);
    const minScore = parseFloat(minOutlierScore) || 2;

    // 전체 결과 캐시 (30분)
    const cacheKey = `outlier|${q}|${limit}|${minScore}`;
    const cached = searchCache.get(cacheKey);
    if (cached && Date.now() - cached.time < CACHE_TTL) {
        return res.json(cached.data);
    }

    try {
        // 1단계: search.list — 조회수 순으로 검색
        const searchRes = await fetch(
            `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&q=${encodeURIComponent(q)}&order=viewCount&maxResults=15&key=${API_KEY}`
        );
        trackUnits('아웃라이어 검색', 100);
        const searchData = await searchRes.json();
        if (searchData.error) return res.status(400).json({ error: searchData.error.message });
        if (!searchData.items || searchData.items.length === 0) return res.json({ videos: [] });

        // 2단계: videos.list — 영상 상세 통계
        const videoIds = searchData.items.map(item => item.id.videoId).join(',');
        const videosRes = await fetch(
            `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${videoIds}&key=${API_KEY}`
        );
        trackUnits('아웃라이어 영상통계', 1);
        const videosData = await videosRes.json();
        if (!videosData.items || videosData.items.length === 0) return res.json({ videos: [] });

        // 3단계: channels.list — 채널 정보 (contentDetails + statistics)
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

        // 4~5단계: 채널별 중앙값 계산
        const channelAvgMap = {};
        for (const chId of uniqueChannelIds) {
            const chInfo = channelMap[chId];
            if (!chInfo) continue;
            try {
                const avg = await getChannelAvgViews(chId, chInfo.uploadsPlaylistId);
                if (avg) channelAvgMap[chId] = avg;
            } catch { /* skip */ }
        }

        // 6단계: outlierScore 계산 + 필터
        const results = [];
        for (const v of videosData.items) {
            const chId = v.snippet.channelId;
            const chAvg = channelAvgMap[chId];
            if (!chAvg) continue;
            if (chAvg.videoCount < 5) continue; // 최소 영상 수 제한

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

        // 점수순 정렬 + limit
        results.sort((a, b) => b.outlierScore - a.outlierScore);
        const finalResults = results.slice(0, limit);

        const result = { videos: finalResults };
        searchCache.set(cacheKey, { data: result, time: Date.now() });
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Supervid 서버 실행중: http://localhost:${PORT}`);
});

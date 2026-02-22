// ===== Ideas (아이디어 찾기) =====
import { state, saveContents } from './state.js';
import { checkGuestBlock } from './auth.js';
import { escapeHtml, formatNumber, toast, generateId, velocityBadgeHtml, formatRelativeTime, parseDurationToSeconds } from './utils.js';
import { renderKanban } from './kanban.js';

let _ideasTrendingLoaded = false;
let _ideasActiveKeyword = '';
let _ideasTrendingCache = [];

export function setupIdeas() {
    document.getElementById('ideasCategorySelect').addEventListener('change', () => {
        _ideasTrendingLoaded = false;
        loadTrendingVideos(document.getElementById('ideasCategorySelect').value);
    });
    document.getElementById('ideasDurationSelect').addEventListener('change', () => {
        filterAndRenderTrending();
    });
    document.getElementById('ideasAnalyzeBtn').addEventListener('click', analyzeKeyword);
    document.getElementById('ideasKeywordInput').addEventListener('keydown', e => {
        if (e.key === 'Enter') analyzeKeyword();
    });
    document.getElementById('ideasKeywordDuration').addEventListener('change', () => {
        if (_ideasActiveKeyword) loadKeywordVideos(_ideasActiveKeyword);
    });
}

export async function loadTrendingVideos(categoryId) {
    if (checkGuestBlock()) return;
    const grid = document.getElementById('ideasTrendingGrid');
    const selectVal = categoryId !== undefined ? categoryId : document.getElementById('ideasCategorySelect').value;

    if (_ideasTrendingLoaded && categoryId === undefined) return;

    grid.innerHTML = `<div class="discover-loading">${t('ideas.trendLoading')}</div>`;

    try {
        const categoryParam = selectVal ? `&videoCategoryId=${encodeURIComponent(selectVal)}` : '';
        const res = await fetch(`/api/youtube/trending?regionCode=KR&maxResults=12${categoryParam}`);
        if (!res.ok) {
            let msg = t('misc.searchFail');
            try { const err = await res.json(); msg = err.error || msg; } catch {}
            throw new Error(msg);
        }
        const videos = await res.json();
        _ideasTrendingLoaded = true;
        _ideasTrendingCache = videos;
        filterAndRenderTrending();
    } catch (err) {
        grid.innerHTML = `<div class="discover-empty"><p style="color:var(--red)">${t('misc.error', { msg: escapeHtml(err.message) })}</p></div>`;
    }
}

function filterAndRenderTrending() {
    const duration = document.getElementById('ideasDurationSelect').value;
    let filtered = _ideasTrendingCache;
    if (duration === 'short') {
        filtered = filtered.filter(v => {
            const sec = parseDurationToSeconds(v.duration);
            return sec > 0 && sec <= 60;
        });
    } else if (duration === 'long') {
        filtered = filtered.filter(v => {
            const sec = parseDurationToSeconds(v.duration);
            return sec > 240;
        });
    }
    renderTrendingVideos(filtered);
}

function renderTrendingVideos(videos) {
    const grid = document.getElementById('ideasTrendingGrid');
    if (!videos || videos.length === 0) {
        grid.innerHTML = `<div class="discover-empty"><p>${t('ideas.trendEmpty')}</p></div>`;
        return;
    }

    grid.innerHTML = videos.map(v => {
        const timeAgo = formatRelativeTime(v.publishedAt);
        return `
        <div class="ideas-video-card">
            <img class="ideas-video-card-thumb" src="${v.thumbnail}" alt="${escapeHtml(v.title)}">
            <div class="ideas-video-card-body">
                <div class="ideas-video-card-title">${escapeHtml(v.title)}</div>
                <div class="ideas-video-card-channel">${escapeHtml(v.channelTitle)}</div>
                <div class="ideas-video-card-stats">
                    <span>👁 ${formatNumber(v.viewCount)}</span>
                    <span>👍 ${formatNumber(v.likeCount)}</span>
                </div>
                <div class="ideas-video-card-sub">${t('discover.subLabel', { n: formatNumber(v.subscriberCount || 0) })}</div>
                ${velocityBadgeHtml(v)}
                <div class="ideas-video-card-date">${timeAgo}</div>
            </div>
            <div class="ideas-video-card-actions">
                <button class="btn btn-primary ideas-save-btn" data-video='${JSON.stringify(v).replace(/'/g, '&#39;')}' data-source="trending">${t('ideas.saveAsIdea')}</button>
            </div>
        </div>`;
    }).join('');

    grid.querySelectorAll('.ideas-save-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const video = JSON.parse(btn.dataset.video);
            saveAsIdea(video, btn.dataset.source, '');
        });
    });
}

async function analyzeKeyword() {
    if (checkGuestBlock()) return;
    const input = document.getElementById('ideasKeywordInput');
    const keyword = input.value.trim();
    if (!keyword) { toast(t('toast.keywordRequired')); return; }

    const chipsContainer = document.getElementById('ideasKeywordChips');
    const videosContainer = document.getElementById('ideasKeywordVideos');
    chipsContainer.innerHTML = `<span style="font-size:12px;color:var(--text-muted)">${t('ideas.keywordAnalyzing')}</span>`;
    videosContainer.innerHTML = '';

    try {
        const res = await fetch(`/api/youtube/keyword-suggestions?q=${encodeURIComponent(keyword)}`);
        if (!res.ok) {
            let msg = t('misc.searchFail');
            try { const err = await res.json(); msg = err.error || msg; } catch {}
            throw new Error(msg);
        }
        const suggestions = await res.json();
        renderKeywordSuggestions(suggestions, keyword);
    } catch (err) {
        chipsContainer.innerHTML = `<span style="font-size:12px;color:var(--red)">${t('misc.error', { msg: escapeHtml(err.message) })}</span>`;
    }
}

function renderKeywordSuggestions(suggestions, originalKeyword) {
    const chipsContainer = document.getElementById('ideasKeywordChips');

    if (!suggestions || suggestions.length === 0) {
        chipsContainer.innerHTML = `<span style="font-size:12px;color:var(--text-muted)">${t('ideas.keywordEmpty')}</span>`;
        return;
    }

    chipsContainer.innerHTML = suggestions.map(s =>
        `<span class="keyword-chip" data-keyword="${escapeHtml(s)}">${escapeHtml(s)}</span>`
    ).join('');

    chipsContainer.querySelectorAll('.keyword-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            chipsContainer.querySelectorAll('.keyword-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            _ideasActiveKeyword = chip.dataset.keyword;
            loadKeywordVideos(chip.dataset.keyword);
        });
    });

    // 첫 번째 칩 자동 선택
    const firstChip = chipsContainer.querySelector('.keyword-chip');
    if (firstChip) {
        firstChip.classList.add('active');
        _ideasActiveKeyword = firstChip.dataset.keyword;
        loadKeywordVideos(firstChip.dataset.keyword);
    }
}

async function loadKeywordVideos(keyword) {
    const container = document.getElementById('ideasKeywordVideos');
    container.innerHTML = `<div class="discover-loading">${t('ideas.keywordVideoLoading')}</div>`;

    try {
        const kwDuration = document.getElementById('ideasKeywordDuration').value;
        const kwDurationParam = kwDuration ? `&videoDuration=${encodeURIComponent(kwDuration)}` : '';
        const res = await fetch(`/api/youtube/search?q=${encodeURIComponent(keyword)}&order=viewCount&maxResults=6&pages=1${kwDurationParam}`);
        if (!res.ok) {
            let msg = t('misc.searchFail');
            try { const err = await res.json(); msg = err.error || msg; } catch {}
            throw new Error(msg);
        }
        const data = await res.json();
        const videos = data.videos || data;
        renderKeywordVideos(videos, keyword);
    } catch (err) {
        container.innerHTML = `<div class="discover-empty"><p style="color:var(--red)">${t('misc.error', { msg: escapeHtml(err.message) })}</p></div>`;
    }
}

function renderKeywordVideos(videos, keyword) {
    const container = document.getElementById('ideasKeywordVideos');
    if (!videos || videos.length === 0) {
        container.innerHTML = `<div class="discover-empty"><p>${t('ideas.keywordVideoEmpty')}</p></div>`;
        return;
    }

    container.innerHTML = videos.map(v => {
        const timeAgo = formatRelativeTime(v.publishedAt);
        return `
        <div class="ideas-keyword-video-item">
            <img class="ideas-keyword-video-thumb" src="${v.thumbnail}" alt="${escapeHtml(v.title)}">
            <div class="ideas-keyword-video-info">
                <div class="ideas-keyword-video-title">${escapeHtml(v.title)}</div>
                <div class="ideas-keyword-video-meta">${escapeHtml(v.channelTitle)} · 👁 ${formatNumber(v.viewCount)} · ${timeAgo}</div>
                ${velocityBadgeHtml(v)}
                <div class="ideas-keyword-video-actions">
                    <button class="btn btn-primary ideas-save-btn" data-video='${JSON.stringify(v).replace(/'/g, '&#39;')}' data-source="keyword" data-keyword="${escapeHtml(keyword)}">${t('ideas.saveAsIdea')}</button>
                </div>
            </div>
        </div>`;
    }).join('');

    container.querySelectorAll('.ideas-save-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const video = JSON.parse(btn.dataset.video);
            saveAsIdea(video, btn.dataset.source, btn.dataset.keyword);
        });
    });
}

export function saveAsIdea(video, source, keyword) {
    const videoUrl = `https://www.youtube.com/watch?v=${video.id}`;
    if (state.contents.find(c => c.memo && c.memo.includes(videoUrl))) {
        toast(t('toast.ideaAlready'));
        return;
    }

    const sourceLabel = source === 'trending' ? t('idea.sourceTrend') : source === 'outlier' ? t('idea.sourceOutlier', { keyword }) : t('idea.sourceKeyword', { keyword });
    const outlierInfo = source === 'outlier' && video.outlierScore ? `\n${t('outlier.thisVideo')}: ${video.outlierScore}x (${t('outlier.channelMedian')} ${formatNumber(video.channelMedianViews || 0)})` : '';
    const memo = `${t('idea.sourceLabel', { source: sourceLabel })}\nURL: ${videoUrl}\n${video.channelTitle}\n${t('misc.views')}: ${formatNumber(video.viewCount)}${video.subscriberCount ? '\n' + t('channel.subscribers') + ': ' + formatNumber(video.subscriberCount) : ''}${outlierInfo}`;

    const newContent = {
        id: generateId(),
        title: video.title,
        platform: 'youtube',
        status: 'idea',
        date: '',
        contentType: 'long',
        memo,
        checklist: {},
        scriptContent: '',
        scriptStatus: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };

    state.contents.push(newContent);
    saveContents();
    renderKanban();
    toast(t('toast.ideaSaved'));
}

// ===== Channel Search (채널 탐색) =====
import { state, saveSavedChannels } from './state.js';
import { escapeHtml, formatNumber, toast, formatRelativeTime, parseDurationToSeconds } from './utils.js';
import { checkGuestBlock } from './auth.js';
import { initCustomDropdowns, syncCustomDropdowns } from './discover.js';
import { updatePlanBadge } from './nav.js';

let _detailVideos = [];
let _detailChannel = null;
let _channelDescCache = {};
let _lastSearchResults = [];
let _discoveredChannels = [];
let _discoveryDone = false;
let _nextPageToken = null;
let _lastQuery = '';
let _lastSubMin = 0;
let _lastSubMax = 0;

export function setupChannelSearch() {
    initCustomDropdowns();
    document.getElementById('channelSearchSubmitBtn').addEventListener('click', submitChannelSearch);
    document.getElementById('channelClearFilters').addEventListener('click', () => {
        document.getElementById('channelSearchKeyword').value = '';
        document.getElementById('channelSubMin').value = '0';
        document.getElementById('channelSubMax').value = '0';
        syncCustomDropdowns();
    });
    document.getElementById('channelSearchKeyword').addEventListener('keydown', e => { if (e.key === 'Enter') submitChannelSearch(); });

    // Detail modal
    document.getElementById('closeChannelDetailModal').addEventListener('click', closeChannelDetail);
    document.getElementById('channelDetailModal').addEventListener('click', e => {
        if (e.target === e.currentTarget) closeChannelDetail();
    });

    // Sort buttons
    document.querySelector('.ch-detail-sort').addEventListener('click', e => {
        const btn = e.target.closest('.ch-sort-btn');
        if (!btn) return;
        document.querySelectorAll('.ch-sort-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderDetailVideos(btn.dataset.sort);
    });

    // Compare modal
    document.getElementById('closeChannelCompareModal').addEventListener('click', () => {
        document.getElementById('channelCompareModal').classList.remove('active');
    });
    document.getElementById('channelCompareModal').addEventListener('click', e => {
        if (e.target === e.currentTarget) document.getElementById('channelCompareModal').classList.remove('active');
    });

    // Compare button
    document.getElementById('channelCompareBtn').addEventListener('click', openChannelCompare);

    // Reference subtabs
    document.querySelectorAll('.ref-subtab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.ref-subtab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.ref-subtab-panel').forEach(p => p.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById(tab.dataset.subtab === 'channels' ? 'refPanelChannels' : 'refPanelContent').classList.add('active');
        });
    });
}

function submitChannelSearch() {
    const query = document.getElementById('channelSearchKeyword').value.trim();
    if (!query) { toast(t('toast.searchRequired')); return; }
    const subMin = parseInt(document.getElementById('channelSubMin').value) || 0;
    const subMax = parseInt(document.getElementById('channelSubMax').value) || 0;
    performChannelSearch(query, subMin, subMax);
}

async function performChannelSearch(query, subMin, subMax, pageToken) {
    if (checkGuestBlock()) return;
    const grid = document.getElementById('channelGrid');
    const infoEl = document.getElementById('channelResultInfo');
    const hasSubFilter = subMin > 0 || subMax > 0;
    const isLoadMore = !!pageToken;

    if (!isLoadMore) {
        _lastSearchResults = [];
        _discoveredChannels = [];
        _discoveryDone = false;
        _nextPageToken = null;
        _lastQuery = query;
        _lastSubMin = subMin;
        _lastSubMax = subMax;
        grid.innerHTML = hasSubFilter
            ? `<div class="discover-loading">${t('channel.filterLoading')}</div>`
            : `<div class="discover-loading">${t('channel.loading')}</div>`;
    }

    try {
        const tokenParam = pageToken ? `&pageToken=${pageToken}` : '';
        const res = await fetch(`/api/youtube/search-channels?q=${encodeURIComponent(query)}&maxResults=50${tokenParam}`);
        if (!res.ok) {
            const err = await res.json();
            if (err.limitExceeded === 'channelSearch') {
                toast(err.error);
                state.usage.channelSearchCount = err.used || state.usage.channelSearchCount;
                updatePlanBadge();
                if (!isLoadMore) grid.innerHTML = `<div class="discover-empty"><p>${escapeHtml(err.error)}</p></div>`;
                return;
            }
            throw new Error(err.error || t('misc.searchFail'));
        }
        state.usage.channelSearchCount++;
        updatePlanBadge();
        const data = await res.json();
        let channels = data.channels || data;
        _nextPageToken = data.nextPageToken || null;

        if (subMin > 0) channels = channels.filter(ch => ch.subscriberCount >= subMin);
        if (subMax > 0) channels = channels.filter(ch => ch.subscriberCount <= subMax);

        _lastSearchResults = [..._lastSearchResults, ...channels];

        infoEl.textContent = hasSubFilter
            ? t('discover.fetchMatch', { total: _lastSearchResults.length, match: _lastSearchResults.length })
            : t('discover.resultCount', { n: _lastSearchResults.length });

        if (!isLoadMore) {
            showResultSort('relevance');
            // Fire-and-forget discovery
            fetchDiscoveredChannels(query, subMin, subMax);
        } else {
            // 더보기 후 발굴 결과에서 중복 자동 제거
            const nameIds = new Set(_lastSearchResults.map(ch => ch.id));
            _discoveredChannels = _discoveredChannels.filter(ch => !nameIds.has(ch.id));
        }
        renderChannelGrid(_lastSearchResults, _discoveredChannels);
        renderLoadMoreBtn();
    } catch (err) {
        if (!isLoadMore) {
            grid.innerHTML = `<div class="discover-empty"><p style="color:var(--red)">${t('misc.error', { msg: escapeHtml(err.message) })}</p></div>`;
        }
    }
}

async function fetchDiscoveredChannels(query, subMin, subMax) {
    const querySnapshot = query;
    try {
        const excludeIds = _lastSearchResults.map(ch => ch.id).join(',');
        const res = await fetch(`/api/youtube/discover-channels?q=${encodeURIComponent(query)}&excludeIds=${encodeURIComponent(excludeIds)}`);
        if (!res.ok) return;
        const data = await res.json();

        // Stale check
        if (_lastQuery !== querySnapshot) return;

        let channels = data.channels || [];
        // 구독자 필터 적용
        if (subMin > 0) channels = channels.filter(ch => ch.subscriberCount >= subMin);
        if (subMax > 0) channels = channels.filter(ch => ch.subscriberCount <= subMax);
        // 중복 제거
        const nameIds = new Set(_lastSearchResults.map(ch => ch.id));
        channels = channels.filter(ch => !nameIds.has(ch.id));

        _discoveredChannels = channels;
        _discoveryDone = true;
        renderChannelGrid(_lastSearchResults, _discoveredChannels);
    } catch {
        _discoveryDone = true;
    }
}

function renderLoadMoreBtn() {
    let wrap = document.getElementById('channelLoadMoreWrap');
    if (!wrap) {
        wrap = document.createElement('div');
        wrap.id = 'channelLoadMoreWrap';
        wrap.className = 'discover-more-wrap';
        document.getElementById('channelGrid').after(wrap);
    }
    if (_nextPageToken) {
        wrap.innerHTML = `<button class="btn btn-secondary" id="channelLoadMoreBtn">더보기</button>`;
        document.getElementById('channelLoadMoreBtn').addEventListener('click', () => {
            wrap.innerHTML = `<div class="discover-loading">로딩 중...</div>`;
            performChannelSearch(_lastQuery, _lastSubMin, _lastSubMax, _nextPageToken);
        });
    } else {
        wrap.innerHTML = '';
    }
}

function isChannelSaved(channelId) {
    return state.savedChannels.some(ch => ch.id === channelId);
}

function showResultSort(activeSort) {
    const sortBar = document.getElementById('channelSortBar');
    if (!_lastSearchResults.length) { sortBar.style.display = 'none'; return; }
    sortBar.style.display = 'flex';
    const sorts = [
        { key: 'relevance', label: '관련도순' },
        { key: 'subscribers', label: '구독자순' },
        { key: 'views', label: '조회수순' },
        { key: 'videos', label: '영상수순' },
        { key: 'efficiency', label: '영상 대비 구독자순' },
    ];
    sortBar.innerHTML = sorts.map(s =>
        `<button class="ch-sort-btn${s.key === activeSort ? ' active' : ''}" data-sort="${s.key}">${s.label}</button>`
    ).join('');
    sortBar.querySelectorAll('.ch-sort-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            sortBar.querySelectorAll('.ch-sort-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const sorted = sortChannels(_lastSearchResults, btn.dataset.sort);
            renderChannelGrid(sorted, _discoveredChannels);
        });
    });
}

function sortChannels(channels, sortKey) {
    const arr = [...channels];
    switch (sortKey) {
        case 'subscribers': return arr.sort((a, b) => b.subscriberCount - a.subscriberCount);
        case 'views': return arr.sort((a, b) => b.viewCount - a.viewCount);
        case 'videos': return arr.sort((a, b) => b.videoCount - a.videoCount);
        case 'efficiency': return arr.sort((a, b) => {
            const ea = a.videoCount > 0 ? a.subscriberCount / a.videoCount : 0;
            const eb = b.videoCount > 0 ? b.subscriberCount / b.videoCount : 0;
            return eb - ea;
        });
        default: return arr;
    }
}

function channelCardHtml(ch) {
    const saved = isChannelSaved(ch.id);
    return `
    <div class="channel-card" data-channel-id="${ch.id}" data-desc="${escapeHtml(ch.description || '')}">
        <button class="ch-bookmark-btn ${saved ? 'active' : ''}" data-id="${ch.id}" data-title="${escapeHtml(ch.title)}" data-thumb="${ch.thumbnail}" data-handle="${escapeHtml(ch.customUrl || '')}" data-subs="${ch.subscriberCount}" data-views="${ch.viewCount}" data-vids="${ch.videoCount}" title="저장">${saved ? '★' : '☆'}</button>
        <img class="channel-card-thumb" src="${ch.thumbnail}" alt="${escapeHtml(ch.title)}">
        <div class="channel-card-body">
            <div class="channel-card-name">${escapeHtml(ch.title)}</div>
            <div class="channel-card-meta">${formatNumber(ch.subscriberCount)} ${t('channel.subscribers')}</div>
        </div>
    </div>`;
}

function renderChannelGrid(nameResults, discoveredResults) {
    const grid = document.getElementById('channelGrid');
    const allChannels = [...(nameResults || []), ...(discoveredResults || [])];

    if (!allChannels.length) {
        grid.innerHTML = `<div class="discover-empty"><p>${t('discover.noResults')}</p></div>`;
        return;
    }

    // Cache descriptions
    allChannels.forEach(ch => { if (ch.description) _channelDescCache[ch.id] = ch.description; });

    let html = (nameResults || []).map(ch => channelCardHtml(ch)).join('');

    if (discoveredResults && discoveredResults.length > 0) {
        html += `<div class="ch-section-divider"><span class="ch-section-label">관련 채널</span></div>`;
        html += discoveredResults.map(ch => channelCardHtml(ch)).join('');
    }

    grid.innerHTML = html;

    // Card click → detail
    grid.querySelectorAll('.channel-card').forEach(card => {
        card.addEventListener('click', e => {
            if (e.target.closest('.channel-card-actions') || e.target.closest('.ch-bookmark-btn')) return;
            openChannelDetail(card.dataset.channelId);
        });
    });

    // Bookmark buttons
    grid.querySelectorAll('.ch-bookmark-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            toggleChannelBookmark(btn);
        });
    });
}

// ===== Bookmark =====

function toggleChannelBookmark(btn) {
    const channelId = btn.dataset.id;
    const idx = state.savedChannels.findIndex(ch => ch.id === channelId);

    if (idx >= 0) {
        state.savedChannels.splice(idx, 1);
        btn.classList.remove('active');
        btn.textContent = '☆';
        toast('채널 저장 해제');
    } else {
        state.savedChannels.push({
            id: channelId,
            title: btn.dataset.title,
            thumbnail: btn.dataset.thumb,
            customUrl: btn.dataset.handle,
            subscriberCount: parseInt(btn.dataset.subs) || 0,
            viewCount: parseInt(btn.dataset.views) || 0,
            videoCount: parseInt(btn.dataset.vids) || 0,
            savedAt: new Date().toISOString()
        });
        btn.classList.add('active');
        btn.textContent = '★';
        toast('채널 저장됨');
    }

    saveSavedChannels();
    renderSavedChannels();
}

export function renderSavedChannels() {
    const list = document.getElementById('savedChannelsList');
    const countEl = document.getElementById('savedChannelCount');
    const compareBtn = document.getElementById('channelCompareBtn');

    countEl.textContent = `${state.savedChannels.length}개의 채널`;
    compareBtn.style.display = state.savedChannels.length >= 2 ? '' : 'none';

    if (!state.savedChannels.length) {
        list.innerHTML = `
            <div class="discover-empty" style="grid-column:1/-1">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color:var(--text-muted);margin-bottom:12px"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
                <p>저장된 채널이 없습니다</p>
                <p style="font-size:12px;color:var(--text-muted);margin-top:4px">채널 탐색에서 ☆ 버튼으로 채널을 저장해보세요</p>
            </div>`;
        return;
    }

    list.innerHTML = state.savedChannels.map(ch => `
        <div class="ch-saved-card" data-id="${ch.id}">
            <img class="ch-saved-card-thumb" src="${ch.thumbnail}" alt="">
            <div class="ch-saved-card-body">
                <div class="ch-saved-card-name">${escapeHtml(ch.title)}</div>
                <div class="ch-saved-card-meta">${formatNumber(ch.subscriberCount)} 구독자 · ${formatNumber(ch.videoCount)} 영상 · ${formatNumber(ch.viewCount)} 조회수</div>
            </div>
            <button class="ch-saved-card-remove" data-id="${ch.id}" title="삭제">&times;</button>
        </div>
    `).join('');

    // Card click → detail
    list.querySelectorAll('.ch-saved-card').forEach(card => {
        card.addEventListener('click', e => {
            if (e.target.closest('.ch-saved-card-remove')) return;
            openChannelDetail(card.dataset.id);
        });
    });

    // Remove button
    list.querySelectorAll('.ch-saved-card-remove').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const idx = state.savedChannels.findIndex(ch => ch.id === btn.dataset.id);
            if (idx >= 0) {
                state.savedChannels.splice(idx, 1);
                saveSavedChannels();
                renderSavedChannels();
                const gridBtn = document.querySelector(`.ch-bookmark-btn[data-id="${btn.dataset.id}"]`);
                if (gridBtn) { gridBtn.classList.remove('active'); gridBtn.textContent = '☆'; }
                toast('채널 저장 해제');
            }
        });
    });
}

// ===== Channel Detail =====

async function openChannelDetail(channelId) {
    if (checkGuestBlock()) return;
    const modal = document.getElementById('channelDetailModal');
    const headerEl = document.getElementById('channelDetailHeader');
    const videosEl = document.getElementById('channelDetailVideos');

    modal.classList.add('active');
    headerEl.innerHTML = '<div class="discover-loading" style="padding:20px">로딩 중...</div>';
    videosEl.innerHTML = '';

    // Reset sort
    document.querySelectorAll('.ch-sort-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('.ch-sort-btn[data-sort="date"]').classList.add('active');

    try {
        const [channelRes, videosRes] = await Promise.all([
            fetch(`/api/youtube/channel?channelId=${channelId}&refresh=true`),
            fetch(`/api/youtube/videos?channelId=${channelId}`)
        ]);

        if (!channelRes.ok || !videosRes.ok) throw new Error('채널 데이터를 불러올 수 없습니다');

        _detailChannel = await channelRes.json();
        _detailChannel.id = channelId;
        _detailVideos = await videosRes.json();

        const ch = _detailChannel;
        const saved = isChannelSaved(channelId);

        const desc = _channelDescCache[channelId] || '';

        // 평균 조회수/좋아요 계산
        const avgViews = _detailVideos.length > 0
            ? Math.round(_detailVideos.reduce((s, v) => s + (v.viewCount || 0), 0) / _detailVideos.length) : 0;
        const avgLikes = _detailVideos.length > 0
            ? Math.round(_detailVideos.reduce((s, v) => s + (v.likeCount || 0), 0) / _detailVideos.length) : 0;

        // 태그 파싱
        const tags = ch.keywords ? ch.keywords.match(/"[^"]+"|[^\s"]+/g)?.map(t => t.replace(/"/g, '')) || [] : [];

        const statItems = [
            { label: '구독자', value: formatNumber(ch.subscriberCount) },
            { label: '영상', value: formatNumber(ch.videoCount) },
            { label: '총 조회수', value: formatNumber(ch.viewCount) },
            { label: '평균 조회수', value: formatNumber(avgViews) },
            { label: '평균 좋아요', value: formatNumber(avgLikes) },
            { label: '국가', value: ch.country || '-' },
        ];

        headerEl.innerHTML = `
            <div class="ch-detail-top">
                <img class="ch-detail-avatar" src="${ch.thumbnail}" alt="">
                <div class="ch-detail-info">
                    <div class="ch-detail-name">${escapeHtml(ch.title)}</div>
                    <div class="ch-detail-handle">${escapeHtml(ch.customUrl || '')}</div>
                </div>
                <button class="ch-detail-bookmark ${saved ? 'active' : ''}" id="detailBookmarkBtn"
                data-id="${ch.id}" data-title="${escapeHtml(ch.title)}" data-thumb="${ch.thumbnail}"
                data-handle="${escapeHtml(ch.customUrl || '')}" data-subs="${ch.subscriberCount}"
                data-views="${ch.viewCount}" data-vids="${ch.videoCount}">${saved ? '★' : '☆'}</button>
            </div>
            <div class="ch-detail-stat-grid">
                ${statItems.map(s => `<div class="ch-detail-stat-cell"><span class="ch-detail-stat-label">${s.label}</span><span class="ch-detail-stat-value">${s.value}</span></div>`).join('')}
            </div>
            ${tags.length > 0 ? `<div class="ch-detail-tags-wrap"><span class="ch-detail-tags-label">채널 태그</span><div class="ch-detail-tags">${tags.map(t => `<span class="ch-detail-tag">${escapeHtml(t)}</span>`).join('')}</div></div>` : ''}
            ${desc ? `<div class="ch-detail-desc">${escapeHtml(desc)}</div>` : ''}
        `;

        document.getElementById('detailBookmarkBtn').addEventListener('click', function () {
            toggleChannelBookmarkFromDetail(this);
        });

        renderDetailVideos('date');
    } catch (err) {
        headerEl.innerHTML = `<div class="discover-empty" style="padding:20px"><p style="color:var(--red)">${escapeHtml(err.message)}</p></div>`;
    }
}

function toggleChannelBookmarkFromDetail(btn) {
    const channelId = btn.dataset.id;
    const idx = state.savedChannels.findIndex(ch => ch.id === channelId);

    if (idx >= 0) {
        state.savedChannels.splice(idx, 1);
        btn.classList.remove('active');
        btn.textContent = '☆';
        toast('채널 저장 해제');
    } else {
        state.savedChannels.push({
            id: channelId,
            title: btn.dataset.title,
            thumbnail: btn.dataset.thumb,
            customUrl: btn.dataset.handle,
            subscriberCount: parseInt(btn.dataset.subs) || 0,
            viewCount: parseInt(btn.dataset.views) || 0,
            videoCount: parseInt(btn.dataset.vids) || 0,
            savedAt: new Date().toISOString()
        });
        btn.classList.add('active');
        btn.textContent = '★';
        toast('채널 저장됨');
    }

    saveSavedChannels();
    renderSavedChannels();

    // Sync grid bookmark btn
    const gridBtn = document.querySelector(`.ch-bookmark-btn[data-id="${channelId}"]`);
    if (gridBtn) {
        gridBtn.classList.toggle('active', isChannelSaved(channelId));
        gridBtn.textContent = isChannelSaved(channelId) ? '★' : '☆';
    }
}

function renderDetailVideos(sortBy) {
    const el = document.getElementById('channelDetailVideos');
    if (!_detailVideos.length) {
        el.innerHTML = '<div class="discover-empty"><p>영상이 없습니다</p></div>';
        return;
    }

    let filtered = [..._detailVideos];
    if (sortBy === 'shorts-views') {
        filtered = filtered.filter(v => v.duration && parseDurationToSeconds(v.duration) <= 70);
    } else if (sortBy === 'long-views') {
        filtered = filtered.filter(v => !v.duration || parseDurationToSeconds(v.duration) > 70);
    }

    const sorted = filtered.sort((a, b) => {
        if (sortBy === 'views' || sortBy === 'shorts-views' || sortBy === 'long-views') return (b.viewCount || 0) - (a.viewCount || 0);
        if (sortBy === 'likes') return (b.likeCount || 0) - (a.likeCount || 0);
        return new Date(b.publishedAt) - new Date(a.publishedAt);
    });

    el.innerHTML = sorted.map(v => {
        const thumb = v.thumbnail || `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`;
        return `
        <div class="ch-video-item">
            <img class="ch-video-thumb" src="${thumb}" alt="">
            <div class="ch-video-info">
                <div class="ch-video-title"><a href="https://www.youtube.com/watch?v=${v.id}" target="_blank">${escapeHtml(v.title)}</a></div>
                <div class="ch-video-meta">
                    <span>${formatNumber(v.viewCount || 0)} views</span>
                    <span>${formatNumber(v.likeCount || 0)} likes</span>
                    <span>${v.publishedAt ? formatRelativeTime(v.publishedAt) : ''}</span>
                </div>
            </div>
        </div>`;
    }).join('');
}

function closeChannelDetail() {
    document.getElementById('channelDetailModal').classList.remove('active');
    _detailVideos = [];
    _detailChannel = null;
}

// ===== Channel Compare =====

async function openChannelCompare() {
    const selected = state.savedChannels;
    if (selected.length < 2) {
        toast('비교하려면 최소 2개 채널을 저장하세요');
        return;
    }

    const toCompare = selected.slice(0, 3);
    const modal = document.getElementById('channelCompareModal');
    const table = document.getElementById('channelCompareTable');

    modal.classList.add('active');

    const rows = [
        { label: '', key: 'avatar' },
        { label: '채널명', key: 'title' },
        { label: '구독자', key: 'subscriberCount' },
        { label: '총 조회수', key: 'viewCount' },
        { label: '영상 수', key: 'videoCount' },
        { label: '평균 조회수/영상', key: 'avgViews' }
    ];

    const data = toCompare.map(ch => ({
        ...ch,
        avgViews: ch.videoCount > 0 ? Math.round(ch.viewCount / ch.videoCount) : 0
    }));

    // Find best for each metric
    const numKeys = ['subscriberCount', 'viewCount', 'videoCount', 'avgViews'];
    const best = {};
    numKeys.forEach(key => {
        const maxVal = Math.max(...data.map(d => d[key]));
        best[key] = maxVal;
    });

    table.innerHTML = rows.map(row => {
        const cells = data.map(ch => {
            if (row.key === 'avatar') {
                return `<td><img class="ch-compare-avatar" src="${ch.thumbnail}" alt=""><br><span style="font-size:12px;color:var(--text-muted)">${escapeHtml(ch.customUrl || '')}</span></td>`;
            }
            if (row.key === 'title') {
                return `<td style="font-weight:600">${escapeHtml(ch.title)}</td>`;
            }
            const val = ch[row.key];
            const isBest = numKeys.includes(row.key) && val === best[row.key] && data.filter(d => d[row.key] === val).length === 1;
            return `<td class="${isBest ? 'ch-compare-best' : ''}">${formatNumber(val)}</td>`;
        }).join('');
        return `<tr><td class="ch-compare-label">${row.label}</td>${cells}</tr>`;
    }).join('');
}

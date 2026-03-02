// ===== Channel Search (채널 탐색) =====
import { state, saveSavedChannels } from './state.js';
import { escapeHtml, formatNumber, toast, formatRelativeTime } from './utils.js';
import { checkGuestBlock } from './auth.js';

let _detailVideos = [];
let _detailChannel = null;
let _channelDescCache = {};
let _lastSearchResults = [];

export function setupChannelSearch() {
    document.getElementById('channelSearchSubmitBtn').addEventListener('click', submitChannelSearch);
    document.getElementById('channelSearchResetBtn').addEventListener('click', () => {
        document.getElementById('channelSearchKeyword').value = '';
        document.getElementById('channelSubMin').value = '0';
        document.getElementById('channelSubMax').value = '0';
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

    // Render saved channels on load
    renderSavedChannels();
}

function submitChannelSearch() {
    const query = document.getElementById('channelSearchKeyword').value.trim();
    if (!query) { toast(t('toast.searchRequired')); return; }
    const subMin = parseInt(document.getElementById('channelSubMin').value) || 0;
    const subMax = parseInt(document.getElementById('channelSubMax').value) || 0;
    performChannelSearch(query, subMin, subMax);
}

async function performChannelSearch(query, subMin, subMax) {
    if (checkGuestBlock()) return;
    const grid = document.getElementById('channelGrid');
    const infoEl = document.getElementById('channelResultInfo');
    const hasSubFilter = subMin > 0 || subMax > 0;
    const fetchCount = 50;

    grid.innerHTML = hasSubFilter
        ? `<div class="discover-loading">${t('channel.filterLoading')}</div>`
        : `<div class="discover-loading">${t('channel.loading')}</div>`;

    try {
        const res = await fetch(`/api/youtube/search-channels?q=${encodeURIComponent(query)}&maxResults=${fetchCount}`);
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || t('misc.searchFail'));
        }
        let channels = await res.json();
        const totalFetched = channels.length;

        if (subMin > 0) channels = channels.filter(ch => ch.subscriberCount >= subMin);
        if (subMax > 0) channels = channels.filter(ch => ch.subscriberCount <= subMax);

        infoEl.textContent = hasSubFilter
            ? t('discover.fetchMatch', { total: totalFetched, match: channels.length })
            : t('discover.resultCount', { n: channels.length });
        _lastSearchResults = channels;
        showResultSort('relevance');
        renderChannelResults(channels);
    } catch (err) {
        grid.innerHTML = `<div class="discover-empty"><p style="color:var(--red)">${t('misc.error', { msg: escapeHtml(err.message) })}</p></div>`;
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
            renderChannelResults(sorted);
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

function renderChannelResults(channels) {
    const grid = document.getElementById('channelGrid');
    if (!channels || channels.length === 0) {
        grid.innerHTML = `<div class="discover-empty"><p>${t('discover.noResults')}</p></div>`;
        return;
    }

    channels.forEach(ch => { if (ch.description) _channelDescCache[ch.id] = ch.description; });

    grid.innerHTML = channels.map(ch => {
        const saved = isChannelSaved(ch.id);
        return `
        <div class="channel-card" data-channel-id="${ch.id}" data-desc="${escapeHtml(ch.description || '')}">
            <button class="ch-bookmark-btn ${saved ? 'active' : ''}" data-id="${ch.id}" data-title="${escapeHtml(ch.title)}" data-thumb="${ch.thumbnail}" data-handle="${escapeHtml(ch.customUrl || '')}" data-subs="${ch.subscriberCount}" data-views="${ch.viewCount}" data-vids="${ch.videoCount}" title="저장">${saved ? '★' : '☆'}</button>
            <img class="channel-card-thumb" src="${ch.thumbnail}" alt="${escapeHtml(ch.title)}">
            <div class="channel-card-body">
                <div class="channel-card-name">${escapeHtml(ch.title)}</div>
                <div class="channel-card-meta">${formatNumber(ch.subscriberCount)} ${t('channel.subscribers')} · ${formatNumber(ch.videoCount)} ${t('channel.videos')} · ${formatNumber(ch.viewCount)} ${t('channel.totalViews')}</div>
            </div>
        </div>`;
    }).join('');

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
    const section = document.getElementById('savedChannelsSection');
    const list = document.getElementById('savedChannelsList');
    const compareBtn = document.getElementById('channelCompareBtn');

    if (!state.savedChannels.length) {
        section.style.display = 'none';
        return;
    }

    section.style.display = '';
    compareBtn.style.display = state.savedChannels.length >= 2 ? '' : 'none';

    list.innerHTML = state.savedChannels.map(ch => `
        <div class="ch-saved-chip" data-id="${ch.id}">
            <img src="${ch.thumbnail}" alt="">
            <span>${escapeHtml(ch.title)}</span>
            <span style="color:var(--text-muted);font-size:11px">${formatNumber(ch.subscriberCount)}</span>
            <button class="ch-saved-remove" data-id="${ch.id}" title="삭제">&times;</button>
        </div>
    `).join('');

    // Chip click → detail
    list.querySelectorAll('.ch-saved-chip').forEach(chip => {
        chip.addEventListener('click', e => {
            if (e.target.closest('.ch-saved-remove')) return;
            openChannelDetail(chip.dataset.id);
        });
    });

    // Remove button
    list.querySelectorAll('.ch-saved-remove').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const idx = state.savedChannels.findIndex(ch => ch.id === btn.dataset.id);
            if (idx >= 0) {
                state.savedChannels.splice(idx, 1);
                saveSavedChannels();
                renderSavedChannels();
                // Update bookmark buttons in grid if visible
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
            fetch(`/api/youtube/channel?channelId=${channelId}`),
            fetch(`/api/youtube/videos?channelId=${channelId}`)
        ]);

        if (!channelRes.ok || !videosRes.ok) throw new Error('채널 데이터를 불러올 수 없습니다');

        _detailChannel = await channelRes.json();
        _detailChannel.id = channelId;
        _detailVideos = await videosRes.json();

        const ch = _detailChannel;
        const saved = isChannelSaved(channelId);

        const desc = _channelDescCache[channelId] || '';

        headerEl.innerHTML = `
            <img class="ch-detail-avatar" src="${ch.thumbnail}" alt="">
            <div class="ch-detail-info">
                <div class="ch-detail-name">${escapeHtml(ch.title)}</div>
                <div class="ch-detail-handle">${escapeHtml(ch.customUrl || '')}</div>
                <div class="ch-detail-stats">
                    <span>구독자 <strong>${formatNumber(ch.subscriberCount)}</strong></span>
                    <span>영상 <strong>${formatNumber(ch.videoCount)}</strong></span>
                    <span>총 조회수 <strong>${formatNumber(ch.viewCount)}</strong></span>
                </div>
                ${desc ? `<div class="ch-detail-desc">${escapeHtml(desc)}</div>` : ''}
            </div>
            <button class="ch-detail-bookmark ${saved ? 'active' : ''}" id="detailBookmarkBtn"
                data-id="${ch.id}" data-title="${escapeHtml(ch.title)}" data-thumb="${ch.thumbnail}"
                data-handle="${escapeHtml(ch.customUrl || '')}" data-subs="${ch.subscriberCount}"
                data-views="${ch.viewCount}" data-vids="${ch.videoCount}">${saved ? '★' : '☆'}</button>
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

    const sorted = [..._detailVideos].sort((a, b) => {
        if (sortBy === 'views') return (b.viewCount || 0) - (a.viewCount || 0);
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

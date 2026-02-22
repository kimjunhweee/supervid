// ===== Discover (콘텐츠 탐색) =====
import { checkGuestBlock } from './auth.js';
import { escapeHtml, formatNumber, toast, velocityBadgeHtml } from './utils.js';
import { saveAsReference } from './references.js';

let _lastSearchParams = null;
let _discoverNextPageToken = null;
let _discoverAllVideos = [];

export function setupDiscover() {
    document.getElementById('openSearchModalBtn').addEventListener('click', openSearchModal);
    document.getElementById('closeSearchModal').addEventListener('click', closeSearchModal);
    document.getElementById('searchModal').addEventListener('click', e => { if (e.target === e.currentTarget) closeSearchModal(); });
    document.getElementById('searchSubmitBtn').addEventListener('click', submitSearch);
    document.getElementById('searchResetBtn').addEventListener('click', resetSearchForm);
    document.getElementById('searchKeyword').addEventListener('keydown', e => { if (e.key === 'Enter') submitSearch(); });
}

function openSearchModal() {
    if (_lastSearchParams) {
        document.getElementById('searchKeyword').value = _lastSearchParams.query || '';
        document.getElementById('searchDuration').value = _lastSearchParams.duration || '';
        document.getElementById('searchOrder').value = _lastSearchParams.order || 'viewCount';
        document.getElementById('searchSubMin').value = _lastSearchParams.subMin || '0';
        document.getElementById('searchSubMax').value = _lastSearchParams.subMax || '0';
    }
    document.getElementById('searchModal').classList.add('active');
    document.getElementById('searchKeyword').focus();
}

function closeSearchModal() {
    document.getElementById('searchModal').classList.remove('active');
}

function resetSearchForm() {
    document.getElementById('searchKeyword').value = '';
    document.getElementById('searchDuration').value = '';
    document.getElementById('searchOrder').value = 'viewCount';
    document.getElementById('searchSubMin').value = '0';
    document.getElementById('searchSubMax').value = '0';
}

function submitSearch() {
    const query = document.getElementById('searchKeyword').value.trim();
    if (!query) { toast(t('toast.searchRequired')); return; }

    const params = {
        query,
        duration: document.getElementById('searchDuration').value,
        order: document.getElementById('searchOrder').value,
        subMin: document.getElementById('searchSubMin').value,
        subMax: document.getElementById('searchSubMax').value
    };
    _lastSearchParams = params;
    closeSearchModal();
    performSearch(params);
}

function calcVelocityScore(video) {
    const days = Math.max(1, Math.floor((Date.now() - new Date(video.publishedAt).getTime()) / 86400000));
    const subs = video.subscriberCount || 1;
    return (video.viewCount / subs) / days;
}

async function performSearch(params, loadMore) {
    if (checkGuestBlock()) return;
    const grid = document.getElementById('discoverGrid');
    const infoEl = document.getElementById('discoverResultInfo');
    updateActiveFilters(params);

    const hasSubFilter = parseInt(params.subMin) > 0 || parseInt(params.subMax) > 0;
    const pages = hasSubFilter ? 3 : 1;
    const perPage = hasSubFilter ? 50 : 12;

    if (!loadMore) {
        _discoverAllVideos = [];
        _discoverNextPageToken = null;
        if (hasSubFilter) {
            grid.innerHTML = `<div class="discover-loading">${t('discover.filterLoading')}</div>`;
        } else {
            grid.innerHTML = `<div class="discover-loading">${t('discover.loading')}</div>`;
        }
    } else {
        const moreBtn = document.getElementById('discoverMoreBtn');
        if (moreBtn) { moreBtn.disabled = true; moreBtn.textContent = t('discover.loading'); }
    }

    try {
        const apiOrder = (params.order === 'performance' || params.order === 'velocity') ? 'viewCount' : params.order;
        const durationParam = params.duration ? `&videoDuration=${encodeURIComponent(params.duration)}` : '';
        const tokenParam = loadMore && _discoverNextPageToken ? `&pageToken=${encodeURIComponent(_discoverNextPageToken)}` : '';
        const res = await fetch(`/api/youtube/search?q=${encodeURIComponent(params.query)}&order=${encodeURIComponent(apiOrder)}&maxResults=${perPage}&pages=${pages}${durationParam}${tokenParam}`);
        if (!res.ok) {
            let msg = t('misc.searchFail');
            try { const err = await res.json(); msg = err.error || msg; } catch {}
            throw new Error(msg);
        }
        const data = await res.json();
        let videos = data.videos || data;
        _discoverNextPageToken = data.nextPageToken || null;

        // Subscriber filter
        const subMin = parseInt(params.subMin) || 0;
        const subMax = parseInt(params.subMax) || 0;
        if (subMin > 0) videos = videos.filter(v => (v.subscriberCount || 0) >= subMin);
        if (subMax > 0) videos = videos.filter(v => (v.subscriberCount || 0) <= subMax);

        if (params.order === 'performance') {
            videos.sort((a, b) => b.viewToSubRatio - a.viewToSubRatio);
        } else if (params.order === 'velocity') {
            videos.sort((a, b) => calcVelocityScore(b) - calcVelocityScore(a));
        }

        _discoverAllVideos = _discoverAllVideos.concat(videos);

        const infoText = hasSubFilter
            ? t('discover.resultFiltered', { n: _discoverAllVideos.length })
            : t('discover.resultCount', { n: _discoverAllVideos.length });
        infoEl.textContent = infoText;
        renderDiscoverResults(_discoverAllVideos);
    } catch (err) {
        if (!loadMore) {
            grid.innerHTML = `<div class="discover-empty"><p style="color:var(--red)">${t('misc.error', { msg: escapeHtml(err.message) })}</p></div>`;
        } else {
            toast(t('toast.loadMoreFail') + err.message);
            const moreBtn = document.getElementById('discoverMoreBtn');
            if (moreBtn) { moreBtn.disabled = false; moreBtn.textContent = t('discover.loadMore'); }
        }
    }
}

function updateActiveFilters(params) {
    const container = document.getElementById('discoverActiveFilters');
    const chips = [];
    chips.push(`"${params.query}"`);

    const durationLabels = { short: t('discover.shorts'), medium: t('discover.medium'), long: t('discover.longPlus') };
    if (params.duration) chips.push(durationLabels[params.duration]);

    const orderLabels = { viewCount: t('discover.sortViews'), relevance: t('discover.sortRelevance'), date: t('discover.sortDate'), performance: t('discover.sortPerformance'), velocity: t('discover.sortVelocity') };
    chips.push(orderLabels[params.order] || t('discover.sortViews'));

    const subMin = parseInt(params.subMin) || 0;
    const subMax = parseInt(params.subMax) || 0;
    if (subMin > 0 || subMax > 0) {
        const fmt = n => n >= 10000 ? formatNumber(n) : n >= 1000 ? formatNumber(n) : n;
        let subLabel = t('channel.subscribers') + ' ';
        if (subMin > 0 && subMax > 0) subLabel += `${fmt(subMin)}~${fmt(subMax)}`;
        else if (subMin > 0) subLabel += t('discover.subAbove', { n: fmt(subMin) });
        else subLabel += t('discover.subBelow', { n: fmt(subMax) });
        chips.push(subLabel);
    }

    container.innerHTML = chips.map(c => `<span class="discover-filter-chip">${c}</span>`).join('');
}

function renderDiscoverResults(videos) {
    const grid = document.getElementById('discoverGrid');
    if (!videos || videos.length === 0) {
        grid.innerHTML = `<div class="discover-empty"><p>${t('discover.noResults')}</p></div>`;
        return;
    }

    grid.innerHTML = videos.map(v => {
        const dateFmt = getLang() === 'en' ? { year: 'numeric', month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' };
        const dateLocale = getLang() === 'en' ? 'en-US' : 'ko-KR';
        const date = new Date(v.publishedAt).toLocaleDateString(dateLocale, dateFmt);
        const ratio = v.viewToSubRatio || 0;
        const ratioClass = ratio >= 200 ? 'hot' : ratio >= 50 ? 'good' : 'normal';
        const ratioLabel = ratio >= 200 ? '🔥' : ratio >= 50 ? '✨' : '';
        return `
        <div class="discover-card">
            <img class="discover-card-thumb" src="${v.thumbnail}" alt="${escapeHtml(v.title)}">
            <div class="discover-card-body">
                <div class="discover-card-title">${escapeHtml(v.title)}</div>
                <div class="discover-card-channel">${escapeHtml(v.channelTitle)}</div>
                <div class="discover-card-stats">
                    <span>👁 ${formatNumber(v.viewCount)}</span>
                    <span>👍 ${formatNumber(v.likeCount)}</span>
                    <span>💬 ${formatNumber(v.commentCount)}</span>
                </div>
                <div class="discover-card-sub">${t('discover.subLabel', { n: formatNumber(v.subscriberCount || 0) })}</div>
                <span class="discover-card-ratio ${ratioClass}">${ratioLabel} ${t('discover.subRatioLabel', { n: ratio })}</span>
                ${velocityBadgeHtml(v)}
                <div class="discover-card-date">${date}</div>
            </div>
            <div class="discover-card-actions">
                <button class="btn btn-secondary discover-ref-btn" data-video='${JSON.stringify(v).replace(/'/g, '&#39;')}'>${t('discover.saveRef')}</button>
            </div>
        </div>`;
    }).join('');

    grid.querySelectorAll('.discover-ref-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const video = JSON.parse(btn.dataset.video);
            saveAsReference(video);
        });
    });

    // Load more button
    const oldBtn = document.getElementById('discoverMoreBtn');
    if (oldBtn) oldBtn.remove();
    if (_discoverNextPageToken && _lastSearchParams) {
        const wrap = document.createElement('div');
        wrap.className = 'discover-more-wrap';
        wrap.innerHTML = `<button class="btn btn-secondary" id="discoverMoreBtn">${t('discover.loadMore')}</button>`;
        grid.after(wrap);
        document.getElementById('discoverMoreBtn').addEventListener('click', () => {
            performSearch(_lastSearchParams, true);
        });
    }
}

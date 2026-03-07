// ===== Discover (콘텐츠 탐색) =====
import { checkGuestBlock } from './auth.js';
import { escapeHtml, formatNumber, toast, velocityBadgeHtml } from './utils.js';
import { saveAsReference } from './references.js';
import { state } from './state.js';
import { updatePlanBadge } from './nav.js';

let _lastSearchParams = null;
let _discoverNextPageToken = null;
let _discoverAllVideos = [];
let _discoverSource = null;  // 'db' | 'youtube'
let _discoverOffset = 0;
let _discoverViewMode = 'grid';
let _discoverHasMore = false;

export function updateSearchQuotaDisplay() {
    const el = document.getElementById('searchQuotaInfo');
    if (!el) return;
    const limit = state.usage.searchLimit;
    if (limit === -1) {
        el.textContent = '';
        return;
    }
    const remaining = Math.max(0, limit - state.usage.searchCount);
    el.textContent = `오늘 남은 검색: ${remaining}/${limit}`;
    el.style.color = remaining === 0 ? 'var(--red)' : 'var(--text-muted)';
}

export function setupDiscover() {
    initCustomDropdowns();
    document.getElementById('searchSubmitBtn').addEventListener('click', submitSearch);
    document.getElementById('searchClearFilters').addEventListener('click', resetSearchForm);
    document.getElementById('searchKeyword').addEventListener('keydown', e => { if (e.key === 'Enter') submitSearch(); });

    // View toggle
    document.querySelectorAll('.discover-view-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const mode = btn.dataset.view;
            if (mode === _discoverViewMode) return;
            _discoverViewMode = mode;
            document.querySelectorAll('.discover-view-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            if (_discoverAllVideos.length > 0) renderDiscoverResults(_discoverAllVideos, _discoverHasMore);
        });
    });

    updateSearchQuotaDisplay();
}

export function initCustomDropdowns() {
    document.querySelectorAll('.discover-inline-select').forEach(select => {
        if (select.dataset.customized) return;
        select.dataset.customized = '1';
        const wrapper = document.createElement('div');
        wrapper.className = 'c-select';
        wrapper._select = select;

        const trigger = document.createElement('div');
        trigger.className = 'c-select-trigger';

        const valueSpan = document.createElement('span');
        valueSpan.className = 'c-select-value';
        valueSpan.textContent = select.options[select.selectedIndex]?.text || '';

        const chevron = document.createElement('span');
        chevron.className = 'c-select-chevron';
        chevron.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>`;

        trigger.appendChild(valueSpan);
        trigger.appendChild(chevron);

        const menu = document.createElement('div');
        menu.className = 'c-select-menu';

        Array.from(select.options).forEach(opt => {
            const item = document.createElement('div');
            item.className = 'c-select-item' + (opt.selected ? ' selected' : '');
            item.dataset.value = opt.value;
            item.textContent = opt.text;
            item.addEventListener('click', () => {
                select.value = opt.value;
                valueSpan.textContent = opt.text;
                menu.querySelectorAll('.c-select-item').forEach(i => i.classList.remove('selected'));
                item.classList.add('selected');
                wrapper.classList.remove('open');
                // Highlight pill when non-default value selected
                const isDefault = select.selectedIndex === 0;
                wrapper.classList.toggle('active', !isDefault);
            });
            menu.appendChild(item);
        });

        trigger.addEventListener('click', e => {
            e.stopPropagation();
            const isOpen = wrapper.classList.contains('open');
            document.querySelectorAll('.c-select.open').forEach(el => el.classList.remove('open'));
            if (!isOpen) wrapper.classList.add('open');
        });

        wrapper.appendChild(trigger);
        wrapper.appendChild(menu);
        select.parentNode.insertBefore(wrapper, select);
    });

    document.addEventListener('click', () => {
        document.querySelectorAll('.c-select.open').forEach(el => el.classList.remove('open'));
        document.querySelectorAll('.c-range-chip.open').forEach(el => el.classList.remove('open'));
    });

    initRangeChips();
}

function initRangeChips() {
    document.querySelectorAll('.c-range-chip').forEach(chip => {
        if (chip.dataset.initialized) return;
        chip.dataset.initialized = '1';
        const trigger = chip.querySelector('.c-range-trigger');
        trigger.addEventListener('click', e => {
            e.stopPropagation();
            const isOpen = chip.classList.contains('open');
            document.querySelectorAll('.c-select.open').forEach(el => el.classList.remove('open'));
            document.querySelectorAll('.c-range-chip.open').forEach(el => el.classList.remove('open'));
            if (!isOpen) chip.classList.add('open');
        });
        // Stop clicks inside panel from closing
        chip.querySelector('.c-range-panel').addEventListener('click', e => e.stopPropagation());
        // Listen for select changes
        chip.querySelectorAll('select').forEach(sel => {
            sel.addEventListener('change', () => updateRangeChipLabel(chip));
        });
        updateRangeChipLabel(chip);
    });
}

function updateRangeChipLabel(chip) {
    const selects = chip.querySelectorAll('select');
    const minSel = selects[0];
    const maxSel = selects[1];
    const minVal = parseInt(minSel.value) || 0;
    const maxVal = parseInt(maxSel.value) || 0;
    const labelEl = chip.querySelector('.c-range-label');
    const baseLabel = chip.id.includes('Sub') || chip.id.includes('sub') ? '구독자' : '조회수';

    const fmt = v => {
        if (v >= 10000000) return (v / 10000000) + '000만';
        if (v >= 10000) return (v / 10000) + '만';
        if (v >= 1000) return (v / 1000) + '천';
        return String(v);
    };

    if (minVal > 0 && maxVal > 0) {
        labelEl.textContent = `${baseLabel} ${fmt(minVal)}~${fmt(maxVal)}`;
    } else if (minVal > 0) {
        labelEl.textContent = `${baseLabel} ${fmt(minVal)} 이상`;
    } else if (maxVal > 0) {
        labelEl.textContent = `${baseLabel} ${fmt(maxVal)} 이하`;
    } else {
        labelEl.textContent = baseLabel;
    }
    chip.classList.toggle('active', minVal > 0 || maxVal > 0);
}

export function syncCustomDropdowns() {
    document.querySelectorAll('.c-select').forEach(wrapper => {
        const select = wrapper._select;
        if (!select) return;
        const selected = select.options[select.selectedIndex];
        wrapper.querySelector('.c-select-value').textContent = selected?.text || '';
        wrapper.querySelectorAll('.c-select-item').forEach(item => {
            item.classList.toggle('selected', item.dataset.value === select.value);
        });
        const isDefault = select.selectedIndex === 0;
        wrapper.classList.toggle('active', !isDefault);
    });
    // Sync range chips
    document.querySelectorAll('.c-range-chip').forEach(chip => updateRangeChipLabel(chip));
}

function resetSearchForm() {
    document.getElementById('searchKeyword').value = '';
    document.getElementById('searchDuration').value = '';
    document.getElementById('searchOrder').value = 'viewCount';
    document.getElementById('searchSubMin').value = '0';
    document.getElementById('searchSubMax').value = '0';
    document.getElementById('searchViewMin').value = '0';
    document.getElementById('searchViewMax').value = '0';
    syncCustomDropdowns();
}

function submitSearch() {
    const query = document.getElementById('searchKeyword').value.trim();
    if (!query) { toast(t('toast.searchRequired')); return; }

    const params = {
        query,
        duration: document.getElementById('searchDuration').value,
        order: document.getElementById('searchOrder').value,
        subMin: document.getElementById('searchSubMin').value,
        subMax: document.getElementById('searchSubMax').value,
        viewMin: document.getElementById('searchViewMin').value,
        viewMax: document.getElementById('searchViewMax').value
    };
    _lastSearchParams = params;
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
    if (!loadMore) {
        _discoverAllVideos = [];
        _discoverNextPageToken = null;
        _discoverSource = null;
        _discoverOffset = 0;
        grid.innerHTML = `<div class="discover-loading">${t('discover.loading')}</div>`;
    } else {
        const moreBtn = document.getElementById('discoverMoreBtn');
        if (moreBtn) { moreBtn.disabled = true; moreBtn.textContent = t('discover.loading'); }
    }

    try {
        const urlParams = new URLSearchParams({ q: params.query, order: params.order, limit: '50' });
        if (params.duration) urlParams.set('duration', params.duration);
        if (parseInt(params.subMin) > 0) urlParams.set('subMin', params.subMin);
        if (parseInt(params.subMax) > 0) urlParams.set('subMax', params.subMax);
        if (parseInt(params.viewMin) > 0) urlParams.set('viewMin', params.viewMin);
        if (parseInt(params.viewMax) > 0) urlParams.set('viewMax', params.viewMax);

        if (loadMore && _discoverSource === 'youtube' && _discoverNextPageToken) {
            urlParams.set('pageToken', _discoverNextPageToken);
        } else if (loadMore && _discoverSource === 'db') {
            urlParams.set('offset', String(_discoverOffset));
        }

        const res = await fetch(`/api/db/search?${urlParams}`);
        if (!res.ok) {
            let msg = t('misc.searchFail');
            try {
                const err = await res.json();
                if (err.limitExceeded === 'search') {
                    toast(err.error);
                    // 사용량 업데이트
                    state.usage.searchCount = err.used || state.usage.searchCount;
                    updateSearchQuotaDisplay();
                    updatePlanBadge();
                    if (!loadMore) grid.innerHTML = `<div class="discover-empty"><p>${escapeHtml(err.error)}</p></div>`;
                    return;
                }
                msg = err.error || msg;
            } catch {}
            throw new Error(msg);
        }
        // 검색 성공 시 카운트 증가 표시
        state.usage.searchCount++;
        updateSearchQuotaDisplay();
        updatePlanBadge();
        const data = await res.json();
        const videos = data.videos || [];

        _discoverSource = data.source;
        _discoverNextPageToken = data.nextPageToken || null;
        _discoverOffset += videos.length;
        _discoverAllVideos = _discoverAllVideos.concat(videos);

        const sourceLabel = data.source === 'db' ? '📦 DB' : '🔴 YouTube';
        const total = data.total || _discoverAllVideos.length;
        infoEl.textContent = `${t('discover.resultCount', { n: total })} · ${sourceLabel}`;

        _discoverHasMore = data.hasMore;
        renderDiscoverResults(_discoverAllVideos, _discoverHasMore);
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

function renderDiscoverResults(videos, hasMore) {
    const grid = document.getElementById('discoverGrid');
    if (!videos || videos.length === 0) {
        grid.innerHTML = `<div class="discover-empty"><p>${t('discover.noResults')}</p></div>`;
        return;
    }

    if (_discoverViewMode === 'table') {
        renderDiscoverTable(videos, grid);
    } else {
        renderDiscoverGrid(videos, grid);
    }

    // Bind save buttons
    grid.querySelectorAll('.discover-ref-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const video = JSON.parse(btn.dataset.video);
            saveAsReference(video);
        });
    });

    // Load more button
    const oldBtn = document.getElementById('discoverMoreBtn');
    if (oldBtn) oldBtn.remove();
    if (hasMore && _lastSearchParams) {
        const wrap = document.createElement('div');
        wrap.className = 'discover-more-wrap';
        wrap.innerHTML = `<button class="btn btn-secondary" id="discoverMoreBtn">${t('discover.loadMore')}</button>`;
        grid.after(wrap);
        document.getElementById('discoverMoreBtn').addEventListener('click', () => {
            performSearch(_lastSearchParams, true);
        });
    }
}

function formatVideoDate(v) {
    const dateFmt = { year: 'numeric', month: 'short', day: 'numeric' };
    const dateLocale = getLang() === 'en' ? 'en-US' : 'ko-KR';
    return new Date(v.publishedAt).toLocaleDateString(dateLocale, dateFmt);
}

function ratioInfo(v) {
    const ratio = v.viewToSubRatio || 0;
    const cls = ratio >= 200 ? 'hot' : ratio >= 50 ? 'good' : 'normal';
    const label = ratio >= 200 ? '🔥' : ratio >= 50 ? '✨' : '';
    return { ratio, cls, label };
}

function renderDiscoverGrid(videos, grid) {
    grid.className = 'discover-grid';
    grid.innerHTML = videos.map(v => {
        const date = formatVideoDate(v);
        const { ratio, cls, label } = ratioInfo(v);
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
                <span class="discover-card-ratio ${cls}">${label} ${t('discover.subRatioLabel', { n: ratio })}</span>
                ${velocityBadgeHtml(v)}
                <div class="discover-card-date">${date}</div>
            </div>
            <div class="discover-card-actions">
                <button class="btn btn-secondary discover-ref-btn" data-video='${JSON.stringify(v).replace(/'/g, '&#39;')}'>${t('discover.saveRef')}</button>
            </div>
        </div>`;
    }).join('');
}

function renderDiscoverTable(videos, grid) {
    grid.className = 'discover-grid discover-table-wrap';
    const rows = videos.map(v => {
        const date = formatVideoDate(v);
        const { ratio, cls, label } = ratioInfo(v);
        return `<tr>
            <td><img class="discover-table-thumb" src="${v.thumbnail}" alt=""></td>
            <td class="discover-table-title">${escapeHtml(v.title)}</td>
            <td>${escapeHtml(v.channelTitle)}</td>
            <td class="num">${formatNumber(v.viewCount)}</td>
            <td class="num">${formatNumber(v.likeCount)}</td>
            <td class="num">${formatNumber(v.commentCount)}</td>
            <td class="num">${formatNumber(v.subscriberCount || 0)}</td>
            <td><span class="discover-card-ratio ${cls}">${label} ${ratio}%</span></td>
            <td class="discover-table-date">${date}</td>
            <td><button class="btn btn-secondary btn-sm discover-ref-btn" data-video='${JSON.stringify(v).replace(/'/g, '&#39;')}'>${t('discover.saveRef')}</button></td>
        </tr>`;
    }).join('');

    grid.innerHTML = `<table class="discover-table">
        <thead><tr>
            <th></th>
            <th>${t('content.title') || '제목'}</th>
            <th>${t('discover.channel') || '채널'}</th>
            <th>${t('discover.views') || '조회수'}</th>
            <th>${t('discover.likes') || '좋아요'}</th>
            <th>${t('discover.comments') || '댓글'}</th>
            <th>${t('channel.subscribers') || '구독자'}</th>
            <th>${t('discover.subRatio') || '조구비'}</th>
            <th>${t('discover.date') || '날짜'}</th>
            <th></th>
        </tr></thead>
        <tbody>${rows}</tbody>
    </table>`;
}

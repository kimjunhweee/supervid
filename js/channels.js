// ===== Channel Search (채널 탐색) =====
import { state, syncToServer } from './state.js';
import { escapeHtml, formatNumber, toast } from './utils.js';
import { checkGuestBlock } from './auth.js';
import { loadYouTubeData } from './youtube.js';
import { saveAsReference } from './references.js';

let _lastChannelSearchKeyword = '';

export function setupChannelSearch() {
    document.getElementById('openChannelSearchBtn').addEventListener('click', openChannelSearchModal);
    document.getElementById('closeChannelSearchModal').addEventListener('click', closeChannelSearchModal);
    document.getElementById('channelSearchModal').addEventListener('click', e => { if (e.target === e.currentTarget) closeChannelSearchModal(); });
    document.getElementById('channelSearchSubmitBtn').addEventListener('click', submitChannelSearch);
    document.getElementById('channelSearchResetBtn').addEventListener('click', () => {
        document.getElementById('channelSearchKeyword').value = '';
        document.getElementById('channelSubMin').value = '0';
        document.getElementById('channelSubMax').value = '0';
    });
    document.getElementById('channelSearchKeyword').addEventListener('keydown', e => { if (e.key === 'Enter') submitChannelSearch(); });
}

function openChannelSearchModal() {
    if (_lastChannelSearchKeyword) {
        document.getElementById('channelSearchKeyword').value = _lastChannelSearchKeyword;
    }
    document.getElementById('channelSearchModal').classList.add('active');
    document.getElementById('channelSearchKeyword').focus();
}

function closeChannelSearchModal() {
    document.getElementById('channelSearchModal').classList.remove('active');
}

function submitChannelSearch() {
    const query = document.getElementById('channelSearchKeyword').value.trim();
    if (!query) { toast(t('toast.searchRequired')); return; }
    _lastChannelSearchKeyword = query;
    const subMin = parseInt(document.getElementById('channelSubMin').value) || 0;
    const subMax = parseInt(document.getElementById('channelSubMax').value) || 0;
    closeChannelSearchModal();
    performChannelSearch(query, subMin, subMax);
}

async function performChannelSearch(query, subMin, subMax) {
    if (checkGuestBlock()) return;
    const grid = document.getElementById('channelGrid');
    const infoEl = document.getElementById('channelResultInfo');
    const hasSubFilter = subMin > 0 || subMax > 0;
    const fetchCount = hasSubFilter ? 50 : 12;

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
        renderChannelResults(channels);
    } catch (err) {
        grid.innerHTML = `<div class="discover-empty"><p style="color:var(--red)">${t('misc.error', { msg: escapeHtml(err.message) })}</p></div>`;
    }
}

function renderChannelResults(channels) {
    const grid = document.getElementById('channelGrid');
    if (!channels || channels.length === 0) {
        grid.innerHTML = `<div class="discover-empty"><p>${t('discover.noResults')}</p></div>`;
        return;
    }

    grid.innerHTML = channels.map(ch => {
        const handle = ch.customUrl ? `${ch.customUrl}` : '';
        return `
        <div class="channel-card">
            <img class="channel-card-thumb" src="${ch.thumbnail}" alt="${escapeHtml(ch.title)}">
            <div class="channel-card-name">${escapeHtml(ch.title)}</div>
            <div class="channel-card-handle">${escapeHtml(handle)}</div>
            ${ch.description ? `<div class="channel-card-desc">${escapeHtml(ch.description)}</div>` : ''}
            <div class="channel-card-stats">
                <div class="channel-card-stat">
                    <span class="channel-card-stat-value">${formatNumber(ch.subscriberCount)}</span>
                    <span class="channel-card-stat-label">${t('channel.subscribers')}</span>
                </div>
                <div class="channel-card-stat">
                    <span class="channel-card-stat-value">${formatNumber(ch.videoCount)}</span>
                    <span class="channel-card-stat-label">${t('channel.videos')}</span>
                </div>
                <div class="channel-card-stat">
                    <span class="channel-card-stat-value">${formatNumber(ch.viewCount)}</span>
                    <span class="channel-card-stat-label">${t('channel.totalViews')}</span>
                </div>
            </div>
            <div class="channel-card-actions">
                <a class="btn btn-secondary" href="https://www.youtube.com/channel/${ch.id}" target="_blank">${t('channel.viewOnYT')}</a>
                <button class="btn btn-primary channel-connect-btn" data-id="${ch.id}">${t('channel.connect')}</button>
            </div>
        </div>`;
    }).join('');

    grid.querySelectorAll('.channel-connect-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            localStorage.setItem('creatorhub_yt_channel', btn.dataset.id);
            syncToServer({ yt_channel: btn.dataset.id });
            toast(t('toast.channelConnected'));
            loadYouTubeData();
        });
    });
}

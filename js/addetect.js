// ===== Ad Detect (광고 탐지) =====
import { checkGuestBlock } from './auth.js';
import { escapeHtml, formatNumber, toast } from './utils.js';
import { saveAsReference } from './references.js';

const AD_KEYWORDS = [
    '광고', '협찬', '제공', 'ppl', '유료광고',
    '유료 광고 포함', '광고 포함', '경제적 대가',
    '#ad', '#sponsored', 'sponsored', 'paid partnership',
    '내돈내산 아님', '소정의 원고료', '협찬을 받아',
    '브랜디드', 'branded'
];

const AD_SEARCH_SUFFIXES = {
    combined: ['광고', '협찬'],
    ad: ['광고', '유료광고'],
    ppl: ['협찬', 'PPL'],
    broad: ['']
};

let _adDetectResults = [];
let _adDetectFilter = 'ad';
let _adDetectChannelFilter = null;
let _adDetectBrandName = '';

function extractBrands(description) {
    const urlRegex = /https?:\/\/[^\s<>"')\]]+/gi;
    const urls = (description || '').match(urlRegex) || [];

    const ignoreDomains = [
        'youtube.com', 'youtu.be', 'instagram.com', 'twitter.com',
        'facebook.com', 'bit.ly', 'linktr.ee', 'tiktok.com',
        'naver.com', 'blog.naver.com', 'cafe.naver.com', 'x.com'
    ];

    const brands = [];
    urls.forEach(url => {
        try {
            const domain = new URL(url).hostname.replace('www.', '');
            if (!ignoreDomains.some(d => domain.includes(d))) {
                brands.push({ domain, url });
            }
        } catch {}
    });

    return [...new Map(brands.map(b => [b.domain, b])).values()];
}

function detectAd(video) {
    const desc = (video.description || '').toLowerCase();
    const title = (video.title || '').toLowerCase();
    const text = desc + ' ' + title;

    const matchedKeywords = AD_KEYWORDS.filter(kw => text.includes(kw.toLowerCase()));
    const isAd = matchedKeywords.length > 0;
    const brands = extractBrands(video.description || '');

    return { isAd, matchedKeywords, brands };
}

export function setupAdDetect() {
    document.getElementById('addetectSearchBtn').addEventListener('click', submitAdSearch);
    document.getElementById('addetectKeyword').addEventListener('keydown', e => {
        if (e.key === 'Enter') submitAdSearch();
    });

    document.querySelectorAll('.addetect-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.addetect-filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            _adDetectFilter = btn.dataset.filter;
            _adDetectChannelFilter = null;
            renderAdDetectResults();
        });
    });
}

function submitAdSearch() {
    const keyword = document.getElementById('addetectKeyword').value.trim();
    if (!keyword) { toast(t('toast.brandRequired')); return; }
    const strategy = document.getElementById('addetectStrategy').value;
    performAdSearch(keyword, strategy);
}

async function performAdSearch(brand, strategy) {
    if (checkGuestBlock()) return;
    const grid = document.getElementById('addetectGrid');
    const summary = document.getElementById('addetectSummary');
    const filterRow = document.getElementById('addetectFilterRow');
    const brandsEl = document.getElementById('addetectBrands');
    const channelsSection = document.getElementById('addetectChannelsSection');

    grid.innerHTML = `<div class="discover-loading">${t('ad.searching', { brand: escapeHtml(brand) })}</div>`;
    summary.style.display = 'none';
    filterRow.style.display = 'none';
    brandsEl.innerHTML = '';
    channelsSection.style.display = 'none';

    _adDetectBrandName = brand;

    try {
        const suffixes = AD_SEARCH_SUFFIXES[strategy] || AD_SEARCH_SUFFIXES.combined;
        const allVideos = [];
        const seenIds = new Set();

        for (const suffix of suffixes) {
            const query = suffix ? `${brand} ${suffix}` : brand;
            const res = await fetch(`/api/youtube/search?q=${encodeURIComponent(query)}&order=relevance&maxResults=12&pages=2`);
            if (!res.ok) {
                let msg = t('misc.searchFail');
                try { const err = await res.json(); msg = err.error || msg; } catch {}
                throw new Error(msg);
            }
            const data = await res.json();
            const videos = data.videos || data;
            videos.forEach(v => {
                if (!seenIds.has(v.id)) {
                    seenIds.add(v.id);
                    allVideos.push(v);
                }
            });
        }

        _adDetectResults = allVideos.map(v => ({ video: v, ...detectAd(v) }));
        _adDetectFilter = 'ad';
        _adDetectChannelFilter = null;

        document.querySelectorAll('.addetect-filter-btn').forEach(b => b.classList.remove('active'));
        document.querySelector('.addetect-filter-btn[data-filter="ad"]').classList.add('active');

        renderAdSummary();
        renderAdChannels();
        renderAdBrandChips();
        renderAdDetectResults();

        summary.style.display = '';
        filterRow.style.display = '';
    } catch (err) {
        grid.innerHTML = `<div class="discover-empty"><p style="color:var(--red)">${t('misc.error', { msg: escapeHtml(err.message) })}</p></div>`;
    }
}

function renderAdSummary() {
    const total = _adDetectResults.length;
    const adCount = _adDetectResults.filter(r => r.isAd).length;
    const ratio = total > 0 ? Math.round((adCount / total) * 1000) / 10 : 0;
    const channels = new Set(_adDetectResults.filter(r => r.isAd).map(r => r.video.channelId));

    document.getElementById('adDetectedCount').textContent = adCount;
    document.getElementById('adChannelCount').textContent = channels.size;
    document.getElementById('adTotalCount').textContent = total;
    document.getElementById('adRatio').textContent = ratio + '%';
}

function renderAdChannels() {
    const section = document.getElementById('addetectChannelsSection');
    const list = document.getElementById('addetectChannelsList');

    const channelMap = {};
    _adDetectResults.forEach(r => {
        if (!r.isAd) return;
        const v = r.video;
        if (!channelMap[v.channelId]) {
            channelMap[v.channelId] = {
                channelId: v.channelId,
                channelTitle: v.channelTitle,
                subscriberCount: v.subscriberCount || 0,
                adCount: 0,
                totalViews: 0
            };
        }
        channelMap[v.channelId].adCount++;
        channelMap[v.channelId].totalViews += v.viewCount || 0;
    });

    const channels = Object.values(channelMap).sort((a, b) => b.adCount - a.adCount);
    if (channels.length === 0) { section.style.display = 'none'; return; }

    section.style.display = '';
    list.innerHTML = channels.map(ch => `
        <div class="addetect-channel-item" data-channel-id="${ch.channelId}">
            <div class="addetect-channel-name">${escapeHtml(ch.channelTitle)}</div>
            <span class="addetect-channel-subs">${formatNumber(ch.subscriberCount)}</span>
            <span class="addetect-channel-count">${ch.adCount}</span>
        </div>
    `).join('');

    list.querySelectorAll('.addetect-channel-item').forEach(item => {
        item.addEventListener('click', () => {
            const chId = item.dataset.channelId;
            if (_adDetectChannelFilter === chId) {
                _adDetectChannelFilter = null;
                list.querySelectorAll('.addetect-channel-item').forEach(el => el.classList.remove('active'));
            } else {
                _adDetectChannelFilter = chId;
                list.querySelectorAll('.addetect-channel-item').forEach(el => el.classList.remove('active'));
                item.classList.add('active');
            }
            renderAdDetectResults();
        });
    });
}

function renderAdBrandChips() {
    const brandsEl = document.getElementById('addetectBrands');
    const brandMap = {};

    _adDetectResults.forEach(r => {
        if (r.isAd && r.brands.length > 0) {
            r.brands.forEach(b => {
                if (!brandMap[b.domain]) brandMap[b.domain] = { domain: b.domain, url: b.url, count: 0 };
                brandMap[b.domain].count++;
            });
        }
    });

    const brands = Object.values(brandMap).sort((a, b) => b.count - a.count);
    if (brands.length === 0) { brandsEl.innerHTML = ''; return; }

    brandsEl.innerHTML = `<span style="font-size:12px;color:var(--text-muted);margin-right:4px">${t('ad.relatedLinks')}</span>` +
        brands.map(b =>
            `<a class="addetect-brand-chip" href="${escapeHtml(b.url)}" target="_blank" rel="noopener">${escapeHtml(b.domain)}<span class="brand-count">${b.count}</span></a>`
        ).join('');
}

function renderAdDetectResults() {
    const grid = document.getElementById('addetectGrid');

    let items = [..._adDetectResults];

    if (_adDetectFilter === 'ad') items = items.filter(r => r.isAd);
    else if (_adDetectFilter === 'clean') items = items.filter(r => !r.isAd);

    if (_adDetectChannelFilter) {
        items = items.filter(r => r.video.channelId === _adDetectChannelFilter);
    }

    items.sort((a, b) => {
        if (a.isAd !== b.isAd) return b.isAd ? 1 : -1;
        return (b.video.viewCount || 0) - (a.video.viewCount || 0);
    });

    if (items.length === 0) {
        const msg = _adDetectFilter === 'ad'
            ? t('ad.noAdDetected', { brand: escapeHtml(_adDetectBrandName) })
            : t('ad.noMatch');
        grid.innerHTML = `<div class="discover-empty"><p>${msg}</p></div>`;
        return;
    }

    grid.innerHTML = items.map(r => {
        const v = r.video;
        const dateLocale = getLang() === 'en' ? 'en-US' : 'ko-KR';
        const date = new Date(v.publishedAt).toLocaleDateString(dateLocale, { year: 'numeric', month: 'short', day: 'numeric' });
        const adBadge = r.isAd
            ? `<span class="ad-badge"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>${t('ad.adBadge')}</span>`
            : '';

        let brandInfo = '';
        if (r.isAd) {
            const keywordsStr = r.matchedKeywords.map(k => `"${escapeHtml(k)}"`).join(', ');
            const domainsHtml = r.brands.map(b =>
                `<a class="ad-brand-domain" href="${escapeHtml(b.url)}" target="_blank" rel="noopener">${escapeHtml(b.domain)}</a>`
            ).join('');
            brandInfo = `
                <div class="ad-brand-info">
                    <div class="ad-brand-info-title">${t('ad.adDetected')}</div>
                    <div class="ad-brand-info-keywords">${t('ad.matchLabel')}${keywordsStr}</div>
                    ${r.brands.length > 0 ? `<div class="ad-brand-info-domains">${domainsHtml}</div>` : ''}
                </div>`;
        }

        return `
        <div class="addetect-card ${r.isAd ? 'is-ad' : ''}">
            <div class="addetect-card-thumb-wrap">
                <img class="addetect-card-thumb" src="${v.thumbnail}" alt="${escapeHtml(v.title)}">
                ${adBadge}
            </div>
            <div class="addetect-card-body">
                <div class="addetect-card-title">${escapeHtml(v.title)}</div>
                <div class="addetect-card-channel">${escapeHtml(v.channelTitle)}${v.subscriberCount ? ' · ' + formatNumber(v.subscriberCount) : ''}</div>
                <div class="addetect-card-stats">
                    <span>👁 ${formatNumber(v.viewCount)}</span>
                    <span>👍 ${formatNumber(v.likeCount)}</span>
                    <span>💬 ${formatNumber(v.commentCount)}</span>
                </div>
                <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">${date}</div>
                ${brandInfo}
            </div>
            <div class="addetect-card-actions">
                <button class="btn btn-secondary addetect-ref-btn" data-video='${JSON.stringify(v).replace(/'/g, '&#39;')}'>${t('discover.saveRef')}</button>
            </div>
        </div>`;
    }).join('');

    grid.querySelectorAll('.addetect-ref-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const video = JSON.parse(btn.dataset.video);
            saveAsReference(video);
        });
    });
}

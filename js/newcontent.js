// ===== New Content Wizard =====
import { state, saveContents } from './state.js';
import { generateId, escapeHtml, formatNumber, toast } from './utils.js';
import { checkGuestBlock } from './auth.js';
import { switchTab } from './nav.js';
// Circular import (resolved at runtime):
import { renderAll } from '../app.js';

const NC_TOTAL_STEPS = 3;
let _ncCurrentStep = 0;
let _ncIdeaText = '';
let _ncSelectedRefs = [];
let _ncLastSearchResults = [];

export function setupNewContentPage() {
    document.getElementById('ncNextBtn').addEventListener('click', ncNext);
    document.getElementById('ncPrevBtn').addEventListener('click', ncPrev);

    // YouTube 외 플랫폼 카드에 coming-soon 스타일 적용
    document.querySelectorAll('#ncPlatformGrid .nc-option-card').forEach(card => {
        if (card.dataset.value !== 'youtube') card.classList.add('coming-soon');
    });

    // Option card selection (platform, type)
    document.querySelectorAll('.nc-option-card').forEach(card => {
        card.addEventListener('click', (e) => {
            if (e.target.type === 'radio') return; // label→input synthetic click 버블링 무시
            const grid = card.closest('.nc-option-grid');
            if (grid.id === 'ncPlatformGrid' && card.dataset.value !== 'youtube') {
                toast(t('toast.comingSoon'));
                return;
            }
            grid.querySelectorAll('.nc-option-card').forEach(c => c.classList.remove('active'));
            card.classList.add('active');
            card.querySelector('input[type="radio"]').checked = true;
        });
    });

    // Enter key on title input → next
    document.getElementById('ncTitle').addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); ncNext(); }
    });

    // Reference search button
    document.getElementById('ncRefSearchBtn').addEventListener('click', () => {
        const q = document.getElementById('ncRefSearchInput').value.trim();
        if (q) ncAutoSearch(q);
    });

    // Reference search input enter key
    document.getElementById('ncRefSearchInput').addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const q = document.getElementById('ncRefSearchInput').value.trim();
            if (q) ncAutoSearch(q);
        }
    });
}

export function openAddContent(date) {
    _ncCurrentStep = 0;
    _ncIdeaText = '';
    _ncSelectedRefs = [];
    _ncLastSearchResults = [];

    document.getElementById('ncIdea').value = '';
    document.getElementById('ncTitle').value = '';
    document.getElementById('ncDate').value = date || '';
    document.getElementById('ncMemo').value = '';
    document.getElementById('ncRefSearchInput').value = '';
    document.getElementById('ncRefChips').innerHTML = '';
    document.getElementById('ncRefList').innerHTML = '';
    document.getElementById('ncRefLoading').style.display = 'none';
    document.getElementById('ncTitlePatterns').innerHTML = '';
    document.getElementById('ncKeywordChips').innerHTML = '';

    // Reset platform selection to youtube
    document.querySelectorAll('#ncPlatformGrid .nc-option-card').forEach(c => c.classList.remove('active'));
    document.querySelector('#ncPlatformGrid .nc-option-card[data-value="youtube"]').classList.add('active');
    document.querySelector('input[name="ncPlatform"][value="youtube"]').checked = true;

    // Reset type selection to long
    document.querySelectorAll('#ncTypeGrid .nc-option-card').forEach(c => c.classList.remove('active'));
    document.querySelector('#ncTypeGrid .nc-option-card[data-value="long"]').classList.add('active');
    document.querySelector('input[name="ncType"][value="long"]').checked = true;

    ncRenderStep();
    switchTab('newcontent');
    setTimeout(() => document.getElementById('ncIdea').focus(), 100);
}

function ncNext() {
    if (_ncCurrentStep === 0) {
        const idea = document.getElementById('ncIdea').value.trim();
        if (idea.length < 2) { toast(t('nc.ideaMinLength')); document.getElementById('ncIdea').focus(); return; }
        _ncIdeaText = idea;
    }
    if (_ncCurrentStep === 1) {
        const title = document.getElementById('ncTitle').value.trim();
        if (title.length < 2) { toast(t('nc.titleMinLength')); document.getElementById('ncTitle').focus(); return; }
    }

    if (_ncCurrentStep < NC_TOTAL_STEPS - 1) {
        _ncCurrentStep++;
        ncRenderStep();
    } else {
        ncSave();
    }
}

function ncPrev() {
    if (_ncCurrentStep > 0) {
        _ncCurrentStep--;
        ncRenderStep();
    } else {
        switchTab('kanban');
    }
}

function ncRenderStep() {
    // Update step indicators
    document.querySelectorAll('.nc-step').forEach(s => {
        const idx = parseInt(s.dataset.step);
        s.classList.remove('active', 'done');
        if (idx === _ncCurrentStep) s.classList.add('active');
        else if (idx < _ncCurrentStep) s.classList.add('done');
    });
    document.querySelectorAll('.nc-step-line').forEach((line, i) => {
        line.classList.toggle('done', i < _ncCurrentStep);
    });

    // Show current step content
    document.querySelectorAll('.nc-step-content').forEach(c => c.classList.remove('active'));
    document.querySelector(`.nc-step-content[data-step-content="${_ncCurrentStep}"]`).classList.add('active');

    // Update buttons
    const prevBtn = document.getElementById('ncPrevBtn');
    const nextBtn = document.getElementById('ncNextBtn');
    prevBtn.textContent = _ncCurrentStep === 0 ? t('nc.nav.cancel') : t('nc.nav.prev');
    const isLast = _ncCurrentStep === NC_TOTAL_STEPS - 1;
    nextBtn.textContent = isLast ? t('nc.nav.complete') : t('nc.nav.next');

    // Step-specific auto actions
    if (_ncCurrentStep === 1) {
        // Pre-fill title and auto-search on entering ref+title step
        const titleInput = document.getElementById('ncTitle');
        if (!titleInput.value.trim()) titleInput.value = _ncIdeaText;
        document.getElementById('ncRefSearchInput').value = _ncIdeaText;
        ncRenderTitlePatterns();
        ncAutoSearch(_ncIdeaText);
        setTimeout(() => titleInput.focus(), 100);
    }
    if (_ncCurrentStep === 2) {
        // Update review card
        ncUpdateReviewCard();
    }
}

async function ncAutoSearch(query) {
    if (checkGuestBlock()) return;
    if (!query) return;

    const loadingEl = document.getElementById('ncRefLoading');
    const listEl = document.getElementById('ncRefList');
    const chipsEl = document.getElementById('ncRefChips');

    loadingEl.style.display = 'block';
    listEl.innerHTML = '';
    chipsEl.innerHTML = '';

    // Fetch keyword suggestions and video search in parallel
    try {
        const [suggestionsRes, videosRes] = await Promise.allSettled([
            fetch(`/api/youtube/keyword-suggestions?q=${encodeURIComponent(query)}`).then(r => r.ok ? r.json() : []),
            fetch(`/api/youtube/search?q=${encodeURIComponent(query)}&order=viewCount&maxResults=6&pages=1`).then(r => r.ok ? r.json() : { videos: [] })
        ]);

        // Render keyword chips
        const suggestions = suggestionsRes.status === 'fulfilled' ? suggestionsRes.value : [];
        if (Array.isArray(suggestions) && suggestions.length > 0) {
            chipsEl.innerHTML = suggestions.map(s =>
                `<span class="nc-ref-chip" data-keyword="${escapeHtml(s)}">${escapeHtml(s)}</span>`
            ).join('');
            chipsEl.querySelectorAll('.nc-ref-chip').forEach(chip => {
                chip.addEventListener('click', () => {
                    const kw = chip.dataset.keyword;
                    document.getElementById('ncRefSearchInput').value = kw;
                    ncAutoSearch(kw);
                });
            });
        }

        // Render video results
        const videosData = videosRes.status === 'fulfilled' ? videosRes.value : { videos: [] };
        const videos = videosData.videos || videosData;
        _ncLastSearchResults = Array.isArray(videos) ? videos : [];
        ncRenderRefResults(_ncLastSearchResults);
        ncRenderTitlePatterns();
    } catch (err) {
        listEl.innerHTML = `<div class="nc-ref-error">${t('nc.ref.searchFail', { error: escapeHtml(err.message) })}</div>`;
    } finally {
        loadingEl.style.display = 'none';
    }
}

function ncRenderRefResults(videos) {
    const listEl = document.getElementById('ncRefList');
    if (!videos || videos.length === 0) {
        listEl.innerHTML = `<div style="text-align:center;color:var(--text-muted);padding:20px;font-size:13px">${t('nc.ref.noResults')}</div>`;
        return;
    }

    listEl.innerHTML = videos.map((v, i) => {
        const isSelected = _ncSelectedRefs.some(r => r.videoId === v.videoId);
        return `
        <div class="nc-ref-item${isSelected ? ' selected' : ''}" data-idx="${i}">
            <img class="nc-ref-thumb" src="${v.thumbnail}" alt="">
            <div class="nc-ref-info">
                <div class="nc-ref-title">${escapeHtml(v.title)}</div>
                <div class="nc-ref-meta">${escapeHtml(v.channelTitle)} · ${t('misc.views')} ${formatNumber(v.viewCount)}${v.subscriberCount ? ' · ' + t('discover.subLabel', { n: formatNumber(v.subscriberCount) }) : ''}</div>
            </div>
            <button class="nc-ref-select-btn${isSelected ? ' selected' : ''}" data-idx="${i}" title="${isSelected ? '-' : '+'}">
                ${isSelected ? '✓' : '+'}
            </button>
        </div>`;
    }).join('');

    listEl.querySelectorAll('.nc-ref-select-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const idx = parseInt(btn.dataset.idx);
            ncToggleRef(videos[idx]);
            ncRenderRefResults(videos);
        });
    });

    listEl.querySelectorAll('.nc-ref-item').forEach(item => {
        item.addEventListener('click', () => {
            const idx = parseInt(item.dataset.idx);
            ncToggleRef(videos[idx]);
            ncRenderRefResults(videos);
        });
    });
}

function ncToggleRef(video) {
    const idx = _ncSelectedRefs.findIndex(r => r.videoId === video.videoId);
    if (idx >= 0) {
        _ncSelectedRefs.splice(idx, 1);
    } else {
        _ncSelectedRefs.push(video);
    }
    ncRenderTitlePatterns();
}

function ncRenderTitlePatterns() {
    const patternsEl = document.getElementById('ncTitlePatterns');
    const keywordsEl = document.getElementById('ncKeywordChips');

    const sourceTitles = _ncSelectedRefs.length > 0
        ? _ncSelectedRefs.map(r => r.title)
        : _ncLastSearchResults.map(r => r.title);

    if (sourceTitles.length === 0) {
        patternsEl.innerHTML = '';
        keywordsEl.innerHTML = '';
        return;
    }

    // Render title patterns
    patternsEl.innerHTML = `<div class="nc-title-patterns-header">${t('nc.title.patterns')}</div>` +
        sourceTitles.slice(0, 6).map(title =>
            `<div class="nc-title-pattern-item">
                <span class="nc-title-pattern-text">${escapeHtml(title)}</span>
                <button class="nc-title-pattern-apply" data-title="${escapeHtml(title)}">${t('nc.title.apply')}</button>
            </div>`
        ).join('');

    patternsEl.querySelectorAll('.nc-title-pattern-apply').forEach(btn => {
        btn.addEventListener('click', () => {
            document.getElementById('ncTitle').value = btn.dataset.title;
            document.getElementById('ncTitle').focus();
        });
    });

    // Render keyword chips
    const keywords = ncExtractKeywords(sourceTitles);
    if (keywords.length > 0) {
        keywordsEl.innerHTML = `<div class="nc-keyword-chips-header">${t('nc.title.keywords')}</div>` +
            keywords.map(w => `<span class="nc-keyword-chip" data-word="${escapeHtml(w)}">${escapeHtml(w)}</span>`).join('');

        keywordsEl.querySelectorAll('.nc-keyword-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                const titleInput = document.getElementById('ncTitle');
                const current = titleInput.value;
                const word = chip.dataset.word;
                if (!current.includes(word)) {
                    titleInput.value = current ? current + ' ' + word : word;
                }
                titleInput.focus();
            });
        });
    } else {
        keywordsEl.innerHTML = '';
    }
}

function ncExtractKeywords(titles) {
    const allWords = titles.join(' ')
        .replace(/[^\w가-힣\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length >= 2);
    const freq = {};
    allWords.forEach(w => { freq[w] = (freq[w] || 0) + 1; });
    return Object.entries(freq)
        .filter(([_, c]) => c >= 2)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([word]) => word);
}

function ncRenderThumbnailStep() {
    const gridEl = document.getElementById('ncThumbGrid');
    const videos = _ncSelectedRefs.length > 0 ? _ncSelectedRefs : _ncLastSearchResults;

    if (!videos || videos.length === 0) {
        gridEl.innerHTML = `<div style="text-align:center;color:var(--text-muted);padding:20px;font-size:13px">${t('nc.thumb.empty')}</div>`;
        return;
    }

    gridEl.innerHTML = videos.slice(0, 6).map((v, i) => `
        <div class="nc-thumb-card" data-idx="${i}">
            <div class="nc-thumb-img-wrap">
                <img class="nc-thumb-img" src="${v.thumbnail}" alt="" loading="lazy">
                <div class="nc-thumb-zoom-icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
                </div>
            </div>
            <div class="nc-thumb-card-title">${escapeHtml(v.title)}</div>
            <div class="nc-thumb-card-meta">${t('misc.views')} ${formatNumber(v.viewCount)}</div>
        </div>
    `).join('');

    gridEl.querySelectorAll('.nc-thumb-card').forEach(card => {
        card.addEventListener('click', () => {
            const idx = parseInt(card.dataset.idx);
            ncRenderThumbPreview(videos[idx]);
        });
    });
}

function ncRenderThumbPreview(video) {
    // Remove existing overlay if any
    const existing = document.querySelector('.nc-thumb-enlarged');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'nc-thumb-enlarged';
    overlay.innerHTML = `
        <div class="nc-thumb-enlarged-inner">
            <img src="${video.thumbnail.replace('mqdefault', 'maxresdefault').replace('hqdefault', 'maxresdefault')}" alt="">
            <div class="nc-thumb-enlarged-info">
                <div class="nc-thumb-enlarged-title">${escapeHtml(video.title)}</div>
                <div class="nc-thumb-enlarged-meta">${escapeHtml(video.channelTitle || '')} · ${t('misc.views')} ${formatNumber(video.viewCount)}</div>
            </div>
            <button class="nc-thumb-enlarged-close">&times;</button>
        </div>
    `;
    overlay.addEventListener('click', e => {
        if (e.target === overlay || e.target.closest('.nc-thumb-enlarged-close')) {
            overlay.remove();
        }
    });
    document.body.appendChild(overlay);
}

function ncUpdateReviewCard() {
    const title = document.getElementById('ncTitle').value.trim();
    const platform = document.querySelector('input[name="ncPlatform"]:checked')?.value || 'youtube';
    const contentType = document.querySelector('input[name="ncType"]:checked')?.value || 'long';
    const date = document.getElementById('ncDate').value;
    const platformLabels = { youtube: 'YouTube', instagram: 'Instagram', tiktok: 'TikTok', blog: 'Blog', other: t('platform.other') };

    document.getElementById('ncReviewTitle').textContent = title || '-';
    document.getElementById('ncReviewPlatform').textContent = platformLabels[platform] || platform;
    document.getElementById('ncReviewType').textContent = t('type.' + contentType) || contentType;
    document.getElementById('ncReviewDate').textContent = date || t('nc.review.dateNone');
    document.getElementById('ncReviewRefs').textContent = _ncSelectedRefs.length > 0
        ? t('nc.review.refsSelected', { n: _ncSelectedRefs.length })
        : t('nc.review.refsNone');
}

function ncSave() {
    const title = document.getElementById('ncTitle').value.trim();
    if (!title) { toast(t('toast.titleRequired')); return; }

    const platform = document.querySelector('input[name="ncPlatform"]:checked').value;
    const contentType = document.querySelector('input[name="ncType"]:checked').value;
    let memo = document.getElementById('ncMemo').value.trim();

    // Append reference URLs to memo
    if (_ncSelectedRefs.length > 0) {
        const refLines = _ncSelectedRefs.map(r => `- ${r.title}\n  https://www.youtube.com/watch?v=${r.videoId}`).join('\n');
        const refSection = `\n\n[${t('nav.references')}]\n${refLines}`;
        memo = memo ? memo + refSection : refSection.trim();
    }

    const thumbnailText = '';
    const thumbnailStyle = 'bold-white';
    const thumbnailBg = 'closeup';
    const thumbnailMemo = '';

    const data = {
        id: generateId(),
        title,
        platform,
        status: 'idea',
        date: document.getElementById('ncDate').value,
        contentType,
        ideaText: _ncIdeaText,
        memo,
        thumbnailText,
        thumbnailStyle,
        thumbnailBg,
        thumbnailMemo,
        scriptContent: '',
        scriptStatus: null,
        checklist: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };

    state.contents.push(data);
    saveContents();
    toast(t('toast.contentAdded'));
    renderAll();
    switchTab('kanban');
}

// ===== Outlier Finder (아웃라이어 찾기) =====
import { checkGuestBlock } from './auth.js';
import { escapeHtml, formatNumber, toast } from './utils.js';
import { saveAsReference } from './references.js';
import { saveAsIdea } from './ideas.js';

let _lastOutlierKeyword = '';
let _outlierResults = [];

export function setupOutlierFinder() {
    document.getElementById('outlierSearchBtn').addEventListener('click', performOutlierSearch);
    document.getElementById('outlierKeyword').addEventListener('keydown', e => {
        if (e.key === 'Enter') performOutlierSearch();
    });
}

async function performOutlierSearch() {
    if (checkGuestBlock()) return;
    const keyword = document.getElementById('outlierKeyword').value.trim();
    if (!keyword) { toast(t('toast.keywordRequired')); return; }

    const minScore = document.getElementById('outlierMinScore').value;
    const grid = document.getElementById('outlierGrid');
    const summary = document.getElementById('outlierSummary');

    _lastOutlierKeyword = keyword;
    grid.innerHTML = `<div class="discover-loading">${t('outlier.searching', { keyword: escapeHtml(keyword) })}</div>`;
    summary.style.display = 'none';

    try {
        const res = await fetch(`/api/youtube/outliers?q=${encodeURIComponent(keyword)}&maxResults=10&minOutlierScore=${encodeURIComponent(minScore)}`);
        if (!res.ok) {
            let msg = t('misc.searchFail');
            try { const err = await res.json(); msg = err.error || msg; } catch {}
            throw new Error(msg);
        }
        const data = await res.json();
        _outlierResults = data.videos || [];

        if (_outlierResults.length > 0) {
            renderOutlierSummary(_outlierResults);
            summary.style.display = '';
        }
        renderOutlierResults(_outlierResults);
    } catch (err) {
        grid.innerHTML = `<div class="discover-empty"><p style="color:var(--red)">${t('misc.error', { msg: escapeHtml(err.message) })}</p></div>`;
    }
}

function renderOutlierSummary(videos) {
    const count = videos.length;
    const maxScore = Math.max(...videos.map(v => v.outlierScore));
    const avgScore = Math.round(videos.reduce((s, v) => s + v.outlierScore, 0) / count * 10) / 10;
    const channels = new Set(videos.map(v => v.channelId)).size;

    document.getElementById('outlierFoundCount').textContent = count;
    document.getElementById('outlierMaxScore').textContent = maxScore + 'x';
    document.getElementById('outlierAvgScore').textContent = avgScore + 'x';
    document.getElementById('outlierChannelCount').textContent = channels;
}

function getOutlierScoreClass(score) {
    if (score >= 20) return 'score-extreme';
    if (score >= 10) return 'score-high';
    if (score >= 5) return 'score-medium';
    return 'score-low';
}

function renderOutlierResults(videos) {
    const grid = document.getElementById('outlierGrid');

    if (!videos || videos.length === 0) {
        grid.innerHTML = `<div class="discover-empty"><p>${t('outlier.noResults')}</p><p style="font-size:12px;color:var(--text-muted);margin-top:4px">${t('outlier.noResultsHint')}</p></div>`;
        return;
    }

    grid.innerHTML = videos.map(v => {
        const dateLocale = getLang() === 'en' ? 'en-US' : 'ko-KR';
        const date = new Date(v.publishedAt).toLocaleDateString(dateLocale, { year: 'numeric', month: 'short', day: 'numeric' });
        const scoreClass = getOutlierScoreClass(v.outlierScore);
        const barMaxWidth = 100;
        const medianBarWidth = v.viewCount > 0 ? Math.min((v.channelMedianViews / v.viewCount) * barMaxWidth, barMaxWidth) : 0;
        const thisBarWidth = barMaxWidth;

        return `
        <div class="outlier-card">
            <div class="outlier-card-thumb-wrap">
                <img class="discover-card-thumb" src="${v.thumbnail}" alt="${escapeHtml(v.title)}">
                <span class="outlier-score-badge ${scoreClass}">${v.outlierScore}x</span>
            </div>
            <div class="discover-card-body">
                <div class="discover-card-title">${escapeHtml(v.title)}</div>
                <div class="discover-card-channel">${escapeHtml(v.channelTitle)}</div>
                <div class="discover-card-stats">
                    <span>👁 ${formatNumber(v.viewCount)}</span>
                    <span>👍 ${formatNumber(v.likeCount)}</span>
                    <span>💬 ${formatNumber(v.commentCount)}</span>
                </div>
                <div class="outlier-comparison">
                    <div class="outlier-comparison-row">
                        <span class="outlier-comparison-label">${t('outlier.thisVideo')}</span>
                        <span class="outlier-comparison-value">${formatNumber(v.viewCount)}</span>
                    </div>
                    <div class="outlier-comparison-row">
                        <span class="outlier-comparison-label">${t('outlier.channelMedian')}</span>
                        <span class="outlier-comparison-value">${formatNumber(v.channelMedianViews)}</span>
                    </div>
                    <div class="outlier-bar-wrap">
                        <div class="outlier-bar-avg" style="width:${medianBarWidth}%"></div>
                        <div class="outlier-bar-this" style="width:${thisBarWidth}%"></div>
                    </div>
                </div>
                <div class="discover-card-sub">${t('discover.subLabel', { n: formatNumber(v.subscriberCount) })} · ${t('outlier.channelVideos', { n: v.channelVideoCount })}</div>
                <div class="discover-card-date">${date}</div>
            </div>
            <div class="discover-card-actions">
                <button class="btn btn-secondary discover-ref-btn" data-video='${JSON.stringify(v).replace(/'/g, '&#39;')}'>${t('outlier.saveRef')}</button>
                <button class="btn btn-primary outlier-idea-btn" data-video='${JSON.stringify(v).replace(/'/g, '&#39;')}'>${t('outlier.saveIdea')}</button>
            </div>
        </div>`;
    }).join('');

    grid.querySelectorAll('.discover-ref-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const video = JSON.parse(btn.dataset.video);
            saveAsReference(video);
        });
    });

    grid.querySelectorAll('.outlier-idea-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const video = JSON.parse(btn.dataset.video);
            saveAsIdea(video, 'outlier', _lastOutlierKeyword);
        });
    });
}

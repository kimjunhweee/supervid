// ===== Utils =====
// Pure utility functions — no imports from other modules needed.
// t(), getLang() are globals from i18n.js (loaded as regular script before app.js module).

export function generateId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
export function formatDate(dateStr) { const d = new Date(dateStr); return `${d.getMonth() + 1}/${d.getDate()}`; }
export function escapeHtml(text) { const div = document.createElement('div'); div.textContent = text; return div.innerHTML; }
export function toast(message) {
    const container = document.getElementById('toastContainer');
    const el = document.createElement('div');
    el.className = 'toast'; el.textContent = message;
    container.appendChild(el);
    setTimeout(() => el.remove(), 3000);
}
export function getChecklistCount(checklist) {
    if (!checklist) return { done: 0, total: 7 };
    const done = Object.values(checklist).filter(Boolean).length;
    return { done, total: 7 };
}

// formatNumber — was in YouTube section, shared across many modules
export function formatNumber(num) {
    if (getLang() === 'en') {
        if (num >= 1000000000) return (num / 1000000000).toFixed(1) + 'B';
        if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
        if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
        return num.toLocaleString();
    }
    if (num >= 100000000) return (num / 100000000).toFixed(1) + t('num.billion');
    if (num >= 10000) return (num / 10000).toFixed(1) + t('num.tenThousand');
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toLocaleString();
}

// parseDurationToSeconds — was in Ideas section, also used by chart
export function parseDurationToSeconds(iso) {
    if (!iso) return 0;
    const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!m) return 0;
    return (parseInt(m[1] || 0) * 3600) + (parseInt(m[2] || 0) * 60) + parseInt(m[3] || 0);
}

// formatRelativeTime — was in Ideas section, used by discover and ideas
export function formatRelativeTime(dateStr) {
    const now = new Date();
    const date = new Date(dateStr);
    const diffMs = now - date;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);
    const diffWeek = Math.floor(diffDay / 7);
    const diffMonth = Math.floor(diffDay / 30);
    const diffYear = Math.floor(diffDay / 365);

    if (diffYear > 0) return t('time.yearsAgo', { n: diffYear });
    if (diffMonth > 0) return t('time.monthsAgo', { n: diffMonth });
    if (diffWeek > 0) return t('time.weeksAgo', { n: diffWeek });
    if (diffDay > 0) return t('time.daysAgo', { n: diffDay });
    if (diffHour > 0) return t('time.hoursAgo', { n: diffHour });
    if (diffMin > 0) return t('time.minutesAgo', { n: diffMin });
    return t('time.justNow');
}

// calcVelocity + velocityBadgeHtml — was in Velocity section, shared between discover and ideas
export function calcVelocity(video) {
    const days = Math.max(1, Math.floor((Date.now() - new Date(video.publishedAt).getTime()) / 86400000));
    const viewsPerDay = Math.round(video.viewCount / days);
    const subs = video.subscriberCount || 1;
    const score = (video.viewCount / subs) / days;
    const engagement = video.viewCount > 0 ? Math.round(((video.likeCount || 0) + (video.commentCount || 0)) / video.viewCount * 1000) / 10 : 0;

    let level, label, icon;
    if (score >= 2)        { level = 'explosive'; label = t('velocity.explosive'); icon = '🔥🔥'; }
    else if (score >= 0.3) { level = 'hot'; label = t('velocity.hot'); icon = '🔥'; }
    else                   { level = 'normal'; label = ''; icon = ''; }

    return { viewsPerDay, score, days, level, label, icon, engagement };
}

export function velocityBadgeHtml(video) {
    const v = calcVelocity(video);
    const parts = [];

    if (v.level !== 'normal') {
        parts.push(`<span class="velocity-badge ${v.level}">${v.icon} ${v.label}</span>`);
    }
    parts.push(`<span class="velocity-detail">${t('velocity.dailyAvg', { n: formatNumber(v.viewsPerDay) })}</span>`);
    if (v.engagement > 0) {
        parts.push(`<span class="velocity-detail">${t('velocity.engagement', { n: v.engagement })}</span>`);
    }

    return `<div class="velocity-row">${parts.join('')}</div>`;
}

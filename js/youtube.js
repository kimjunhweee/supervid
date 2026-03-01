// ===== My Page + YouTube Integration + Upload Goal + Last Upload Banner =====
import { state, syncToServer } from './state.js';
import { escapeHtml, formatNumber, toast } from './utils.js';
import { checkGuestBlock, logout } from './auth.js';
// Circular import (resolved at runtime):
import { renderChart } from './dashboard.js';

// ===== My Page =====
export function setupMyPageModal() {
    document.getElementById('closeMyPageModal').addEventListener('click', closeMyPage);
    document.getElementById('myPageModal').addEventListener('click', e => { if (e.target === e.currentTarget) closeMyPage(); });
    document.getElementById('mypageLogoutBtn').addEventListener('click', () => { closeMyPage(); logout(); });
}

export async function openMyPage() {
    if (!state.user) return;
    document.getElementById('mypageAvatar').src = state.user.picture || '';
    document.getElementById('mypageName').textContent = state.user.name || '';
    document.getElementById('mypageEmail').textContent = state.user.email || '';
    document.getElementById('mypageContentCount').textContent = state.contents.length;
    document.getElementById('mypagePublishedCount').textContent = state.contents.filter(c => c.status === 'published').length;
    document.getElementById('mypageScriptCount').textContent = state.contents.filter(c => c.scriptContent).length;
    document.getElementById('myPageModal').classList.add('active');

    // API 사용량 로드
    const usageText = document.getElementById('mypageUsageText');
    const usageFill = document.getElementById('mypageUsageFill');
    const usageDetail = document.getElementById('mypageUsageDetail');
    usageText.textContent = t('mypage.loading');
    usageFill.style.width = '0%';
    usageFill.className = 'mypage-usage-bar-fill';
    usageDetail.innerHTML = '';

    try {
        const res = await fetch('/api/youtube/usage');
        if (!res.ok) throw new Error(t('toast.usageLoadFail'));
        const usage = await res.json();

        const pct = Math.min((usage.used / usage.limit) * 100, 100);
        usageFill.style.width = pct + '%';
        if (pct >= 90) usageFill.classList.add('danger');
        else if (pct >= 60) usageFill.classList.add('warning');

        usageText.textContent = t('mypage.units', { used: formatNumber(usage.used), limit: formatNumber(usage.limit) });

        const breakdown = usage.breakdown || {};
        const categories = Object.keys(breakdown);
        if (categories.length > 0) {
            usageDetail.innerHTML = categories.map(cat =>
                `<div class="mypage-usage-row">
                    <span class="mypage-usage-row-label">${escapeHtml(cat)}</span>
                    <span class="mypage-usage-row-value">${formatNumber(breakdown[cat])} ${getLang() === 'en' ? 'units' : '유닛'}</span>
                </div>`
            ).join('') +
            `<div class="mypage-usage-row">
                <span class="mypage-usage-row-label">${t('mypage.remainingUnits')}</span>
                <span class="mypage-usage-row-value" style="color:${pct >= 90 ? 'var(--red)' : pct >= 60 ? 'var(--orange)' : 'var(--green)'}">${formatNumber(usage.remaining)}</span>
            </div>`;
        } else {
            usageDetail.innerHTML = `<div class="mypage-usage-row">
                <span class="mypage-usage-row-label">${t('mypage.noUsage')}</span>
                <span class="mypage-usage-row-value">${t('mypage.remainingLabel', { n: formatNumber(usage.remaining) })}</span>
            </div>`;
        }
    } catch {
        usageText.textContent = t('toast.usageError');
    }
}

export function closeMyPage() { document.getElementById('myPageModal').classList.remove('active'); }

// ===== YouTube Integration =====
export function promptChannelConnect() {
    const saved = localStorage.getItem('creatorhub_yt_channel');
    const input = prompt(t('yt.channelPrompt'), saved || '');
    if (!input || !input.trim()) return;
    localStorage.setItem('creatorhub_yt_channel', input.trim());
    syncToServer({ yt_channel: input.trim() });
    updateSidebarYtLink(input.trim());
    loadYouTubeData();
}

export function setupYouTube() {
    document.getElementById('ytConnectBtn').addEventListener('click', promptChannelConnect);
    document.getElementById('ytRefreshBtn').addEventListener('click', () => loadYouTubeData(true));

    // 대시보드 상단 연동 버튼
    const myChConnectBtn = document.getElementById('myChConnectBtn');
    if (myChConnectBtn) myChConnectBtn.addEventListener('click', promptChannelConnect);

    const channelId = localStorage.getItem('creatorhub_yt_channel');
    if (channelId) {
        updateSidebarYtLink(channelId);
        loadYouTubeData();
    } else {
        updateMyChannelHero(null);
    }
}

export function updateSidebarYtLink(channelId) {
    const link = document.getElementById('sidebarYtLink');
    const studioLink = document.getElementById('sidebarStudioLink');
    if (channelId) {
        if (link) {
            link.href = 'https://www.youtube.com/channel/' + encodeURIComponent(channelId);
            link.style.display = '';
        }
        if (studioLink) {
            studioLink.href = 'https://studio.youtube.com/channel/' + encodeURIComponent(channelId);
            studioLink.style.display = '';
        }
    } else {
        if (link) link.style.display = 'none';
        if (studioLink) studioLink.style.display = 'none';
    }
}

export async function loadYouTubeData(forceRefresh = false) {
    if (checkGuestBlock()) return;
    const channelId = localStorage.getItem('creatorhub_yt_channel');
    if (!channelId) return;

    const emptyEl = document.getElementById('ytEmpty');
    const statsEl = document.getElementById('ytStats');
    const videosCard = document.getElementById('ytVideosCard');
    const refreshBtn = document.getElementById('ytRefreshBtn');
    const connectBtn = document.getElementById('ytConnectBtn');

    emptyEl.innerHTML = `<p class="empty-state">${escapeHtml(t('yt.loading'))}</p>`;

    const refreshParam = forceRefresh ? '&refresh=true' : '';
    try {
        const channelRes = await fetch(`/api/youtube/channel?channelId=${encodeURIComponent(channelId)}${refreshParam}`);
        if (!channelRes.ok) {
            const err = await channelRes.json();
            throw new Error(err.error || t('misc.searchFail'));
        }
        const channel = await channelRes.json();

        document.getElementById('ytSubscribers').textContent = formatNumber(channel.subscriberCount);
        document.getElementById('ytTotalViews').textContent = formatNumber(channel.viewCount);
        document.getElementById('ytVideoCount').textContent = formatNumber(channel.videoCount);

        updateMyChannelHero(channel);

        // 대시보드 웰컴 아바타용 썸네일 저장
        if (channel.thumbnail) {
            localStorage.setItem('creatorhub_yt_thumb', channel.thumbnail);
            const avatarEl = document.getElementById('welcomeAvatar');
            if (avatarEl) { avatarEl.src = channel.thumbnail; avatarEl.style.display = ''; }
        }

        emptyEl.style.display = 'none';
        statsEl.style.display = 'grid';
        videosCard.style.display = 'block';
        refreshBtn.style.display = 'inline-flex';
        connectBtn.textContent = t('yt.changeChannel');

        const channelInfoHtml = `
            <div class="yt-channel-info">
                <img class="yt-channel-thumb" src="${channel.thumbnail}" alt="${escapeHtml(channel.title)}">
                <div class="yt-channel-name">
                    ${escapeHtml(channel.title)}
                    <small>${t('yt.connected')}</small>
                </div>
            </div>`;

        const existingInfo = document.querySelector('.yt-channel-info');
        if (existingInfo) existingInfo.remove();
        statsEl.insertAdjacentHTML('beforebegin', channelInfoHtml);

        const videosRes = await fetch(`/api/youtube/videos?channelId=${encodeURIComponent(channelId)}${refreshParam}`);
        if (videosRes.ok) {
            const videos = await videosRes.json();
            state.ytVideos = videos;
            renderYouTubeVideos(videos);
            renderChart();
            updateUploadGoal();
            updateLastUploadBanner();
        }

        toast(t('yt.channelDataLoaded', { name: channel.title }));
    } catch (err) {
        emptyEl.style.display = 'block';
        emptyEl.innerHTML = `<p class="empty-state" style="color:var(--red)">${t('misc.error', { msg: escapeHtml(err.message) })}<br><small>${t('misc.serverCheck')}</small></p>`;
        statsEl.style.display = 'none';
        videosCard.style.display = 'none';
        updateMyChannelHero(null);
    }
}

function calcMilestone(value) {
    if (value <= 0) return { min: 0, max: 10, pct: 0 };
    const steps = [
        10, 25, 50, 100, 250, 500,
        1000, 2500, 5000, 10000, 25000, 50000,
        100000, 250000, 500000, 1000000, 2500000, 5000000,
        10000000, 25000000, 50000000, 100000000
    ];
    let min = 0, max = steps[0];
    for (let i = 0; i < steps.length; i++) {
        if (value < steps[i]) { max = steps[i]; min = i > 0 ? steps[i - 1] : 0; break; }
        if (i === steps.length - 1) { min = steps[i]; max = steps[i] * 2; }
    }
    const pct = max > min ? Math.min(((value - min) / (max - min)) * 100, 100) : 0;
    return { min, max, pct };
}

function formatMilestone(n) {
    if (getLang() === 'en') {
        if (n >= 1000000000) return (n / 1000000000) + 'B';
        if (n >= 1000000) return (n / 1000000) + 'M';
        if (n >= 1000) return (n / 1000) + 'K';
        return n.toLocaleString();
    }
    if (n >= 100000000) return (n / 100000000) + t('num.billion');
    if (n >= 10000) return (n / 10000) + t('num.tenThousand');
    if (n >= 1000) return (n / 1000) + t('num.thousand');
    return n.toLocaleString();
}

export function updateMyChannelHero(channel) {
    const statsEl = document.getElementById('myChannelStats');
    const emptyEl = document.getElementById('myChannelEmpty');
    if (!statsEl || !emptyEl) return;

    if (channel) {
        const subs = channel.subscriberCount || 0;
        const views = channel.viewCount || 0;

        document.getElementById('myChSubscribers').textContent = subs.toLocaleString();
        document.getElementById('myChTotalViews').textContent = views.toLocaleString();

        const subMs = calcMilestone(subs);
        document.getElementById('myChSubsProgress').style.width = subMs.pct + '%';
        document.getElementById('myChSubsMin').textContent = formatMilestone(subMs.min);
        document.getElementById('myChSubsMax').textContent = formatMilestone(subMs.max);

        const viewMs = calcMilestone(views);
        document.getElementById('myChViewsProgress').style.width = viewMs.pct + '%';
        document.getElementById('myChViewsMin').textContent = formatMilestone(viewMs.min);
        document.getElementById('myChViewsMax').textContent = formatMilestone(viewMs.max);

        const videos = channel.videoCount || 0;
        document.getElementById('myChVideoCount').textContent = videos.toLocaleString();
        const videoMs = calcMilestone(videos);
        document.getElementById('myChVideosProgress').style.width = videoMs.pct + '%';
        document.getElementById('myChVideosMin').textContent = formatMilestone(videoMs.min);
        document.getElementById('myChVideosMax').textContent = formatMilestone(videoMs.max);

        updateUploadGoal();

        statsEl.style.display = '';
        emptyEl.style.display = 'none';
    } else {
        statsEl.style.display = 'none';
        emptyEl.style.display = '';
    }
}

// ===== Upload Goal =====
export function getUploadGoal() {
    return parseInt(localStorage.getItem('creatorhub_upload_goal')) || 4;
}

export function getWeeklyGoal() {
    return parseInt(localStorage.getItem('creatorhub_weekly_goal')) || 1;
}

export function countMonthUploads() {
    if (!state.ytVideos || !state.ytVideos.length) return 0;
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    return state.ytVideos.filter(v => {
        const d = new Date(v.publishedAt);
        return d.getFullYear() === year && d.getMonth() === month;
    }).length;
}

export function countWeekUploads() {
    if (!state.ytVideos || !state.ytVideos.length) return 0;
    const now = new Date();
    const day = now.getDay(); // 0=Sun
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - day);
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 7);
    return state.ytVideos.filter(v => {
        const d = new Date(v.publishedAt);
        return d >= weekStart && d < weekEnd;
    }).length;
}

export function updateUploadGoal() {
    const CIRC = 2 * Math.PI * 32; // circumference for r=32

    // — Monthly ring —
    const goal = getUploadGoal();
    const uploads = countMonthUploads();
    const monthPct = goal > 0 ? Math.min(uploads / goal, 1) : 0;
    const monthRing = document.getElementById('goalRingMonthly');
    if (monthRing) {
        monthRing.setAttribute('stroke-dasharray', CIRC);
        monthRing.setAttribute('stroke-dashoffset', CIRC * (1 - monthPct));
    }
    const currentEl = document.getElementById('myChMonthUploads');
    const goalEl = document.getElementById('myChMonthGoal');
    if (currentEl) currentEl.textContent = uploads;
    if (goalEl) goalEl.textContent = goal;

    // — Weekly ring —
    const weeklyGoal = getWeeklyGoal();
    const weekUploads = countWeekUploads();
    const weekPct = weeklyGoal > 0 ? Math.min(weekUploads / weeklyGoal, 1) : 0;
    const weekRing = document.getElementById('goalRingWeekly');
    if (weekRing) {
        weekRing.setAttribute('stroke-dasharray', CIRC);
        weekRing.setAttribute('stroke-dashoffset', CIRC * (1 - weekPct));
    }
    const weekUploadsEl = document.getElementById('myChWeekUploads');
    const weekGoalEl = document.getElementById('myChWeekGoal');
    if (weekUploadsEl) weekUploadsEl.textContent = weekUploads;
    if (weekGoalEl) weekGoalEl.textContent = weeklyGoal;

    // — Upload Streak —
    const streak = calcUploadStreak();
    const streakNumEl = document.getElementById('goalStreakCurrent');
    const streakLabelEl = document.getElementById('goalStreakLabel');
    const streakBestEl = document.getElementById('goalStreakBest');
    if (streakNumEl) streakNumEl.textContent = streak.current;
    if (streakLabelEl) {
        streakLabelEl.textContent = streak.current > 0
            ? t('goal.streakWeeks', { n: streak.current })
            : t('goal.streakNone');
    }
    if (streakBestEl) {
        streakBestEl.textContent = streak.best > 0
            ? t('goal.streakBest', { n: streak.best })
            : '';
    }

    // — Remaining Pace —
    const pace = calcRemainingPace();
    const paceInfoEl = document.getElementById('goalPaceInfo');
    const paceBadgeEl = document.getElementById('goalPaceBadge');
    if (paceInfoEl) {
        paceInfoEl.textContent = pace.uploadsLeft <= 0
            ? ''
            : t('goal.paceInfo', { days: pace.daysLeft, uploads: pace.uploadsLeft });
    }
    if (paceBadgeEl) {
        paceBadgeEl.className = 'goal-pace-badge';
        if (pace.uploadsLeft <= 0) {
            paceBadgeEl.textContent = t('goal.paceDone');
            paceBadgeEl.classList.add('done');
        } else {
            const labels = { relaxed: t('goal.paceRelaxed'), 'on-track': t('goal.paceOnTrack'), tight: t('goal.paceTight') };
            paceBadgeEl.textContent = labels[pace.pace] || '';
            paceBadgeEl.classList.add(pace.pace);
        }
    }
}

function calcUploadStreak() {
    if (!state.ytVideos || !state.ytVideos.length) return { current: 0, best: 0 };

    // Build a Set of ISO week keys (YYYY-Www) that have uploads
    const weekSet = new Set();
    state.ytVideos.forEach(v => {
        const d = new Date(v.publishedAt);
        weekSet.add(getISOWeekKey(d));
    });

    // Current streak: from this week backwards
    const now = new Date();
    let current = 0;
    let d = new Date(now);
    // If current week has no upload, streak is 0
    if (weekSet.has(getISOWeekKey(d))) {
        while (weekSet.has(getISOWeekKey(d))) {
            current++;
            d.setDate(d.getDate() - 7);
        }
    }

    // Best streak: scan all weeks in range
    if (weekSet.size === 0) return { current: 0, best: 0 };
    const sorted = Array.from(weekSet).sort();
    let best = 1, run = 1;
    for (let i = 1; i < sorted.length; i++) {
        if (isConsecutiveWeek(sorted[i - 1], sorted[i])) {
            run++;
            if (run > best) best = run;
        } else {
            run = 1;
        }
    }
    return { current, best: Math.max(best, current) };
}

function getISOWeekKey(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
    return d.getUTCFullYear() + '-W' + String(weekNo).padStart(2, '0');
}

function isConsecutiveWeek(a, b) {
    // Parse YYYY-Www and check if b = a + 1 week
    const [aY, aW] = a.split('-W').map(Number);
    const [bY, bW] = b.split('-W').map(Number);
    if (aY === bY) return bW === aW + 1;
    // Year boundary: last week of year → week 1 of next year
    if (bY === aY + 1 && bW === 1) {
        // Check if aW is the last week of aY (52 or 53)
        const dec28 = new Date(Date.UTC(aY, 11, 28));
        dec28.setUTCDate(dec28.getUTCDate() + 4 - (dec28.getUTCDay() || 7));
        const lastWeek = Math.ceil(((dec28 - new Date(Date.UTC(dec28.getUTCFullYear(), 0, 1))) / 86400000 + 1) / 7);
        return aW === lastWeek;
    }
    return false;
}

function calcRemainingPace() {
    const goal = getUploadGoal();
    const uploads = countMonthUploads();
    const uploadsLeft = Math.max(goal - uploads, 0);

    const now = new Date();
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const daysLeft = lastDay - now.getDate();

    let pace = 'on-track';
    if (uploadsLeft <= 0) {
        pace = 'done';
    } else if (daysLeft <= 0) {
        pace = 'tight';
    } else {
        const ratio = daysLeft / uploadsLeft;
        if (ratio > 7) pace = 'relaxed';
        else if (ratio >= 3) pace = 'on-track';
        else pace = 'tight';
    }

    return { daysLeft, uploadsLeft, pace };
}

export function setupUploadGoal() {
    const btn = document.getElementById('uploadGoalEditBtn');
    if (!btn) return;
    btn.addEventListener('click', () => {
        openGoalModal();
    });
}

export function setupGoalModal() {
    const overlay = document.getElementById('goalModal');
    const closeBtn = document.getElementById('closeGoalModal');
    const saveBtn = document.getElementById('saveGoalBtn');
    if (!overlay) return;

    closeBtn.addEventListener('click', () => overlay.classList.remove('active'));
    overlay.addEventListener('click', e => {
        if (e.target === overlay) overlay.classList.remove('active');
    });
    saveBtn.addEventListener('click', saveGoalSettings);
}

export function openGoalModal() {
    const overlay = document.getElementById('goalModal');
    const monthlyInput = document.getElementById('goalMonthlyInput');
    const weeklyInput = document.getElementById('goalWeeklyInput');
    const monthlyCurrent = document.getElementById('goalMonthlyCurrent');
    const weeklyCurrent = document.getElementById('goalWeeklyCurrent');

    monthlyInput.value = getUploadGoal();
    weeklyInput.value = getWeeklyGoal();
    monthlyCurrent.textContent = t('goal.monthlyCurrent', { n: countMonthUploads() });
    weeklyCurrent.textContent = t('goal.weeklyCurrent', { n: countWeekUploads() });

    overlay.classList.add('active');
}

export function saveGoalSettings() {
    const monthlyVal = parseInt(document.getElementById('goalMonthlyInput').value);
    const weeklyVal = parseInt(document.getElementById('goalWeeklyInput').value);

    if (!monthlyVal || monthlyVal < 1 || monthlyVal > 100) {
        toast(t('toast.goalMonthlyError'));
        return;
    }
    if (!weeklyVal || weeklyVal < 1 || weeklyVal > 30) {
        toast(t('toast.goalWeeklyError'));
        return;
    }

    localStorage.setItem('creatorhub_upload_goal', monthlyVal);
    localStorage.setItem('creatorhub_weekly_goal', weeklyVal);
    syncToServer({ upload_goal: monthlyVal, weekly_goal: weeklyVal });
    updateUploadGoal();
    document.getElementById('goalModal').classList.remove('active');
    toast(t('toast.goalSaved', { monthly: monthlyVal, weekly: weeklyVal }));
}

// ===== Last Upload Banner =====
export function updateLastUploadBanner() {
    const banner = document.getElementById('lastUploadBanner');
    if (!banner) return;
    if (!state.ytVideos || !state.ytVideos.length) { banner.style.display = 'none'; return; }

    const sorted = state.ytVideos.slice().sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    const lastDate = new Date(sorted[0].publishedAt);
    const now = new Date();
    // 날짜 단위로만 비교 (시간대 차이 무시)
    const toDateOnly = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diffDays = Math.round((toDateOnly(now) - toDateOnly(lastDate)) / (1000 * 60 * 60 * 24));

    document.getElementById('lastUploadDays').textContent = t('dash.lastUploadDays', { n: diffDays });
    const subEl = document.getElementById('lastUploadSub');
    if (subEl) {
        if (diffDays === 0) subEl.textContent = t('dash.lastUpload0');
        else if (diffDays <= 3) subEl.textContent = t('dash.lastUpload3');
        else if (diffDays <= 7) subEl.textContent = t('dash.lastUpload7');
        else if (diffDays <= 14) subEl.textContent = t('dash.lastUpload14');
        else subEl.textContent = t('dash.lastUploadLong');
    }
    banner.style.display = '';
    banner.classList.toggle('warn', diffDays >= 14);
}

// renderYouTubeVideos — was placed in Reference Folders section in original, belongs here
export function renderYouTubeVideos(videos) {
    const container = document.getElementById('ytVideosList');
    if (!videos || videos.length === 0) {
        container.innerHTML = `<p class="empty-state">${t('yt.noVideos')}</p>`;
        return;
    }

    container.innerHTML = videos.map(v => {
        const dateLocale = getLang() === 'en' ? 'en-US' : 'ko-KR';
        const date = new Date(v.publishedAt).toLocaleDateString(dateLocale, { year: 'numeric', month: 'short', day: 'numeric' });
        return `
        <div class="yt-video-item">
            <img class="yt-video-thumb" src="${v.thumbnail}" alt="${escapeHtml(v.title)}">
            <div class="yt-video-info">
                <div class="yt-video-title">${escapeHtml(v.title)}</div>
                <div class="yt-video-date">${date}</div>
                <div class="yt-video-stats">
                    <span>👁 ${formatNumber(v.viewCount)}</span>
                    <span>👍 ${formatNumber(v.likeCount)}</span>
                    <span>💬 ${formatNumber(v.commentCount)}</span>
                </div>
            </div>
        </div>`;
    }).join('');
}

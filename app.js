// ===== State =====
const state = {
    contents: JSON.parse(localStorage.getItem('creatorhub_contents') || '[]'),
    references: JSON.parse(localStorage.getItem('creatorhub_references') || '[]'),
    refFolders: JSON.parse(localStorage.getItem('creatorhub_ref_folders') || '[]'),
    activeRefFolder: null,
    ytVideos: [],
    currentTab: 'dashboard',
    calendarDate: new Date(),
    theme: localStorage.getItem('creatorhub_theme') || 'dark',
    user: null,
    isGuest: false
};

const STATUS_ORDER = ['idea', 'scripting', 'filming', 'editing', 'scheduled', 'published'];
function getStatusLabel(s) { return t('status.' + s) || s; }
function getScriptStatusLabel(s) { return s ? (t('scriptStatus.' + s) || s) : t('scriptStatus.none'); }
function getTypeLabel(tp) { return t('type.' + tp) || tp; }
// Legacy compat — some code may reference these directly
const statusLabels = new Proxy({}, { get: (_, k) => getStatusLabel(k) });
const scriptStatusLabels = new Proxy({}, { get: (_, k) => getScriptStatusLabel(k) });
const typeLabels = new Proxy({}, { get: (_, k) => getTypeLabel(k) });

// ===== Server Sync =====
let _syncPatch = {};
let _syncTimer = null;

function syncToServer(patch) {
    Object.assign(_syncPatch, patch);
    clearTimeout(_syncTimer);
    _syncTimer = setTimeout(async () => {
        const payload = _syncPatch;
        _syncPatch = {};
        try {
            await fetch('/api/data', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        } catch { /* 네트워크 실패 시 무시 — localStorage는 이미 저장됨 */ }
    }, 1000);
}

async function loadDataFromServer() {
    try {
        const res = await fetch('/api/data');
        if (!res.ok) return;
        const data = await res.json();

        if (!data || data.noDb) {
            // Supabase 미설정 — localStorage 데이터 그대로 사용
            return;
        }

        // 스칼라 값은 항상 서버 우선 적용
        if (data.upload_goal) localStorage.setItem('creatorhub_upload_goal', data.upload_goal);
        if (data.weekly_goal) localStorage.setItem('creatorhub_weekly_goal', data.weekly_goal);
        if (data.yt_channel) localStorage.setItem('creatorhub_yt_channel', data.yt_channel);

        const hasServerData = data.contents && data.contents.length > 0;
        const hasLocalContents = state.contents.length > 0;

        if (hasServerData) {
            // 서버 데이터가 있으면 서버 우선
            if (data.contents) { state.contents = data.contents; localStorage.setItem('creatorhub_contents', JSON.stringify(data.contents)); }
            if (data.refs) { state.references = data.refs; localStorage.setItem('creatorhub_references', JSON.stringify(data.refs)); }
            if (data.ref_folders) { state.refFolders = data.ref_folders; localStorage.setItem('creatorhub_ref_folders', JSON.stringify(data.ref_folders)); }
        } else if (hasLocalContents) {
            // 서버 비어있고 localStorage에 데이터 있음 → 마이그레이션
            await fetch('/api/data', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: state.contents,
                    refs: state.references,
                    ref_folders: state.refFolders,
                    upload_goal: parseInt(localStorage.getItem('creatorhub_upload_goal')) || 4,
                    weekly_goal: parseInt(localStorage.getItem('creatorhub_weekly_goal')) || 1,
                    yt_channel: localStorage.getItem('creatorhub_yt_channel') || null
                })
            });
        }
    } catch { /* 실패 시 localStorage 데이터로 정상 동작 */ }
}

// ===== Data Migration =====
function migrateScriptsToContents() {
    const scriptsRaw = localStorage.getItem('creatorhub_scripts');
    if (!scriptsRaw) return;

    const scripts = JSON.parse(scriptsRaw);
    if (!Array.isArray(scripts) || scripts.length === 0) {
        localStorage.removeItem('creatorhub_scripts');
        return;
    }

    const linkedScriptIds = new Set();

    // 1. Merge linked scripts into their contents
    state.contents.forEach(c => {
        if (c.scriptId) {
            const script = scripts.find(s => s.id === c.scriptId);
            if (script) {
                c.scriptContent = script.content || '';
                c.scriptStatus = script.status || 'draft';
                c.updatedAt = script.updatedAt || new Date().toISOString();
                linkedScriptIds.add(script.id);
            }
            delete c.scriptId;
        }
    });

    // 2. Orphan scripts → new content items
    scripts.forEach(s => {
        if (!linkedScriptIds.has(s.id)) {
            state.contents.push({
                id: generateId(),
                title: s.title || t('misc.noTitle'),
                platform: s.platform || 'youtube',
                status: 'idea',
                date: '',
                contentType: 'long',
                memo: '',
                checklist: {},
                scriptContent: s.content || '',
                scriptStatus: s.status || 'draft',
                createdAt: s.createdAt || new Date().toISOString(),
                updatedAt: s.updatedAt || new Date().toISOString()
            });
        }
    });

    // 3. Clean up: remove scriptId from all contents & delete scripts storage
    state.contents.forEach(c => { delete c.scriptId; });
    localStorage.removeItem('creatorhub_scripts');
    saveContents();
}

// ===== Init =====
document.addEventListener('DOMContentLoaded', () => {
    applyTheme();
    checkAuth();
    document.getElementById('guestModeBtn')?.addEventListener('click', enterGuestMode);
});

let _appInitialized = false;
function initApp() {
    migrateScriptsToContents();
    if (!_appInitialized) {
        setupSidebarToggle();
        setupNavigation();
        setupCalendar();
        setupContentModal();
        setupModalTabs();
        setupScriptEditorToolbar();
        setupThemeToggle();
        setupKanban();
        setupChecklist();
        setupYouTube();
        setupDiscover();
        setupChannelSearch();
        setupReferences();
        setupIdeas();
        setupAdDetect();
        setupOutlierFinder();
        setupNewContentPage();
        setupChart();
        setupUploadGoal();
        setupGoalModal();
        setupLangSwitcher();
        updateTodayDate();
        applyI18nToDOM();
        // 초기 로드 시 현재 탭 헤더 갱신
        const info = getNavTitle(state.currentTab);
        document.getElementById('pageTitle').textContent = info.title;
        document.getElementById('pageDesc').textContent = info.desc;
        _appInitialized = true;
    }
    renderAll();
}

// ===== Auth =====
async function checkAuth() {
    try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
            const data = await res.json();
            state.user = data.user;
            showApp();
        } else {
            showLogin();
        }
    } catch {
        showLogin();
    }
}

function enterGuestMode() {
    state.isGuest = true;
    state.user = null;
    showApp();
}

function checkGuestBlock() {
    if (state.isGuest) {
        toast(t('toast.guestRestricted'));
        return true;
    }
    return false;
}

async function showApp() {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('sidebar').style.display = '';
    document.getElementById('mainContent').style.display = '';

    // Nav User 프로필 표시
    if (state.user) {
        document.getElementById('navUser').style.display = '';
        // Trigger
        document.getElementById('userAvatar').src = state.user.picture || '';
        document.getElementById('userName').textContent = state.user.name || '';
        document.getElementById('userEmail').textContent = state.user.email || '';
        // Dropdown header
        document.getElementById('dropdownAvatar').src = state.user.picture || '';
        document.getElementById('dropdownName').textContent = state.user.name || '';
        document.getElementById('dropdownEmail').textContent = state.user.email || '';
        // Events
        document.getElementById('myPageBtn').onclick = openMyPage;
        document.getElementById('logoutBtn').onclick = logout;
        setupNavUserDropdown();
        setupMyPageModal();
    } else if (state.isGuest) {
        const navUser = document.getElementById('navUser');
        navUser.style.display = '';
        navUser.innerHTML = `<button class="nav-login-btn" onclick="showLogin()">${t('login.guestBadge')} · ${t('nav.mypage')} 로그인</button>`;
    }

    if (!state.isGuest) {
        await loadDataFromServer();
        const ytCh = localStorage.getItem('creatorhub_yt_channel');
        if (ytCh) updateSidebarYtLink(ytCh);
    }
    initApp();
}

function setupNavUserDropdown() {
    const trigger = document.getElementById('navUserTrigger');
    const dropdown = document.getElementById('navUserDropdown');
    if (!trigger || trigger._bound) return;
    trigger._bound = true;

    trigger.addEventListener('click', e => {
        e.stopPropagation();
        dropdown.classList.toggle('open');
    });

    document.addEventListener('click', e => {
        if (!dropdown.contains(e.target) && !trigger.contains(e.target)) {
            dropdown.classList.remove('open');
        }
    });

    // 드롭다운 내 버튼 클릭 시 닫기
    dropdown.querySelectorAll('.nav-user-dropdown-item').forEach(btn => {
        btn.addEventListener('click', () => dropdown.classList.remove('open'));
    });
}

function showLogin() {
    state.isGuest = false;
    document.getElementById('loginScreen').style.display = '';
    document.getElementById('sidebar').style.display = 'none';
    document.getElementById('mainContent').style.display = 'none';
    renderGoogleButton();
}

async function renderGoogleButton() {
    const btnContainer = document.getElementById('googleLoginBtn');
    if (!btnContainer || !window.google) {
        setTimeout(renderGoogleButton, 200);
        return;
    }

    // 서버에서 Client ID 가져오기
    if (!window.__GOOGLE_CLIENT_ID) {
        try {
            const res = await fetch('/api/config');
            const config = await res.json();
            window.__GOOGLE_CLIENT_ID = config.googleClientId;
        } catch { return; }
    }

    google.accounts.id.initialize({
        client_id: window.__GOOGLE_CLIENT_ID,
        callback: handleGoogleLogin
    });
    google.accounts.id.renderButton(btnContainer, {
        theme: state.theme === 'dark' ? 'filled_black' : 'outline',
        size: 'large',
        width: 280,
        text: 'signin_with',
        locale: getLang() === 'en' ? 'en' : 'ko'
    });
}

async function handleGoogleLogin(response) {
    try {
        const res = await fetch('/api/auth/google', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ credential: response.credential })
        });
        if (res.ok) {
            const data = await res.json();
            state.user = data.user;
            showApp();
            toast(t('login.welcome', { name: state.user.name }));
        } else {
            const err = await res.json();
            toast(t('login.fail', { error: err.error || t('login.failUnknown') }));
        }
    } catch {
        toast(t('login.error'));
    }
}

async function logout() {
    try {
        await fetch('/api/auth/logout', { method: 'POST' });
    } catch { /* ignore */ }
    state.user = null;
    state.isGuest = false;
    showLogin();
    toast(t('login.loggedOut'));
}

function renderAll() {
    renderDashboard();
    renderCalendar();
    renderKanban();
}

// ===== Theme =====
function applyTheme() { document.documentElement.setAttribute('data-theme', state.theme); }
function setupThemeToggle() {
    document.getElementById('themeToggle').addEventListener('click', () => {
        state.theme = state.theme === 'dark' ? 'light' : 'dark';
        localStorage.setItem('creatorhub_theme', state.theme);
        applyTheme();
        renderChart();
    });
}

// ===== Sidebar Toggle =====
function setupSidebarToggle() {
    const saved = localStorage.getItem('creatorhub_sidebar');
    if (saved === 'collapsed') toggleSidebar(true);
    document.getElementById('sidebarToggle').addEventListener('click', e => {
        e.stopPropagation();
        toggleSidebar();
    });
}

function toggleSidebar(silent) {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('collapsed');
    document.body.classList.toggle('sidebar-collapsed');
    const isCollapsed = sidebar.classList.contains('collapsed');
    localStorage.setItem('creatorhub_sidebar', isCollapsed ? 'collapsed' : 'expanded');
    if (!silent) setTimeout(() => renderChart(), 350);
}

// ===== Navigation =====
function getNavTitle(tab) {
    const map = {
        dashboard: 'nav.home', kanban: 'nav.content', calendar: 'nav.calendar',
        discover: 'nav.discover', channels: 'nav.channels', references: 'nav.references',
        ideas: 'nav.ideas', addetect: 'nav.addetect', outliers: 'nav.outliers',
        newcontent: 'header.newContent'
    };
    return { title: t(map[tab] || tab), desc: t('desc.' + tab) };
}

const LAB_TABS = ['discover', 'channels', 'references', 'ideas', 'addetect', 'outliers'];

function switchTab(tab) {
    document.querySelectorAll('.menu-item').forEach(m => m.classList.remove('active'));
    const target = document.querySelector(`.menu-item[data-tab="${tab}"]`);
    if (target) target.classList.add('active');
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.getElementById(`tab-${tab}`).classList.add('active');
    const info = getNavTitle(tab);
    document.getElementById('pageTitle').textContent = info.title;
    document.getElementById('pageDesc').textContent = info.desc;
    state.currentTab = tab;
    // Auto-open lab submenu when switching to a lab tab
    if (LAB_TABS.includes(tab)) {
        const toggle = document.getElementById('labToggle');
        const submenu = document.getElementById('labSubmenu');
        if (toggle && submenu) {
            toggle.classList.add('open');
            submenu.classList.add('open');
            localStorage.setItem('creatorhub_lab_open', 'true');
        }
    }
    if (tab === 'dashboard') renderDashboard();
    if (tab === 'kanban') renderKanban();
    if (tab === 'references') renderReferences();
    if (tab === 'ideas') loadTrendingVideos();
}

function setupNavigation() {
    document.querySelectorAll('.menu-item[data-tab]').forEach(item => {
        item.addEventListener('click', () => switchTab(item.dataset.tab));
    });
    document.querySelector('.sidebar-logo').addEventListener('click', () => switchTab('dashboard'));

    // Lab toggle
    const labToggle = document.getElementById('labToggle');
    const labSubmenu = document.getElementById('labSubmenu');
    if (labToggle && labSubmenu) {
        // Restore saved state
        if (localStorage.getItem('creatorhub_lab_open') === 'true') {
            labToggle.classList.add('open');
            labSubmenu.classList.add('open');
        }
        labToggle.addEventListener('click', () => {
            const isOpen = labToggle.classList.toggle('open');
            labSubmenu.classList.toggle('open');
            localStorage.setItem('creatorhub_lab_open', isOpen ? 'true' : 'false');
        });
    }
}

function updateTodayDate() {
    const now = new Date();
    const locale = getLang() === 'en' ? 'en-US' : 'ko-KR';
    document.getElementById('todayDate').textContent = now.toLocaleDateString(locale, {
        year: 'numeric', month: 'long', day: 'numeric', weekday: 'long'
    });
}

// ===== Data Helpers =====
function saveContents() { localStorage.setItem('creatorhub_contents', JSON.stringify(state.contents)); syncToServer({ contents: state.contents }); }
function generateId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function formatDate(dateStr) { const d = new Date(dateStr); return `${d.getMonth() + 1}/${d.getDate()}`; }
function escapeHtml(text) { const div = document.createElement('div'); div.textContent = text; return div.innerHTML; }
function toast(message) {
    const container = document.getElementById('toastContainer');
    const el = document.createElement('div');
    el.className = 'toast'; el.textContent = message;
    container.appendChild(el);
    setTimeout(() => el.remove(), 3000);
}
function getChecklistCount(checklist) {
    if (!checklist) return { done: 0, total: 7 };
    const done = Object.values(checklist).filter(Boolean).length;
    return { done, total: 7 };
}

// ===== Dashboard =====
function updateWelcomeGreeting() {
    const titleEl = document.getElementById('welcomeTitle');
    const msgEl = document.getElementById('welcomeMessage');
    if (!titleEl || !msgEl) return;

    const hour = new Date().getHours();
    let greetingKey;
    if (hour >= 5 && hour < 12) greetingKey = 'greeting.morning';
    else if (hour >= 12 && hour < 18) greetingKey = 'greeting.afternoon';
    else if (hour >= 18 && hour < 23) greetingKey = 'greeting.evening';
    else greetingKey = 'greeting.night';

    const name = (state.user && state.user.name) ? state.user.name : t('greeting.default');
    titleEl.textContent = t('greeting.format', { greeting: t(greetingKey), name });
    const msgs = getWelcomeMessages();
    msgEl.textContent = msgs[Math.floor(Math.random() * msgs.length)];

    const ctaBtn = document.getElementById('welcomeNewContent');
    if (ctaBtn && !ctaBtn._bound) {
        ctaBtn.addEventListener('click', () => switchTab('newcontent'));
        ctaBtn._bound = true;
    }
    const lastUploadBtn = document.getElementById('lastUploadNewBtn');
    if (lastUploadBtn && !lastUploadBtn._bound) {
        lastUploadBtn.addEventListener('click', () => switchTab('newcontent'));
        lastUploadBtn._bound = true;
    }
}

function renderDashboard() {
    updateWelcomeGreeting();
    renderChart();
}

// ===== Area Chart =====
let _chartResizeTimer = null;

function setupChart() {
    const rangeSelect = document.getElementById('chartRange');
    if (rangeSelect) rangeSelect.addEventListener('change', () => renderChart());

    window.addEventListener('resize', () => {
        clearTimeout(_chartResizeTimer);
        _chartResizeTimer = setTimeout(() => renderChart(), 200);
    });

    // Canvas mouse interaction
    const canvas = document.getElementById('monthlyChart');
    if (!canvas) return;
    canvas.addEventListener('mousemove', handleChartHover);
    canvas.addEventListener('mouseleave', handleChartLeave);
}

// Store chart state for hover interaction
let _chartState = null;
let _chartHoverIdx = -1; // -1 = no hover

function getWeeklyData(monthsBack) {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - monthsBack, now.getDate());
    start.setDate(start.getDate() - start.getDay()); // align to Sunday
    const startStr = start.toISOString().slice(0, 10);

    // Count all uploads before the chart range as the baseline
    let baseLong = 0, baseShort = 0;
    state.ytVideos.forEach(v => {
        const d = v.publishedAt ? v.publishedAt.slice(0, 10) : '';
        if (d < startStr) {
            const sec = parseDurationToSeconds(v.duration);
            if (sec > 0 && sec <= 60) baseShort++; else baseLong++;
        }
    });
    state.contents.filter(c => c.status === 'published' && c.date < startStr).forEach(c => {
        if (c.contentType === 'short') baseShort++; else baseLong++;
    });

    const weeks = [];
    let cumLong = baseLong, cumShort = baseShort;
    const cur = new Date(start);
    while (cur <= now) {
        const weekStart = new Date(cur);
        const weekEnd = new Date(cur);
        weekEnd.setDate(weekEnd.getDate() + 6);
        const wsStr = weekStart.toISOString().slice(0, 10);
        const weStr = weekEnd.toISOString().slice(0, 10);

        // YouTube videos this week
        state.ytVideos.forEach(v => {
            const d = v.publishedAt ? v.publishedAt.slice(0, 10) : '';
            if (d >= wsStr && d <= weStr) {
                const sec = parseDurationToSeconds(v.duration);
                if (sec > 0 && sec <= 60) cumShort++; else cumLong++;
            }
        });
        // App-published contents this week
        state.contents.filter(c => c.status === 'published' && c.date >= wsStr && c.date <= weStr).forEach(c => {
            if (c.contentType === 'short') cumShort++; else cumLong++;
        });

        weeks.push({ weekStart, weekEnd, longForm: cumLong, shortForm: cumShort, label: `${weekStart.getMonth() + 1}/${weekStart.getDate()}` });
        cur.setDate(cur.getDate() + 7);
    }
    return weeks;
}

function catmullRomToBezier(points) {
    const result = [];
    for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[Math.max(i - 1, 0)];
        const p1 = points[i];
        const p2 = points[i + 1];
        const p3 = points[Math.min(i + 2, points.length - 1)];
        result.push({
            cp1x: p1.x + (p2.x - p0.x) / 6,
            cp1y: p1.y + (p2.y - p0.y) / 6,
            cp2x: p2.x - (p3.x - p1.x) / 6,
            cp2y: p2.y - (p3.y - p1.y) / 6,
            x: p2.x,
            y: p2.y
        });
    }
    return result;
}

function drawSmoothLine(ctx, points) {
    if (points.length < 2) return;
    ctx.moveTo(points[0].x, points[0].y);
    const segs = catmullRomToBezier(points);
    segs.forEach((s, i) => {
        // Clamp control points so curve never goes above previous or below next point (y is inverted)
        const yTop = Math.min(points[i].y, points[i + 1].y);
        const yBot = Math.max(points[i].y, points[i + 1].y);
        const cp1y = Math.max(Math.min(s.cp1y, yBot), yTop);
        const cp2y = Math.max(Math.min(s.cp2y, yBot), yTop);
        ctx.bezierCurveTo(s.cp1x, cp1y, s.cp2x, cp2y, s.x, s.y);
    });
}

function renderChart() {
    const canvas = document.getElementById('monthlyChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const wrap = canvas.parentElement;
    const dpr = window.devicePixelRatio || 1;
    const cs = getComputedStyle(wrap);
    const w = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const h = 250;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.scale(dpr, dpr);

    const isDark = state.theme === 'dark';
    const rangeSelect = document.getElementById('chartRange');
    const monthsBack = rangeSelect ? parseInt(rangeSelect.value) : 6;
    const weeks = getWeeklyData(monthsBack);

    const color1 = isDark ? '#d4d4d8' : '#3f3f46';
    const color2 = isDark ? '#71717a' : '#a1a1aa';
    const gridColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
    const labelColor = isDark ? '#71717a' : '#a1a1aa';

    const dot1 = document.getElementById('legendDot1');
    const dot2 = document.getElementById('legendDot2');
    if (dot1) dot1.style.background = color1;
    if (dot2) dot2.style.background = color2;

    const padding = { top: 16, right: 16, bottom: 32, left: 36 };
    const chartW = w - padding.left - padding.right;
    const chartH = h - padding.top - padding.bottom;

    const allVals = weeks.flatMap(w => [w.longForm, w.shortForm]);
    const maxData = Math.max(...allVals, 1);
    const gridStep = Math.ceil(maxData / 4) || 1;
    const maxVal = gridStep * 4;

    const gap = weeks.length > 1 ? chartW / (weeks.length - 1) : chartW;
    const pts1 = weeks.map((wk, i) => ({
        x: padding.left + (weeks.length > 1 ? gap * i : chartW / 2),
        y: padding.top + chartH - (wk.longForm / maxVal) * chartH
    }));
    const pts2 = weeks.map((wk, i) => ({
        x: padding.left + (weeks.length > 1 ? gap * i : chartW / 2),
        y: padding.top + chartH - (wk.shortForm / maxVal) * chartH
    }));

    _chartState = { weeks, pts1, pts2, padding, chartW, chartH, maxVal, color1, color2, w, h, isDark };

    ctx.clearRect(0, 0, w, h);

    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
        const y = Math.round(padding.top + (chartH / 4) * i) + 0.5;
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(w - padding.right, y);
        ctx.stroke();

        ctx.fillStyle = labelColor;
        ctx.font = '10px -apple-system, sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(maxVal - gridStep * i, padding.left - 8, y);
    }

    const baseline = padding.top + chartH;

    if (pts2.length >= 2) {
        ctx.beginPath();
        drawSmoothLine(ctx, pts2);
        ctx.lineTo(pts2[pts2.length - 1].x, baseline);
        ctx.lineTo(pts2[0].x, baseline);
        ctx.closePath();
        const grad2 = ctx.createLinearGradient(0, padding.top, 0, baseline);
        grad2.addColorStop(0, isDark ? 'rgba(113,113,122,0.35)' : 'rgba(161,161,170,0.35)');
        grad2.addColorStop(1, isDark ? 'rgba(113,113,122,0.03)' : 'rgba(161,161,170,0.03)');
        ctx.fillStyle = grad2;
        ctx.fill();
    }

    if (pts1.length >= 2) {
        ctx.beginPath();
        drawSmoothLine(ctx, pts1);
        ctx.lineTo(pts1[pts1.length - 1].x, baseline);
        ctx.lineTo(pts1[0].x, baseline);
        ctx.closePath();
        const grad1 = ctx.createLinearGradient(0, padding.top, 0, baseline);
        grad1.addColorStop(0, isDark ? 'rgba(212,212,216,0.40)' : 'rgba(63,63,70,0.40)');
        grad1.addColorStop(1, isDark ? 'rgba(212,212,216,0.03)' : 'rgba(63,63,70,0.03)');
        ctx.fillStyle = grad1;
        ctx.fill();
    }

    if (pts2.length >= 2) {
        ctx.beginPath();
        drawSmoothLine(ctx, pts2);
        ctx.strokeStyle = color2;
        ctx.lineWidth = 1.5;
        ctx.stroke();
    }

    if (pts1.length >= 2) {
        ctx.beginPath();
        drawSmoothLine(ctx, pts1);
        ctx.strokeStyle = color1;
        ctx.lineWidth = 1.5;
        ctx.stroke();
    }

    ctx.fillStyle = labelColor;
    ctx.font = '10px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const labelInterval = weeks.length > 16 ? 4 : weeks.length > 8 ? 2 : 1;
    weeks.forEach((wk, i) => {
        if (i % labelInterval === 0 || i === weeks.length - 1) {
            const x = padding.left + (weeks.length > 1 ? gap * i : chartW / 2);
            ctx.fillText(wk.label, x, baseline + 8);
        }
    });

    const tooltip = document.getElementById('chartTooltip');
    if (_chartHoverIdx >= 0 && _chartHoverIdx < weeks.length) {
        const ci = _chartHoverIdx;
        const hx = pts1[ci].x;

        ctx.beginPath();
        ctx.moveTo(hx, padding.top);
        ctx.lineTo(hx, padding.top + chartH);
        ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.stroke();
        ctx.setLineDash([]);

        [{ pts: pts1, color: color1 }, { pts: pts2, color: color2 }].forEach(({ pts, color }) => {
            const p = pts[ci];
            ctx.beginPath();
            ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
            ctx.fillStyle = isDark ? '#09090b' : '#ffffff';
            ctx.fill();
            ctx.beginPath();
            ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.stroke();
        });

        const wk = weeks[ci];
        const endLabel = `${wk.weekEnd.getMonth() + 1}/${wk.weekEnd.getDate()}`;
        tooltip.innerHTML = `
            <div class="chart-tooltip-title">${wk.label} ~ ${endLabel}</div>
            <div class="chart-tooltip-row">
                <span class="chart-tooltip-dot" style="background:${color1}"></span>
                <span class="chart-tooltip-label">${t('dash.longForm')}</span>
                <span class="chart-tooltip-value">${wk.longForm}${t('num.piece')}</span>
            </div>
            <div class="chart-tooltip-row">
                <span class="chart-tooltip-dot" style="background:${color2}"></span>
                <span class="chart-tooltip-label">${t('dash.shortForm')}</span>
                <span class="chart-tooltip-value">${wk.shortForm}${t('num.piece')}</span>
            </div>`;
        tooltip.style.display = 'block';

        let tx = hx + 12;
        if (tx + 140 > w) tx = hx - 150;
        let ty = Math.min(pts1[ci].y, pts2[ci].y) - 10;
        if (ty < 0) ty = 10;
        tooltip.style.left = tx + 'px';
        tooltip.style.top = ty + 'px';
    } else {
        if (tooltip) tooltip.style.display = 'none';
    }
}

function handleChartHover(e) {
    if (!_chartState) return;
    const canvas = e.target;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const { pts1 } = _chartState;

    let closestIdx = 0;
    let closestDist = Infinity;
    pts1.forEach((p, i) => {
        const d = Math.abs(p.x - mx);
        if (d < closestDist) { closestDist = d; closestIdx = i; }
    });

    _chartHoverIdx = closestIdx;
    renderChart();
}

function handleChartLeave() {
    _chartHoverIdx = -1;
    renderChart();
}

// ===== Kanban =====
let draggedId = null;

function setupKanban() {
    document.getElementById('kanbanAddBtn').addEventListener('click', () => {
        const today = new Date();
        const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        openAddContent(dateStr);
    });

    const board = document.getElementById('kanbanBoard');

    board.addEventListener('dragover', e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const col = e.target.closest('.kanban-column');
        if (col) {
            document.querySelectorAll('.kanban-col-body').forEach(c => c.classList.remove('drag-over'));
            col.querySelector('.kanban-col-body').classList.add('drag-over');
        }
    });

    board.addEventListener('dragleave', e => {
        if (!e.relatedTarget || !board.contains(e.relatedTarget)) {
            document.querySelectorAll('.kanban-col-body').forEach(c => c.classList.remove('drag-over'));
        }
    });

    board.addEventListener('drop', e => {
        e.preventDefault();
        document.querySelectorAll('.kanban-col-body').forEach(c => c.classList.remove('drag-over'));
        const col = e.target.closest('.kanban-column');
        if (!col || !draggedId) return;
        const newStatus = col.dataset.status;
        const content = state.contents.find(c => c.id === draggedId);
        if (content && content.status !== newStatus) {
            content.status = newStatus;
            saveContents(); renderAll();
            toast(`"${content.title}" → ${statusLabels[newStatus]}`);
        }
        draggedId = null;
    });
}

function renderKanban() {
    STATUS_ORDER.forEach(status => {
        const col = document.querySelector(`.kanban-col-body[data-status="${status}"]`);
        const items = state.contents.filter(c => c.status === status);
        const countEl = document.querySelector(`.kanban-col-count[data-count="${status}"]`);
        if (countEl) countEl.textContent = items.length;

        if (items.length === 0) {
            col.innerHTML = '';
            return;
        }

        col.innerHTML = items.map(c => {
            const cl = getChecklistCount(c.checklist);
            const clClass = cl.done === cl.total && cl.total > 0 ? 'complete' : '';
            const statusIdx = STATUS_ORDER.indexOf(c.status);
            const canPrev = statusIdx > 0;
            const canNext = statusIdx < STATUS_ORDER.length - 1;
            const hasScript = !!c.scriptContent;
            const sStatus = c.scriptStatus || '';

            return `
            <div class="kanban-card" draggable="true" data-id="${c.id}">
                <div class="kanban-card-title">${escapeHtml(c.title)}</div>
                <div class="kanban-card-meta">
                    <span class="platform-badge ${c.platform}">${c.platform}</span>
                    ${c.contentType ? `<span class="type-badge">${typeLabels[c.contentType] || ''}</span>` : ''}
                    ${c.date ? `<span class="kanban-card-date">${formatDate(c.date)}</span>` : ''}
                    <span class="kanban-card-checklist ${clClass}">${cl.done}/${cl.total}</span>
                </div>
                ${hasScript ? `<div style="font-size:11px;margin-top:4px;display:flex;align-items:center;gap:4px"><span class="script-status ${sStatus}">${scriptStatusLabels[sStatus] || t('scriptStatus.draft')}</span></div>` : ''}
                <div class="kanban-card-actions">
                    ${canPrev ? `<button class="kanban-move-btn" data-id="${c.id}" data-dir="prev">← ${statusLabels[STATUS_ORDER[statusIdx - 1]]}</button>` : ''}
                    ${canNext ? `<button class="kanban-move-btn" data-id="${c.id}" data-dir="next">${statusLabels[STATUS_ORDER[statusIdx + 1]]} →</button>` : ''}
                </div>
            </div>`;
        }).join('');

        // Drag events
        col.querySelectorAll('.kanban-card').forEach(card => {
            card.addEventListener('dragstart', e => {
                draggedId = card.dataset.id;
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', card.dataset.id);
                setTimeout(() => card.classList.add('dragging'), 0);
            });
            card.addEventListener('dragend', () => {
                card.classList.remove('dragging');
                document.querySelectorAll('.kanban-col-body').forEach(c => c.classList.remove('drag-over'));
                draggedId = null;
            });
            card.addEventListener('click', e => {
                if (e.target.closest('.kanban-move-btn')) return;
                openEditContent(card.dataset.id);
            });
        });

        // Move buttons
        col.querySelectorAll('.kanban-move-btn').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                const id = btn.dataset.id;
                const dir = btn.dataset.dir;
                const content = state.contents.find(c => c.id === id);
                if (!content) return;
                const idx = STATUS_ORDER.indexOf(content.status);
                const newIdx = dir === 'next' ? idx + 1 : idx - 1;
                if (newIdx >= 0 && newIdx < STATUS_ORDER.length) {
                    content.status = STATUS_ORDER[newIdx];
                    saveContents(); renderAll();
                    toast(`"${content.title}" → ${statusLabels[content.status]}`);
                }
            });
        });
    });
}

// ===== Calendar =====
function setupCalendar() {
    document.getElementById('prevMonth').addEventListener('click', () => {
        state.calendarDate.setMonth(state.calendarDate.getMonth() - 1); renderCalendar();
    });
    document.getElementById('nextMonth').addEventListener('click', () => {
        state.calendarDate.setMonth(state.calendarDate.getMonth() + 1); renderCalendar();
    });
}

function renderCalendar() {
    const date = state.calendarDate;
    const year = date.getFullYear(); const month = date.getMonth();
    if (getLang() === 'en') {
        const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
        document.getElementById('calendarTitle').textContent = t('cal.title', { year, month: monthNames[month] });
    } else {
        document.getElementById('calendarTitle').textContent = t('cal.title', { year, month: month + 1 });
    }

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();
    const today = new Date();
    let html = '';

    for (let i = firstDay - 1; i >= 0; i--) {
        html += `<div class="cal-day other-month"><span class="cal-day-number">${daysInPrevMonth - i}</span></div>`;
    }
    for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === d;
        const dayContents = state.contents.filter(c => c.date === dateStr);
        html += `<div class="cal-day${isToday ? ' today' : ''}" data-date="${dateStr}">`;
        html += `<span class="cal-day-number">${d}</span>`;
        dayContents.forEach(c => {
            html += `<div class="cal-event ${c.platform}" data-id="${c.id}">${escapeHtml(c.title)}</div>`;
        });
        html += '</div>';
    }
    const totalCells = firstDay + daysInMonth;
    const remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
    for (let i = 1; i <= remaining; i++) {
        html += `<div class="cal-day other-month"><span class="cal-day-number">${i}</span></div>`;
    }

    const container = document.getElementById('calendarDays');
    container.innerHTML = html;
    container.querySelectorAll('.cal-day:not(.other-month)').forEach(dayEl => {
        dayEl.addEventListener('click', e => {
            if (e.target.closest('.cal-event')) {
                openEditContent(e.target.closest('.cal-event').dataset.id);
            } else {
                openAddContent(dayEl.dataset.date);
            }
        });
    });
}

// ===== Modal Tabs =====
function setupModalTabs() {
    document.querySelectorAll('.modal-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.dataset.modalTab;
            document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            document.querySelectorAll('.modal-tab-panel').forEach(p => p.classList.remove('active'));
            document.querySelector(`.modal-tab-panel[data-modal-panel="${target}"]`).classList.add('active');
        });
    });
}

function resetModalTabs() {
    document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.modal-tab-panel').forEach(p => p.classList.remove('active'));
    const firstTab = document.querySelector('.modal-tab[data-modal-tab="info"]');
    const firstPanel = document.querySelector('.modal-tab-panel[data-modal-panel="info"]');
    if (firstTab) firstTab.classList.add('active');
    if (firstPanel) firstPanel.classList.add('active');
}

// ===== Script Editor Toolbar =====
function setupScriptEditorToolbar() {
    document.querySelectorAll('#contentEditorToolbar .toolbar-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const textarea = document.getElementById('contentScriptContent');
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            const text = textarea.value;
            let insert = '';
            let replaceSelection = false;

            switch (btn.dataset.action) {
                case 'hook': insert = `\n## ${t('toolbar.hook')}\n`; break;
                case 'heading': insert = '\n## '; break;
                case 'bold':
                    insert = `**${text.slice(start, end) || t('toolbar.hook')}**`;
                    replaceSelection = true; break;
                case 'scene': insert = `\n---\n[${t('toolbar.scene')}: ] `; break;
                case 'note':
                    insert = `[${text.slice(start, end) || t('toolbar.note')}]`;
                    replaceSelection = true; break;
                case 'cta': insert = '\n## CTA\n'; break;
            }

            if (replaceSelection) {
                textarea.value = text.slice(0, start) + insert + text.slice(end);
            } else {
                textarea.value = text.slice(0, start) + insert + text.slice(start);
            }
            textarea.focus(); updateWordCount();
        });
    });
    document.getElementById('contentScriptContent').addEventListener('input', updateWordCount);
}

function updateWordCount() {
    const textarea = document.getElementById('contentScriptContent');
    document.getElementById('wordCount').textContent = t('modal.chars', { n: textarea.value.length });
}

// ===== Content Modal =====
function setupContentModal() {
    const todayDateStr = () => {
        const today = new Date();
        return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    };
    document.getElementById('addContentBtn').addEventListener('click', () => openAddContent(todayDateStr()));
    document.getElementById('headerAddBtn').addEventListener('click', () => openAddContent(todayDateStr()));
    document.getElementById('closeContentModal').addEventListener('click', confirmCloseContent);
    document.getElementById('contentModal').addEventListener('click', e => { if (e.target === e.currentTarget) confirmCloseContent(); });
    document.getElementById('saveContentBtn').addEventListener('click', saveContent);
    document.getElementById('deleteContentBtn').addEventListener('click', deleteContent);

    // Confirm dialog buttons
    document.getElementById('confirmSave').addEventListener('click', () => {
        hideConfirmDialog();
        saveContent();
    });
    document.getElementById('confirmDiscard').addEventListener('click', () => {
        hideConfirmDialog();
        closeContentModal();
    });
    document.getElementById('confirmDialog').addEventListener('click', e => {
        if (e.target === e.currentTarget) hideConfirmDialog();
    });
}

function confirmCloseContent() {
    document.getElementById('confirmDialog').classList.add('active');
}

function hideConfirmDialog() {
    document.getElementById('confirmDialog').classList.remove('active');
}

// openAddContent defined in New Content Wizard section below

function openEditContent(id) {
    const content = state.contents.find(c => c.id === id);
    if (!content) return;
    document.getElementById('contentModalTitle').textContent = t('modal.editContent');
    document.getElementById('contentId').value = content.id;
    document.getElementById('contentTitle').value = content.title;
    document.getElementById('contentPlatform').value = content.platform;
    document.getElementById('contentStatus').value = content.status;
    document.getElementById('contentDate').value = content.date;
    document.getElementById('contentType').value = content.contentType || 'long';
    document.getElementById('contentMemo').value = content.memo || '';
    document.getElementById('contentScriptStatus').value = content.scriptStatus || '';
    document.getElementById('contentScriptContent').value = content.scriptContent || '';
    document.getElementById('deleteContentBtn').style.display = 'block';

    // Thumbnail summary
    const thumbSection = document.getElementById('contentThumbSection');
    const thumbSummary = document.getElementById('contentThumbSummary');
    if (content.thumbnailText || content.thumbnailMemo) {
        const styleLabels = { 'bold-white': t('nc.thumb.styleBoldWhite'), 'yellow-highlight': t('nc.thumb.styleYellow'), 'red-bg': t('nc.thumb.styleRed'), 'outline': t('nc.thumb.styleOutline'), 'gradient': t('nc.thumb.styleGradient') };
        const bgLabels = { 'closeup': t('nc.thumb.bgCloseup'), 'before-after': t('nc.thumb.bgBeforeAfter'), 'product': t('nc.thumb.bgProduct'), 'reaction': t('nc.thumb.bgReaction'), 'text-only': t('nc.thumb.bgTextOnly'), 'custom': t('nc.thumb.bgCustom') };
        let html = '';
        if (content.thumbnailText) html += `<div><strong>${t('nc.thumb.mainText')}:</strong> ${escapeHtml(content.thumbnailText)}</div>`;
        if (content.thumbnailStyle) html += `<div><strong>${t('nc.thumb.textStyle')}:</strong> ${escapeHtml(styleLabels[content.thumbnailStyle] || content.thumbnailStyle)}</div>`;
        if (content.thumbnailBg) html += `<div><strong>${t('nc.thumb.bgConcept')}:</strong> ${escapeHtml(bgLabels[content.thumbnailBg] || content.thumbnailBg)}</div>`;
        if (content.thumbnailMemo) html += `<div><strong>${t('modal.memo')}:</strong> ${escapeHtml(content.thumbnailMemo)}</div>`;
        thumbSummary.innerHTML = html;
        thumbSection.style.display = '';
    } else {
        thumbSection.style.display = 'none';
    }

    loadChecklist(content.checklist);
    updateWordCount();
    resetModalTabs();
    document.getElementById('contentModal').classList.add('active');
}

function closeContentModal() { document.getElementById('contentModal').classList.remove('active'); }

function saveContent() {
    const title = document.getElementById('contentTitle').value.trim();
    if (!title) { toast(t('toast.titleRequired')); return; }

    const id = document.getElementById('contentId').value;
    const scriptStatusVal = document.getElementById('contentScriptStatus').value;
    const data = {
        title,
        platform: document.getElementById('contentPlatform').value,
        status: document.getElementById('contentStatus').value,
        date: document.getElementById('contentDate').value,
        contentType: document.getElementById('contentType').value,
        memo: document.getElementById('contentMemo').value.trim(),
        scriptContent: document.getElementById('contentScriptContent').value,
        scriptStatus: scriptStatusVal || null,
        checklist: readChecklist(),
        updatedAt: new Date().toISOString()
    };

    if (id) {
        const idx = state.contents.findIndex(c => c.id === id);
        if (idx !== -1) { state.contents[idx] = { ...state.contents[idx], ...data }; toast(t('toast.contentEdited')); }
    } else {
        state.contents.push({ id: generateId(), ...data, createdAt: new Date().toISOString() });
        toast(t('toast.contentAdded'));
    }
    saveContents(); closeContentModal(); renderAll();
}

function deleteContent() {
    const id = document.getElementById('contentId').value;
    if (!id || !confirm(t('toast.deleteConfirm'))) return;
    state.contents = state.contents.filter(c => c.id !== id);
    saveContents(); closeContentModal(); renderAll();
    toast(t('toast.contentDeleted'));
}

// ===== Checklist =====
function setupChecklist() {
    document.querySelectorAll('#uploadChecklist input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', updateChecklistProgress);
    });
}

function resetChecklist() {
    document.querySelectorAll('#uploadChecklist input[type="checkbox"]').forEach(cb => { cb.checked = false; });
    updateChecklistProgress();
}

function loadChecklist(checklist) {
    document.querySelectorAll('#uploadChecklist input[type="checkbox"]').forEach(cb => {
        cb.checked = checklist ? !!checklist[cb.dataset.key] : false;
    });
    updateChecklistProgress();
}

function readChecklist() {
    const result = {};
    document.querySelectorAll('#uploadChecklist input[type="checkbox"]').forEach(cb => {
        result[cb.dataset.key] = cb.checked;
    });
    return result;
}

function updateChecklistProgress() {
    const boxes = document.querySelectorAll('#uploadChecklist input[type="checkbox"]');
    const checked = [...boxes].filter(cb => cb.checked).length;
    const total = boxes.length;
    const pct = total > 0 ? (checked / total) * 100 : 0;
    const fill = document.getElementById('checklistProgress');
    fill.style.width = pct + '%';
    fill.className = 'checklist-progress-fill' + (checked === total && total > 0 ? ' complete' : '');
    document.getElementById('checklistText').textContent = `${checked}/${total}`;
}

// ===== My Page =====
function setupMyPageModal() {
    document.getElementById('closeMyPageModal').addEventListener('click', closeMyPage);
    document.getElementById('myPageModal').addEventListener('click', e => { if (e.target === e.currentTarget) closeMyPage(); });
    document.getElementById('mypageLogoutBtn').addEventListener('click', () => { closeMyPage(); logout(); });
}

async function openMyPage() {
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

function closeMyPage() { document.getElementById('myPageModal').classList.remove('active'); }

// ===== YouTube Integration =====
function promptChannelConnect() {
    const saved = localStorage.getItem('creatorhub_yt_channel');
    const input = prompt(t('yt.channelPrompt'), saved || '');
    if (!input || !input.trim()) return;
    localStorage.setItem('creatorhub_yt_channel', input.trim());
    syncToServer({ yt_channel: input.trim() });
    updateSidebarYtLink(input.trim());
    loadYouTubeData();
}

function setupYouTube() {
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

function updateSidebarYtLink(channelId) {
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

function formatNumber(num) {
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

async function loadYouTubeData(forceRefresh = false) {
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

function updateMyChannelHero(channel) {
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
function getUploadGoal() {
    return parseInt(localStorage.getItem('creatorhub_upload_goal')) || 4;
}

function getWeeklyGoal() {
    return parseInt(localStorage.getItem('creatorhub_weekly_goal')) || 1;
}

function countMonthUploads() {
    if (!state.ytVideos || !state.ytVideos.length) return 0;
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    return state.ytVideos.filter(v => {
        const d = new Date(v.publishedAt);
        return d.getFullYear() === year && d.getMonth() === month;
    }).length;
}

function countWeekUploads() {
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

function updateUploadGoal() {
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

function setupUploadGoal() {
    const btn = document.getElementById('uploadGoalEditBtn');
    if (!btn) return;
    btn.addEventListener('click', () => {
        openGoalModal();
    });
}

function setupGoalModal() {
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

function openGoalModal() {
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

function saveGoalSettings() {
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
function updateLastUploadBanner() {
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

// ===== Discover (콘텐츠 탐색) =====
let _lastSearchParams = null;
let _discoverNextPageToken = null;
let _discoverAllVideos = [];

function setupDiscover() {
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
        const totalFetched = videos.length;

        // Subscriber filter
        const subMin = parseInt(params.subMin) || 0;
        const subMax = parseInt(params.subMax) || 0;
        if (subMin > 0) videos = videos.filter(v => (v.subscriberCount || 0) >= subMin);
        if (subMax > 0) videos = videos.filter(v => (v.subscriberCount || 0) <= subMax);

        if (params.order === 'performance') {
            videos.sort((a, b) => b.viewToSubRatio - a.viewToSubRatio);
        } else if (params.order === 'velocity') {
            videos.sort((a, b) => calcVelocity(b).score - calcVelocity(a).score);
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

// ===== Channel Search (채널 탐색) =====
let _lastChannelSearchKeyword = '';

function setupChannelSearch() {
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

let _pendingRefVideo = null;

function saveAsReference(video) {
    const exists = state.references.some(r => r.videoId === video.id);
    if (exists) {
        toast(t('toast.refAlreadySaved'));
        return;
    }
    _pendingRefVideo = video;
    openRefFolderModal();
}

// ===== References (레퍼런스) =====
function saveReferences() { localStorage.setItem('creatorhub_references', JSON.stringify(state.references)); syncToServer({ refs: state.references }); }

function setupReferences() {
    document.getElementById('refClearAllBtn').addEventListener('click', () => {
        if (!confirm(t('toast.allRefDeleteConfirm'))) return;
        state.references = [];
        saveReferences();
        renderReferences();
        toast(t('toast.allRefDeleted'));
    });

    // Folder modal events
    document.getElementById('closeRefFolderModal').addEventListener('click', closeRefFolderModal);
    document.getElementById('refFolderModal').addEventListener('click', e => { if (e.target === e.currentTarget) closeRefFolderModal(); });
    document.getElementById('refFolderModalCancel').addEventListener('click', closeRefFolderModal);
    document.getElementById('refFolderModalSave').addEventListener('click', confirmRefFolderSave);
    document.getElementById('refFolderCreateBtn').addEventListener('click', createRefFolderInline);
    document.getElementById('refFolderNewName').addEventListener('keydown', e => { if (e.key === 'Enter') createRefFolderInline(); });

    // Context menu events
    document.getElementById('refFolderCtx').addEventListener('click', e => {
        const item = e.target.closest('.ref-folder-ctx-item');
        if (!item) return;
        const action = item.dataset.action;
        const folderId = document.getElementById('refFolderCtx').dataset.folderId;
        closeFolderContextMenu();
        if (action === 'rename') renameRefFolder(folderId);
        else if (action === 'delete') deleteRefFolder(folderId);
    });
    document.addEventListener('click', () => closeFolderContextMenu());
}

function renderReferences() {
    const grid = document.getElementById('refGrid');
    const countEl = document.getElementById('refCount');
    const clearBtn = document.getElementById('refClearAllBtn');

    renderRefFolderChips();

    // Filter references based on activeRefFolder
    let filtered = state.references;
    if (state.activeRefFolder === 'uncategorized') {
        filtered = state.references.filter(r => !r.folderId);
    } else if (state.activeRefFolder) {
        filtered = state.references.filter(r => r.folderId === state.activeRefFolder);
    }

    countEl.textContent = t('ref.count', { n: filtered.length });
    clearBtn.style.display = state.references.length > 0 ? '' : 'none';

    if (filtered.length === 0) {
        grid.innerHTML = `
            <div class="discover-empty">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color:var(--text-muted);margin-bottom:12px"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg>
                <p>${t('ref.emptyTitle')}</p>
                <p style="font-size:12px;color:var(--text-muted);margin-top:4px">${t('ref.emptyDesc')}</p>
            </div>`;
        return;
    }

    grid.innerHTML = filtered.map(ref => {
        const dateLocale = getLang() === 'en' ? 'en-US' : 'ko-KR';
        const pubDate = new Date(ref.publishedAt).toLocaleDateString(dateLocale, { year: 'numeric', month: 'short', day: 'numeric' });
        const savedDate = new Date(ref.savedAt).toLocaleDateString(dateLocale, { month: 'short', day: 'numeric' });
        const folder = ref.folderId ? state.refFolders.find(f => f.id === ref.folderId) : null;
        const folderBadge = folder ? `<span class="ref-card-folder">${escapeHtml(folder.name)}</span>` : '';
        return `
        <div class="ref-card" data-id="${ref.id}">
            <div class="ref-card-thumb-wrap">
                <img class="ref-card-thumb" src="${ref.thumbnail}" alt="${escapeHtml(ref.title)}">
                <a class="ref-card-link" href="${ref.url}" target="_blank" title="${t('channel.viewOnYT')}">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15,3 21,3 21,9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                </a>
            </div>
            <div class="ref-card-body">
                ${folderBadge}
                <div class="ref-card-title">${escapeHtml(ref.title)}</div>
                <div class="ref-card-channel">${escapeHtml(ref.channelTitle)} · ${t('discover.subLabel', { n: formatNumber(ref.subscriberCount || 0) })} · ${pubDate}</div>
                <div class="ref-card-stats">
                    <span>👁 ${formatNumber(ref.viewCount)}</span>
                    <span>👍 ${formatNumber(ref.likeCount)}</span>
                    <span>💬 ${formatNumber(ref.commentCount)}</span>
                </div>
                ${ref.viewToSubRatio ? `<span class="discover-card-ratio ${ref.viewToSubRatio >= 200 ? 'hot' : ref.viewToSubRatio >= 50 ? 'good' : 'normal'}">${ref.viewToSubRatio >= 200 ? '🔥' : ref.viewToSubRatio >= 50 ? '✨' : ''} ${t('discover.subRatioLabel', { n: ref.viewToSubRatio })}</span>` : ''}
            </div>
            <div class="ref-card-saved">${t('ref.saved', { date: savedDate })}</div>
            <div class="ref-card-actions">
                <button class="btn btn-primary ref-use-btn" data-id="${ref.id}">${t('ref.useAsContent')}</button>
                <button class="btn btn-secondary ref-delete-btn" data-id="${ref.id}">${t('ref.delete')}</button>
            </div>
        </div>`;
    }).join('');

    grid.querySelectorAll('.ref-use-btn').forEach(btn => {
        btn.addEventListener('click', () => useReferenceAsContent(btn.dataset.id));
    });
    grid.querySelectorAll('.ref-delete-btn').forEach(btn => {
        btn.addEventListener('click', () => deleteReference(btn.dataset.id));
    });
}

function useReferenceAsContent(refId) {
    const ref = state.references.find(r => r.id === refId);
    if (!ref) return;
    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    openAddContent(dateStr);
    document.getElementById('contentTitle').value = ref.title;
    document.getElementById('contentMemo').value = `[${t('nav.references')}]\n${t('modal.title')}: ${ref.title}\nURL: ${ref.url}\n${t('channel.subscribers')}: ${ref.channelTitle}\n${t('misc.views')}: ${formatNumber(ref.viewCount)}`;
}

function deleteReference(refId) {
    state.references = state.references.filter(r => r.id !== refId);
    saveReferences();
    renderReferences();
    toast(t('toast.refDeleted'));
}

// ===== Reference Folders =====
function saveRefFolders() {
    localStorage.setItem('creatorhub_ref_folders', JSON.stringify(state.refFolders));
    syncToServer({ ref_folders: state.refFolders });
}

function openRefFolderModal() {
    const modal = document.getElementById('refFolderModal');
    const list = document.getElementById('refFolderList');
    document.getElementById('refFolderNewName').value = '';

    // Render folder list inside modal
    let html = `<div class="ref-folder-list-item selected" data-folder-id="">
        <span class="folder-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
        </span>
        <span>${t('ref.folderUncategorized')}</span>
        <span class="folder-check">&#10003;</span>
    </div>`;
    state.refFolders.forEach(f => {
        html += `<div class="ref-folder-list-item" data-folder-id="${f.id}">
            <span class="folder-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
            </span>
            <span>${escapeHtml(f.name)}</span>
            <span class="folder-check" style="display:none">&#10003;</span>
        </div>`;
    });
    list.innerHTML = html;

    // Folder item click → select
    list.querySelectorAll('.ref-folder-list-item').forEach(item => {
        item.addEventListener('click', () => {
            list.querySelectorAll('.ref-folder-list-item').forEach(i => {
                i.classList.remove('selected');
                i.querySelector('.folder-check').style.display = 'none';
            });
            item.classList.add('selected');
            item.querySelector('.folder-check').style.display = '';
        });
    });

    modal.classList.add('active');
}

function closeRefFolderModal() {
    document.getElementById('refFolderModal').classList.remove('active');
    _pendingRefVideo = null;
}

function confirmRefFolderSave() {
    if (!_pendingRefVideo) { closeRefFolderModal(); return; }
    const selected = document.querySelector('#refFolderList .ref-folder-list-item.selected');
    const folderId = selected ? (selected.dataset.folderId || null) : null;

    state.references.unshift({
        id: generateId(),
        videoId: _pendingRefVideo.id,
        title: _pendingRefVideo.title,
        thumbnail: _pendingRefVideo.thumbnail,
        channelTitle: _pendingRefVideo.channelTitle,
        url: `https://www.youtube.com/watch?v=${_pendingRefVideo.id}`,
        viewCount: _pendingRefVideo.viewCount,
        likeCount: _pendingRefVideo.likeCount,
        commentCount: _pendingRefVideo.commentCount,
        subscriberCount: _pendingRefVideo.subscriberCount || 0,
        viewToSubRatio: _pendingRefVideo.viewToSubRatio || 0,
        publishedAt: _pendingRefVideo.publishedAt,
        savedAt: new Date().toISOString(),
        folderId: folderId
    });
    saveReferences();
    closeRefFolderModal();
    toast(t('toast.refSaved'));
    if (state.currentTab === 'references') renderReferences();
}

function createRefFolderInline() {
    const input = document.getElementById('refFolderNewName');
    const name = input.value.trim();
    if (!name) { toast(t('toast.folderNameRequired')); return; }
    if (state.refFolders.some(f => f.name === name)) { toast(t('toast.folderDuplicate')); return; }

    const folder = { id: generateId(), name, createdAt: new Date().toISOString() };
    state.refFolders.push(folder);
    saveRefFolders();
    input.value = '';

    // Re-render modal list and auto-select new folder
    openRefFolderModal();
    setTimeout(() => {
        const list = document.getElementById('refFolderList');
        list.querySelectorAll('.ref-folder-list-item').forEach(i => {
            i.classList.remove('selected');
            i.querySelector('.folder-check').style.display = 'none';
        });
        const newItem = list.querySelector(`[data-folder-id="${folder.id}"]`);
        if (newItem) {
            newItem.classList.add('selected');
            newItem.querySelector('.folder-check').style.display = '';
        }
    }, 0);
}

function renderRefFolderChips() {
    const bar = document.getElementById('refFolderBar');
    if (!bar) return;

    const allCount = state.references.length;
    const uncatCount = state.references.filter(r => !r.folderId).length;

    let html = `<button class="ref-folder-chip${state.activeRefFolder === null ? ' active' : ''}" data-folder="all">
        ${t('ref.folderAll')} <span class="ref-folder-count">${allCount}</span>
    </button>`;
    html += `<button class="ref-folder-chip${state.activeRefFolder === 'uncategorized' ? ' active' : ''}" data-folder="uncategorized">
        ${t('ref.folderUncategorized')} <span class="ref-folder-count">${uncatCount}</span>
    </button>`;

    state.refFolders.forEach(f => {
        const count = state.references.filter(r => r.folderId === f.id).length;
        html += `<button class="ref-folder-chip${state.activeRefFolder === f.id ? ' active' : ''}" data-folder="${f.id}" data-folder-name="${escapeHtml(f.name)}">
            ${escapeHtml(f.name)} <span class="ref-folder-count">${count}</span>
        </button>`;
    });

    html += `<button class="ref-folder-add-btn" id="refFolderAddChip">${t('ref.folderNew')}</button>`;
    bar.innerHTML = html;
    bindRefFolderChipEvents();
}

function bindRefFolderChipEvents() {
    const bar = document.getElementById('refFolderBar');

    // Chip click → filter
    bar.querySelectorAll('.ref-folder-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const folder = chip.dataset.folder;
            if (folder === 'all') state.activeRefFolder = null;
            else if (folder === 'uncategorized') state.activeRefFolder = 'uncategorized';
            else state.activeRefFolder = folder;
            renderReferences();
        });

        // Right-click context menu (only for user folders)
        if (chip.dataset.folder !== 'all' && chip.dataset.folder !== 'uncategorized') {
            chip.addEventListener('contextmenu', e => {
                e.preventDefault();
                showFolderContextMenu(e, chip.dataset.folder);
            });
        }
    });

    // Add folder button
    const addBtn = document.getElementById('refFolderAddChip');
    if (addBtn) addBtn.addEventListener('click', createRefFolderFromChipBar);
}

function createRefFolderFromChipBar() {
    const name = prompt(t('ref.folderNewPrompt'));
    if (!name || !name.trim()) return;
    const trimmed = name.trim();
    if (state.refFolders.some(f => f.name === trimmed)) { toast(t('toast.folderDuplicate')); return; }

    state.refFolders.push({ id: generateId(), name: trimmed, createdAt: new Date().toISOString() });
    saveRefFolders();
    renderReferences();
    toast(t('toast.folderCreated', { name: trimmed }));
}

function showFolderContextMenu(e, folderId) {
    const ctx = document.getElementById('refFolderCtx');
    ctx.dataset.folderId = folderId;
    ctx.style.display = 'block';
    ctx.style.left = e.clientX + 'px';
    ctx.style.top = e.clientY + 'px';

    // Adjust if overflowing viewport
    const rect = ctx.getBoundingClientRect();
    if (rect.right > window.innerWidth) ctx.style.left = (window.innerWidth - rect.width - 8) + 'px';
    if (rect.bottom > window.innerHeight) ctx.style.top = (window.innerHeight - rect.height - 8) + 'px';
}

function closeFolderContextMenu() {
    document.getElementById('refFolderCtx').style.display = 'none';
}

function renameRefFolder(id) {
    const folder = state.refFolders.find(f => f.id === id);
    if (!folder) return;
    const newName = prompt(t('ref.folderRenamePrompt'), folder.name);
    if (!newName || !newName.trim() || newName.trim() === folder.name) return;
    const trimmed = newName.trim();
    if (state.refFolders.some(f => f.id !== id && f.name === trimmed)) { toast(t('toast.folderDuplicate')); return; }
    folder.name = trimmed;
    saveRefFolders();
    renderReferences();
    toast(t('toast.folderRenamed'));
}

function deleteRefFolder(id) {
    const folder = state.refFolders.find(f => f.id === id);
    if (!folder) return;
    if (!confirm(t('toast.folderDeleteConfirm', { name: folder.name }))) return;

    // Move references to uncategorized
    state.references.forEach(r => { if (r.folderId === id) r.folderId = null; });
    saveReferences();

    // Remove folder
    state.refFolders = state.refFolders.filter(f => f.id !== id);
    saveRefFolders();

    // Reset filter if viewing deleted folder
    if (state.activeRefFolder === id) state.activeRefFolder = null;
    renderReferences();
    toast(t('toast.folderDeleted'));
}

function renderYouTubeVideos(videos) {
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

// ===== Ideas (아이디어 찾기) =====
let _ideasTrendingLoaded = false;
let _ideasActiveKeyword = '';
let _ideasTrendingCache = [];

function parseDurationToSeconds(iso) {
    if (!iso) return 0;
    const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!m) return 0;
    return (parseInt(m[1] || 0) * 3600) + (parseInt(m[2] || 0) * 60) + parseInt(m[3] || 0);
}

function setupIdeas() {
    document.getElementById('ideasCategorySelect').addEventListener('change', () => {
        _ideasTrendingLoaded = false;
        loadTrendingVideos(document.getElementById('ideasCategorySelect').value);
    });
    document.getElementById('ideasDurationSelect').addEventListener('change', () => {
        filterAndRenderTrending();
    });
    document.getElementById('ideasAnalyzeBtn').addEventListener('click', analyzeKeyword);
    document.getElementById('ideasKeywordInput').addEventListener('keydown', e => {
        if (e.key === 'Enter') analyzeKeyword();
    });
    document.getElementById('ideasKeywordDuration').addEventListener('change', () => {
        if (_ideasActiveKeyword) loadKeywordVideos(_ideasActiveKeyword);
    });
}

async function loadTrendingVideos(categoryId) {
    if (checkGuestBlock()) return;
    const grid = document.getElementById('ideasTrendingGrid');
    const selectVal = categoryId !== undefined ? categoryId : document.getElementById('ideasCategorySelect').value;

    if (_ideasTrendingLoaded && categoryId === undefined) return;

    grid.innerHTML = `<div class="discover-loading">${t('ideas.trendLoading')}</div>`;

    try {
        const categoryParam = selectVal ? `&videoCategoryId=${encodeURIComponent(selectVal)}` : '';
        const res = await fetch(`/api/youtube/trending?regionCode=KR&maxResults=12${categoryParam}`);
        if (!res.ok) {
            let msg = t('misc.searchFail');
            try { const err = await res.json(); msg = err.error || msg; } catch {}
            throw new Error(msg);
        }
        const videos = await res.json();
        _ideasTrendingLoaded = true;
        _ideasTrendingCache = videos;
        filterAndRenderTrending();
    } catch (err) {
        grid.innerHTML = `<div class="discover-empty"><p style="color:var(--red)">${t('misc.error', { msg: escapeHtml(err.message) })}</p></div>`;
    }
}

function filterAndRenderTrending() {
    const duration = document.getElementById('ideasDurationSelect').value;
    let filtered = _ideasTrendingCache;
    if (duration === 'short') {
        filtered = filtered.filter(v => {
            const sec = parseDurationToSeconds(v.duration);
            return sec > 0 && sec <= 60;
        });
    } else if (duration === 'long') {
        filtered = filtered.filter(v => {
            const sec = parseDurationToSeconds(v.duration);
            return sec > 240;
        });
    }
    renderTrendingVideos(filtered);
}

function renderTrendingVideos(videos) {
    const grid = document.getElementById('ideasTrendingGrid');
    if (!videos || videos.length === 0) {
        grid.innerHTML = `<div class="discover-empty"><p>${t('ideas.trendEmpty')}</p></div>`;
        return;
    }

    grid.innerHTML = videos.map(v => {
        const timeAgo = formatRelativeTime(v.publishedAt);
        return `
        <div class="ideas-video-card">
            <img class="ideas-video-card-thumb" src="${v.thumbnail}" alt="${escapeHtml(v.title)}">
            <div class="ideas-video-card-body">
                <div class="ideas-video-card-title">${escapeHtml(v.title)}</div>
                <div class="ideas-video-card-channel">${escapeHtml(v.channelTitle)}</div>
                <div class="ideas-video-card-stats">
                    <span>👁 ${formatNumber(v.viewCount)}</span>
                    <span>👍 ${formatNumber(v.likeCount)}</span>
                </div>
                <div class="ideas-video-card-sub">${t('discover.subLabel', { n: formatNumber(v.subscriberCount || 0) })}</div>
                ${velocityBadgeHtml(v)}
                <div class="ideas-video-card-date">${timeAgo}</div>
            </div>
            <div class="ideas-video-card-actions">
                <button class="btn btn-primary ideas-save-btn" data-video='${JSON.stringify(v).replace(/'/g, '&#39;')}' data-source="trending">${t('ideas.saveAsIdea')}</button>
            </div>
        </div>`;
    }).join('');

    grid.querySelectorAll('.ideas-save-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const video = JSON.parse(btn.dataset.video);
            saveAsIdea(video, btn.dataset.source, '');
        });
    });
}

async function analyzeKeyword() {
    if (checkGuestBlock()) return;
    const input = document.getElementById('ideasKeywordInput');
    const keyword = input.value.trim();
    if (!keyword) { toast(t('toast.keywordRequired')); return; }

    const chipsContainer = document.getElementById('ideasKeywordChips');
    const videosContainer = document.getElementById('ideasKeywordVideos');
    chipsContainer.innerHTML = `<span style="font-size:12px;color:var(--text-muted)">${t('ideas.keywordAnalyzing')}</span>`;
    videosContainer.innerHTML = '';

    try {
        const res = await fetch(`/api/youtube/keyword-suggestions?q=${encodeURIComponent(keyword)}`);
        if (!res.ok) {
            let msg = t('misc.searchFail');
            try { const err = await res.json(); msg = err.error || msg; } catch {}
            throw new Error(msg);
        }
        const suggestions = await res.json();
        renderKeywordSuggestions(suggestions, keyword);
    } catch (err) {
        chipsContainer.innerHTML = `<span style="font-size:12px;color:var(--red)">${t('misc.error', { msg: escapeHtml(err.message) })}</span>`;
    }
}

function renderKeywordSuggestions(suggestions, originalKeyword) {
    const chipsContainer = document.getElementById('ideasKeywordChips');

    if (!suggestions || suggestions.length === 0) {
        chipsContainer.innerHTML = `<span style="font-size:12px;color:var(--text-muted)">${t('ideas.keywordEmpty')}</span>`;
        return;
    }

    chipsContainer.innerHTML = suggestions.map(s =>
        `<span class="keyword-chip" data-keyword="${escapeHtml(s)}">${escapeHtml(s)}</span>`
    ).join('');

    chipsContainer.querySelectorAll('.keyword-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            chipsContainer.querySelectorAll('.keyword-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            _ideasActiveKeyword = chip.dataset.keyword;
            loadKeywordVideos(chip.dataset.keyword);
        });
    });

    // 첫 번째 칩 자동 선택
    const firstChip = chipsContainer.querySelector('.keyword-chip');
    if (firstChip) {
        firstChip.classList.add('active');
        _ideasActiveKeyword = firstChip.dataset.keyword;
        loadKeywordVideos(firstChip.dataset.keyword);
    }
}

async function loadKeywordVideos(keyword) {
    const container = document.getElementById('ideasKeywordVideos');
    container.innerHTML = `<div class="discover-loading">${t('ideas.keywordVideoLoading')}</div>`;

    try {
        const kwDuration = document.getElementById('ideasKeywordDuration').value;
        const kwDurationParam = kwDuration ? `&videoDuration=${encodeURIComponent(kwDuration)}` : '';
        const res = await fetch(`/api/youtube/search?q=${encodeURIComponent(keyword)}&order=viewCount&maxResults=6&pages=1${kwDurationParam}`);
        if (!res.ok) {
            let msg = t('misc.searchFail');
            try { const err = await res.json(); msg = err.error || msg; } catch {}
            throw new Error(msg);
        }
        const data = await res.json();
        const videos = data.videos || data;
        renderKeywordVideos(videos, keyword);
    } catch (err) {
        container.innerHTML = `<div class="discover-empty"><p style="color:var(--red)">${t('misc.error', { msg: escapeHtml(err.message) })}</p></div>`;
    }
}

function renderKeywordVideos(videos, keyword) {
    const container = document.getElementById('ideasKeywordVideos');
    if (!videos || videos.length === 0) {
        container.innerHTML = `<div class="discover-empty"><p>${t('ideas.keywordVideoEmpty')}</p></div>`;
        return;
    }

    container.innerHTML = videos.map(v => {
        const timeAgo = formatRelativeTime(v.publishedAt);
        return `
        <div class="ideas-keyword-video-item">
            <img class="ideas-keyword-video-thumb" src="${v.thumbnail}" alt="${escapeHtml(v.title)}">
            <div class="ideas-keyword-video-info">
                <div class="ideas-keyword-video-title">${escapeHtml(v.title)}</div>
                <div class="ideas-keyword-video-meta">${escapeHtml(v.channelTitle)} · 👁 ${formatNumber(v.viewCount)} · ${timeAgo}</div>
                ${velocityBadgeHtml(v)}
                <div class="ideas-keyword-video-actions">
                    <button class="btn btn-primary ideas-save-btn" data-video='${JSON.stringify(v).replace(/'/g, '&#39;')}' data-source="keyword" data-keyword="${escapeHtml(keyword)}">${t('ideas.saveAsIdea')}</button>
                </div>
            </div>
        </div>`;
    }).join('');

    container.querySelectorAll('.ideas-save-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const video = JSON.parse(btn.dataset.video);
            saveAsIdea(video, btn.dataset.source, btn.dataset.keyword);
        });
    });
}

function saveAsIdea(video, source, keyword) {
    const videoUrl = `https://www.youtube.com/watch?v=${video.id}`;
    if (state.contents.find(c => c.memo && c.memo.includes(videoUrl))) {
        toast(t('toast.ideaAlready'));
        return;
    }

    const sourceLabel = source === 'trending' ? t('idea.sourceTrend') : source === 'outlier' ? t('idea.sourceOutlier', { keyword }) : t('idea.sourceKeyword', { keyword });
    const outlierInfo = source === 'outlier' && video.outlierScore ? `\n${t('outlier.thisVideo')}: ${video.outlierScore}x (${t('outlier.channelMedian')} ${formatNumber(video.channelMedianViews || 0)})` : '';
    const memo = `${t('idea.sourceLabel', { source: sourceLabel })}\nURL: ${videoUrl}\n${video.channelTitle}\n${t('misc.views')}: ${formatNumber(video.viewCount)}${video.subscriberCount ? '\n' + t('channel.subscribers') + ': ' + formatNumber(video.subscriberCount) : ''}${outlierInfo}`;

    const newContent = {
        id: generateId(),
        title: video.title,
        platform: 'youtube',
        status: 'idea',
        date: '',
        contentType: 'long',
        memo,
        checklist: {},
        scriptContent: '',
        scriptStatus: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };

    state.contents.push(newContent);
    saveContents();
    renderKanban();
    toast(t('toast.ideaSaved'));
}

function formatRelativeTime(dateStr) {
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

// ===== Velocity (초기 폭발력) =====
function calcVelocity(video) {
    const days = Math.max(1, Math.floor((Date.now() - new Date(video.publishedAt).getTime()) / 86400000));
    const viewsPerDay = Math.round(video.viewCount / days);
    const subs = video.subscriberCount || 1;
    const score = (video.viewCount / subs) / days;
    const engagement = video.viewCount > 0 ? Math.round(((video.likeCount || 0) + (video.commentCount || 0)) / video.viewCount * 1000) / 10 : 0;

    let level, label, icon;
    if (score >= 2)       { level = 'explosive'; label = t('velocity.explosive'); icon = '🔥🔥'; }
    else if (score >= 0.3) { level = 'hot'; label = t('velocity.hot'); icon = '🔥'; }
    else                   { level = 'normal'; label = ''; icon = ''; }

    return { viewsPerDay, score, days, level, label, icon, engagement };
}

function velocityBadgeHtml(video) {
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

// ===== New Content Wizard =====
const NC_TOTAL_STEPS = 3;
let _ncCurrentStep = 0;
let _ncIdeaText = '';
let _ncSelectedRefs = [];
let _ncLastSearchResults = [];

function setupNewContentPage() {
    document.getElementById('ncNextBtn').addEventListener('click', ncNext);
    document.getElementById('ncPrevBtn').addEventListener('click', ncPrev);

    // Option card selection (platform, type)
    document.querySelectorAll('.nc-option-card').forEach(card => {
        card.addEventListener('click', () => {
            const grid = card.closest('.nc-option-grid');
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

function openAddContent(date) {
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
    document.getElementById('ncReviewType').textContent = typeLabels[contentType] || contentType;
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

// ===== Ad Detect (광고 탐지) =====
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

function setupAdDetect() {
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

// ===== Outlier Finder (아웃라이어 찾기) =====
let _lastOutlierKeyword = '';
let _outlierResults = [];

function setupOutlierFinder() {
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

// ===== Language Switcher =====
function setupLangSwitcher() {
    const switcher = document.getElementById('langSwitcher');
    if (!switcher) return;
    // set initial active state
    switcher.querySelectorAll('.lang-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.lang === getLang());
        btn.addEventListener('click', () => {
            if (btn.dataset.lang === getLang()) return;
            setLang(btn.dataset.lang);
            switcher.querySelectorAll('.lang-btn').forEach(b => b.classList.toggle('active', b.dataset.lang === getLang()));
            applyLanguageSwitch();
            toast(t('toast.langChanged'));
        });
    });
}

function applyLanguageSwitch() {
    applyI18nToDOM();
    updateTodayDate();
    updateUploadGoal();
    updateLastUploadBanner();
    // re-render header for current tab
    const info = getNavTitle(state.currentTab);
    document.getElementById('pageTitle').textContent = info.title;
    document.getElementById('pageDesc').textContent = info.desc;
    renderAll();
    if (state.currentTab === 'references') renderReferences();
    if (state.currentTab === 'ideas') loadTrendingVideos();
}

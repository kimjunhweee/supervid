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
    user: null
};

const STATUS_ORDER = ['idea', 'scripting', 'filming', 'editing', 'scheduled', 'published'];
const statusLabels = {
    idea: '아이디어', scripting: '스크립트 작성중', filming: '촬영중',
    editing: '편집중', scheduled: '예약됨', published: '게시완료'
};
const scriptStatusLabels = { draft: '초안', writing: '작성중', done: '완료' };
const typeLabels = { long: '롱폼', short: '숏츠', post: '포스트' };

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
                title: s.title || '제목 없음',
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
        updateTodayDate();
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

function showApp() {
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
        document.getElementById('logoutBtn').onclick = logout;
        document.getElementById('myPageBtn').onclick = openMyPage;
        setupNavUserDropdown();
        setupMyPageModal();
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
        locale: 'ko'
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
            toast(`${state.user.name}님, 환영합니다!`);
        } else {
            const err = await res.json();
            toast('로그인 실패: ' + (err.error || '알 수 없는 오류'));
        }
    } catch {
        toast('로그인 중 오류가 발생했습니다');
    }
}

async function logout() {
    try {
        await fetch('/api/auth/logout', { method: 'POST' });
    } catch { /* ignore */ }
    state.user = null;
    showLogin();
    toast('로그아웃 되었습니다');
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
const NAV_TITLES = {
    dashboard: { title: '대시보드', desc: '콘텐츠 현황을 한눈에 확인하세요' },
    kanban: { title: '콘텐츠 관리', desc: '콘텐츠 진행 상태를 한눈에 관리하세요' },
    calendar: { title: '캘린더', desc: '콘텐츠 일정을 관리하세요' },
    discover: { title: '콘텐츠 탐색', desc: '키워드로 인기 영상을 검색하고 레퍼런스를 찾아보세요' },
    channels: { title: '채널 탐색', desc: '유튜브 채널을 검색하고 분석하세요' },
    references: { title: '레퍼런스', desc: '저장한 레퍼런스 영상을 관리하세요' },
    ideas: { title: '아이디어 찾기', desc: '트렌드와 키워드 분석으로 콘텐츠 아이디어를 발굴하세요' },
    addetect: { title: '광고 탐지', desc: '브랜드의 유튜브 광고 캠페인을 검색하고 협업 채널을 분석하세요' },
    outliers: { title: '아웃라이어', desc: '채널 평균 대비 폭발적으로 성과가 좋은 영상을 발견하세요' },
    newcontent: { title: '새 콘텐츠', desc: '새로운 콘텐츠를 등록하세요' }
};

function switchTab(tab) {
    document.querySelectorAll('.menu-item').forEach(m => m.classList.remove('active'));
    const target = document.querySelector(`.menu-item[data-tab="${tab}"]`);
    if (target) target.classList.add('active');
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.getElementById(`tab-${tab}`).classList.add('active');
    const info = NAV_TITLES[tab] || { title: tab, desc: '' };
    document.getElementById('pageTitle').textContent = info.title;
    document.getElementById('pageDesc').textContent = info.desc;
    state.currentTab = tab;
    if (tab === 'dashboard') renderDashboard();
    if (tab === 'kanban') renderKanban();
    if (tab === 'references') renderReferences();
    if (tab === 'ideas') loadTrendingVideos();
}

function setupNavigation() {
    document.querySelectorAll('.menu-item').forEach(item => {
        item.addEventListener('click', () => switchTab(item.dataset.tab));
    });
    document.querySelector('.sidebar-logo').addEventListener('click', () => switchTab('dashboard'));
}

function updateTodayDate() {
    const now = new Date();
    document.getElementById('todayDate').textContent = now.toLocaleDateString('ko-KR', {
        year: 'numeric', month: 'long', day: 'numeric', weekday: 'long'
    });
}

// ===== Data Helpers =====
function saveContents() { localStorage.setItem('creatorhub_contents', JSON.stringify(state.contents)); }
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
function renderDashboard() {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);

    // This week's todos
    const dayOfWeek = now.getDay();
    const weekStart = new Date(now); weekStart.setDate(now.getDate() - dayOfWeek);
    const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6);
    const weekStartStr = weekStart.toISOString().slice(0, 10);
    const weekEndStr = weekEnd.toISOString().slice(0, 10);

    const weeklyContents = state.contents
        .filter(c => c.status !== 'published' && c.date >= weekStartStr && c.date <= weekEndStr)
        .sort((a, b) => a.date.localeCompare(b.date));

    const weeklyEl = document.getElementById('weeklyTodos');
    if (weeklyContents.length === 0) {
        weeklyEl.innerHTML = '<p class="empty-state">이번 주 예정된 콘텐츠가 없습니다</p>';
    } else {
        weeklyEl.innerHTML = weeklyContents.map(c => {
            const cl = getChecklistCount(c.checklist);
            const overdue = c.date < todayStr ? ' style="color:var(--red)"' : '';
            return `
            <div class="upcoming-item" data-id="${c.id}" style="cursor:pointer">
                <div class="upcoming-item-left">
                    <span class="platform-badge ${c.platform}">${c.platform}</span>
                    <span class="upcoming-item-title">${escapeHtml(c.title)}</span>
                    ${c.contentType ? `<span class="type-badge">${typeLabels[c.contentType] || ''}</span>` : ''}
                </div>
                <div class="upcoming-item-right">
                    <span class="status-badge ${c.status}">${statusLabels[c.status]}</span>
                    <span class="upcoming-item-date"${overdue}>${formatDate(c.date)}</span>
                    <span style="font-size:11px;color:var(--text-muted)">${cl.done}/${cl.total}</span>
                </div>
            </div>`;
        }).join('');
        weeklyEl.querySelectorAll('.upcoming-item').forEach(el => {
            el.addEventListener('click', () => openEditContent(el.dataset.id));
        });
    }

    // 스크립트 현황 — contents with scriptContent
    const withScript = state.contents
        .filter(c => c.scriptContent)
        .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))
        .slice(0, 5);
    const recentEl = document.getElementById('recentScripts');
    if (withScript.length === 0) {
        recentEl.innerHTML = '<p class="empty-state">작성된 스크립트가 없습니다</p>';
    } else {
        recentEl.innerHTML = withScript.map(c => `
            <div class="recent-item" data-id="${c.id}" style="cursor:pointer">
                <div class="recent-item-left">
                    <span class="platform-badge ${c.platform}">${c.platform}</span>
                    <span class="recent-item-title">${escapeHtml(c.title)}</span>
                </div>
                <span class="script-status ${c.scriptStatus || 'draft'}">${scriptStatusLabels[c.scriptStatus] || '초안'}</span>
            </div>`).join('');
        recentEl.querySelectorAll('.recent-item').forEach(el => {
            el.addEventListener('click', () => openEditContent(el.dataset.id));
        });
    }

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
    const weeks = [];
    const cur = new Date(start);
    while (cur <= now) {
        const weekStart = new Date(cur);
        const weekEnd = new Date(cur);
        weekEnd.setDate(weekEnd.getDate() + 6);
        const wsStr = weekStart.toISOString().slice(0, 10);
        const weStr = weekEnd.toISOString().slice(0, 10);

        const publishedContents = state.contents.filter(c =>
            c.status === 'published' && c.date >= wsStr && c.date <= weStr
        ).length;
        const ytPublished = state.ytVideos.filter(v => {
            const d = v.publishedAt ? v.publishedAt.slice(0, 10) : '';
            return d >= wsStr && d <= weStr;
        }).length;
        const published = publishedContents + ytPublished;
        const inProgress = state.contents.filter(c =>
            ['scripting', 'filming', 'editing', 'scheduled'].includes(c.status) &&
            c.date >= wsStr && c.date <= weStr
        ).length;

        weeks.push({ weekStart, weekEnd, published, inProgress, label: `${weekStart.getMonth() + 1}/${weekStart.getDate()}` });
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
    segs.forEach(s => ctx.bezierCurveTo(s.cp1x, s.cp1y, s.cp2x, s.cp2y, s.x, s.y));
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

    const allVals = weeks.flatMap(w => [w.published, w.inProgress]);
    const maxData = Math.max(...allVals, 1);
    const gridStep = Math.ceil(maxData / 4) || 1;
    const maxVal = gridStep * 4;

    const gap = weeks.length > 1 ? chartW / (weeks.length - 1) : chartW;
    const pts1 = weeks.map((wk, i) => ({
        x: padding.left + (weeks.length > 1 ? gap * i : chartW / 2),
        y: padding.top + chartH - (wk.published / maxVal) * chartH
    }));
    const pts2 = weeks.map((wk, i) => ({
        x: padding.left + (weeks.length > 1 ? gap * i : chartW / 2),
        y: padding.top + chartH - (wk.inProgress / maxVal) * chartH
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
                <span class="chart-tooltip-label">게시완료</span>
                <span class="chart-tooltip-value">${wk.published}</span>
            </div>
            <div class="chart-tooltip-row">
                <span class="chart-tooltip-dot" style="background:${color2}"></span>
                <span class="chart-tooltip-label">진행중</span>
                <span class="chart-tooltip-value">${wk.inProgress}</span>
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
                ${hasScript ? `<div style="font-size:11px;margin-top:4px;display:flex;align-items:center;gap:4px"><span class="script-status ${sStatus}">${scriptStatusLabels[sStatus] || '초안'}</span></div>` : ''}
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
    document.getElementById('calendarTitle').textContent = `${year}년 ${month + 1}월`;

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
                case 'hook': insert = '\n## 훅 (첫 5초)\n'; break;
                case 'heading': insert = '\n## '; break;
                case 'bold':
                    insert = `**${text.slice(start, end) || '텍스트'}**`;
                    replaceSelection = true; break;
                case 'scene': insert = '\n---\n[장면: ] '; break;
                case 'note':
                    insert = `[${text.slice(start, end) || '연출 노트'}]`;
                    replaceSelection = true; break;
                case 'cta': insert = '\n## CTA\n좋아요와 구독 부탁드립니다!\n'; break;
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
    document.getElementById('wordCount').textContent = `${textarea.value.length}자`;
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
    document.getElementById('contentModalTitle').textContent = '콘텐츠 수정';
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
        const styleLabels = { 'bold-white': '굵은 흰색', 'yellow-highlight': '노란 강조', 'red-bg': '빨간 배경', 'outline': '아웃라인', 'gradient': '그라디언트' };
        const bgLabels = { 'closeup': '인물 클로즈업', 'before-after': '비포/애프터', 'product': '음식/제품', 'reaction': '반응샷', 'text-only': '텍스트 중심', 'custom': '기타' };
        let html = '';
        if (content.thumbnailText) html += `<div><strong>텍스트:</strong> ${escapeHtml(content.thumbnailText)}</div>`;
        if (content.thumbnailStyle) html += `<div><strong>스타일:</strong> ${escapeHtml(styleLabels[content.thumbnailStyle] || content.thumbnailStyle)}</div>`;
        if (content.thumbnailBg) html += `<div><strong>배경:</strong> ${escapeHtml(bgLabels[content.thumbnailBg] || content.thumbnailBg)}</div>`;
        if (content.thumbnailMemo) html += `<div><strong>메모:</strong> ${escapeHtml(content.thumbnailMemo)}</div>`;
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
    if (!title) { toast('제목을 입력해주세요'); return; }

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
        if (idx !== -1) { state.contents[idx] = { ...state.contents[idx], ...data }; toast('콘텐츠가 수정되었습니다'); }
    } else {
        state.contents.push({ id: generateId(), ...data, createdAt: new Date().toISOString() });
        toast('콘텐츠가 추가되었습니다');
    }
    saveContents(); closeContentModal(); renderAll();
}

function deleteContent() {
    const id = document.getElementById('contentId').value;
    if (!id || !confirm('이 콘텐츠를 삭제하시겠습니까?')) return;
    state.contents = state.contents.filter(c => c.id !== id);
    saveContents(); closeContentModal(); renderAll();
    toast('콘텐츠가 삭제되었습니다');
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
    usageText.textContent = '로딩 중...';
    usageFill.style.width = '0%';
    usageFill.className = 'mypage-usage-bar-fill';
    usageDetail.innerHTML = '';

    try {
        const res = await fetch('/api/youtube/usage');
        if (!res.ok) throw new Error('사용량 조회 실패');
        const usage = await res.json();

        const pct = Math.min((usage.used / usage.limit) * 100, 100);
        usageFill.style.width = pct + '%';
        if (pct >= 90) usageFill.classList.add('danger');
        else if (pct >= 60) usageFill.classList.add('warning');

        usageText.textContent = `${formatNumber(usage.used)} / ${formatNumber(usage.limit)} 유닛`;

        const breakdown = usage.breakdown || {};
        const categories = Object.keys(breakdown);
        if (categories.length > 0) {
            usageDetail.innerHTML = categories.map(cat =>
                `<div class="mypage-usage-row">
                    <span class="mypage-usage-row-label">${escapeHtml(cat)}</span>
                    <span class="mypage-usage-row-value">${formatNumber(breakdown[cat])} 유닛</span>
                </div>`
            ).join('') +
            `<div class="mypage-usage-row">
                <span class="mypage-usage-row-label">남은 유닛</span>
                <span class="mypage-usage-row-value" style="color:${pct >= 90 ? 'var(--red)' : pct >= 60 ? 'var(--orange)' : 'var(--green)'}">${formatNumber(usage.remaining)}</span>
            </div>`;
        } else {
            usageDetail.innerHTML = `<div class="mypage-usage-row">
                <span class="mypage-usage-row-label">오늘 사용 내역 없음</span>
                <span class="mypage-usage-row-value">${formatNumber(usage.remaining)} 유닛 남음</span>
            </div>`;
        }
    } catch {
        usageText.textContent = '사용량을 불러올 수 없습니다';
    }
}

function closeMyPage() { document.getElementById('myPageModal').classList.remove('active'); }

// ===== YouTube Integration =====
function promptChannelConnect() {
    const saved = localStorage.getItem('creatorhub_yt_channel');
    const input = prompt('YouTube 채널 ID를 입력하세요\n(YouTube Studio → 설정 → 채널 → 기본 정보에서 확인)', saved || '');
    if (!input || !input.trim()) return;
    localStorage.setItem('creatorhub_yt_channel', input.trim());
    loadYouTubeData();
}

function setupYouTube() {
    document.getElementById('ytConnectBtn').addEventListener('click', promptChannelConnect);
    document.getElementById('ytRefreshBtn').addEventListener('click', loadYouTubeData);

    // 대시보드 상단 연동 버튼
    const myChConnectBtn = document.getElementById('myChConnectBtn');
    if (myChConnectBtn) myChConnectBtn.addEventListener('click', promptChannelConnect);

    const channelId = localStorage.getItem('creatorhub_yt_channel');
    if (channelId) {
        loadYouTubeData();
    } else {
        updateMyChannelHero(null);
    }
}

function formatNumber(num) {
    if (num >= 100000000) return (num / 100000000).toFixed(1) + '억';
    if (num >= 10000) return (num / 10000).toFixed(1) + '만';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toLocaleString();
}

async function loadYouTubeData() {
    const channelId = localStorage.getItem('creatorhub_yt_channel');
    if (!channelId) return;

    const emptyEl = document.getElementById('ytEmpty');
    const statsEl = document.getElementById('ytStats');
    const videosCard = document.getElementById('ytVideosCard');
    const refreshBtn = document.getElementById('ytRefreshBtn');
    const connectBtn = document.getElementById('ytConnectBtn');

    emptyEl.innerHTML = '<p class="empty-state">YouTube 데이터를 불러오는 중...</p>';

    try {
        const channelRes = await fetch(`/api/youtube/channel?channelId=${encodeURIComponent(channelId)}`);
        if (!channelRes.ok) {
            const err = await channelRes.json();
            throw new Error(err.error || '채널 데이터를 가져올 수 없습니다');
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
        connectBtn.textContent = '채널 변경';

        const channelInfoHtml = `
            <div class="yt-channel-info">
                <img class="yt-channel-thumb" src="${channel.thumbnail}" alt="${escapeHtml(channel.title)}">
                <div class="yt-channel-name">
                    ${escapeHtml(channel.title)}
                    <small>연동됨</small>
                </div>
            </div>`;

        const existingInfo = document.querySelector('.yt-channel-info');
        if (existingInfo) existingInfo.remove();
        statsEl.insertAdjacentHTML('beforebegin', channelInfoHtml);

        const videosRes = await fetch(`/api/youtube/videos?channelId=${encodeURIComponent(channelId)}`);
        if (videosRes.ok) {
            const videos = await videosRes.json();
            state.ytVideos = videos;
            renderYouTubeVideos(videos);
            renderChart();
        }

        toast(`"${channel.title}" 채널 데이터를 불러왔습니다`);
    } catch (err) {
        emptyEl.style.display = 'block';
        emptyEl.innerHTML = `<p class="empty-state" style="color:var(--red)">오류: ${escapeHtml(err.message)}<br><small>서버가 실행중인지 확인하세요 (node server.js)</small></p>`;
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
    if (n >= 100000000) return (n / 100000000) + '억';
    if (n >= 10000) return (n / 10000) + '만';
    if (n >= 1000) return (n / 1000) + '천';
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

        statsEl.style.display = '';
        emptyEl.style.display = 'none';
    } else {
        statsEl.style.display = 'none';
        emptyEl.style.display = '';
    }
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
    if (!query) { toast('검색어를 입력하세요'); return; }

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
            grid.innerHTML = '<div class="discover-loading">구독자 필터 적용 중... (더 많은 결과를 탐색합니다)</div>';
        } else {
            grid.innerHTML = '<div class="discover-loading">검색 중...</div>';
        }
    } else {
        const moreBtn = document.getElementById('discoverMoreBtn');
        if (moreBtn) { moreBtn.disabled = true; moreBtn.textContent = '불러오는 중...'; }
    }

    try {
        const apiOrder = (params.order === 'performance' || params.order === 'velocity') ? 'viewCount' : params.order;
        const durationParam = params.duration ? `&videoDuration=${encodeURIComponent(params.duration)}` : '';
        const tokenParam = loadMore && _discoverNextPageToken ? `&pageToken=${encodeURIComponent(_discoverNextPageToken)}` : '';
        const res = await fetch(`/api/youtube/search?q=${encodeURIComponent(params.query)}&order=${encodeURIComponent(apiOrder)}&maxResults=${perPage}&pages=${pages}${durationParam}${tokenParam}`);
        if (!res.ok) {
            let msg = '검색에 실패했습니다';
            try { const err = await res.json(); msg = err.error || msg; } catch {}
            throw new Error(msg);
        }
        const data = await res.json();
        let videos = data.videos || data;
        _discoverNextPageToken = data.nextPageToken || null;
        const totalFetched = videos.length;

        // 구독자 수 필터링
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
            ? `${_discoverAllVideos.length}개 표시 (필터 적용)`
            : `${_discoverAllVideos.length}개의 결과`;
        infoEl.textContent = infoText;
        renderDiscoverResults(_discoverAllVideos);
    } catch (err) {
        if (!loadMore) {
            grid.innerHTML = `<div class="discover-empty"><p style="color:var(--red)">오류: ${escapeHtml(err.message)}</p></div>`;
        } else {
            toast('더 보기 실패: ' + err.message);
            const moreBtn = document.getElementById('discoverMoreBtn');
            if (moreBtn) { moreBtn.disabled = false; moreBtn.textContent = '더 보기'; }
        }
    }
}

function updateActiveFilters(params) {
    const container = document.getElementById('discoverActiveFilters');
    const chips = [];
    chips.push(`"${params.query}"`);

    const durationLabels = { short: '숏츠', medium: '롱폼', long: '롱폼+' };
    if (params.duration) chips.push(durationLabels[params.duration]);

    const orderLabels = { viewCount: '조회수순', relevance: '관련도순', date: '최신순', performance: '성과순', velocity: '폭발력순' };
    chips.push(orderLabels[params.order] || '조회수순');

    const subMin = parseInt(params.subMin) || 0;
    const subMax = parseInt(params.subMax) || 0;
    if (subMin > 0 || subMax > 0) {
        const fmt = n => n >= 10000 ? (n / 10000) + '만' : n >= 1000 ? (n / 1000) + '천' : n;
        let subLabel = '구독자 ';
        if (subMin > 0 && subMax > 0) subLabel += `${fmt(subMin)}~${fmt(subMax)}`;
        else if (subMin > 0) subLabel += `${fmt(subMin)} 이상`;
        else subLabel += `${fmt(subMax)} 이하`;
        chips.push(subLabel);
    }

    container.innerHTML = chips.map(c => `<span class="discover-filter-chip">${c}</span>`).join('');
}

function renderDiscoverResults(videos) {
    const grid = document.getElementById('discoverGrid');
    if (!videos || videos.length === 0) {
        grid.innerHTML = '<div class="discover-empty"><p>검색 결과가 없습니다</p></div>';
        return;
    }

    grid.innerHTML = videos.map(v => {
        const date = new Date(v.publishedAt).toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' });
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
                <div class="discover-card-sub">구독자 ${formatNumber(v.subscriberCount || 0)}</div>
                <span class="discover-card-ratio ${ratioClass}">${ratioLabel} 구독자 대비 ${ratio}%</span>
                ${velocityBadgeHtml(v)}
                <div class="discover-card-date">${date}</div>
            </div>
            <div class="discover-card-actions">
                <button class="btn btn-secondary discover-ref-btn" data-video='${JSON.stringify(v).replace(/'/g, '&#39;')}'>레퍼런스 저장</button>
            </div>
        </div>`;
    }).join('');

    grid.querySelectorAll('.discover-ref-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const video = JSON.parse(btn.dataset.video);
            saveAsReference(video);
        });
    });

    // 더 보기 버튼
    const oldBtn = document.getElementById('discoverMoreBtn');
    if (oldBtn) oldBtn.remove();
    if (_discoverNextPageToken && _lastSearchParams) {
        const wrap = document.createElement('div');
        wrap.className = 'discover-more-wrap';
        wrap.innerHTML = '<button class="btn btn-secondary" id="discoverMoreBtn">더 보기</button>';
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
    if (!query) { toast('검색어를 입력하세요'); return; }
    _lastChannelSearchKeyword = query;
    const subMin = parseInt(document.getElementById('channelSubMin').value) || 0;
    const subMax = parseInt(document.getElementById('channelSubMax').value) || 0;
    closeChannelSearchModal();
    performChannelSearch(query, subMin, subMax);
}

async function performChannelSearch(query, subMin, subMax) {
    const grid = document.getElementById('channelGrid');
    const infoEl = document.getElementById('channelResultInfo');
    const hasSubFilter = subMin > 0 || subMax > 0;
    const fetchCount = hasSubFilter ? 50 : 12;

    grid.innerHTML = hasSubFilter
        ? '<div class="discover-loading">구독자 필터 적용 중...</div>'
        : '<div class="discover-loading">채널 검색 중...</div>';

    try {
        const res = await fetch(`/api/youtube/search-channels?q=${encodeURIComponent(query)}&maxResults=${fetchCount}`);
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || '검색에 실패했습니다');
        }
        let channels = await res.json();
        const totalFetched = channels.length;

        if (subMin > 0) channels = channels.filter(ch => ch.subscriberCount >= subMin);
        if (subMax > 0) channels = channels.filter(ch => ch.subscriberCount <= subMax);

        infoEl.textContent = hasSubFilter
            ? `${totalFetched}개 중 ${channels.length}개 일치`
            : `${channels.length}개의 결과`;
        renderChannelResults(channels);
    } catch (err) {
        grid.innerHTML = `<div class="discover-empty"><p style="color:var(--red)">오류: ${escapeHtml(err.message)}</p></div>`;
    }
}

function renderChannelResults(channels) {
    const grid = document.getElementById('channelGrid');
    if (!channels || channels.length === 0) {
        grid.innerHTML = '<div class="discover-empty"><p>검색 결과가 없습니다</p></div>';
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
                    <span class="channel-card-stat-label">구독자</span>
                </div>
                <div class="channel-card-stat">
                    <span class="channel-card-stat-value">${formatNumber(ch.videoCount)}</span>
                    <span class="channel-card-stat-label">영상</span>
                </div>
                <div class="channel-card-stat">
                    <span class="channel-card-stat-value">${formatNumber(ch.viewCount)}</span>
                    <span class="channel-card-stat-label">총 조회수</span>
                </div>
            </div>
            <div class="channel-card-actions">
                <a class="btn btn-secondary" href="https://www.youtube.com/channel/${ch.id}" target="_blank">YouTube에서 보기</a>
                <button class="btn btn-primary channel-connect-btn" data-id="${ch.id}">채널 연동</button>
            </div>
        </div>`;
    }).join('');

    grid.querySelectorAll('.channel-connect-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            localStorage.setItem('creatorhub_yt_channel', btn.dataset.id);
            toast('채널이 연동되었습니다. 대시보드에서 확인하세요.');
            loadYouTubeData();
        });
    });
}

let _pendingRefVideo = null;

function saveAsReference(video) {
    const exists = state.references.some(r => r.videoId === video.id);
    if (exists) {
        toast('이미 저장된 레퍼런스입니다');
        return;
    }
    _pendingRefVideo = video;
    openRefFolderModal();
}

// ===== References (레퍼런스) =====
function saveReferences() { localStorage.setItem('creatorhub_references', JSON.stringify(state.references)); }

function setupReferences() {
    document.getElementById('refClearAllBtn').addEventListener('click', () => {
        if (!confirm('모든 레퍼런스를 삭제하시겠습니까?')) return;
        state.references = [];
        saveReferences();
        renderReferences();
        toast('모든 레퍼런스가 삭제되었습니다');
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

    countEl.textContent = `${filtered.length}개의 레퍼런스`;
    clearBtn.style.display = state.references.length > 0 ? '' : 'none';

    if (filtered.length === 0) {
        grid.innerHTML = `
            <div class="discover-empty">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color:var(--text-muted);margin-bottom:12px"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg>
                <p>저장된 레퍼런스가 없습니다</p>
                <p style="font-size:12px;color:var(--text-muted);margin-top:4px">콘텐츠 탐색에서 영상을 검색하고 레퍼런스로 저장해보세요</p>
            </div>`;
        return;
    }

    grid.innerHTML = filtered.map(ref => {
        const pubDate = new Date(ref.publishedAt).toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' });
        const savedDate = new Date(ref.savedAt).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
        const folder = ref.folderId ? state.refFolders.find(f => f.id === ref.folderId) : null;
        const folderBadge = folder ? `<span class="ref-card-folder">${escapeHtml(folder.name)}</span>` : '';
        return `
        <div class="ref-card" data-id="${ref.id}">
            <div class="ref-card-thumb-wrap">
                <img class="ref-card-thumb" src="${ref.thumbnail}" alt="${escapeHtml(ref.title)}">
                <a class="ref-card-link" href="${ref.url}" target="_blank" title="YouTube에서 보기">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15,3 21,3 21,9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                </a>
            </div>
            <div class="ref-card-body">
                ${folderBadge}
                <div class="ref-card-title">${escapeHtml(ref.title)}</div>
                <div class="ref-card-channel">${escapeHtml(ref.channelTitle)} · 구독자 ${formatNumber(ref.subscriberCount || 0)} · ${pubDate}</div>
                <div class="ref-card-stats">
                    <span>👁 ${formatNumber(ref.viewCount)}</span>
                    <span>👍 ${formatNumber(ref.likeCount)}</span>
                    <span>💬 ${formatNumber(ref.commentCount)}</span>
                </div>
                ${ref.viewToSubRatio ? `<span class="discover-card-ratio ${ref.viewToSubRatio >= 200 ? 'hot' : ref.viewToSubRatio >= 50 ? 'good' : 'normal'}">${ref.viewToSubRatio >= 200 ? '🔥' : ref.viewToSubRatio >= 50 ? '✨' : ''} 구독자 대비 ${ref.viewToSubRatio}%</span>` : ''}
            </div>
            <div class="ref-card-saved">저장: ${savedDate}</div>
            <div class="ref-card-actions">
                <button class="btn btn-primary ref-use-btn" data-id="${ref.id}">콘텐츠로 등록</button>
                <button class="btn btn-secondary ref-delete-btn" data-id="${ref.id}">삭제</button>
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
    document.getElementById('contentMemo').value = `[레퍼런스]\n제목: ${ref.title}\nURL: ${ref.url}\n채널: ${ref.channelTitle}\n조회수: ${formatNumber(ref.viewCount)}`;
}

function deleteReference(refId) {
    state.references = state.references.filter(r => r.id !== refId);
    saveReferences();
    renderReferences();
    toast('레퍼런스가 삭제되었습니다');
}

// ===== Reference Folders =====
function saveRefFolders() {
    localStorage.setItem('creatorhub_ref_folders', JSON.stringify(state.refFolders));
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
        <span>미분류</span>
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
    toast('레퍼런스가 저장되었습니다');
    if (state.currentTab === 'references') renderReferences();
}

function createRefFolderInline() {
    const input = document.getElementById('refFolderNewName');
    const name = input.value.trim();
    if (!name) { toast('폴더 이름을 입력하세요'); return; }
    if (state.refFolders.some(f => f.name === name)) { toast('같은 이름의 폴더가 있습니다'); return; }

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
        전체 <span class="ref-folder-count">${allCount}</span>
    </button>`;
    html += `<button class="ref-folder-chip${state.activeRefFolder === 'uncategorized' ? ' active' : ''}" data-folder="uncategorized">
        미분류 <span class="ref-folder-count">${uncatCount}</span>
    </button>`;

    state.refFolders.forEach(f => {
        const count = state.references.filter(r => r.folderId === f.id).length;
        html += `<button class="ref-folder-chip${state.activeRefFolder === f.id ? ' active' : ''}" data-folder="${f.id}" data-folder-name="${escapeHtml(f.name)}">
            ${escapeHtml(f.name)} <span class="ref-folder-count">${count}</span>
        </button>`;
    });

    html += `<button class="ref-folder-add-btn" id="refFolderAddChip">+ 새 폴더</button>`;
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
    const name = prompt('새 폴더 이름을 입력하세요:');
    if (!name || !name.trim()) return;
    const trimmed = name.trim();
    if (state.refFolders.some(f => f.name === trimmed)) { toast('같은 이름의 폴더가 있습니다'); return; }

    state.refFolders.push({ id: generateId(), name: trimmed, createdAt: new Date().toISOString() });
    saveRefFolders();
    renderReferences();
    toast(`"${trimmed}" 폴더가 생성되었습니다`);
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
    const newName = prompt('새 폴더 이름:', folder.name);
    if (!newName || !newName.trim() || newName.trim() === folder.name) return;
    const trimmed = newName.trim();
    if (state.refFolders.some(f => f.id !== id && f.name === trimmed)) { toast('같은 이름의 폴더가 있습니다'); return; }
    folder.name = trimmed;
    saveRefFolders();
    renderReferences();
    toast('폴더 이름이 변경되었습니다');
}

function deleteRefFolder(id) {
    const folder = state.refFolders.find(f => f.id === id);
    if (!folder) return;
    if (!confirm(`"${folder.name}" 폴더를 삭제하시겠습니까?\n포함된 레퍼런스는 미분류로 이동됩니다.`)) return;

    // Move references to uncategorized
    state.references.forEach(r => { if (r.folderId === id) r.folderId = null; });
    saveReferences();

    // Remove folder
    state.refFolders = state.refFolders.filter(f => f.id !== id);
    saveRefFolders();

    // Reset filter if viewing deleted folder
    if (state.activeRefFolder === id) state.activeRefFolder = null;
    renderReferences();
    toast('폴더가 삭제되었습니다');
}

function renderYouTubeVideos(videos) {
    const container = document.getElementById('ytVideosList');
    if (!videos || videos.length === 0) {
        container.innerHTML = '<p class="empty-state">영상이 없습니다</p>';
        return;
    }

    container.innerHTML = videos.map(v => {
        const date = new Date(v.publishedAt).toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' });
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
    const grid = document.getElementById('ideasTrendingGrid');
    const selectVal = categoryId !== undefined ? categoryId : document.getElementById('ideasCategorySelect').value;

    if (_ideasTrendingLoaded && categoryId === undefined) return;

    grid.innerHTML = '<div class="discover-loading">트렌드 영상을 불러오는 중...</div>';

    try {
        const categoryParam = selectVal ? `&videoCategoryId=${encodeURIComponent(selectVal)}` : '';
        const res = await fetch(`/api/youtube/trending?regionCode=KR&maxResults=12${categoryParam}`);
        if (!res.ok) {
            let msg = '트렌드 영상을 가져올 수 없습니다';
            try { const err = await res.json(); msg = err.error || msg; } catch {}
            throw new Error(msg);
        }
        const videos = await res.json();
        _ideasTrendingLoaded = true;
        _ideasTrendingCache = videos;
        filterAndRenderTrending();
    } catch (err) {
        grid.innerHTML = `<div class="discover-empty"><p style="color:var(--red)">오류: ${escapeHtml(err.message)}</p></div>`;
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
        grid.innerHTML = '<div class="discover-empty"><p>트렌드 영상이 없습니다</p></div>';
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
                <div class="ideas-video-card-sub">구독자 ${formatNumber(v.subscriberCount || 0)}</div>
                ${velocityBadgeHtml(v)}
                <div class="ideas-video-card-date">${timeAgo}</div>
            </div>
            <div class="ideas-video-card-actions">
                <button class="btn btn-primary ideas-save-btn" data-video='${JSON.stringify(v).replace(/'/g, '&#39;')}' data-source="trending">아이디어로 저장</button>
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
    const input = document.getElementById('ideasKeywordInput');
    const keyword = input.value.trim();
    if (!keyword) { toast('키워드를 입력하세요'); return; }

    const chipsContainer = document.getElementById('ideasKeywordChips');
    const videosContainer = document.getElementById('ideasKeywordVideos');
    chipsContainer.innerHTML = '<span style="font-size:12px;color:var(--text-muted)">연관 키워드 분석 중...</span>';
    videosContainer.innerHTML = '';

    try {
        const res = await fetch(`/api/youtube/keyword-suggestions?q=${encodeURIComponent(keyword)}`);
        if (!res.ok) {
            let msg = '키워드 분석에 실패했습니다';
            try { const err = await res.json(); msg = err.error || msg; } catch {}
            throw new Error(msg);
        }
        const suggestions = await res.json();
        renderKeywordSuggestions(suggestions, keyword);
    } catch (err) {
        chipsContainer.innerHTML = `<span style="font-size:12px;color:var(--red)">오류: ${escapeHtml(err.message)}</span>`;
    }
}

function renderKeywordSuggestions(suggestions, originalKeyword) {
    const chipsContainer = document.getElementById('ideasKeywordChips');

    if (!suggestions || suggestions.length === 0) {
        chipsContainer.innerHTML = '<span style="font-size:12px;color:var(--text-muted)">연관 키워드가 없습니다</span>';
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
    container.innerHTML = '<div class="discover-loading">관련 영상을 검색하는 중...</div>';

    try {
        const kwDuration = document.getElementById('ideasKeywordDuration').value;
        const kwDurationParam = kwDuration ? `&videoDuration=${encodeURIComponent(kwDuration)}` : '';
        const res = await fetch(`/api/youtube/search?q=${encodeURIComponent(keyword)}&order=viewCount&maxResults=6&pages=1${kwDurationParam}`);
        if (!res.ok) {
            let msg = '영상 검색에 실패했습니다';
            try { const err = await res.json(); msg = err.error || msg; } catch {}
            throw new Error(msg);
        }
        const data = await res.json();
        const videos = data.videos || data;
        renderKeywordVideos(videos, keyword);
    } catch (err) {
        container.innerHTML = `<div class="discover-empty"><p style="color:var(--red)">오류: ${escapeHtml(err.message)}</p></div>`;
    }
}

function renderKeywordVideos(videos, keyword) {
    const container = document.getElementById('ideasKeywordVideos');
    if (!videos || videos.length === 0) {
        container.innerHTML = '<div class="discover-empty"><p>관련 영상이 없습니다</p></div>';
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
                    <button class="btn btn-primary ideas-save-btn" data-video='${JSON.stringify(v).replace(/'/g, '&#39;')}' data-source="keyword" data-keyword="${escapeHtml(keyword)}">아이디어로 저장</button>
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
        toast('이미 아이디어로 저장된 영상입니다');
        return;
    }

    const sourceLabel = source === 'trending' ? '트렌드' : source === 'outlier' ? `아웃라이어: ${keyword}` : `키워드: ${keyword}`;
    const outlierInfo = source === 'outlier' && video.outlierScore ? `\n아웃라이어: ${video.outlierScore}x (채널 중앙값 ${formatNumber(video.channelMedianViews || 0)})` : '';
    const memo = `[${sourceLabel}에서 발견]\nURL: ${videoUrl}\n채널: ${video.channelTitle}\n조회수: ${formatNumber(video.viewCount)}${video.subscriberCount ? '\n구독자: ' + formatNumber(video.subscriberCount) : ''}${outlierInfo}`;

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
    toast('아이디어로 저장되었습니다');
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

    if (diffYear > 0) return `${diffYear}년 전`;
    if (diffMonth > 0) return `${diffMonth}개월 전`;
    if (diffWeek > 0) return `${diffWeek}주 전`;
    if (diffDay > 0) return `${diffDay}일 전`;
    if (diffHour > 0) return `${diffHour}시간 전`;
    if (diffMin > 0) return `${diffMin}분 전`;
    return '방금 전';
}

// ===== Velocity (초기 폭발력) =====
function calcVelocity(video) {
    const days = Math.max(1, Math.floor((Date.now() - new Date(video.publishedAt).getTime()) / 86400000));
    const viewsPerDay = Math.round(video.viewCount / days);
    const subs = video.subscriberCount || 1;
    const score = (video.viewCount / subs) / days;
    const engagement = video.viewCount > 0 ? Math.round(((video.likeCount || 0) + (video.commentCount || 0)) / video.viewCount * 1000) / 10 : 0;

    let level, label, icon;
    if (score >= 2)       { level = 'explosive'; label = '폭발'; icon = '🔥🔥'; }
    else if (score >= 0.3) { level = 'hot'; label = '급상승'; icon = '🔥'; }
    else                   { level = 'normal'; label = ''; icon = ''; }

    return { viewsPerDay, score, days, level, label, icon, engagement };
}

function velocityBadgeHtml(video) {
    const v = calcVelocity(video);
    const parts = [];

    if (v.level !== 'normal') {
        parts.push(`<span class="velocity-badge ${v.level}">${v.icon} ${v.label}</span>`);
    }
    parts.push(`<span class="velocity-detail">일평균 ${formatNumber(v.viewsPerDay)}회</span>`);
    if (v.engagement > 0) {
        parts.push(`<span class="velocity-detail">참여율 ${v.engagement}%</span>`);
    }

    return `<div class="velocity-row">${parts.join('')}</div>`;
}

// ===== New Content Wizard =====
const NC_TOTAL_STEPS = 6;
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

    // Thumbnail style card selection
    document.querySelectorAll('#ncThumbStyleGrid .nc-thumb-style-card').forEach(card => {
        card.addEventListener('click', () => {
            document.querySelectorAll('#ncThumbStyleGrid .nc-thumb-style-card').forEach(c => c.classList.remove('active'));
            card.classList.add('active');
        });
    });

    // Thumbnail background card selection
    document.querySelectorAll('#ncThumbBgGrid .nc-thumb-bg-card').forEach(card => {
        card.addEventListener('click', () => {
            document.querySelectorAll('#ncThumbBgGrid .nc-thumb-bg-card').forEach(c => c.classList.remove('active'));
            card.classList.add('active');
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

    // Skip reference step
    document.getElementById('ncRefSkip').addEventListener('click', e => {
        e.preventDefault();
        ncNext();
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

    // Reset thumbnail fields
    document.getElementById('ncThumbText').value = '';
    document.getElementById('ncThumbMemo').value = '';
    document.getElementById('ncThumbGrid').innerHTML = '';
    document.querySelectorAll('#ncThumbStyleGrid .nc-thumb-style-card').forEach(c => c.classList.remove('active'));
    document.querySelector('#ncThumbStyleGrid .nc-thumb-style-card[data-value="bold-white"]').classList.add('active');
    document.querySelectorAll('#ncThumbBgGrid .nc-thumb-bg-card').forEach(c => c.classList.remove('active'));
    document.querySelector('#ncThumbBgGrid .nc-thumb-bg-card[data-value="closeup"]').classList.add('active');

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
        if (idea.length < 2) { toast('아이디어를 2글자 이상 입력해주세요'); document.getElementById('ncIdea').focus(); return; }
        _ncIdeaText = idea;
    }
    if (_ncCurrentStep === 2) {
        const title = document.getElementById('ncTitle').value.trim();
        if (title.length < 2) { toast('제목을 2글자 이상 입력해주세요'); document.getElementById('ncTitle').focus(); return; }
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
    prevBtn.textContent = _ncCurrentStep === 0 ? '취소' : '이전';
    const isLast = _ncCurrentStep === NC_TOTAL_STEPS - 1;
    nextBtn.textContent = isLast ? '완료' : '다음';

    // Step-specific auto actions
    if (_ncCurrentStep === 1) {
        // Auto search on entering reference step
        document.getElementById('ncRefSearchInput').value = _ncIdeaText;
        ncAutoSearch(_ncIdeaText);
    }
    if (_ncCurrentStep === 2) {
        // Pre-fill title with idea text if empty
        const titleInput = document.getElementById('ncTitle');
        if (!titleInput.value.trim()) titleInput.value = _ncIdeaText;
        ncRenderTitlePatterns();
        setTimeout(() => titleInput.focus(), 100);
    }
    if (_ncCurrentStep === 3) {
        // Render thumbnail comparison grid
        ncRenderThumbnailStep();
    }
    if (_ncCurrentStep === 5) {
        // Update review card
        ncUpdateReviewCard();
    }
}

async function ncAutoSearch(query) {
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
    } catch (err) {
        listEl.innerHTML = `<div class="nc-ref-error">검색에 실패했습니다: ${escapeHtml(err.message)}</div>`;
    } finally {
        loadingEl.style.display = 'none';
    }
}

function ncRenderRefResults(videos) {
    const listEl = document.getElementById('ncRefList');
    if (!videos || videos.length === 0) {
        listEl.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:20px;font-size:13px">검색 결과가 없습니다</div>';
        return;
    }

    listEl.innerHTML = videos.map((v, i) => {
        const isSelected = _ncSelectedRefs.some(r => r.videoId === v.videoId);
        return `
        <div class="nc-ref-item${isSelected ? ' selected' : ''}" data-idx="${i}">
            <img class="nc-ref-thumb" src="${v.thumbnail}" alt="">
            <div class="nc-ref-info">
                <div class="nc-ref-title">${escapeHtml(v.title)}</div>
                <div class="nc-ref-meta">${escapeHtml(v.channelTitle)} · 조회수 ${formatNumber(v.viewCount)}${v.subscriberCount ? ' · 구독자 ' + formatNumber(v.subscriberCount) : ''}</div>
            </div>
            <button class="nc-ref-select-btn${isSelected ? ' selected' : ''}" data-idx="${i}" title="${isSelected ? '선택 해제' : '선택'}">
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
    patternsEl.innerHTML = '<div class="nc-title-patterns-header">참고 제목 패턴</div>' +
        sourceTitles.slice(0, 6).map(t =>
            `<div class="nc-title-pattern-item">
                <span class="nc-title-pattern-text">${escapeHtml(t)}</span>
                <button class="nc-title-pattern-apply" data-title="${escapeHtml(t)}">적용</button>
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
        keywordsEl.innerHTML = '<div class="nc-keyword-chips-header">자주 쓰인 키워드</div>' +
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
        gridEl.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:20px;font-size:13px">레퍼런스 영상이 없습니다. 이전 단계에서 영상을 검색해보세요.</div>';
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
            <div class="nc-thumb-card-meta">조회수 ${formatNumber(v.viewCount)}</div>
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
                <div class="nc-thumb-enlarged-meta">${escapeHtml(video.channelTitle || '')} · 조회수 ${formatNumber(video.viewCount)}</div>
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
    const platformLabels = { youtube: 'YouTube', instagram: 'Instagram', tiktok: 'TikTok', blog: 'Blog', other: '기타' };

    document.getElementById('ncReviewTitle').textContent = title || '-';
    document.getElementById('ncReviewPlatform').textContent = platformLabels[platform] || platform;
    document.getElementById('ncReviewType').textContent = typeLabels[contentType] || contentType;
    document.getElementById('ncReviewDate').textContent = date || '미정';
    document.getElementById('ncReviewRefs').textContent = _ncSelectedRefs.length > 0
        ? _ncSelectedRefs.length + '개 선택됨'
        : '없음';

    // Thumbnail summary
    const thumbText = document.getElementById('ncThumbText').value.trim();
    const thumbStyle = document.querySelector('#ncThumbStyleGrid .nc-thumb-style-card.active')?.dataset.value || '';
    const styleLabels = { 'bold-white': '굵은 흰색', 'yellow-highlight': '노란 강조', 'red-bg': '빨간 배경', 'outline': '아웃라인', 'gradient': '그라디언트' };
    const thumbParts = [];
    if (thumbText) thumbParts.push(`"${thumbText}"`);
    if (thumbStyle) thumbParts.push(styleLabels[thumbStyle] || thumbStyle);
    document.getElementById('ncReviewThumb').textContent = thumbParts.length > 0 ? thumbParts.join(' · ') : '미설정';
}

function ncSave() {
    const title = document.getElementById('ncTitle').value.trim();
    if (!title) { toast('제목을 입력해주세요'); return; }

    const platform = document.querySelector('input[name="ncPlatform"]:checked').value;
    const contentType = document.querySelector('input[name="ncType"]:checked').value;
    let memo = document.getElementById('ncMemo').value.trim();

    // Append reference URLs to memo
    if (_ncSelectedRefs.length > 0) {
        const refLines = _ncSelectedRefs.map(r => `- ${r.title}\n  https://www.youtube.com/watch?v=${r.videoId}`).join('\n');
        const refSection = `\n\n[참고 레퍼런스]\n${refLines}`;
        memo = memo ? memo + refSection : refSection.trim();
    }

    const thumbnailText = document.getElementById('ncThumbText').value.trim();
    const thumbnailStyle = document.querySelector('#ncThumbStyleGrid .nc-thumb-style-card.active')?.dataset.value || 'bold-white';
    const thumbnailBg = document.querySelector('#ncThumbBgGrid .nc-thumb-bg-card.active')?.dataset.value || 'closeup';
    const thumbnailMemo = document.getElementById('ncThumbMemo').value.trim();

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
    toast('콘텐츠가 추가되었습니다');
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
    if (!keyword) { toast('브랜드명을 입력하세요'); return; }
    const strategy = document.getElementById('addetectStrategy').value;
    performAdSearch(keyword, strategy);
}

async function performAdSearch(brand, strategy) {
    const grid = document.getElementById('addetectGrid');
    const summary = document.getElementById('addetectSummary');
    const filterRow = document.getElementById('addetectFilterRow');
    const brandsEl = document.getElementById('addetectBrands');
    const channelsSection = document.getElementById('addetectChannelsSection');

    grid.innerHTML = `<div class="discover-loading">"${escapeHtml(brand)}" 광고 캠페인 검색 중...</div>`;
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
                let msg = '검색에 실패했습니다';
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
        grid.innerHTML = `<div class="discover-empty"><p style="color:var(--red)">오류: ${escapeHtml(err.message)}</p></div>`;
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
            <span class="addetect-channel-subs">${formatNumber(ch.subscriberCount)}명</span>
            <span class="addetect-channel-count">${ch.adCount}건</span>
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

    brandsEl.innerHTML = '<span style="font-size:12px;color:var(--text-muted);margin-right:4px">관련 링크:</span>' +
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
            ? `"${escapeHtml(_adDetectBrandName)}"의 광고 영상이 감지되지 않았습니다`
            : '조건에 맞는 영상이 없습니다';
        grid.innerHTML = `<div class="discover-empty"><p>${msg}</p></div>`;
        return;
    }

    grid.innerHTML = items.map(r => {
        const v = r.video;
        const date = new Date(v.publishedAt).toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' });
        const adBadge = r.isAd
            ? `<span class="ad-badge"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>광고</span>`
            : '';

        let brandInfo = '';
        if (r.isAd) {
            const keywordsStr = r.matchedKeywords.map(k => `"${escapeHtml(k)}"`).join(', ');
            const domainsHtml = r.brands.map(b =>
                `<a class="ad-brand-domain" href="${escapeHtml(b.url)}" target="_blank" rel="noopener">${escapeHtml(b.domain)}</a>`
            ).join('');
            brandInfo = `
                <div class="ad-brand-info">
                    <div class="ad-brand-info-title">광고 감지</div>
                    <div class="ad-brand-info-keywords">매칭: ${keywordsStr}</div>
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
                <div class="addetect-card-channel">${escapeHtml(v.channelTitle)}${v.subscriberCount ? ' · ' + formatNumber(v.subscriberCount) + '명' : ''}</div>
                <div class="addetect-card-stats">
                    <span>👁 ${formatNumber(v.viewCount)}</span>
                    <span>👍 ${formatNumber(v.likeCount)}</span>
                    <span>💬 ${formatNumber(v.commentCount)}</span>
                </div>
                <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">${date}</div>
                ${brandInfo}
            </div>
            <div class="addetect-card-actions">
                <button class="btn btn-secondary addetect-ref-btn" data-video='${JSON.stringify(v).replace(/'/g, '&#39;')}'>레퍼런스 저장</button>
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
    const keyword = document.getElementById('outlierKeyword').value.trim();
    if (!keyword) { toast('키워드를 입력하세요'); return; }

    const minScore = document.getElementById('outlierMinScore').value;
    const grid = document.getElementById('outlierGrid');
    const summary = document.getElementById('outlierSummary');

    _lastOutlierKeyword = keyword;
    grid.innerHTML = `<div class="discover-loading">"${escapeHtml(keyword)}" 아웃라이어 분석 중... (채널별 영상을 분석하므로 잠시 걸릴 수 있습니다)</div>`;
    summary.style.display = 'none';

    try {
        const res = await fetch(`/api/youtube/outliers?q=${encodeURIComponent(keyword)}&maxResults=10&minOutlierScore=${encodeURIComponent(minScore)}`);
        if (!res.ok) {
            let msg = '아웃라이어 분석에 실패했습니다';
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
        grid.innerHTML = `<div class="discover-empty"><p style="color:var(--red)">오류: ${escapeHtml(err.message)}</p></div>`;
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
        grid.innerHTML = `<div class="discover-empty"><p>조건에 맞는 아웃라이어 영상이 없습니다</p><p style="font-size:12px;color:var(--text-muted);margin-top:4px">최소 배수를 낮추거나 다른 키워드로 검색해보세요</p></div>`;
        return;
    }

    grid.innerHTML = videos.map(v => {
        const date = new Date(v.publishedAt).toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' });
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
                        <span class="outlier-comparison-label">이 영상</span>
                        <span class="outlier-comparison-value">${formatNumber(v.viewCount)}</span>
                    </div>
                    <div class="outlier-comparison-row">
                        <span class="outlier-comparison-label">채널 중앙값</span>
                        <span class="outlier-comparison-value">${formatNumber(v.channelMedianViews)}</span>
                    </div>
                    <div class="outlier-bar-wrap">
                        <div class="outlier-bar-avg" style="width:${medianBarWidth}%"></div>
                        <div class="outlier-bar-this" style="width:${thisBarWidth}%"></div>
                    </div>
                </div>
                <div class="discover-card-sub">구독자 ${formatNumber(v.subscriberCount)} · 채널 영상 ${v.channelVideoCount}개</div>
                <div class="discover-card-date">${date}</div>
            </div>
            <div class="discover-card-actions">
                <button class="btn btn-secondary discover-ref-btn" data-video='${JSON.stringify(v).replace(/'/g, '&#39;')}'>레퍼런스 저장</button>
                <button class="btn btn-primary outlier-idea-btn" data-video='${JSON.stringify(v).replace(/'/g, '&#39;')}'>아이디어 저장</button>
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

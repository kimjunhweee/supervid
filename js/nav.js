// ===== Theme + Sidebar Toggle + Navigation + Language Switcher =====
import { state } from './state.js';
// Circular imports (resolved at runtime):
import { renderDashboard, renderChart } from './dashboard.js';
import { renderKanban } from './kanban.js';
import { renderReferences } from './references.js';
import { loadTrendingVideos } from './ideas.js';
import { updateUploadGoal, updateLastUploadBanner } from './youtube.js';
import { renderAll } from '../app.js';

// ===== Theme =====
export function applyTheme() { document.documentElement.setAttribute('data-theme', state.theme); }
export function setupThemeToggle() {
    document.getElementById('themeToggle').addEventListener('click', () => {
        state.theme = state.theme === 'dark' ? 'light' : 'dark';
        localStorage.setItem('creatorhub_theme', state.theme);
        applyTheme();
        renderChart();
    });
}

// ===== Sidebar Toggle =====
export function setupSidebarToggle() {
    const saved = localStorage.getItem('creatorhub_sidebar');
    if (saved === 'collapsed') toggleSidebar(true);
    document.getElementById('sidebarToggle').addEventListener('click', e => {
        e.stopPropagation();
        toggleSidebar();
    });
}

export function toggleSidebar(silent) {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('collapsed');
    document.body.classList.toggle('sidebar-collapsed');
    const isCollapsed = sidebar.classList.contains('collapsed');
    localStorage.setItem('creatorhub_sidebar', isCollapsed ? 'collapsed' : 'expanded');
    if (!silent) setTimeout(() => renderChart(), 350);
}

// ===== Navigation =====
export function getNavTitle(tab) {
    const map = {
        dashboard: 'nav.home', kanban: 'nav.content', calendar: 'nav.calendar',
        discover: 'nav.discover', channels: 'nav.channels', references: 'nav.references',
        ideas: 'nav.ideas', addetect: 'nav.addetect', outliers: 'nav.outliers',
        newcontent: 'header.newContent'
    };
    return { title: t(map[tab] || tab), desc: t('desc.' + tab) };
}

export const LAB_TABS = ['ideas', 'addetect', 'outliers'];

export function switchTab(tab) {
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

export function setupNavigation() {
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

export function updateTodayDate() {
    const now = new Date();
    const locale = getLang() === 'en' ? 'en-US' : 'ko-KR';
    document.getElementById('todayDate').textContent = now.toLocaleDateString(locale, {
        year: 'numeric', month: 'long', day: 'numeric', weekday: 'long'
    });
}

// ===== Language Switcher =====
export function setupLangSwitcher() {
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

export function applyLanguageSwitch() {
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

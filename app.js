// ===== App Entry Point =====
import { state, migrateScriptsToContents } from './js/state.js';
import { applyTheme, setupThemeToggle, setupSidebarToggle, setupNavigation, updateTodayDate, setupLangSwitcher, getNavTitle } from './js/nav.js';
import { checkAuth, enterGuestMode } from './js/auth.js';
import { renderDashboard, setupChart } from './js/dashboard.js';
import { setupKanban, renderKanban, setupContentModal, setupModalTabs, setupScriptEditorToolbar, setupChecklist } from './js/kanban.js';
import { setupCalendar, renderCalendar } from './js/calendar.js';
import { setupYouTube, setupUploadGoal, setupGoalModal } from './js/youtube.js';
import { setupDiscover } from './js/discover.js';
import { setupChannelSearch } from './js/channels.js';
import { setupReferences } from './js/references.js';
import { setupIdeas } from './js/ideas.js';
import { setupAdDetect } from './js/addetect.js';
import { setupOutlierFinder } from './js/outliers.js';
import { setupNewContentPage } from './js/newcontent.js';

export function renderAll() {
    renderDashboard();
    renderCalendar();
    renderKanban();
}

let _appInitialized = false;
export function initApp() {
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

document.addEventListener('DOMContentLoaded', () => {
    applyTheme();
    checkAuth();
    document.getElementById('guestModeBtn')?.addEventListener('click', enterGuestMode);
});

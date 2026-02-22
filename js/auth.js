// ===== Auth =====
import { state, loadDataFromServer } from './state.js';
import { toast } from './utils.js';
// Circular imports (resolved at runtime — all calls happen inside function bodies):
import { updateSidebarYtLink, loadYouTubeData, setupMyPageModal, openMyPage } from './youtube.js';
import { initApp } from '../app.js';

export async function checkAuth() {
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

export function enterGuestMode() {
    state.isGuest = true;
    state.user = null;
    showApp();
}

export function checkGuestBlock() {
    if (state.isGuest) {
        toast(t('toast.guestRestricted'));
        return true;
    }
    return false;
}

export async function showApp() {
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

export function setupNavUserDropdown() {
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

export function showLogin() {
    state.isGuest = false;
    document.getElementById('loginScreen').style.display = '';
    document.getElementById('sidebar').style.display = 'none';
    document.getElementById('mainContent').style.display = 'none';
    renderGoogleButton();
}

export async function renderGoogleButton() {
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

export async function handleGoogleLogin(response) {
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

export async function logout() {
    try {
        await fetch('/api/auth/logout', { method: 'POST' });
    } catch { /* ignore */ }
    state.user = null;
    state.isGuest = false;
    showLogin();
    toast(t('login.loggedOut'));
}

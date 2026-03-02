// ===== State =====
import { generateId } from './utils.js';

export const state = {
    contents: JSON.parse(localStorage.getItem('creatorhub_contents') || '[]'),
    references: JSON.parse(localStorage.getItem('creatorhub_references') || '[]'),
    refFolders: JSON.parse(localStorage.getItem('creatorhub_ref_folders') || '[]'),
    savedChannels: JSON.parse(localStorage.getItem('creatorhub_saved_channels') || '[]'),
    activeRefFolder: null,
    ytVideos: [],
    currentTab: 'dashboard',
    calendarDate: new Date(),
    theme: localStorage.getItem('creatorhub_theme') || 'dark',
    user: null,
    isGuest: false
};

export const STATUS_ORDER = ['idea', 'scripting', 'filming', 'editing', 'scheduled', 'published'];
export function getStatusLabel(s) { return t('status.' + s) || s; }
export function getScriptStatusLabel(s) { return s ? (t('scriptStatus.' + s) || s) : t('scriptStatus.none'); }
export function getTypeLabel(tp) { return t('type.' + tp) || tp; }
// Legacy compat — some code may reference these directly
export const statusLabels = new Proxy({}, { get: (_, k) => getStatusLabel(k) });
export const scriptStatusLabels = new Proxy({}, { get: (_, k) => getScriptStatusLabel(k) });
export const typeLabels = new Proxy({}, { get: (_, k) => getTypeLabel(k) });

// ===== Data Helpers — save functions =====
export function saveContents() { localStorage.setItem('creatorhub_contents', JSON.stringify(state.contents)); syncToServer({ contents: state.contents }); }
export function saveReferences() { localStorage.setItem('creatorhub_references', JSON.stringify(state.references)); syncToServer({ refs: state.references }); }
export function saveRefFolders() {
    localStorage.setItem('creatorhub_ref_folders', JSON.stringify(state.refFolders));
    syncToServer({ ref_folders: state.refFolders });
}
export function saveSavedChannels() {
    localStorage.setItem('creatorhub_saved_channels', JSON.stringify(state.savedChannels));
    syncToServer({ saved_channels: state.savedChannels });
}

// ===== Server Sync =====
let _syncPatch = {};
let _syncTimer = null;

export function syncToServer(patch) {
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

export async function loadDataFromServer() {
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
            if (data.saved_channels) { state.savedChannels = data.saved_channels; localStorage.setItem('creatorhub_saved_channels', JSON.stringify(data.saved_channels)); }
        } else if (hasLocalContents) {
            // 서버 비어있고 localStorage에 데이터 있음 → 마이그레이션
            await fetch('/api/data', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: state.contents,
                    refs: state.references,
                    ref_folders: state.refFolders,
                    saved_channels: state.savedChannels,
                    upload_goal: parseInt(localStorage.getItem('creatorhub_upload_goal')) || 4,
                    weekly_goal: parseInt(localStorage.getItem('creatorhub_weekly_goal')) || 1,
                    yt_channel: localStorage.getItem('creatorhub_yt_channel') || null
                })
            });
        }
    } catch { /* 실패 시 localStorage 데이터로 정상 동작 */ }
}

// ===== Data Migration =====
export function migrateScriptsToContents() {
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

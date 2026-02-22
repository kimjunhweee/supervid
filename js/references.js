// ===== References + Reference Folders =====
import { state, saveReferences, saveRefFolders } from './state.js';
import { escapeHtml, formatNumber, generateId, toast } from './utils.js';
// Circular import (resolved at runtime):
import { openAddContent } from './newcontent.js';

// _pendingRefVideo is shared between saveAsReference (called from discover/channels/outliers)
// and confirmRefFolderSave
export let _pendingRefVideo = null;

export function saveAsReference(video) {
    const exists = state.references.some(r => r.videoId === video.id);
    if (exists) {
        toast(t('toast.refAlreadySaved'));
        return;
    }
    _pendingRefVideo = video;
    openRefFolderModal();
}

// ===== References =====
export function setupReferences() {
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

export function renderReferences() {
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

export function useReferenceAsContent(refId) {
    const ref = state.references.find(r => r.id === refId);
    if (!ref) return;
    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    openAddContent(dateStr);
    document.getElementById('contentTitle').value = ref.title;
    document.getElementById('contentMemo').value = `[${t('nav.references')}]\n${t('modal.title')}: ${ref.title}\nURL: ${ref.url}\n${t('channel.subscribers')}: ${ref.channelTitle}\n${t('misc.views')}: ${formatNumber(ref.viewCount)}`;
}

export function deleteReference(refId) {
    state.references = state.references.filter(r => r.id !== refId);
    saveReferences();
    renderReferences();
    toast(t('toast.refDeleted'));
}

// ===== Reference Folders =====
export function openRefFolderModal() {
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

export function closeRefFolderModal() {
    document.getElementById('refFolderModal').classList.remove('active');
    _pendingRefVideo = null;
}

export function confirmRefFolderSave() {
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

export function createRefFolderInline() {
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

export function renderRefFolderChips() {
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

export function bindRefFolderChipEvents() {
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

export function createRefFolderFromChipBar() {
    const name = prompt(t('ref.folderNewPrompt'));
    if (!name || !name.trim()) return;
    const trimmed = name.trim();
    if (state.refFolders.some(f => f.name === trimmed)) { toast(t('toast.folderDuplicate')); return; }

    state.refFolders.push({ id: generateId(), name: trimmed, createdAt: new Date().toISOString() });
    saveRefFolders();
    renderReferences();
    toast(t('toast.folderCreated', { name: trimmed }));
}

export function showFolderContextMenu(e, folderId) {
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

export function closeFolderContextMenu() {
    document.getElementById('refFolderCtx').style.display = 'none';
}

export function renameRefFolder(id) {
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

export function deleteRefFolder(id) {
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

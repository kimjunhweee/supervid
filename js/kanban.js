// ===== Kanban + Modal Tabs + Script Editor + Content Modal + Checklist =====
import { state, saveContents, STATUS_ORDER, statusLabels, scriptStatusLabels, typeLabels } from './state.js';
import { escapeHtml, formatDate, getChecklistCount, toast, generateId } from './utils.js';
// Circular imports (resolved at runtime):
import { openAddContent } from './newcontent.js';
import { renderAll } from '../app.js';

// ===== Kanban =====
export let draggedId = null;

export function setupKanban() {
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

export function renderKanban() {
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

// ===== Modal Tabs =====
export function setupModalTabs() {
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

export function resetModalTabs() {
    document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.modal-tab-panel').forEach(p => p.classList.remove('active'));
    const firstTab = document.querySelector('.modal-tab[data-modal-tab="info"]');
    const firstPanel = document.querySelector('.modal-tab-panel[data-modal-panel="info"]');
    if (firstTab) firstTab.classList.add('active');
    if (firstPanel) firstPanel.classList.add('active');
}

// ===== Script Editor Toolbar =====
export function setupScriptEditorToolbar() {
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

export function updateWordCount() {
    const textarea = document.getElementById('contentScriptContent');
    document.getElementById('wordCount').textContent = t('modal.chars', { n: textarea.value.length });
}

// ===== Content Modal =====
export function setupContentModal() {
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

export function confirmCloseContent() {
    document.getElementById('confirmDialog').classList.add('active');
}

export function hideConfirmDialog() {
    document.getElementById('confirmDialog').classList.remove('active');
}

// openAddContent defined in newcontent.js

export function openEditContent(id) {
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

export function closeContentModal() { document.getElementById('contentModal').classList.remove('active'); }

export function saveContent() {
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

export function deleteContent() {
    const id = document.getElementById('contentId').value;
    if (!id || !confirm(t('toast.deleteConfirm'))) return;
    state.contents = state.contents.filter(c => c.id !== id);
    saveContents(); closeContentModal(); renderAll();
    toast(t('toast.contentDeleted'));
}

// ===== Checklist =====
export function setupChecklist() {
    document.querySelectorAll('#uploadChecklist input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', updateChecklistProgress);
    });
}

export function resetChecklist() {
    document.querySelectorAll('#uploadChecklist input[type="checkbox"]').forEach(cb => { cb.checked = false; });
    updateChecklistProgress();
}

export function loadChecklist(checklist) {
    document.querySelectorAll('#uploadChecklist input[type="checkbox"]').forEach(cb => {
        cb.checked = checklist ? !!checklist[cb.dataset.key] : false;
    });
    updateChecklistProgress();
}

export function readChecklist() {
    const result = {};
    document.querySelectorAll('#uploadChecklist input[type="checkbox"]').forEach(cb => {
        result[cb.dataset.key] = cb.checked;
    });
    return result;
}

export function updateChecklistProgress() {
    const boxes = document.querySelectorAll('#uploadChecklist input[type="checkbox"]');
    const checked = [...boxes].filter(cb => cb.checked).length;
    const total = boxes.length;
    const pct = total > 0 ? (checked / total) * 100 : 0;
    const fill = document.getElementById('checklistProgress');
    fill.style.width = pct + '%';
    fill.className = 'checklist-progress-fill' + (checked === total && total > 0 ? ' complete' : '');
    document.getElementById('checklistText').textContent = `${checked}/${total}`;
}

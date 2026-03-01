// ===== New Content Wizard =====
import { state, saveContents } from './state.js';
import { generateId, escapeHtml, toast } from './utils.js';
import { switchTab } from './nav.js';
// Circular import (resolved at runtime):
import { renderAll } from '../app.js';

const NC_TOTAL_STEPS = 3;
let _ncCurrentStep = 0;
let _ncIdeaText = '';
let _ncChatMessages = [];   // { role: 'user'|'assistant', content: string }
let _ncChatIdea = '';       // AI가 확정한 아이디어
let _ncChatLoading = false;

function saveChatHistory() {
    localStorage.setItem('creatorhub_ai_chat', JSON.stringify(_ncChatMessages));
}

function ncNewChat() {
    if (_ncChatMessages.length > 0) {
        localStorage.setItem('creatorhub_ai_chat_prev', JSON.stringify(_ncChatMessages));
    }
    _ncChatMessages = [];
    _ncChatIdea = '';
    localStorage.removeItem('creatorhub_ai_chat');
    ncRenderChat();
    document.getElementById('ncChatInput').focus();
}

export function setupNewContentPage() {
    document.getElementById('ncNextBtn').addEventListener('click', ncNext);
    document.getElementById('ncPrevBtn').addEventListener('click', ncPrev);

    // AI Chat 이벤트
    document.getElementById('ncChatSend').addEventListener('click', ncChatSend);
    document.getElementById('ncChatInput').addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ncChatSend(); }
    });
    document.getElementById('ncChatInput').addEventListener('input', e => {
        e.target.style.height = 'auto';
        e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
    });
    document.getElementById('ncChatIdeaConfirm').addEventListener('click', () => {
        if (_ncChatIdea) {
            _ncIdeaText = _ncChatIdea;
            // 현재 대화를 prev로 보관하고 초기화
            if (_ncChatMessages.length > 0) {
                localStorage.setItem('creatorhub_ai_chat_prev', JSON.stringify(_ncChatMessages));
            }
            _ncChatMessages = [];
            _ncChatIdea = '';
            localStorage.removeItem('creatorhub_ai_chat');
            _ncCurrentStep = 1;
            ncRenderStep();
        }
    });
    document.getElementById('ncNewChatBtn').addEventListener('click', ncNewChat);

    // YouTube 외 플랫폼 카드에 coming-soon 스타일 적용
    document.querySelectorAll('#ncPlatformGrid .nc-option-card').forEach(card => {
        if (card.dataset.value !== 'youtube') card.classList.add('coming-soon');
    });

    // Option card selection (platform, type)
    document.querySelectorAll('.nc-option-card').forEach(card => {
        card.addEventListener('click', (e) => {
            if (e.target.type === 'radio') return; // label→input synthetic click 버블링 무시
            const grid = card.closest('.nc-option-grid');
            if (grid.id === 'ncPlatformGrid' && card.dataset.value !== 'youtube') {
                toast(t('toast.comingSoon'));
                return;
            }
            grid.querySelectorAll('.nc-option-card').forEach(c => c.classList.remove('active'));
            card.classList.add('active');
            card.querySelector('input[type="radio"]').checked = true;
        });
    });

    // Enter key on title input → next
    document.getElementById('ncTitle').addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); ncNext(); }
    });

}

export function openAddContent(date) {
    _ncCurrentStep = 0;
    _ncIdeaText = '';
    // localStorage에서 이전 대화 복원
    const savedChat = localStorage.getItem('creatorhub_ai_chat');
    if (savedChat) {
        try { _ncChatMessages = JSON.parse(savedChat); } catch { _ncChatMessages = []; }
    } else {
        _ncChatMessages = [];
    }
    _ncChatIdea = '';
    _ncChatLoading = false;

    document.getElementById('ncTitle').value = '';
    document.getElementById('ncDate').value = date || '';
    document.getElementById('ncMemo').value = '';
    // Reset platform selection to youtube
    document.querySelectorAll('#ncPlatformGrid .nc-option-card').forEach(c => c.classList.remove('active'));
    document.querySelector('#ncPlatformGrid .nc-option-card[data-value="youtube"]').classList.add('active');
    document.querySelector('input[name="ncPlatform"][value="youtube"]').checked = true;

    // Reset type selection to long
    document.querySelectorAll('#ncTypeGrid .nc-option-card').forEach(c => c.classList.remove('active'));
    document.querySelector('#ncTypeGrid .nc-option-card[data-value="long"]').classList.add('active');
    document.querySelector('input[name="ncType"][value="long"]').checked = true;

    ncRenderStep();
    ncRenderChat();
    switchTab('newcontent');
    setTimeout(() => document.getElementById('ncChatInput').focus(), 100);
}

function ncNext() {
    if (_ncCurrentStep === 0) {
        // AI 확정 아이디어 우선, 없으면 마지막 user 메시지, 그것도 없으면 차단
        if (!_ncIdeaText) {
            if (_ncChatIdea) {
                _ncIdeaText = _ncChatIdea;
            } else if (_ncChatMessages.length > 0) {
                const lastUser = [..._ncChatMessages].reverse().find(m => m.role === 'user');
                _ncIdeaText = lastUser ? lastUser.content : '';
            }
        }
        if (!_ncIdeaText) {
            toast('아이디어를 입력해주세요');
            document.getElementById('ncChatInput').focus();
            return;
        }
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

// ===== AI Chat =====

function ncBuildContext() {
    const ctx = {};

    // 채널 정보
    const subsEl = document.getElementById('ytSubscribers');
    const viewsEl = document.getElementById('ytTotalViews');
    const countEl = document.getElementById('ytVideoCount');
    const channelInfo = document.querySelector('.yt-channel-name');
    if (channelInfo && subsEl) {
        ctx.channel = {
            name: channelInfo.textContent.trim().split('\n')[0],
            subscribers: subsEl.textContent.trim(),
            totalViews: viewsEl?.textContent.trim(),
            videoCount: countEl?.textContent.trim()
        };
    }

    // 최근 영상 (조회수 상위 10개)
    if (state.ytVideos && state.ytVideos.length > 0) {
        const sorted = [...state.ytVideos].sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0));
        ctx.recentVideos = sorted.slice(0, 10).map(v => ({
            title: v.title,
            views: v.viewCount
        }));
    }

    // 현재 콘텐츠 파이프라인
    if (state.contents && state.contents.length > 0) {
        ctx.pipeline = state.contents.slice(-10).map(c => ({
            title: c.title,
            status: c.status
        }));
    }

    // 이전 대화 기록 (크로스 세션 맥락 유지)
    const prev = localStorage.getItem('creatorhub_ai_chat_prev');
    if (prev) {
        try { ctx.previousChat = JSON.parse(prev).slice(-20); } catch { /* ignore */ }
    }

    return Object.keys(ctx).length > 0 ? ctx : null;
}

function ncRenderChat() {
    const messagesEl = document.getElementById('ncChatMessages');
    const ideaBar = document.getElementById('ncChatIdeaBar');

    if (_ncChatMessages.length === 0) {
        messagesEl.innerHTML = `
            <div class="nc-chat-welcome">
                <div class="nc-chat-ai-avatar">AI</div>
                <div class="nc-chat-bubble nc-chat-bubble-ai">
                    어떤 콘텐츠를 만들고 싶으신가요? 막연한 아이디어라도 괜찮아요. 함께 구체화해 드릴게요!
                </div>
            </div>`;
    } else {
        messagesEl.innerHTML = _ncChatMessages.map(m => {
            if (m.role === 'user') {
                return `<div class="nc-chat-row nc-chat-row-user">
                    <div class="nc-chat-bubble nc-chat-bubble-user">${escapeHtml(m.content)}</div>
                </div>`;
            } else {
                // Strip [IDEA_READY: ...] from display
                const display = m.content.replace(/\[IDEA_READY:[^\]]*\]/g, '').trim();
                const formatted = escapeHtml(display)
                    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                    .replace(/\n/g, '<br>');
                return `<div class="nc-chat-row nc-chat-row-ai">
                    <div class="nc-chat-ai-avatar">AI</div>
                    <div class="nc-chat-bubble nc-chat-bubble-ai">${formatted}</div>
                </div>`;
            }
        }).join('');

        if (_ncChatLoading) {
            messagesEl.innerHTML += `<div class="nc-chat-row nc-chat-row-ai">
                <div class="nc-chat-ai-avatar">AI</div>
                <div class="nc-chat-bubble nc-chat-bubble-ai nc-chat-typing">
                    <span></span><span></span><span></span>
                </div>
            </div>`;
        }
    }

    messagesEl.scrollTop = messagesEl.scrollHeight;

    // 아이디어 확정 바
    if (_ncChatIdea) {
        ideaBar.classList.add('active');
        document.getElementById('ncChatIdeaText').textContent = _ncChatIdea;
    } else {
        ideaBar.classList.remove('active');
    }

    // 전송 버튼 상태
    document.getElementById('ncChatSend').disabled = _ncChatLoading;
    document.getElementById('ncChatInput').disabled = _ncChatLoading;
}

async function ncChatSend() {
    const input = document.getElementById('ncChatInput');
    const text = input.value.trim();
    if (!text || _ncChatLoading) return;

    input.value = '';
    input.style.height = 'auto';

    _ncChatMessages.push({ role: 'user', content: text });
    _ncChatLoading = true;
    ncRenderChat();

    const platform = document.querySelector('input[name="ncPlatform"]:checked')?.value || 'youtube';
    const contentType = document.querySelector('input[name="ncType"]:checked')?.value || 'long';

    // 채널 + 콘텐츠 컨텍스트 수집
    const context = ncBuildContext();

    try {
        const res = await fetch('/api/ai/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: _ncChatMessages, platform, contentType, context })
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        _ncChatMessages.push({ role: 'assistant', content: data.content });
        if (data.idea) _ncChatIdea = data.idea;
    } catch (err) {
        toast('AI 응답 오류: ' + err.message);
        _ncChatMessages.pop(); // 실패한 user 메시지 롤백
    } finally {
        _ncChatLoading = false;
        saveChatHistory();
        ncRenderChat();
        if (!_ncChatIdea) document.getElementById('ncChatInput').focus();
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
        const titleInput = document.getElementById('ncTitle');
        if (!titleInput.value.trim()) titleInput.value = _ncIdeaText;
        setTimeout(() => titleInput.focus(), 100);
    }
    if (_ncCurrentStep === 2) {
        // Update review card
        ncUpdateReviewCard();
    }
}



function ncUpdateReviewCard() {
    const title = document.getElementById('ncTitle').value.trim();
    const platform = document.querySelector('input[name="ncPlatform"]:checked')?.value || 'youtube';
    const contentType = document.querySelector('input[name="ncType"]:checked')?.value || 'long';
    const date = document.getElementById('ncDate').value;
    const platformLabels = { youtube: 'YouTube', instagram: 'Instagram', tiktok: 'TikTok', blog: 'Blog', other: t('platform.other') };

    document.getElementById('ncReviewTitle').textContent = title || '-';
    document.getElementById('ncReviewPlatform').textContent = platformLabels[platform] || platform;
    document.getElementById('ncReviewType').textContent = t('type.' + contentType) || contentType;
    document.getElementById('ncReviewDate').textContent = date || t('nc.review.dateNone');
}

function ncSave() {
    const title = document.getElementById('ncTitle').value.trim();
    if (!title) { toast(t('toast.titleRequired')); return; }

    const platform = document.querySelector('input[name="ncPlatform"]:checked').value;
    const contentType = document.querySelector('input[name="ncType"]:checked').value;
    const memo = document.getElementById('ncMemo').value.trim();

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

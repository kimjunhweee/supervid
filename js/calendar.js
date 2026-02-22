// ===== Calendar =====
import { state } from './state.js';
import { escapeHtml } from './utils.js';
import { openAddContent } from './newcontent.js';
import { openEditContent } from './kanban.js';

export function setupCalendar() {
    document.getElementById('prevMonth').addEventListener('click', () => {
        state.calendarDate.setMonth(state.calendarDate.getMonth() - 1); renderCalendar();
    });
    document.getElementById('nextMonth').addEventListener('click', () => {
        state.calendarDate.setMonth(state.calendarDate.getMonth() + 1); renderCalendar();
    });
}

export function renderCalendar() {
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

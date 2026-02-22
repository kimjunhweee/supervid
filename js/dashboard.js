// ===== Dashboard + Area Chart =====
import { state } from './state.js';
import { parseDurationToSeconds } from './utils.js';
// Circular import (resolved at runtime):
import { switchTab } from './nav.js';

// ===== Dashboard =====
export function updateWelcomeGreeting() {
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

export function renderDashboard() {
    updateWelcomeGreeting();
    renderChart();
}

// ===== Area Chart =====
let _chartResizeTimer = null;

export function setupChart() {
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

export function renderChart() {
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

export function handleChartHover(e) {
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

export function handleChartLeave() {
    _chartHoverIdx = -1;
    renderChart();
}

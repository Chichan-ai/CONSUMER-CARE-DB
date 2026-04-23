'use strict';

// =============================================
// SUPABASE CONFIG
// =============================================
const SUPABASE_URL      = 'https://mvghegfopkdnrcdkpdws.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im12Z2hlZ2ZvcGtkbnJjZGtwZHdzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3NDY2NDIsImV4cCI6MjA5MjMyMjY0Mn0.ktte6GZT6YCcP1cPOI7xU8vzoQ-Zw_Ju9tfwUEk1Ofw';

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// =============================================
// GLOBAL STATE
// =============================================
let cachedTickets        = [];
let cachedUsers          = [];
let currentDashboardData = [];
let myChart              = null;
let branchChart          = null;
let engagementChart      = null;

// =============================================
// INITIALIZATION — wait for DOM
// =============================================
document.addEventListener('DOMContentLoaded', () => {
    // FIX: password toggle attached here, after DOM is ready
    const toggleBtn     = document.getElementById('toggleBtn');
    const passwordInput = document.getElementById('password');
    const eyeIcon       = document.getElementById('eyeIcon');

    if (toggleBtn && passwordInput && eyeIcon) {
        toggleBtn.addEventListener('click', () => {
            const isPassword = passwordInput.type === 'password';
            passwordInput.type = isPassword ? 'text' : 'password';
            eyeIcon.textContent = isPassword ? '🙈' : '👁️';
        });
    }

    // Enter key on login
    document.addEventListener('keypress', (e) => {
        const loginSection = document.getElementById('login-section');
        if (e.key === 'Enter' && loginSection && !loginSection.classList.contains('hidden')) {
            handleLogin();
        }
    });

    // Apply saved theme
    const savedTheme = localStorage.getItem('theme') || 'dark';
    document.body.className = savedTheme;
    const themeIcon = document.getElementById('theme-icon');
    if (themeIcon) themeIcon.textContent = savedTheme === 'dark' ? '☀️' : '🌙';

    // Night shift subtle filter
    const h = new Date().getHours();
    if (h < 5 || h >= 23) document.body.classList.add('night-shift');

    // Check session
    const isLoggedIn = localStorage.getItem('isLoggedIn');
    if (isLoggedIn === 'true') {
        showDashboard();
        initializeAppData();
    } else {
        document.getElementById('login-section').classList.remove('hidden');
    }
});

// Reset session timer on click
document.addEventListener('click', () => {
    if (localStorage.getItem('isLoggedIn') === 'true') {
        localStorage.setItem('loginTimestamp', Date.now());
    }
});

function initializeAppData() {
    const u  = localStorage.getItem('username') || '—';
    const el = document.getElementById('sidebar-user');
    if (el) el.textContent = u;

    // FIX: checkAdminAccess MUST run before showPage so nav-admin
    // is un-hidden before we try to navigate to 'admin'
    checkAdminAccess();

    const savedPage = localStorage.getItem('activePage') || 'dashboard';
    showPage(savedPage);

    loadData();
    loadKioskData();

    const ticketForm = document.getElementById('ticketForm');
    if (ticketForm) ticketForm.onsubmit = handleFormSubmit;

    setInterval(checkSession, 30000);

    // ── v2.0: Show top bar, set user in audit label ──
    const topBar = document.getElementById('top-bar');
    if (topBar) topBar.classList.remove('hidden');

    // Log session start
    logAudit('SESSION_START', `User ${localStorage.getItem('username')||'UNKNOWN'} logged in`, 'login');
    updateAuditCount();

    // Periodic SLA alerting every 5 min
    setInterval(() => {
        if (cachedTickets.length > 0) updateExtendedKPIs(cachedTickets);
    }, 300000);
}

// =============================================
// LOGIN
// =============================================
async function handleLogin() {
    const user     = (document.getElementById('username').value || '').trim().toUpperCase();
    const pass     = document.getElementById('password').value || '';
    const errorMsg = document.getElementById('login-error');
    const btn      = document.getElementById('loginBtn');

    errorMsg.classList.add('hidden');

    if (!user || !pass) {
        errorMsg.innerText = 'CREDENTIALS REQUIRED';
        errorMsg.classList.remove('hidden');
        return;
    }

    btn.innerHTML = '<div class="spinner" style="width:14px;height:14px;border-width:2px;border-top-color:#040c0a;border-color:rgba(4,12,10,0.3);"></div> AUTHENTICATING...';
    btn.disabled  = true;

    try {
        const { data, error } = await db
            .from('users')
            .select('*')
            .eq('username', user)
            .eq('password', pass)
            .eq('status', 'ACTIVE')
            .single();

        if (error || !data) throw new Error('Invalid Credentials');

        localStorage.setItem('isLoggedIn',     'true');
        localStorage.setItem('loginTimestamp', Date.now());
        localStorage.setItem('username',       data.username);
        localStorage.setItem('branch',         data.branch || '');

        showDashboard();
        checkAdminAccess();
        initializeAppData();
        // Notify after data loads
        setTimeout(() => pushNotif(`🔐 Logged in as ${data.username}`, 'info'), 1500);

    } catch (err) {
        const msg = err.message === 'Invalid Credentials' ? 'INVALID CREDENTIALS' : 'CONNECTION ERROR — RETRY';
        errorMsg.innerText = msg;
        errorMsg.classList.remove('hidden');
        btn.innerHTML = 'LOGIN';
        btn.disabled  = false;
    }
}

// =============================================
// SESSION & AUTH
// =============================================
function checkAdminAccess() {
    const navAdmin    = document.getElementById('nav-admin');
    if (!navAdmin) return;
    const currentUser = (localStorage.getItem('username') || '').trim().toUpperCase();
    const isAdmin     = currentUser === 'CHRISTIAN' || currentUser.includes('ADMIN');
    navAdmin.classList.toggle('hidden', !isAdmin);
}

// FIX: Session timeout increased to 60 min (was 5 min — too short for dashboard work)
function checkSession() {
    const loginTime  = localStorage.getItem('loginTimestamp');
    const isLoggedIn = localStorage.getItem('isLoggedIn');
    if (isLoggedIn === 'true' && loginTime) {
        if (Date.now() - parseInt(loginTime) > 60 * 60 * 1000) {
            showToast('SESSION EXPIRED');
            setTimeout(forceLogout, 1200);
        }
    }
}

function forceLogout() {
    localStorage.clear();
    location.reload();
}

function handleLogout() {
    if (confirm('Are you sure you want to logout?')) {
        logAudit('SESSION_END', `User ${localStorage.getItem('username')||'UNKNOWN'} logged out`, 'login');
        localStorage.removeItem('isLoggedIn');
        localStorage.removeItem('activePage');
        location.reload();
    }
}

function showDashboard() {
    document.getElementById('login-section').classList.add('hidden');
    const main = document.getElementById('main-dashboard');
    main.classList.remove('hidden');
    main.style.display = 'flex';
}

// =============================================
// THEME
// =============================================
function toggleTheme() {
    const isDark = document.body.classList.contains('dark');
    document.body.className = isDark ? 'light' : 'dark';
    localStorage.setItem('theme', isDark ? 'light' : 'dark');
    const icon = document.getElementById('theme-icon');
    if (icon) icon.innerText = isDark ? '🌙' : '☀️';
    if (cachedTickets.length > 0) renderDashboard(cachedTickets);
}

// =============================================
// NAVIGATION
// =============================================
function showPage(page) {
    // Always sync admin nav visibility first, before any page switch
    checkAdminAccess();

    // Guard: if trying to open admin but not authorised, fall back to dashboard
    const navAdmin = document.getElementById('nav-admin');
    if (page === 'admin' && navAdmin && navAdmin.classList.contains('hidden')) {
        page = 'dashboard';
    }

    localStorage.setItem('activePage', page);
    ['dashboard','summary','report','kiosk','analytics','audit','admin'].forEach(p => {
        const pageEl = document.getElementById(`page-${p}`);
        const navEl  = document.getElementById(`nav-${p}`);
        if (pageEl) pageEl.classList.toggle('hidden', p !== page);
        if (navEl)  navEl.classList.toggle('active',  p === page);
    });
    if (page === 'report')    updateDateInput();
    if (page === 'admin')     renderUserTable();
    if (page === 'analytics') renderAnalytics();
    if (page === 'audit')     { renderAuditLog(); updateAuditCount(); }
    // Close mobile sidebar
    closeSidebar();
}

function toggleSidebar() {
    const sidebar   = document.getElementById('sidebar');
    const overlay   = document.getElementById('sidebar-overlay');
    const hamburger = document.getElementById('hamburger-btn');
    const isOpen    = sidebar.classList.toggle('open');
    overlay.classList.toggle('visible', isOpen);
    hamburger.setAttribute('aria-expanded', isOpen);
}

function closeSidebar() {
    const sidebar   = document.getElementById('sidebar');
    const overlay   = document.getElementById('sidebar-overlay');
    const hamburger = document.getElementById('hamburger-btn');
    sidebar.classList.remove('open');
    overlay.classList.remove('visible');
    if (hamburger) hamburger.setAttribute('aria-expanded', 'false');
}

// Auto-refresh admin table every 5 min if visible
setInterval(() => {
    const adminPage = document.getElementById('page-admin');
    if (adminPage && !adminPage.classList.contains('hidden')) renderUserTable();
}, 300000);

// =============================================
// LOAD DATA  — FIX: removed nested loadData(), fixed call order
// =============================================
async function loadData() {
    const loadingEl = document.getElementById('loading-state');
    if (loadingEl) loadingEl.classList.remove('hidden');

    try {
        // Get last ticket number
        const { data: lastTicketNo, error: rpcError } = await db.rpc('get_last_ticket_no');
        if (!rpcError) {
            const lastID = lastTicketNo || 0;
            const hint  = document.getElementById('last-ticket-hint');
            const input = document.getElementById('ticketNoInput');
            if (hint)  hint.innerText = lastID;
            if (input) input.value   = lastID + 1;
        }

        // Paginated ticket fetch
        let allTickets = [];
        let from       = 0;
        const batchSize = 1000;
        let hasMore     = true;

        while (hasMore) {
            const { data, error } = await db
                .from('tickets')
                .select('*')
                .order('ticket_no', { ascending: false })
                .range(from, from + batchSize - 1);

            if (error) throw error;

            if (data && data.length > 0) {
                allTickets = allTickets.concat(data);
                from += batchSize;
                hasMore = data.length === batchSize;
            } else {
                hasMore = false;
            }
        }

        // Store raw data for export (uses original DB field names)
        currentDashboardData = allTickets;

        // Map to UI-friendly keys
        cachedTickets = allTickets.map(t => ({
            TicketNo:      t.ticket_no,
            TicketTagging: t.ticket_tagging,
            DateIssued:    t.date_issued,
            DatePickedUp:  t.date_picked_up,
            DateReplied:   t.date_replied,
            Name:          t.name,
            Branch:        t.branch,
            Type:          t.type,
            Engagement:    t.engagement,
            Concerns:      t.concerns,
            Assistance:    t.assistance,
            Action:        t.action,
            Status:        t.status,
            Channel:       t.channel,
            SeverityLevel: t.severity_level,
        }));

        // Sort by TicketNo descending (newest first) — keeps JS order in sync with DB order
        cachedTickets.sort((a, b) => Number(b.TicketNo) - Number(a.TicketNo));
        // Keep raw export data in same order
        currentDashboardData.sort((a, b) => Number(b.ticket_no) - Number(a.ticket_no));

        renderDashboard(cachedTickets);
        updateSummary(cachedTickets);
        showToast(`✓ SYNCED ${allTickets.length} TICKETS`);

    } catch (err) {
        console.error('Load Error:', err);
        showToast('⚠ SYNC FAILED', true);
    } finally {
        if (loadingEl) loadingEl.classList.add('hidden');
    }
}

// =============================================
// LOAD KIOSKS
// =============================================
async function loadKioskData() {
    const table        = document.getElementById('kioskTable');
    const loader       = document.getElementById('loader');
    const tbody        = document.getElementById('tableBody');
    const countDisplay = document.getElementById('kiosk-count');

    if (!tbody) return;
    if (loader) loader.style.display = 'block';
    if (table)  table.style.display  = 'none';

    try {
        const { data: kiosks, error } = await db
            .from('kiosks')
            .select('*')
            .order('terminal_id');

        if (error) throw error;

        tbody.innerHTML = '';
        let activeCount = 0;

        kiosks.forEach(k => {
            const statusStr  = (k.status || 'OFFLINE').toUpperCase();
            const isActive   = statusStr === 'ACTIVE';
            if (isActive) activeCount++;

            const cleanDate  = k.go_live ? k.go_live.split('T')[0] : '---';
            const badgeClass = isActive ? 'badge-active' : 'badge-inactive';

            tbody.innerHTML += `
                <tr>
                    <td style="font-family:var(--font-mono);color:var(--text-muted);font-size:12px;">#${k.terminal_id || '---'}</td>
                    <td style="font-weight:500;">${k.location || '---'}</td>
                    <td style="color:var(--text-dim);font-size:12px;">${cleanDate}</td>
                    <td style="color:var(--text-dim);font-size:12px;">${k.hours || '---'}</td>
                    <td style="color:var(--text-dim);font-size:12px;">${k.address || '---'}</td>
                    <td style="color:var(--text-dim);font-size:12px;">${k.connectivity || '---'}</td>
                    <td style="color:var(--text-dim);font-size:12px;">${k.kiosk_threshold || '---'}</td>
                    <td style="text-align:right;"><span class="badge ${badgeClass}">${statusStr}</span></td>
                </tr>`;
        });

        if (countDisplay) countDisplay.innerText = activeCount.toString().padStart(2, '0');
        if (loader) loader.style.display = 'none';
        if (table)  table.style.display  = 'table';

    } catch (e) {
        console.error('Kiosk Error:', e);
        if (loader) loader.innerHTML = `
            <div style="padding:20px;color:var(--red);font-family:var(--font-mono);font-size:11px;text-align:center;">
                CONNECTION FAILED — <button onclick="loadKioskData()" class="btn btn-ghost btn-sm" style="display:inline-flex;">RETRY</button>
            </div>`;
    }
}

// =============================================
// UPDATE TICKET STATUS
// =============================================
async function updateTicketStatus(ticketNo, newStatus) {
    showToast('UPDATING...');
    try {
        const { error } = await db
            .from('tickets')
            .update({ status: newStatus })
            .eq('ticket_no', ticketNo);

        if (error) throw error;

        const index = cachedTickets.findIndex(t => t.TicketNo == ticketNo);
        if (index !== -1) {
            cachedTickets[index].Status = newStatus;
            // Also update raw data
            const rawIdx = currentDashboardData.findIndex(t => t.ticket_no == ticketNo);
            if (rawIdx !== -1) currentDashboardData[rawIdx].status = newStatus;
        }

        // Re-sort to keep display order stable after in-place update
        cachedTickets.sort((a, b) => Number(b.TicketNo) - Number(a.TicketNo));
        renderDashboard(cachedTickets);
        updateSummary(cachedTickets);
        showToast(`✓ STATUS → ${newStatus.toUpperCase()}`);
        logAudit('STATUS_CHANGED', `Ticket #${ticketNo} updated to ${newStatus.toUpperCase()}`, 'status');
        // Push notification for resolution
        if (newStatus.toUpperCase() === 'RESOLVED') {
            const t = cachedTickets.find(x => String(x.TicketNo) === String(ticketNo));
            if (t) pushNotif(`✓ Ticket #${ticketNo} (${(t.Name||'').toUpperCase()}) marked RESOLVED`, 'info', ticketNo);
        }

    } catch (err) {
        console.error('Update Error:', err);
        showToast('⚠ UPDATE FAILED', true);
    }
}

// FIX: handleStatusChange was called in populateTable but never defined
function handleStatusChange(selectEl, ticketNo) {
    const newStatus = selectEl.value;
    // Update dropdown color class
    selectEl.className = 'status-select';
    if (newStatus === 'RESOLVED') selectEl.classList.add('select-resolved');
    else if (newStatus === 'BLOCKED') selectEl.classList.add('select-blocked');
    else selectEl.classList.add('select-pending');

    updateTicketStatus(ticketNo, newStatus);
}

// =============================================
// DASHBOARD RENDERING  — FIX: removed nested loadData()
// =============================================
function renderDashboard(data) {
    const oldTotal    = parseInt(document.getElementById('stat-total').innerText)    || 0;
    const oldResolved = parseInt(document.getElementById('stat-resolved').innerText) || 0;
    const oldPending  = parseInt(document.getElementById('stat-pending').innerText)  || 0;

    const newTotal    = data.length;
    const newResolved = data.filter(t => (t.Status || '').toString().toLowerCase() === 'resolved').length;
    const newPending  = data.filter(t => (t.Status || '').toString().toLowerCase() === 'pending').length;

    animateValue(document.getElementById('stat-total'),    oldTotal,    newTotal);
    animateValue(document.getElementById('stat-resolved'), oldResolved, newResolved);
    animateValue(document.getElementById('stat-pending'),  oldPending,  newPending);

    // Avg resolution time
    const resolvedTickets = data.filter(t =>
        (t.Status || '').toString().toLowerCase() === 'resolved' && t.DateIssued && t.DateReplied
    );
    let totalMinutes = 0;
    resolvedTickets.forEach(t => {
        const diff = (new Date(t.DateReplied) - new Date(t.DateIssued)) / 60000;
        if (diff > 0) totalMinutes += diff;
    });
    const avgMin = resolvedTickets.length > 0 ? totalMinutes / resolvedTickets.length : 0;
    document.getElementById('stat-tat').innerText =
        avgMin >= 60 ? (avgMin / 60).toFixed(1) + 'h' : Math.round(avgMin) + 'm';

    // Sort newest-first before display so Live Database table always shows latest tickets on top
    const sortedForTable = [...data].sort((a, b) => Number(b.TicketNo) - Number(a.TicketNo));
    populateTable(sortedForTable.slice(0, 50));

    const catCounts    = data.reduce((acc, t) => { const k = t.Type       || 'Other';    acc[k] = (acc[k] || 0) + 1; return acc; }, {});
    const branchCounts = data.reduce((acc, t) => { const k = t.Branch     || 'Unknown';  acc[k] = (acc[k] || 0) + 1; return acc; }, {});
    const engCounts    = data.reduce((acc, t) => { const k = t.Engagement || 'Not Set';  acc[k] = (acc[k] || 0) + 1; return acc; }, {});

    updateChart(catCounts);
    updateBranchChart(branchCounts);
    updateEngagementChart(engCounts);

    // v2.0 extras
    updateExtendedKPIs(data);
    // Update analytics page if visible
    const analyticsPage = document.getElementById('page-analytics');
    if (analyticsPage && !analyticsPage.classList.contains('hidden')) renderAnalytics();
}

// XSS helper
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function populateTable(dataToDisplay) {
    const reportBody = document.getElementById('daily-report-body');
    if (!reportBody) return;

    if (!dataToDisplay || dataToDisplay.length === 0) {
        reportBody.innerHTML = `<tr><td colspan="5" style="padding:24px;text-align:center;color:var(--text-muted);font-family:var(--font-mono);font-size:11px;">NO DATA FOUND</td></tr>`;
        return;
    }

    reportBody.innerHTML = dataToDisplay.map(t => {
        const safeName   = escapeHtml((t.Name   || '---').toString());
        const safeBranch = escapeHtml((t.Branch || '---').toString());
        const tStatus    = (t.Status        || 'PENDING').toString().toUpperCase();
        const tSeverity  = (t.SeverityLevel || 'LOW').toString().toUpperCase();

        let sevClass = 'sev-low';
        if (tSeverity === 'CRITICAL') sevClass = 'sev-critical';
        else if (tSeverity === 'HIGH')     sevClass = 'sev-high';
        else if (tSeverity === 'MODERATE') sevClass = 'sev-moderate';

        const colorClass = tStatus === 'RESOLVED' ? 'select-resolved' :
                           tStatus === 'BLOCKED'  ? 'select-blocked'  : 'select-pending';

        // FIX: handleStatusChange is now defined above
        const statusDropdown = `
            <select class="status-select ${colorClass}" onchange="handleStatusChange(this, '${t.TicketNo}')">
                ${['PENDING','RESOLVED','BLOCKED'].map(opt =>
                    `<option value="${opt}" ${tStatus === opt ? 'selected' : ''}>${opt}</option>`
                ).join('')}
            </select>`;

        return `
            <tr>
                <td style="font-family:var(--font-mono);color:var(--text-muted);font-size:11px;">#${t.TicketNo || '---'}</td>
                <td style="font-weight:600;text-transform:uppercase;">${safeName}</td>
                <td style="color:var(--text-dim);font-size:12px;">${safeBranch}</td>
                <td class="${sevClass}" style="font-family:var(--font-mono);font-size:11px;">${tSeverity}</td>
                <td style="text-align:right;">${statusDropdown}</td>
            </tr>`;
    }).join('');
}

// v2.0: alias populateTable → clickable rows version
// (override after definition)
const _origPopulateTable = populateTable;
populateTable = function(dataToDisplay) { populateTableClickable(dataToDisplay); };

// =============================================
// CHARTS
// =============================================
function getChartDefaults() {
    const isLight = document.body.classList.contains('light');
    return {
        gridColor: isLight ? 'rgba(0,0,0,0.06)'    : 'rgba(255,255,255,0.06)',
        tickColor: isLight ? '#64748b'              : '#5a6478',
        isLight
    };
}

function updateChart(counts) {
    const ctx = document.getElementById('ticketChart');
    if (!ctx) return;
    const { gridColor, tickColor, isLight } = getChartDefaults();
    if (myChart) myChart.destroy();
    myChart = new Chart(ctx.getContext('2d'), {
        type: 'bar',
        data: {
            labels: Object.keys(counts),
            datasets: [{ label: 'VOLUME', data: Object.values(counts),
                backgroundColor: isLight ? '#059669' : '#00ff9d', borderRadius: 5 }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: {
                y: { grid: { color: gridColor }, ticks: { color: tickColor, font: { family: "'JetBrains Mono'" } } },
                x: { grid: { display: false },   ticks: { color: tickColor, font: { size: 9, family: "'JetBrains Mono'" } } }
            },
            plugins: { legend: { display: false } }
        }
    });
}

function updateBranchChart(counts) {
    const ctx = document.getElementById('branchChart');
    if (!ctx) return;
    const { gridColor, tickColor } = getChartDefaults();
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10);
    if (branchChart) branchChart.destroy();
    branchChart = new Chart(ctx.getContext('2d'), {
        type: 'bar',
        data: {
            labels: sorted.map(i => i[0]),
            datasets: [{ label: 'Top Branches', data: sorted.map(i => i[1]),
                backgroundColor: '#00e5c8', borderRadius: 5 }]
        },
        options: {
            indexAxis: 'y',
            responsive: true, maintainAspectRatio: false,
            scales: {
                x: { grid: { color: gridColor }, ticks: { color: tickColor, font: { family: "'JetBrains Mono'" } } },
                y: { grid: { display: false },   ticks: { color: tickColor, font: { size: 9, family: "'JetBrains Mono'" } } }
            },
            plugins: { legend: { display: false } }
        }
    });
}

function updateEngagementChart(counts) {
    const ctx = document.getElementById('engagementChart');
    if (!ctx) return;
    const { tickColor } = getChartDefaults();
    if (engagementChart) engagementChart.destroy();
    engagementChart = new Chart(ctx.getContext('2d'), {
        type: 'doughnut',
        data: {
            labels: Object.keys(counts),
            datasets: [{
                data: Object.values(counts),
                backgroundColor: ['#00ff9d','#00e5c8','#ff6b35','#ffc53d','#b47aff','#5a6478'],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { color: tickColor, font: { size: 10, family: "'JetBrains Mono'" }, padding: 16 }
                }
            },
            cutout: '68%'
        }
    });
}

// =============================================
// SUBMIT TICKET
// =============================================
async function handleFormSubmit(e) {
    e.preventDefault();
    const form = e.target;
    const btn  = document.getElementById('submitBtn');
    const requiredFields = form.querySelectorAll('[required]');
    let isValid = true;

    requiredFields.forEach(field => {
        if (!field.value.trim()) {
            field.classList.add('input-error');
            isValid = false;
        } else {
            field.classList.remove('input-error');
        }
        const eventType = field.tagName === 'SELECT' ? 'change' : 'input';
        field.addEventListener(eventType, function () {
            if (this.value.trim()) this.classList.remove('input-error');
        }, { once: true });
    });

    if (!isValid) { showToast('⚠ FILL ALL REQUIRED FIELDS', true); return; }

    const formData = new FormData(form);
    btn.innerHTML = '<div class="spinner" style="width:14px;height:14px;border-width:2px;border-top-color:#040c0a;border-color:rgba(4,12,10,0.2);"></div> TRANSMITTING...';
    btn.disabled  = true;

    try {
        const { error } = await db.from('tickets').insert([{
            ticket_no:      formData.get('ticketNo'),
            ticket_tagging: formData.get('ticketTagging'),
            date_issued:    formData.get('dateIssued')   || null,
            date_picked_up: formData.get('datePickedUp') || null,
            date_replied:   formData.get('dateReplied')  || null,
            name:           (formData.get('name') || '').toUpperCase(),
            branch:         formData.get('branch'),
            type:           formData.get('type'),
            engagement:     formData.get('engagement'),
            concerns:       formData.get('concerns'),
            assistance:     formData.get('assistance'),
            action:         formData.get('action'),
            status:         formData.get('status'),
            channel:        formData.get('channel'),
            severity_level: formData.get('severity'),
        }]);

        if (error) throw new Error(error.message);

        showToast('✓ UPLOAD COMPLETE');
        logAudit('TICKET_CREATED', `New ticket submitted via form`, 'ticket');
        pushNotif('✓ New ticket uploaded successfully', 'info');
        form.reset();
        updateDateInput();
        loadData();

    } catch (err) {
        showToast('✗ UPLOAD FAILED', true);
        console.error('Submit Error:', err.message);
    } finally {
        btn.innerHTML = 'UPLOAD TICKET';
        btn.disabled  = false;
    }
}

// =============================================
// FILTER — FIX: separated kiosk and dashboard search
// =============================================
function filterDashboardTable() {
    const input = document.getElementById('tableSearch');
    if (!input) return;
    const query = input.value.toLowerCase();
    const filtered = cachedTickets.filter(t =>
        [t.TicketNo, t.Name, t.Branch, t.Status, t.SeverityLevel]
            .join(' ').toLowerCase().includes(query)
    );
    // Keep sorted newest-first even after filtering
    filtered.sort((a, b) => Number(b.TicketNo) - Number(a.TicketNo));
    populateTable(filtered.slice(0, 50));
}

function filterKioskTable() {
    const input = document.getElementById('kioskSearchInput');
    if (!input) return;
    const query = input.value.toLowerCase();
    document.querySelectorAll('#tableBody tr').forEach(row => {
        row.style.display = row.innerText.toLowerCase().includes(query) ? '' : 'none';
    });
}

// =============================================
// SUMMARY
// =============================================
function updateSummary(tickets) {
    const now          = new Date();
    const todayStr     = now.toISOString().split('T')[0];
    const currentMonth = now.getMonth() + 1;
    const currentYear  = now.getFullYear();

    const monthlyTickets = tickets.filter(t => {
        if (!t.DateIssued) return false;
        const d = new Date(t.DateIssued);
        return d.getFullYear() === currentYear && (d.getMonth() + 1) === currentMonth;
    });

    const todayTickets  = monthlyTickets.filter(t => t.DateIssued && t.DateIssued.startsWith(todayStr));
    const daysPassed    = now.getDate();
    const resolvedCount = monthlyTickets.filter(t =>
        (t.Status || '').toString().trim().toUpperCase() === 'RESOLVED'
    ).length;
    const avgDaily = daysPassed > 0 ? Math.round(monthlyTickets.length / daysPassed) : 0;

    const updateEl = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };

    updateEl('global-monthly-total', monthlyTickets.length.toString().padStart(3, '0'));
    updateEl('ftd-ma',               todayTickets.length);
    updateEl('mt-ma',                avgDaily);
    updateEl('res-ma',               resolvedCount);
    updateEl('today-total-tag',      `${todayTickets.length} TOTAL`);

    const listBody = document.getElementById('summary-daily-list');
    const emptyMsg = document.getElementById('summary-empty-msg');

    if (listBody) {
        if (todayTickets.length === 0) {
            listBody.innerHTML = '';
            emptyMsg?.classList.remove('hidden');
        } else {
            emptyMsg?.classList.add('hidden');
            listBody.innerHTML = todayTickets.slice().reverse().map(t => {
                const status = (t.Status || '').toString().trim().toUpperCase();
                const badge  = status === 'RESOLVED'
                    ? `<span class="badge badge-resolved">RESOLVED</span>`
                    : status === 'BLOCKED'
                    ? `<span class="badge badge-blocked">BLOCKED</span>`
                    : `<span class="badge badge-pending">PENDING</span>`;
                return `
                    <tr>
                        <td style="font-family:var(--font-mono);color:var(--text-muted);font-size:11px;">#${t.TicketNo}</td>
                        <td style="font-weight:600;text-transform:uppercase;">${escapeHtml(t.Name || '---')}</td>
                        <td style="color:var(--text-dim);font-size:12px;">${escapeHtml(t.Type   || '---')}</td>
                        <td style="color:var(--text-dim);font-size:12px;">${escapeHtml(t.Branch || '---')}</td>
                        <td style="text-align:right;">${badge}</td>
                    </tr>`;
            }).join('');
        }
    }

    const dateDisplay = document.getElementById('summary-date-display');
    if (dateDisplay) dateDisplay.innerText = now.toLocaleString();
}

// =============================================
// ADMIN — USER TABLE
// =============================================
async function renderUserTable() {
    const tableBody    = document.getElementById('user-list-table');
    const countDisplay = document.getElementById('user-count');
    if (!tableBody) return;

    tableBody.innerHTML = `<tr><td colspan="5" style="padding:20px;text-align:center;font-family:var(--font-mono);font-size:11px;color:var(--text-muted);"><span class="pulse">SYNCING DATABASE...</span></td></tr>`;

    try {
        addLog('<span style="color:var(--accent)">●</span> SYNCING_LIVE_DATABASE...');
        const { data: users, error } = await db.from('users').select('*').order('username');

        if (error) throw error;

        cachedUsers = users.filter(u => u.username && u.username.trim() !== '');
        if (countDisplay) countDisplay.innerText = cachedUsers.length.toString().padStart(2, '0');

        displayUsers(cachedUsers);
        addLog('USER_SYNC_SUCCESS');

    } catch (e) {
        addLog('CRITICAL: USER_DATABASE_UNREACHABLE');
        tableBody.innerHTML = `<tr><td colspan="5" style="padding:20px;text-align:center;color:var(--red);font-family:var(--font-mono);font-size:11px;">CONNECTION_ERROR</td></tr>`;
    }
}

function filterUserTable() {
    const input = document.getElementById('user-search');
    if (!input) return;
    const term = input.value.toUpperCase();
    const filtered = cachedUsers.filter(u =>
        (u.username || '').toUpperCase().includes(term) ||
        (u.branch   || '').toUpperCase().includes(term)
    );
    displayUsers(filtered);
    const cd = document.getElementById('user-count');
    if (cd) cd.innerText = filtered.length.toString().padStart(2, '0');
}

function displayUsers(userArray) {
    const tableBody = document.getElementById('user-list-table');
    if (!tableBody) return;

    if (userArray.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="5" style="padding:20px;text-align:center;color:var(--text-muted);font-family:var(--font-mono);font-size:11px;">NO_MATCHING_RECORDS</td></tr>`;
        return;
    }

    tableBody.innerHTML = userArray.map(user => {
        const displayUser   = (user.username || 'UNKNOWN').toString().trim().toUpperCase();
        const currentStatus = (user.status   || 'ACTIVE').toString().toUpperCase();
        const branchName    = (user.branch   || 'N/A').toString().toUpperCase();
        const isAdmin       = displayUser.includes('ADMIN') || displayUser === 'CHRISTIAN';
        const roleLabel     = isAdmin ? 'ADMIN' : 'ENCODER';
        const roleClass     = isAdmin ? 'role-admin' : 'role-encoder';
        const statusBadge   = currentStatus === 'ACTIVE'
            ? `<span class="badge badge-active">[ACTIVE]</span>`
            : `<span class="badge badge-inactive">[${currentStatus}]</span>`;

        return `
        <tr>
            <td style="font-family:var(--font-mono);font-weight:700;color:${isAdmin ? 'var(--purple)' : 'var(--text)'};">${escapeHtml(displayUser)}</td>
            <td><span class="badge ${roleClass}" style="padding:3px 8px;border-radius:4px;font-size:10px;">${roleLabel}</span></td>
            <td style="color:var(--text-dim);font-size:12px;font-family:var(--font-mono);">${escapeHtml(branchName)}</td>
            <td>${statusBadge}</td>
            <td style="text-align:right;">
                <button onclick="toggleUserStatus('${escapeHtml(displayUser)}', '${currentStatus}')" class="btn btn-ghost btn-sm">TOGGLE</button>
            </td>
        </tr>`;
    }).join('');
}

async function toggleUserStatus(username, currentStatus) {
    const newStatus = currentStatus === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    const { error } = await db.from('users').update({ status: newStatus }).eq('username', username);
    if (error) { showToast('✗ TOGGLE FAILED', true); addLog(`ERROR: TOGGLE_FAILED for ${username}`); return; }
    addLog(`STATUS_UPDATED: ${username} → ${newStatus}`);
    showToast(`✓ ${username} → ${newStatus}`);
    logAudit('USER_STATUS_CHANGED', `${username} status changed to ${newStatus}`, 'user');
    renderUserTable();
}

// =============================================
// ADMIN — ADD USER
// =============================================
async function openAddUserModal() {
    const userInput = prompt('NEW USERNAME:');
    if (!userInput) return;
    const user   = userInput.trim().toUpperCase();
    const pass   = prompt('ASSIGN PASSWORD:');
    if (!pass) return;
    const branch = (prompt('ASSIGN BRANCH (e.g. PASIG, DAVAO):') || 'GENERAL').trim().toUpperCase();

    addLog(`POSTING_NEW_USER: ${user}...`);
    try {
        const { error } = await db.from('users').insert([{ username: user, password: pass, branch, status: 'ACTIVE' }]);
        if (error) throw new Error(error.message);
        addLog(`DATABASE_RECORD_CREATED: ${user}`);
        showToast(`✓ USER ${user} ADDED`);
        renderUserTable();
    } catch (e) {
        addLog(`ERROR: FAILED_TO_CREATE_USER — ${e.message}`);
        showToast('✗ FAILED TO ADD USER', true);
    }
}

// =============================================
// ADMIN — LOG STREAM
// =============================================
function addLog(message) {
    const logContainer = document.getElementById('admin-logs');
    if (!logContainer) return;
    const time     = new Date().toLocaleTimeString([], { hour12: false });
    const logEntry = document.createElement('div');
    logEntry.className = 'log-entry';
    logEntry.innerHTML = `<span class="log-time">[${time}]</span><span class="log-arrow">>></span>${message}`;
    logContainer.prepend(logEntry);
    // Keep log from growing too large
    while (logContainer.children.length > 100) logContainer.removeChild(logContainer.lastChild);
}

// =============================================
// EXPORT TO EXCEL  — FIX: now uses SheetJS for real .xlsx
// =============================================
function downloadExcel() {
    if (!currentDashboardData || currentDashboardData.length === 0) {
        showToast('⚠ NO DATA TO EXPORT', true);
        return;
    }

    showToast('⏳ PREPARING EXPORT...');

    try {
        // Build worksheet data with human-readable headers
        const headers = {
            ticket_no:      'Ticket No',
            ticket_tagging: 'Ticket Tagging',
            date_issued:    'Date Issued',
            date_picked_up: 'Date Picked Up',
            date_replied:   'Date Replied',
            name:           'Customer Name',
            branch:         'Branch',
            type:           'Ticket Type',
            engagement:     'Engagement Type',
            concerns:       'Client Concern',
            assistance:     'Assistance Provided',
            action:         'Action Taken',
            status:         'Status',
            channel:        'Channel',
            severity_level: 'Severity Level',
        };

        const dbKeys = Object.keys(headers);

        // Header row
        const wsData = [Object.values(headers)];

        // Data rows
        currentDashboardData.forEach(row => {
            wsData.push(dbKeys.map(k => {
                const v = row[k];
                if (v === null || v === undefined) return '';
                return v;
            }));
        });

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(wsData);

        // Style header row width
        ws['!cols'] = dbKeys.map((k, i) => ({
            wch: Math.max(headers[dbKeys[i]].length + 4, 18)
        }));

        XLSX.utils.book_append_sheet(wb, ws, 'Tickets');

        // Summary sheet
        const now          = new Date();
        const month        = now.getMonth() + 1;
        const year         = now.getFullYear();
        const totalTickets = currentDashboardData.length;
        const resolved     = currentDashboardData.filter(t => (t.status || '').toUpperCase() === 'RESOLVED').length;
        const pending      = currentDashboardData.filter(t => (t.status || '').toUpperCase() === 'PENDING').length;

        const summaryData = [
            ['AGRIBANK CONSUMER CARE — EXPORT SUMMARY'],
            [],
            ['Generated',  now.toLocaleString()],
            ['Period',     `${year}-${String(month).padStart(2,'0')}`],
            ['Total Tickets', totalTickets],
            ['Resolved',   resolved],
            ['Pending',    pending],
            ['Export By',  localStorage.getItem('username') || 'UNKNOWN'],
        ];

        const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
        wsSummary['!cols'] = [{ wch: 22 }, { wch: 30 }];
        XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

        const filename = `AGRIBANK_EXPORT_${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}.xlsx`;
        XLSX.writeFile(wb, filename);

        showToast(`✓ EXPORTED ${totalTickets} RECORDS`);
        logAudit('EXPORT_EXCEL', `${totalTickets} tickets exported to ${filename}`, 'export');
        addLog(`EXPORT_SUCCESS: ${totalTickets} rows → ${filename}`);

    } catch (err) {
        console.error('Export Error:', err);
        showToast('✗ EXPORT FAILED', true);
    }
}

// =============================================
// UTILITIES
// =============================================
function updateDateInput() {
    const el = document.getElementById('dateIssuedInput');
    if (el) {
        const now = new Date();
        now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
        el.value = now.toISOString().slice(0, 16);
    }
}

function refreshDashboardData() {
    loadData();
    loadKioskData();
    showToast('✓ REFRESHING...');
}

function animateValue(el, start, end, duration = 700) {
    if (!el || start === end) { if (el) el.innerText = end; return; }
    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        const eased    = 1 - Math.pow(1 - progress, 3);
        el.innerText   = Math.floor(eased * (end - start) + start);
        if (progress < 1) window.requestAnimationFrame(step);
    };
    window.requestAnimationFrame(step);
}

function showToast(message, isError = false) {
    document.querySelector('.toast')?.remove();
    const toast = document.createElement('div');
    toast.className = 'toast' + (isError ? ' toast-error' : '');
    toast.innerText = message;
    document.body.appendChild(toast);
    setTimeout(() => toast?.remove(), 2500);
}


// =============================================
// v2.0 — EXTENDED GLOBAL STATE
// =============================================
let auditLog         = [];   // In-memory audit log
let notifications    = [];   // In-memory notification queue
let ticketNotes      = {};   // { ticketNo: [{ user, note, ts }] }
let currentTicket    = null; // Ticket currently open in modal
let activeFilter     = 'all';
let trendChart       = null;
let tatDistChart     = null;
let severityChart    = null;
let channelChart     = null;

// =============================================
// AUDIT TRAIL — Append + Render
// =============================================
function logAudit(action, detail, type = 'ticket') {
    const entry = {
        id:        Date.now() + Math.random(),
        action,
        detail,
        type,      // ticket | status | user | export | login | system
        user:      localStorage.getItem('username') || 'SYSTEM',
        ts:        new Date().toISOString(),
        tsDisplay: new Date().toLocaleString('en-PH', { hour12: false }),
    };
    auditLog.unshift(entry);
    if (auditLog.length > 500) auditLog.pop();
    renderAuditLog();
    updateAuditCount();
}

function renderAuditLog(filtered) {
    const container = document.getElementById('audit-log-container');
    if (!container) return;
    const entries = filtered || auditLog;
    if (entries.length === 0) {
        container.innerHTML = '<div style="text-align:center;padding:32px;font-family:var(--font-mono);font-size:10px;color:var(--text-muted);">NO AUDIT EVENTS</div>';
        return;
    }
    const iconMap = { ticket:'📋', status:'🔄', user:'👤', export:'📊', login:'🔐', system:'⚙️' };
    const classMap = { ticket:'', status:'orange', user:'blue', export:'', login:'', system:'red' };
    container.innerHTML = entries.map(e => `
        <div class="audit-entry" data-type="${e.type}" id="ae-${e.id}">
            <div class="audit-icon ${classMap[e.type] || ''}">${iconMap[e.type] || '📌'}</div>
            <div class="audit-body">
                <div class="audit-action">${escapeHtml(e.action)}</div>
                <div class="audit-detail">${escapeHtml(e.detail)}</div>
                <div class="audit-timestamp">[${e.tsDisplay}] · USER: ${escapeHtml(e.user)}</div>
            </div>
        </div>`).join('');
}

function filterAuditLog() {
    const typeFilter = document.getElementById('audit-filter-type')?.value || 'all';
    const searchVal  = (document.getElementById('audit-search')?.value || '').toLowerCase();
    let filtered = auditLog;
    if (typeFilter !== 'all') filtered = filtered.filter(e => e.type === typeFilter);
    if (searchVal) filtered = filtered.filter(e =>
        e.action.toLowerCase().includes(searchVal) || e.detail.toLowerCase().includes(searchVal)
    );
    renderAuditLog(filtered);
    updateAuditCount(filtered.length);
}

function updateAuditCount(count) {
    const el = document.getElementById('audit-total-count');
    if (el) el.textContent = (count !== undefined ? count : auditLog.length);
    const sessionEl = document.getElementById('audit-session-user');
    if (sessionEl) sessionEl.textContent = localStorage.getItem('username') || '--';
}

function clearAuditLog() {
    if (!confirm('Clear audit log from this session?')) return;
    auditLog = [];
    renderAuditLog();
    updateAuditCount();
}

function exportAuditLog() {
    if (auditLog.length === 0) { showToast('⚠ AUDIT LOG EMPTY', true); return; }
    const wsData = [['Timestamp','Action','Detail','User','Type']];
    auditLog.forEach(e => wsData.push([e.tsDisplay, e.action, e.detail, e.user, e.type]));
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws['!cols'] = [{ wch:22 },{ wch:30 },{ wch:50 },{ wch:18 },{ wch:12 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Audit Log');
    XLSX.writeFile(wb, `AUDIT_LOG_${new Date().toISOString().split('T')[0]}.xlsx`);
    showToast('✓ AUDIT LOG EXPORTED');
    logAudit('EXPORT_AUDIT_LOG', `${auditLog.length} events exported`, 'export');
}

// =============================================
// NOTIFICATIONS — Push + Render
// =============================================
function pushNotif(msg, type = 'info', ticketNo = null) {
    // type: info | warning | critical
    const n = { id: Date.now() + Math.random(), msg, type, ticketNo, ts: new Date(), read: false };
    notifications.unshift(n);
    if (notifications.length > 50) notifications.pop();
    renderNotifPanel();
    updateNotifBadge();
}

function renderNotifPanel() {
    const list = document.getElementById('notif-list');
    if (!list) return;
    const unread = notifications.filter(n => !n.read);
    if (notifications.length === 0) {
        list.innerHTML = '<div style="padding:24px;text-align:center;font-family:var(--font-mono);font-size:10px;color:var(--text-muted);">NO NOTIFICATIONS</div>';
        return;
    }
    const dotColor = { info:'var(--accent)', warning:'var(--orange)', critical:'var(--red)' };
    list.innerHTML = notifications.map(n => `
        <div class="notif-item ${n.read ? '' : (n.type === 'critical' ? 'unread-red' : 'unread')}" onclick="readNotif(${n.id})">
            <div class="notif-dot" style="background:${dotColor[n.type]||'var(--accent)'}; ${n.type==='critical'?'animation:pulse-dot 1.5s infinite':''}"></div>
            <div>
                <div class="notif-msg">${escapeHtml(n.msg)}</div>
                <div class="notif-time">${timeAgo(n.ts)}</div>
            </div>
        </div>`).join('');
}

function readNotif(id) {
    const n = notifications.find(n => n.id === id);
    if (n) { n.read = true; if (n.ticketNo) openTicketModal(n.ticketNo); }
    renderNotifPanel();
    updateNotifBadge();
}

function updateNotifBadge() {
    const count  = notifications.filter(n => !n.read).length;
    const badge  = document.getElementById('notif-badge');
    if (badge) { badge.style.display = count > 0 ? 'flex' : 'none'; badge.textContent = count > 9 ? '9+' : count; }
}

function toggleNotifPanel() {
    const panel = document.getElementById('notif-panel');
    if (!panel) return;
    panel.classList.toggle('open');
    if (panel.classList.contains('open')) {
        // mark all as read when opened
        notifications.forEach(n => n.read = true);
        renderNotifPanel();
        updateNotifBadge();
    }
}

function clearAllNotifs() {
    notifications = [];
    renderNotifPanel();
    updateNotifBadge();
    const panel = document.getElementById('notif-panel');
    if (panel) panel.classList.remove('open');
}

// Close notif panel + search when clicking outside
document.addEventListener('click', e => {
    const panel = document.getElementById('notif-panel');
    const btn   = document.getElementById('notif-btn');
    if (panel && !panel.contains(e.target) && e.target !== btn && !btn?.contains(e.target)) {
        panel.classList.remove('open');
    }
    const sp = document.getElementById('search-results-panel');
    const gs = document.getElementById('global-search');
    if (sp && !sp.contains(e.target) && e.target !== gs) sp.classList.remove('open');
});

// =============================================
// GLOBAL SEARCH
// =============================================
function handleGlobalSearch(val) {
    const panel = document.getElementById('search-results-panel');
    if (!panel) return;
    if (!val || val.length < 2) { panel.classList.remove('open'); return; }
    const q = val.toLowerCase();
    const results = cachedTickets.filter(t =>
        String(t.TicketNo).toLowerCase().includes(q) ||
        (t.Name || '').toLowerCase().includes(q) ||
        (t.Branch || '').toLowerCase().includes(q) ||
        (t.Type || '').toLowerCase().includes(q) ||
        (t.Concerns || '').toLowerCase().includes(q)
    ).slice(0, 8);
    if (results.length === 0) {
        panel.innerHTML = '<div style="padding:16px;font-family:var(--font-mono);font-size:10px;color:var(--text-muted);text-align:center;">NO RESULTS</div>';
    } else {
        const sevColor = { CRITICAL:'var(--red)', HIGH:'var(--orange)', MODERATE:'var(--yellow)', LOW:'var(--blue)' };
        panel.innerHTML = results.map(t => `
            <div class="search-result-item" onclick="openTicketModal(${t.TicketNo})">
                <div style="font-family:var(--font-mono);font-size:10px;color:var(--text-muted);min-width:44px;">#${t.TicketNo}</div>
                <div style="flex:1;">
                    <div style="font-size:12px;font-weight:600;">${escapeHtml((t.Name||'---').toUpperCase())}</div>
                    <div style="font-family:var(--font-mono);font-size:9px;color:var(--text-muted);">${escapeHtml(t.Branch||'---')} · ${escapeHtml(t.Type||'---')}</div>
                </div>
                <div style="font-family:var(--font-mono);font-size:9px;font-weight:700;color:${sevColor[(t.SeverityLevel||'').toUpperCase()]||'var(--text-dim)'};">${(t.SeverityLevel||'').toUpperCase()}</div>
            </div>`).join('');
    }
    panel.classList.add('open');
}

function openSearchPanel() {
    const gs = document.getElementById('global-search');
    if (gs && gs.value.length >= 2) handleGlobalSearch(gs.value);
}

// =============================================
// FILTER CHIPS — Dashboard
// =============================================
function applyFilter(filter, btn) {
    activeFilter = filter;
    document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
    if (btn) btn.classList.add('active');
    let filtered = [...cachedTickets];
    const today = new Date().toISOString().split('T')[0];
    if (filter === 'pending')  filtered = filtered.filter(t => (t.Status||'').toLowerCase() === 'pending');
    if (filter === 'resolved') filtered = filtered.filter(t => (t.Status||'').toLowerCase() === 'resolved');
    if (filter === 'critical') filtered = filtered.filter(t => (t.SeverityLevel||'').toUpperCase() === 'CRITICAL');
    if (filter === 'today')    filtered = filtered.filter(t => t.DateIssued && t.DateIssued.startsWith(today));
    filtered.sort((a, b) => Number(b.TicketNo) - Number(a.TicketNo));
    populateTable(filtered.slice(0, 50));
    const label = document.getElementById('filter-count-label');
    if (label) label.textContent = `${filtered.length} RECORDS`;
    logAudit('FILTER_APPLIED', `Filter: ${filter.toUpperCase()} — ${filtered.length} records`, 'system');
}

// =============================================
// TICKET DETAIL MODAL
// =============================================
function openTicketModal(ticketNo) {
    const t = cachedTickets.find(x => String(x.TicketNo) === String(ticketNo));
    if (!t) { showToast('⚠ TICKET NOT FOUND', true); return; }
    currentTicket = t;
    const modal = document.getElementById('ticket-modal');

    // Populate fields
    document.getElementById('modal-ticket-no').textContent  = '#' + (t.TicketNo || '---');
    document.getElementById('modal-name').textContent       = (t.Name || '---').toUpperCase();
    document.getElementById('modal-branch').textContent     = t.Branch || '---';
    document.getElementById('modal-channel').textContent    = t.Channel || '---';
    document.getElementById('modal-type').textContent       = t.Type || '---';
    document.getElementById('modal-engagement').textContent = t.Engagement || '---';
    document.getElementById('modal-action').textContent     = t.Action || '---';
    document.getElementById('modal-concern').textContent    = t.Concerns || '---';
    document.getElementById('modal-assistance').textContent = t.Assistance || '---';
    document.getElementById('modal-date-issued').textContent = t.DateIssued ? new Date(t.DateIssued).toLocaleString('en-PH',{hour12:false}) : '---';
    document.getElementById('modal-pickup').textContent     = t.DatePickedUp ? new Date(t.DatePickedUp).toLocaleString('en-PH',{hour12:false}) : '---';
    document.getElementById('modal-replied').textContent    = t.DateReplied ? new Date(t.DateReplied).toLocaleString('en-PH',{hour12:false}) : '---';

    // Severity badge
    const sevEl = document.getElementById('modal-severity');
    if (sevEl) {
        const sevColor = { CRITICAL:'var(--red)', HIGH:'var(--orange)', MODERATE:'var(--yellow)', LOW:'var(--blue)' };
        sevEl.textContent = (t.SeverityLevel || 'LOW').toUpperCase();
        sevEl.style.color = sevColor[(t.SeverityLevel||'low').toUpperCase()] || 'var(--blue)';
        sevEl.style.fontWeight = '700';
        sevEl.style.fontFamily = 'var(--font-mono)';
    }

    // Status badge
    const sb = document.getElementById('modal-status-badge');
    if (sb) {
        const s = (t.Status || 'PENDING').toUpperCase();
        sb.textContent = s;
        sb.className = 'badge ' + (s === 'RESOLVED' ? 'badge-resolved' : s === 'BLOCKED' ? 'badge-blocked' : 'badge-pending');
    }

    // TAT calculation
    const tatEl    = document.getElementById('modal-tat');
    const slaBar   = document.getElementById('modal-sla-bar');
    if (t.DateIssued && t.DateReplied) {
        const mins = (new Date(t.DateReplied) - new Date(t.DateIssued)) / 60000;
        const hrs  = mins / 60;
        if (tatEl) tatEl.textContent = hrs >= 1 ? hrs.toFixed(1) + 'h' : Math.round(mins) + 'm';
        // SLA target: CRITICAL=2h, HIGH=4h, MODERATE=8h, LOW=24h
        const slaTarget = { CRITICAL:120, HIGH:240, MODERATE:480, LOW:1440 };
        const target = slaTarget[(t.SeverityLevel||'LOW').toUpperCase()] || 480;
        const pct = Math.min((mins / target) * 100, 100);
        if (slaBar) { slaBar.style.width = pct + '%'; slaBar.style.background = pct > 90 ? 'var(--red)' : pct > 70 ? 'var(--orange)' : 'var(--accent)'; }
    } else {
        if (tatEl) tatEl.textContent = 'OPEN';
        if (slaBar) slaBar.style.width = '0%';
    }

    // Interaction notes
    renderModalNotes(ticketNo);
    if (modal) modal.classList.add('open');
    logAudit('TICKET_VIEWED', `Ticket #${ticketNo} — ${(t.Name||'---').toUpperCase()} opened for review`, 'ticket');
}

function closeTicketModal() {
    const modal = document.getElementById('ticket-modal');
    if (modal) modal.classList.remove('open');
    const ni = document.getElementById('note-input');
    if (ni) ni.value = '';
    currentTicket = null;
}

function modalChangeStatus(newStatus) {
    if (!currentTicket) return;
    handleStatusChange({ value: newStatus, className: 'status-select', classList: { add:()=>{}, remove:()=>{} } }, currentTicket.TicketNo);
    // Update modal badge immediately
    const sb = document.getElementById('modal-status-badge');
    if (sb) { sb.textContent = newStatus; sb.className = 'badge ' + (newStatus === 'RESOLVED' ? 'badge-resolved' : newStatus === 'BLOCKED' ? 'badge-blocked' : 'badge-pending'); }
    logAudit('STATUS_CHANGED', `Ticket #${currentTicket.TicketNo} → ${newStatus}`, 'status');
    closeTicketModal();
}

function copyTicketInfo() {
    if (!currentTicket) return;
    const t = currentTicket;
    const text = `TICKET #${t.TicketNo}
Client: ${t.Name||'---'}
Branch: ${t.Branch||'---'}
Type: ${t.Type||'---'}
Status: ${t.Status||'---'}
Severity: ${t.SeverityLevel||'---'}
Concern: ${t.Concerns||'---'}`;
    navigator.clipboard?.writeText(text).then(() => showToast('✓ COPIED TO CLIPBOARD')).catch(() => showToast('⚠ COPY FAILED', true));
}

// ── Interaction Notes ──
function renderModalNotes(ticketNo) {
    const container = document.getElementById('modal-interaction-log');
    const countEl   = document.getElementById('modal-log-count');
    const notes     = ticketNotes[ticketNo] || [];
    if (countEl) countEl.textContent = `${notes.length} NOTE${notes.length !== 1 ? 'S' : ''}`;
    if (!container) return;
    if (notes.length === 0) {
        container.innerHTML = '<div style="text-align:center;padding:16px;font-family:var(--font-mono);font-size:10px;color:var(--text-muted);">NO NOTES YET</div>';
        return;
    }
    container.innerHTML = notes.map(n => `
        <div class="interaction-entry">
            <div class="interaction-meta">
                <span style="color:var(--accent);">${escapeHtml(n.user)}</span>
                <span>·</span>
                <span>${n.tsDisplay}</span>
            </div>
            <div>${escapeHtml(n.note)}</div>
        </div>`).join('');
    container.scrollTop = container.scrollHeight;
}

function addTicketNote() {
    if (!currentTicket) return;
    const inp  = document.getElementById('note-input');
    const note = (inp?.value || '').trim();
    if (!note) { showToast('⚠ NOTE CANNOT BE EMPTY', true); return; }
    const ticketNo = currentTicket.TicketNo;
    if (!ticketNotes[ticketNo]) ticketNotes[ticketNo] = [];
    const entry = {
        user:      localStorage.getItem('username') || 'UNKNOWN',
        note,
        ts:        new Date().toISOString(),
        tsDisplay: new Date().toLocaleString('en-PH', { hour12: false }),
    };
    ticketNotes[ticketNo].push(entry);
    if (inp) inp.value = '';
    renderModalNotes(ticketNo);
    showToast('✓ NOTE ADDED');
    logAudit('NOTE_ADDED', `Ticket #${ticketNo}: "${note.slice(0,60)}..."`, 'ticket');
}

// Make ticket rows clickable in the Live Database table
function populateTableClickable(dataToDisplay) {
    const reportBody = document.getElementById('daily-report-body');
    if (!reportBody) return;
    if (!dataToDisplay || dataToDisplay.length === 0) {
        reportBody.innerHTML = `<tr><td colspan="5" style="padding:24px;text-align:center;color:var(--text-muted);font-family:var(--font-mono);font-size:11px;">NO DATA FOUND</td></tr>`;
        return;
    }
    reportBody.innerHTML = dataToDisplay.map(t => {
        const safeName   = escapeHtml((t.Name   || '---').toString());
        const safeBranch = escapeHtml((t.Branch || '---').toString());
        const tStatus    = (t.Status        || 'PENDING').toString().toUpperCase();
        const tSeverity  = (t.SeverityLevel || 'LOW').toString().toUpperCase();
        let sevClass = 'sev-low';
        if (tSeverity === 'CRITICAL') sevClass = 'sev-critical';
        else if (tSeverity === 'HIGH') sevClass = 'sev-high';
        else if (tSeverity === 'MODERATE') sevClass = 'sev-moderate';
        const colorClass = tStatus === 'RESOLVED' ? 'select-resolved' : tStatus === 'BLOCKED' ? 'select-blocked' : 'select-pending';
        const statusDropdown = `<select class="status-select ${colorClass}" onchange="handleStatusChange(this, '${t.TicketNo}')" onclick="event.stopPropagation()">${['PENDING','RESOLVED','BLOCKED'].map(opt=>`<option value="${opt}" ${tStatus===opt?'selected':''}>${opt}</option>`).join('')}</select>`;
        return `<tr style="cursor:pointer;" onclick="openTicketModal('${t.TicketNo}')">
            <td style="font-family:var(--font-mono);color:var(--text-muted);font-size:11px;">#${t.TicketNo||'---'}</td>
            <td style="font-weight:600;text-transform:uppercase;">${safeName}</td>
            <td style="color:var(--text-dim);font-size:12px;">${safeBranch}</td>
            <td class="${sevClass}" style="font-family:var(--font-mono);font-size:11px;">${tSeverity}</td>
            <td style="text-align:right;">${statusDropdown}</td>
        </tr>`;
    }).join('');
}

// =============================================
// ANALYTICS PAGE
// =============================================
function renderAnalytics() {
    if (!cachedTickets.length) return;
    const periodVal = document.getElementById('analytics-period')?.value || '30';
    let filtered = cachedTickets;
    if (periodVal !== 'all') {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - parseInt(periodVal));
        filtered = cachedTickets.filter(t => t.DateIssued && new Date(t.DateIssued) >= cutoff);
    }

    // Resolution rate
    const total    = filtered.length;
    const resolved = filtered.filter(t => (t.Status||'').toLowerCase() === 'resolved').length;
    const pending  = filtered.filter(t => (t.Status||'').toLowerCase() === 'pending').length;
    const critical = filtered.filter(t => (t.SeverityLevel||'').toUpperCase() === 'CRITICAL' && (t.Status||'').toLowerCase() !== 'resolved').length;
    const resRate  = total > 0 ? ((resolved / total) * 100).toFixed(1) : '0.0';
    const escalatedCount = filtered.filter(t => (t.Action||'').toUpperCase() === 'ESCALATED').length;

    const anResEl   = document.getElementById('an-res-rate');
    const anReopenEl = document.getElementById('an-reopen');
    if (anResEl)    animateValue(anResEl,   parseFloat(anResEl.textContent)   || 0, parseFloat(resRate));
    if (anReopenEl) animateValue(anReopenEl, parseFloat(anReopenEl.textContent) || 0, total > 0 ? parseFloat(((escalatedCount/total)*100).toFixed(1)) : 0);
    if (anResEl) setTimeout(() => { anResEl.textContent = resRate + '%'; }, 720);
    if (anReopenEl) setTimeout(() => { anReopenEl.textContent = ((escalatedCount/total)*100).toFixed(1) + '%'; }, 720);

    // AHT
    const resolvedWithTime = filtered.filter(t => (t.Status||'').toLowerCase() === 'resolved' && t.DateIssued && t.DateReplied);
    const totalMins = resolvedWithTime.reduce((sum, t) => {
        const d = (new Date(t.DateReplied) - new Date(t.DateIssued)) / 60000;
        return sum + (d > 0 ? d : 0);
    }, 0);
    const avgMins = resolvedWithTime.length ? totalMins / resolvedWithTime.length : 0;
    const ahtEl = document.getElementById('an-aht');
    if (ahtEl) ahtEl.textContent = avgMins >= 60 ? (avgMins/60).toFixed(1) + 'h' : Math.round(avgMins) + 'm';

    // Peak hour
    const hourCounts = {};
    filtered.forEach(t => {
        if (t.DateIssued) { const h = new Date(t.DateIssued).getHours(); hourCounts[h] = (hourCounts[h]||0)+1; }
    });
    const peakH = Object.entries(hourCounts).sort((a,b)=>b[1]-a[1])[0];
    const peakEl = document.getElementById('an-peak');
    if (peakEl) peakEl.textContent = peakH ? `${String(peakH[0]).padStart(2,'0')}:00` : '--:--';

    // Escalation banner
    const banner = document.getElementById('escalation-banner');
    const msg    = document.getElementById('escalation-msg');
    if (banner && msg) {
        if (critical > 0) { banner.classList.remove('hidden'); msg.textContent = `${critical} CRITICAL TICKET${critical>1?'S':''} REQUIRE IMMEDIATE ATTENTION`; }
        else banner.classList.add('hidden');
    }

    // SLA alert chip in topbar
    const slaChip  = document.getElementById('sla-alert-chip');
    const slaCount = document.getElementById('sla-count');
    if (slaChip && slaCount) {
        if (critical > 0) { slaChip.classList.remove('hidden'); slaCount.textContent = critical; }
        else slaChip.classList.add('hidden');
    }

    // Charts
    buildTrendChart(filtered);
    buildTatDistChart(filtered);
    buildSeverityChart(filtered);
    buildChannelChart(filtered);
    buildSlaTable(filtered);
}

function buildTrendChart(data) {
    const ctx = document.getElementById('trendChart');
    if (!ctx) return;
    const { gridColor, tickColor } = getChartDefaults();
    // Group by date
    const dateCounts = {};
    data.forEach(t => {
        if (t.DateIssued) {
            const d = t.DateIssued.split('T')[0];
            dateCounts[d] = (dateCounts[d]||0)+1;
        }
    });
    const sorted = Object.entries(dateCounts).sort((a,b)=>a[0].localeCompare(b[0])).slice(-30);
    if (trendChart) trendChart.destroy();
    trendChart = new Chart(ctx.getContext('2d'), {
        type: 'line',
        data: {
            labels: sorted.map(([d]) => d.slice(5)),
            datasets: [{
                label: 'Tickets',
                data: sorted.map(([,v]) => v),
                borderColor: '#00ff9d',
                backgroundColor: 'rgba(0,255,157,0.07)',
                tension: 0.4, fill: true,
                pointBackgroundColor: '#00ff9d', pointRadius: 3
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: {
                y: { grid:{ color:gridColor }, ticks:{ color:tickColor, font:{ family:"'JetBrains Mono'", size:10 } } },
                x: { grid:{ display:false }, ticks:{ color:tickColor, font:{ size:9, family:"'JetBrains Mono'" }, maxRotation:45 } }
            },
            plugins: { legend:{ display:false } }
        }
    });
}

function buildTatDistChart(data) {
    const ctx = document.getElementById('tatDistChart');
    if (!ctx) return;
    const { gridColor, tickColor } = getChartDefaults();
    const buckets = { '<1h':0, '1-4h':0, '4-8h':0, '8-24h':0, '>24h':0 };
    data.filter(t => t.DateIssued && t.DateReplied).forEach(t => {
        const h = (new Date(t.DateReplied) - new Date(t.DateIssued)) / 3600000;
        if (h < 1) buckets['<1h']++;
        else if (h < 4) buckets['1-4h']++;
        else if (h < 8) buckets['4-8h']++;
        else if (h < 24) buckets['8-24h']++;
        else buckets['>24h']++;
    });
    if (tatDistChart) tatDistChart.destroy();
    tatDistChart = new Chart(ctx.getContext('2d'), {
        type: 'bar',
        data: {
            labels: Object.keys(buckets),
            datasets: [{ label:'Tickets', data: Object.values(buckets), backgroundColor:['#00ff9d','#00e5c8','#ffc53d','#ff6b35','#ff4444'], borderRadius:5 }]
        },
        options: { responsive:true, maintainAspectRatio:false, scales:{ y:{grid:{color:gridColor},ticks:{color:tickColor,font:{family:"'JetBrains Mono'"}}}, x:{grid:{display:false},ticks:{color:tickColor,font:{family:"'JetBrains Mono'",size:10}}} }, plugins:{legend:{display:false}} }
    });
}

function buildSeverityChart(data) {
    const ctx = document.getElementById('severityChart');
    if (!ctx) return;
    const { tickColor } = getChartDefaults();
    const counts = { CRITICAL:0, HIGH:0, MODERATE:0, LOW:0 };
    data.forEach(t => { const s=(t.SeverityLevel||'LOW').toUpperCase(); if(counts[s]!==undefined) counts[s]++; });
    if (severityChart) severityChart.destroy();
    severityChart = new Chart(ctx.getContext('2d'), {
        type: 'doughnut',
        data: { labels:Object.keys(counts), datasets:[{ data:Object.values(counts), backgroundColor:['#ff4444','#ff6b35','#ffc53d','#3d9eff'], borderWidth:0 }] },
        options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'bottom', labels:{ color:tickColor, font:{ size:10, family:"'JetBrains Mono'" }, padding:12 } } }, cutout:'65%' }
    });
}

function buildChannelChart(data) {
    const ctx = document.getElementById('channelChart');
    if (!ctx) return;
    const { gridColor, tickColor } = getChartDefaults();
    const counts = {};
    data.forEach(t => { const c=t.Channel||'UNKNOWN'; counts[c]=(counts[c]||0)+1; });
    const sorted = Object.entries(counts).sort((a,b)=>b[1]-a[1]);
    if (channelChart) channelChart.destroy();
    channelChart = new Chart(ctx.getContext('2d'), {
        type:'bar',
        data:{ labels:sorted.map(([k])=>k), datasets:[{ label:'Volume', data:sorted.map(([,v])=>v), backgroundColor:'#b47aff', borderRadius:5 }] },
        options:{ indexAxis:'y', responsive:true, maintainAspectRatio:false, scales:{ x:{grid:{color:gridColor},ticks:{color:tickColor,font:{family:"'JetBrains Mono'"}}}, y:{grid:{display:false},ticks:{color:tickColor,font:{size:10,family:"'JetBrains Mono'"}}} }, plugins:{legend:{display:false}} }
    });
}

function buildSlaTable(data) {
    const tbody  = document.getElementById('sla-table-body');
    const cntEl  = document.getElementById('sla-table-count');
    if (!tbody) return;
    const now = new Date();
    // Show pending tickets sorted by age descending
    const pending = data
        .filter(t => (t.Status||'').toLowerCase() !== 'resolved' && t.DateIssued)
        .sort((a,b) => new Date(a.DateIssued) - new Date(b.DateIssued))
        .slice(0, 30);
    if (cntEl) cntEl.textContent = `${pending.length} TICKETS`;
    if (pending.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="padding:20px;text-align:center;font-family:var(--font-mono);font-size:10px;color:var(--text-muted);">ALL TICKETS RESOLVED ✓</td></tr>';
        return;
    }
    const sevColor = { CRITICAL:'sev-critical', HIGH:'sev-high', MODERATE:'sev-moderate', LOW:'sev-low' };
    tbody.innerHTML = pending.map(t => {
        const issued = new Date(t.DateIssued);
        const ageMins = (now - issued) / 60000;
        const ageStr = ageMins >= 1440 ? (ageMins/1440).toFixed(1)+'d' : ageMins >= 60 ? (ageMins/60).toFixed(1)+'h' : Math.round(ageMins)+'m';
        const isUrgent = (t.SeverityLevel||'').toUpperCase() === 'CRITICAL' && ageMins > 120;
        return `<tr style="${isUrgent?'background:rgba(255,68,68,0.05);':''} cursor:pointer;" onclick="openTicketModal('${t.TicketNo}')">
            <td style="font-family:var(--font-mono);color:var(--text-muted);font-size:11px;">#${t.TicketNo}</td>
            <td style="font-weight:600;">${escapeHtml((t.Name||'---').toUpperCase())}</td>
            <td style="color:var(--text-dim);font-size:12px;">${escapeHtml(t.Branch||'---')}</td>
            <td class="${sevColor[(t.SeverityLevel||'LOW').toUpperCase()]}" style="font-family:var(--font-mono);font-size:11px;">${(t.SeverityLevel||'LOW').toUpperCase()}</td>
            <td style="color:var(--text-dim);font-size:11px;font-family:var(--font-mono);">${issued.toLocaleDateString('en-PH')}</td>
            <td style="font-family:var(--font-mono);font-size:11px;color:${isUrgent?'var(--red)':'var(--orange)'};">${ageStr}</td>
            <td style="text-align:right;"><span class="badge badge-pending">OPEN</span></td>
        </tr>`;
    }).join('');
}

// PDF export (opens a printable window)
function downloadAnalyticsPDF() {
    showToast('⏳ GENERATING PDF...');
    const w   = window.open('', '_blank');
    const now = new Date().toLocaleString('en-PH', { hour12: false });
    const total = cachedTickets.length;
    const res   = cachedTickets.filter(t=>(t.Status||'').toLowerCase()==='resolved').length;
    const pend  = cachedTickets.filter(t=>(t.Status||'').toLowerCase()==='pending').length;
    const crit  = cachedTickets.filter(t=>(t.SeverityLevel||'').toUpperCase()==='CRITICAL').length;
    w.document.write(`<html><head><title>Analytics Report</title><style>
        body{font-family:monospace;padding:40px;background:#fff;color:#000;}
        h1{font-size:24px;letter-spacing:2px;border-bottom:3px solid #000;padding-bottom:10px;}
        h2{font-size:14px;letter-spacing:1px;margin-top:24px;color:#333;}
        table{width:100%;border-collapse:collapse;margin-top:12px;}
        th{background:#000;color:#fff;padding:8px 12px;text-align:left;font-size:11px;letter-spacing:0.1em;}
        td{padding:7px 12px;border-bottom:1px solid #eee;font-size:12px;}
        .kpi{display:inline-block;background:#f5f5f5;border:1px solid #ddd;border-radius:8px;padding:14px 24px;margin:8px;min-width:140px;text-align:center;}
        .kpi-num{font-size:32px;font-weight:700;display:block;}
        .kpi-lbl{font-size:10px;letter-spacing:0.12em;color:#666;text-transform:uppercase;}
        @media print{body{padding:20px;}}
    </style></head><body>
        <h1>CONSUMER CARE — ANALYTICS REPORT</h1>
        <p style="font-size:11px;color:#666;margin-bottom:20px;">Generated: ${now} · User: ${localStorage.getItem('username')||'SYSTEM'}</p>
        <h2>KEY PERFORMANCE INDICATORS</h2>
        <div>
            <div class="kpi"><span class="kpi-num">${total}</span><span class="kpi-lbl">Total Tickets</span></div>
            <div class="kpi"><span class="kpi-num">${res}</span><span class="kpi-lbl">Resolved</span></div>
            <div class="kpi"><span class="kpi-num">${pend}</span><span class="kpi-lbl">Pending</span></div>
            <div class="kpi"><span class="kpi-num">${crit}</span><span class="kpi-lbl">Critical</span></div>
            <div class="kpi"><span class="kpi-num">${total>0?((res/total)*100).toFixed(1):'0.0'}%</span><span class="kpi-lbl">Resolution Rate</span></div>
        </div>
        <h2>TICKET STATUS BREAKDOWN</h2>
        <table><thead><tr><th>Ticket #</th><th>Client</th><th>Branch</th><th>Type</th><th>Severity</th><th>Status</th></tr></thead>
        <tbody>${cachedTickets.slice(0,100).map(t=>`<tr><td>#${t.TicketNo}</td><td>${(t.Name||'---').toUpperCase()}</td><td>${t.Branch||'---'}</td><td>${t.Type||'---'}</td><td>${t.SeverityLevel||'---'}</td><td>${t.Status||'---'}</td></tr>`).join('')}</tbody></table>
        <p style="font-size:10px;color:#aaa;margin-top:32px;">AGRIBANK CONSUMER CARE SYSTEM · CONFIDENTIAL</p>
        <script>setTimeout(()=>window.print(),600)</scr`+'ipt></body></html>');
    w.document.close();
    showToast('✓ PDF REPORT GENERATED');
    logAudit('EXPORT_PDF_REPORT', `Analytics report generated — ${total} tickets`, 'export');
}

// =============================================
// EXTENDED KPI — Extra dashboard stat cards
// =============================================
function updateExtendedKPIs(data) {
    // SLA compliance: resolved within target
    const slaTarget = { CRITICAL:120, HIGH:240, MODERATE:480, LOW:1440 };
    const resolvedWithTime = data.filter(t => (t.Status||'').toLowerCase()==='resolved' && t.DateIssued && t.DateReplied);
    const slaCompliant = resolvedWithTime.filter(t => {
        const mins    = (new Date(t.DateReplied)-new Date(t.DateIssued))/60000;
        const target  = slaTarget[(t.SeverityLevel||'LOW').toUpperCase()] || 480;
        return mins <= target;
    });
    const slaPct = resolvedWithTime.length > 0 ? ((slaCompliant.length/resolvedWithTime.length)*100).toFixed(1) : '--';
    const slaEl = document.getElementById('stat-sla');
    if (slaEl) slaEl.textContent = slaPct + '%';

    const critOpenCount = data.filter(t => (t.SeverityLevel||'').toUpperCase()==='CRITICAL' && (t.Status||'').toLowerCase()!=='resolved').length;
    const critEl = document.getElementById('stat-critical');
    if (critEl) animateValue(critEl, parseInt(critEl.innerText)||0, critOpenCount);

    const appCount = data.filter(t => (t.Channel||'').toUpperCase().includes('APP')).length;
    const appEl = document.getElementById('stat-app');
    if (appEl) animateValue(appEl, parseInt(appEl.innerText)||0, appCount);

    const escalatedCount = data.filter(t => (t.Action||'').toUpperCase()==='ESCALATED').length;
    const escEl = document.getElementById('stat-escalated');
    if (escEl) animateValue(escEl, parseInt(escEl.innerText)||0, escalatedCount);

    // Fire notifications for critical unresolved
    if (critOpenCount > 0) {
        const existing = notifications.find(n => n.type==='critical' && n.msg.includes('CRITICAL'));
        if (!existing) pushNotif(`⚠ ${critOpenCount} CRITICAL ticket${critOpenCount>1?'s':''} still unresolved`, 'critical');
    }

    // SLA chip
    const slaChip  = document.getElementById('sla-alert-chip');
    const slaCount = document.getElementById('sla-count');
    if (slaChip && slaCount) {
        if (critOpenCount > 0) { slaChip.classList.remove('hidden'); slaCount.textContent = critOpenCount; }
        else slaChip.classList.add('hidden');
    }
}

// =============================================
// UTILITY: timeAgo
// =============================================
function timeAgo(date) {
    const s = Math.floor((new Date() - new Date(date)) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s/60) + 'm ago';
    if (s < 86400) return Math.floor(s/3600) + 'h ago';
    return Math.floor(s/86400) + 'd ago';
}


// =============================================
// KEYBOARD SHORTCUTS
// =============================================
document.addEventListener('keydown', e => {
    if (['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;
    if (e.key === '/') {
        e.preventDefault();
        document.getElementById('tableSearch')?.focus();
    }
    if (e.key === 'r' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        refreshDashboardData();
    }
    if (e.key >= '1' && e.key <= '5') {
        const pages = ['dashboard','summary','report','kiosk','analytics','audit','admin'];
        showPage(pages[parseInt(e.key) - 1]);
    }
    if (e.key === 'Escape') { closeTicketModal(); const notif = document.getElementById('notif-panel'); if(notif) notif.classList.remove('open'); }
    if (e.key === '?') {
        alert('KEYBOARD SHORTCUTS\n━━━━━━━━━━━━━━━━━━\n/  →  Focus search\nR  →  Refresh data\n1-7  →  Jump to page\nEsc →  Close modal');
    }
});

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
    ['dashboard','summary','report','kiosk','admin'].forEach(p => {
        const pageEl = document.getElementById(`page-${p}`);
        const navEl  = document.getElementById(`nav-${p}`);
        if (pageEl) pageEl.classList.toggle('hidden', p !== page);
        if (navEl)  navEl.classList.toggle('active',  p === page);
    });
    if (page === 'report') updateDateInput();
    if (page === 'admin')  renderUserTable();
    // Close mobile sidebar
    document.getElementById('sidebar')?.classList.remove('open');
}

function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
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
                y: { grid: { color: gridColor }, ticks: { color: tickColor, font: { family: "'Space Mono'" } } },
                x: { grid: { display: false },   ticks: { color: tickColor, font: { size: 9, family: "'Space Mono'" } } }
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
                x: { grid: { color: gridColor }, ticks: { color: tickColor, font: { family: "'Space Mono'" } } },
                y: { grid: { display: false },   ticks: { color: tickColor, font: { size: 9, family: "'Space Mono'" } } }
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
                    labels: { color: tickColor, font: { size: 10, family: "'Space Mono'" }, padding: 16 }
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
        const pages = ['dashboard','summary','report','kiosk','admin'];
        showPage(pages[parseInt(e.key) - 1]);
    }
    if (e.key === '?') {
        alert('KEYBOARD SHORTCUTS\n━━━━━━━━━━━━━━━━━━\n/  →  Focus search\nR  →  Refresh data\n1-5  →  Jump to page');
    }
});
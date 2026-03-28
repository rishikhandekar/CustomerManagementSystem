/* frontend/js/dashboard.js */

document.addEventListener('DOMContentLoaded', () => {
    // 1. Personalize Greeting
    const userName = sessionStorage.getItem('user_name') || 'Admin'; 
    document.getElementById('userNameDisplay').innerText = userName;

    // --- REAL-TIME DATA STATE ---
    let dashboardData = {
        collected: {
            both:  { total: 0, cash: 0, upi: 0, net: 0, cheque: 0 },
            cable: { total: 0, cash: 0, upi: 0, net: 0, cheque: 0 },
            net:   { total: 0, cash: 0, upi: 0, net: 0, cheque: 0 }
        },
        pending: { both: 0, cable: 0, net: 0 },
        charts: {
            customers: { active: 0, inactive: 0 },
            revenue: {
                cy: { both: [], cable: [], net: [] },
                fy: { both: [], cable: [], net: [] }
            }
        },
        // ✅ NEW: Action Cards Data Added Here
        action_cards: { 
            defaulters: [], 
            expiring: { both: 0, cable: 0, net: 0 }, 
            expiring_dates: "" 
        }
    };

    // Formatter for Indian Rupees
    const formatCurrency = (amount) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);

    const amtCollected = document.getElementById('amtCollected');
    const barCash = document.getElementById('barCash');
    const barUpi = document.getElementById('barUpi');
    const barNet = document.getElementById('barNet');
    const barCheque = document.getElementById('barCheque');
    const amtPending = document.getElementById('amtPending');

    // ── Payment bar tooltip setup ─────────────────────────────
    const barTooltip = document.createElement('div');
    barTooltip.className = 'bar-tooltip';
    document.body.appendChild(barTooltip);

    function wireBarTooltip(bar) {
        bar.style.cursor = 'default';
        bar.addEventListener('mouseenter', () => {
            if (!bar.dataset.tip || parseFloat(bar.style.width) === 0) return;
            barTooltip.innerText = bar.dataset.tip;
            barTooltip.style.display = 'block';
        });
        bar.addEventListener('mousemove', (e) => {
            barTooltip.style.left = `${e.clientX - barTooltip.offsetWidth / 2}px`;
            barTooltip.style.top  = `${e.clientY - barTooltip.offsetHeight - 10}px`;
        });
        bar.addEventListener('mouseleave', () => {
            barTooltip.style.display = 'none';
        });
    }

    wireBarTooltip(barCash);
    wireBarTooltip(barUpi);
    wireBarTooltip(barNet);
    wireBarTooltip(barCheque);
    // ─────────────────────────────────────────────────────────
    
    function updateCollected(type) {
        const data = dashboardData.collected[type];
        amtCollected.innerText = formatCurrency(data.total);

        // data.cash/upi/net/cheque are now actual rupee amounts from backend
        const total     = data.total || 0;
        const cashPct   = total > 0 ? (data.cash   / total) * 100 : 0;
        const upiPct    = total > 0 ? (data.upi    / total) * 100 : 0;
        const netPct    = total > 0 ? (data.net    / total) * 100 : 0;
        const chequePct = total > 0 ? (data.cheque / total) * 100 : 0;

        barCash.style.width   = `${cashPct}%`;
        barUpi.style.width    = `${upiPct}%`;
        barNet.style.width    = `${netPct}%`;
        barCheque.style.width = `${chequePct}%`;

        // Tooltip shows real amount + percentage
        barCash.dataset.tip   = `Cash: ${formatCurrency(data.cash)} (${cashPct.toFixed(1)}%)`;
        barUpi.dataset.tip    = `UPI: ${formatCurrency(data.upi)} (${upiPct.toFixed(1)}%)`;
        barNet.dataset.tip    = `Bank: ${formatCurrency(data.net)} (${netPct.toFixed(1)}%)`;
        barCheque.dataset.tip = `Cheque: ${formatCurrency(data.cheque)} (${chequePct.toFixed(1)}%)`;

        document.getElementById('txtCash').innerText   = `Cash: ${cashPct.toFixed(1)}%`;
        document.getElementById('txtUpi').innerText    = `UPI: ${upiPct.toFixed(1)}%`;
        document.getElementById('txtNet').innerText    = `Bank: ${netPct.toFixed(1)}%`;
        document.getElementById('txtCheque').innerText = `Cheque: ${chequePct.toFixed(1)}%`;
    }

    function updatePending(type) {
        amtPending.innerText = formatCurrency(dashboardData.pending[type]);
    }

    const collectedBtns = document.querySelectorAll('#tabsCollected .kpi-tab-btn');
    collectedBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            collectedBtns.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            updateCollected(e.target.dataset.type);
        });
    });

    const pendingBtns = document.querySelectorAll('#tabsPending .kpi-tab-btn');
    pendingBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            pendingBtns.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            updatePending(e.target.dataset.type);
        });
    });

    // --- ✅ ACTION CARDS LOGIC ---
    const amtExpiring = document.getElementById('amtExpiring');
    const txtExpiringDates = document.getElementById('txtExpiringDates');
    
    function updateExpiring(type) {
        if (!dashboardData.action_cards) return;
        amtExpiring.innerText = dashboardData.action_cards.expiring[type] || 0;
        txtExpiringDates.innerText = dashboardData.action_cards.expiring_dates || "Loading...";
    }

    const expiringBtns = document.querySelectorAll('#tabsExpiring .kpi-tab-btn');
    expiringBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            expiringBtns.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            updateExpiring(e.target.dataset.type);
        });
    });

    function renderDefaulters() {
        const tbody = document.getElementById('defaultersTableBody');
        if (!tbody || !dashboardData.action_cards) return;
        tbody.innerHTML = "";
        
        const defaulters = dashboardData.action_cards.defaulters;
        if (!defaulters || defaulters.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding: 20px; font-size: 13px; color:#64748b;">No pending dues found. Great job!</td></tr>`;
            return;
        }

        defaulters.forEach(d => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9; font-size: 13px; font-weight: 500; color: #1e293b;">${d.name}</td>
                <td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9; font-size: 13px; color: #475569;">${d.phone}</td>
                <td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9; font-size: 13px; font-weight: 600; color: #c62828;">${formatCurrency(d.total_pending_all_current)}</td>
                <td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9; text-align: right;">
                    <button class="btn-open-cust" data-id="${d.id}" style="padding: 4px 12px; font-size: 11px; font-weight: 600; background: #e2e8f0; color: #334155; border: none; border-radius: 4px; cursor: pointer; transition: 0.2s;">Open</button>
                </td>
            `;
            tbody.appendChild(tr);
        });

        // Add Click Event to "Open" buttons
        document.querySelectorAll('.btn-open-cust').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const custId = e.target.getAttribute('data-id');
                sessionStorage.setItem('current_customer_id', custId);
                window.location.href = 'customerinfo.html';
            });
        });
    }

    // --- CHARTS INITIALIZATION ---
    let revenueChartInstance = null;
    let customerChartInstance = null;

    // A. Revenue Chart Logic
    function initRevenueChart() {
        const ctx = document.getElementById('growthChart').getContext('2d');
        revenueChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: [], 
                datasets: [{
                    label: 'Revenue',
                    data: [],
                    borderColor: '#1565c0', 
                    backgroundColor: 'rgba(21, 101, 192, 0.1)',
                    tension: 0.4,
                    pointBackgroundColor: '#1565c0',
                    pointRadius: 3,
                    fill: true 
                }]
            },
            options: { 
                responsive: true, 
                maintainAspectRatio: false, 
                plugins: { 
                    legend: { display: false },
                    tooltip: { callbacks: { label: (ctx) => formatCurrency(ctx.raw) } }
                }, 
                scales: { 
                    y: { beginAtZero: true, grid: { color: '#f0f0f0' }, ticks: { callback: (val) => '₹' + val } }, 
                    x: { grid: { display: false } } 
                } 
            }
        });
        updateRevenueChart();
    }

    function updateRevenueChart() {
        if (!revenueChartInstance || !dashboardData.charts) return;
        
        const yearType = document.getElementById('chartYearType').value; 
        const serviceType = document.querySelector('#chartServiceType .active').dataset.type; 
        
        const labelsCY = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const labelsFY = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];
        
        revenueChartInstance.data.labels = yearType === 'cy' ? labelsCY : labelsFY;
        revenueChartInstance.data.datasets[0].data = dashboardData.charts.revenue[yearType][serviceType];
        revenueChartInstance.update();
    }

    document.getElementById('chartYearType').addEventListener('change', updateRevenueChart);
    const chartTabs = document.querySelectorAll('#chartServiceType .kpi-tab-btn');
    chartTabs.forEach(btn => {
        btn.addEventListener('click', (e) => {
            chartTabs.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            updateRevenueChart();
        });
    });

    // B. Customer Report (Doughnut) Logic
    function initCustomerChart() {
        const ctx = document.getElementById('reportChart').getContext('2d');
        const activeCount = dashboardData.charts.customers.active;
        const inactiveCount = dashboardData.charts.customers.inactive;
        const totalCount = activeCount + inactiveCount;

        // Custom Plugin to draw text perfectly in the center hole
        const centerTextPlugin = {
            id: 'centerTextPlugin',
            beforeDraw: function(chart) {
                const width = chart.width, height = chart.height, ctx = chart.ctx;
                ctx.restore();
                
                // Draw "Total"
                ctx.font = "500 13px PoppinsLocal, sans-serif";
                ctx.textBaseline = "middle";
                ctx.fillStyle = "#64748b";
                let textX = Math.round((width - ctx.measureText("Total").width) / 2);
                let textY = height / 2 - 12;
                ctx.fillText("Total", textX, textY);
                
                // Draw Number
                ctx.font = "700 24px PoppinsLocal, sans-serif";
                ctx.fillStyle = "#1e293b";
                let numText = totalCount.toString(); // Fix for text rendering
                let numX = Math.round((width - ctx.measureText(numText).width) / 2);
                let numY = height / 2 + 12;
                ctx.fillText(numText, numX, numY);
                
                ctx.save();
            }
        };

        // NEW PLUGIN: Custom Line & Label on Hover
        const hoverLinePlugin = {
            id: 'hoverLinePlugin',
            afterDraw: function(chart) {
                const activeElements = chart.getActiveElements();
                if (activeElements.length === 0) return; // Only draw when hovering

                const ctx = chart.ctx;
                const activePoint = activeElements[0];
                const dataIndex = activePoint.index;
                const datasetIndex = activePoint.datasetIndex;

                const meta = chart.getDatasetMeta(datasetIndex);
                const arc = meta.data[dataIndex];

                const label = chart.data.labels[dataIndex];
                const value = chart.data.datasets[datasetIndex].data[dataIndex];
                
                // Calculate percentage
                const percentage = totalCount > 0 ? ((value / totalCount) * 100).toFixed(1) : 0;

                const midAngle = (arc.startAngle + arc.endAngle) / 2;
                const radius = arc.outerRadius;
                
                // Coordinates for line
                const startX = arc.x + Math.cos(midAngle) * radius;
                const startY = arc.y + Math.sin(midAngle) * radius;
                
                // Shortened elbow from 15 to 12 to save space
                const elbowX = arc.x + Math.cos(midAngle) * (radius + 12);
                const elbowY = arc.y + Math.sin(midAngle) * (radius + 12);
                
                const isRightSide = Math.cos(midAngle) >= 0;
                const textX = elbowX + (isRightSide ? 8 : -8);

                ctx.save();
                // Draw the connecting line
                ctx.beginPath();
                ctx.moveTo(startX, startY);
                ctx.lineTo(elbowX, elbowY);
                ctx.lineTo(textX, elbowY);
                ctx.strokeStyle = '#94a3b8'; 
                ctx.lineWidth = 1.5;
                ctx.stroke();

                // Draw Text
                ctx.font = "600 12px PoppinsLocal, sans-serif";
                ctx.fillStyle = "#334155";
                ctx.textAlign = isRightSide ? 'left' : 'right';
                ctx.textBaseline = 'middle';
                
                const displayText = `${label}: ${value} (${percentage}%)`;
                ctx.fillText(displayText, textX + (isRightSide ? 4 : -4), elbowY);

                ctx.restore();
            }
        };

        customerChartInstance = new Chart(ctx, {
            type: 'doughnut',
            data: { 
                labels: ['Active', 'Inactive'], 
                datasets: [{ 
                    data: [activeCount, inactiveCount], 
                    backgroundColor: ['#3b66bc', '#3db9d3'], 
                    borderWidth: 0, 
                    hoverOffset: 4 
                }] 
            },
            options: { 
                responsive: true, 
                maintainAspectRatio: false, 
                cutout: '72%', 
                layout: {
                    padding: { top: 25, bottom: 25, left: 30, right: 30 } 
                },
                plugins: { 
                    legend: { display: false },
                    tooltip: { enabled: false } 
                } 
            },
            plugins: [centerTextPlugin, hoverLinePlugin] 
        });
    }

    // --- FETCH LIVE DATA FROM PYTHON ---
    async function loadRealTimeStats() {
        const userId = sessionStorage.getItem('user_id');
        if (!userId) return;

        try {
            const res = await window.pywebview.api.get_dashboard_stats({ user_id: userId });
            if (res.ok) {
                dashboardData = res.data; 
                
                // ✅ Update User Name on screen
                if (res.data.user_name) {
                    document.getElementById('userNameDisplay').innerText = res.data.user_name;
                    sessionStorage.setItem('user_name', res.data.user_name);
                }
                
                // 1. Update Top Cards
                updateCollected(document.querySelector('#tabsCollected .active').dataset.type);
                updatePending(document.querySelector('#tabsPending .active').dataset.type);
                
                // ✅ 1.5 Update Action Cards (This was missing!)
                updateExpiring(document.querySelector('#tabsExpiring .active').dataset.type);
                renderDefaulters();

                // 2. Fire up the real-time charts
                if(!revenueChartInstance) initRevenueChart();
                if(!customerChartInstance) initCustomerChart();
            } else {
                console.error("Failed to load stats:", res.error);
            }
        } catch (error) {
            console.error("API Connection Error:", error);
            showToast("Could not load dashboard. Please check your internet connection.", 'warning');
        }
    }

    // --- DAILY PLAN TRACKER LOGIC ---
    const trackerDate = document.getElementById('trackerDate');
    const trackerDateType = document.getElementById('trackerDateType');
    const trackerTabs = document.querySelectorAll('#tabsTracker .kpi-tab-btn');
    const trackerTableBody = document.getElementById('trackerTableBody');

    // Set Calendar default to Today
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const savedTrackerDate = sessionStorage.getItem('tracker_date');
    if (savedTrackerDate) {
        trackerDate.value = savedTrackerDate;
        sessionStorage.removeItem('tracker_date');
    } else {
        trackerDate.value = `${yyyy}-${mm}-${dd}`;
    }

    const savedTrackerDateType = sessionStorage.getItem('tracker_date_type');
    if (savedTrackerDateType) {
        trackerDateType.value = savedTrackerDateType;
        sessionStorage.removeItem('tracker_date_type');
    }

    const savedTrackerTab = sessionStorage.getItem('tracker_tab');
    if (savedTrackerTab) {
        trackerTabs.forEach(b => b.classList.remove('active'));
        const targetBtn = [...trackerTabs].find(b => b.dataset.type === savedTrackerTab);
        if (targetBtn) targetBtn.classList.add('active');
        sessionStorage.removeItem('tracker_tab');
    }

    let trackerDataCache = []; // Stores the data to avoid re-fetching when just clicking Cable/Net tabs

    async function loadTrackerData() {
        const userId = sessionStorage.getItem('user_id');
        if (!userId) return;

        trackerTableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 30px; font-size: 13px; color:#64748b;">⏳ Loading daily records...</td></tr>`;

        try {
            const res = await window.pywebview.api.get_daily_tracker_data({
                user_id: userId,
                target_date: trackerDate.value,
                date_type: trackerDateType.value
            });

            if (res.ok) {
                trackerDataCache = res.data;
                renderTrackerTable();
            } else {
                trackerTableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 30px; font-size: 13px; color:#ef4444;">Failed to load data.</td></tr>`;
            }
        } catch (error) {
            console.error("Tracker API Error:", error);
            showToast("Could not load tracker data. Please check your internet connection.", 'warning');
        }
    }

    function renderTrackerTable() {
        const activeType = document.querySelector('#tabsTracker .active').dataset.type;
        
        // Filter by Service Type (Both, Cable, Net)
        let filtered = trackerDataCache;
        if (activeType === 'cable') {
            filtered = trackerDataCache.filter(item => item.cable_plan_id);
        } else if (activeType === 'net') {
            filtered = trackerDataCache.filter(item => item.internet_plan_id);
        }

        if (filtered.length === 0) {
            trackerTableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 30px; font-size: 13px; color:#64748b;">No records found for this date.</td></tr>`;
            return;
        }

        trackerTableBody.innerHTML = "";
        filtered.forEach(item => {
            const cust = item.customers || {};
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="padding: 14px 20px; border-bottom: 1px solid #f1f5f9; font-size: 13px; color: #475569; font-weight: 600;">#${cust.customer_seq_id || '-'}</td>
                <td style="padding: 14px 20px; border-bottom: 1px solid #f1f5f9; font-size: 13px; font-weight: 500; color: #1e293b;">${cust.name || 'Unknown'}</td>
                <td style="padding: 14px 20px; border-bottom: 1px solid #f1f5f9; font-size: 13px; color: #3b82f6; font-weight: 500;">${item.plan_name_cached || 'Plan'}</td>
                <td style="padding: 14px 20px; border-bottom: 1px solid #f1f5f9; font-size: 13px; color: #475569;">${cust.phone || '-'}</td>
                <td style="padding: 14px 20px; border-bottom: 1px solid #f1f5f9; font-size: 13px; color: #64748b;">${cust.short_address || '-'}</td>
                <td style="padding: 14px 20px; border-bottom: 1px solid #f1f5f9; text-align: right;">
                    <button class="btn-open-tracker" data-id="${item.customer_id}" data-sub-id="${item.id}" style="padding: 5px 14px; font-size: 11px; font-weight: 600; background: #e2e8f0; color: #334155; border: none; border-radius: 4px; cursor: pointer; transition: 0.2s;">Open</button>
                </td>
            `;
            trackerTableBody.appendChild(tr);
        });

        // Add Click Events to all the new "Open" buttons
        document.querySelectorAll('.btn-open-tracker').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const custId = e.target.getAttribute('data-id');
                const subId  = e.target.getAttribute('data-sub-id');
                sessionStorage.setItem('current_customer_id', custId);
                if (subId && subId !== 'undefined' && subId !== 'null' && subId !== '') {
                    sessionStorage.setItem('target_sub_id', subId);
                } else {
                    sessionStorage.removeItem('target_sub_id');
                }
                // ✅ Save tracker state so Go Back restores it
                sessionStorage.setItem('tracker_date', trackerDate.value);
                sessionStorage.setItem('tracker_date_type', trackerDateType.value);
                const activeTrackerTab = document.querySelector('#tabsTracker .active');
                sessionStorage.setItem('tracker_tab', activeTrackerTab ? activeTrackerTab.dataset.type : 'both');
                window.location.href = 'customerinfo.html';
            });
        });
    }

    // Attach Event Listeners to UI Elements
    trackerDate.addEventListener('change', loadTrackerData);
    trackerDateType.addEventListener('change', loadTrackerData);
    
    trackerTabs.forEach(btn => {
        btn.addEventListener('click', (e) => {
            trackerTabs.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            renderTrackerTable(); // Filters cache locally (fast!)
        });
    });

    // Initialize pywebview connection — with 300ms delay to let the
    // _returnValuesCallbacks bridge fully build before firing API calls
    let isDashboardInitialized = false;

    function startDashboardWhenReady() {
        if (isDashboardInitialized) return;
        if (window.pywebview && window.pywebview.api) {
            isDashboardInitialized = true;
            setTimeout(() => {
                loadRealTimeStats();
                loadTrackerData();
            }, 300);
        }
    }

    window.addEventListener('pywebviewready', startDashboardWhenReady);

    const dashCheckInterval = setInterval(() => {
        if (window.pywebview && window.pywebview.api) {
            clearInterval(dashCheckInterval);
            startDashboardWhenReady();
        }
    }, 100);
});
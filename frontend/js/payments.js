/* frontend/js/payments.js */
loadLayout('payments');

let allSubscriptions = [];
let currentPage = 0;
let isLoading = false;
let hasMoreData = true;
// Check memory first! If memory is empty, default to cable/pending.
let currentPlanType = sessionStorage.getItem('pay_tab_type') || 'cable'; 
let currentStatus = sessionStorage.getItem('pay_tab_status') || 'pending';

document.addEventListener('DOMContentLoaded', () => {
    // ✅ Restore visual active state for tabs based on memory
    document.getElementById('tabCable').classList.toggle('active', currentPlanType === 'cable');
    document.getElementById('tabInternet').classList.toggle('active', currentPlanType === 'internet');
    
    document.getElementById('tabPending').classList.toggle('active', currentStatus === 'pending');
    document.getElementById('tabCleared').classList.toggle('active', currentStatus === 'cleared');
    document.getElementById('tabAdvance').classList.toggle('active', currentStatus === 'advance');
    document.getElementById('tabFree').classList.toggle('active', currentStatus === 'free');

    // 1. Initial Data Fetch (FIXED)
    if (window.pywebview) {
        fetchDashboardData(true); // ✅ Added true
    } else {
        window.addEventListener('pywebviewready', () => fetchDashboardData(true)); // ✅ Wrapped in an arrow function and added true
    }

    // 2. Setup Search Listeners (With Debounce)
    const searchTypeDropdown = document.getElementById('searchType');
    const searchInput = document.getElementById('searchInput');

    let searchTimeout = null;
    searchInput.addEventListener('input', () => {
        if (searchTimeout) clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            fetchDashboardData(true);
        }, 300);
    });

    searchTypeDropdown.addEventListener('change', (e) => {
        const val = e.target.value;
        const oldSearchText = searchInput.value.trim();
        searchInput.value = '';

        const isNumeric = val === 'phone' || val === 'id';
        searchInput.inputMode = isNumeric ? 'numeric' : 'text';
        searchInput.oninput = isNumeric
            ? (e) => { e.target.value = e.target.value.replace(/[^0-9]/g, ''); }
            : null;

        if (val === 'name')    searchInput.placeholder = "Enter Name";
        else if (val === 'id') searchInput.placeholder = "Enter ID";
        else if (val === 'phone') searchInput.placeholder = "Enter Phone No";

        if (oldSearchText !== '') {
            fetchDashboardData(true);
        }
    });

    // 3. Detect Scroll to Load More
    const scrollWrapper = document.querySelector('.table-scroll-wrapper');
    if (scrollWrapper) {
        scrollWrapper.addEventListener('scroll', () => {
            const { scrollTop, scrollHeight, clientHeight } = scrollWrapper;
            if (scrollTop + clientHeight >= scrollHeight - 10) {
                fetchDashboardData(false);
            }
        });
    }
});

async function fetchDashboardData(isInitial = false) {
    if (isLoading || (!hasMoreData && !isInitial)) return;

    const userId = sessionStorage.getItem('user_id');
    if (!userId) return;

    if (isInitial) {
        currentPage = 0;
        hasMoreData = true;
        document.getElementById('paymentsTableBody').innerHTML = '';
        allSubscriptions = [];
    }

    isLoading = true;
    try {
        const searchTerm = document.getElementById('searchInput').value.trim();
        const searchType = document.getElementById('searchType').value;

        // Send parameters to Python
        const res = await window.pywebview.api.get_payment_dashboard_data({ 
            page: currentPage,
            search_term: searchTerm,
            search_type: searchType,
            plan_type: currentPlanType,
            status: currentStatus
        });

        if (res.ok) {
            allSubscriptions = [...allSubscriptions, ...res.data];
            renderTable(res.data, !isInitial);
            hasMoreData = res.has_more;
            currentPage++;
        } else {
            console.error("Failed to load payments data:", res.error);
        }
    } catch (err) {
        console.error("System error loading payments:", err);
        showToast("Could not load payments. Please check your internet connection.", 'warning');
    }
    isLoading = false;
}

// UI Toggle Logic for Plan Type (Cable/Internet)
function setPlanType(type) {
    if (currentPlanType === type) return;
    currentPlanType = type;
    sessionStorage.setItem('pay_tab_type', type); // ✅ Save to memory
    
    document.getElementById('tabCable').classList.toggle('active', type === 'cable');
    document.getElementById('tabInternet').classList.toggle('active', type === 'internet');
    
    fetchDashboardData(true);
}

// UI Toggle Logic for Status (Pending/Cleared/Advance)
function setStatus(status) {
    if (currentStatus === status) return;
    currentStatus = status;
    sessionStorage.setItem('pay_tab_status', status); // ✅ Save to memory
    
    document.getElementById('tabPending').classList.toggle('active', status === 'pending');
    document.getElementById('tabCleared').classList.toggle('active', status === 'cleared');
    document.getElementById('tabAdvance').classList.toggle('active', status === 'advance');
    document.getElementById('tabFree').classList.toggle('active', status === 'free');
    
    fetchDashboardData(true);
}

function renderTable(data, append = false) {
    const tableBody = document.getElementById('paymentsTableBody');
    if (!append) tableBody.innerHTML = '';

    if (data.length === 0 && !append) {
        tableBody.innerHTML = '<tr><td colspan="5" style="text-align:center;">No matching records found.</td></tr>';
        return;
    }

    data.forEach(sub => {
        const cust = sub.customers || {};
        const custName = cust.name || 'Unknown';
        const phone = cust.phone || '-';
        const displayId = String(cust.customer_seq_id || 0).padStart(4, '0');
        const planName = sub.plan_name_cached || 'Unnamed Plan';
        const custId = sub.customer_id;
        const subId = sub.id || sub.subscription_id || ''; 

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${custName}</td>
            <td>${planName}</td>
            <td>${phone}</td>
            <td>${displayId}</td>
            <td><button class="btn-open" onclick="openCustomerProfile('${custId}', '${subId}')">Open</button></td>
        `;
        tableBody.appendChild(tr);
    });
}

// Global function to navigate to the customer info page
window.openCustomerProfile = function(custId, subId) {
    sessionStorage.setItem('current_customer_id', custId);
    
    // ✅ Strict check to prevent "undefined" or empty strings from breaking the routing
    if (subId && subId !== 'undefined' && subId !== 'null' && subId !== '') {
        sessionStorage.setItem('target_sub_id', subId);
    } else {
        sessionStorage.removeItem('target_sub_id');
    }
    
    window.location.href = 'customerinfo.html';
};
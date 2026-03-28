/* frontend/js/subscription.js */
loadLayout('subscriptions');

document.addEventListener('DOMContentLoaded', async () => {
    const pendingToast = sessionStorage.getItem('pending_subscription_toast');
    if (pendingToast) {
        const [msg, type] = pendingToast.split('|');
        showToast(msg, type || 'info');
        sessionStorage.removeItem('pending_subscription_toast');
    }
    const tabCable = document.getElementById('tabCable');
    const tabInternet = document.getElementById('tabInternet');
    const tableBody = document.getElementById('planTableBody');
    const searchInput = document.getElementById('searchInput');
    const filterSelect = document.getElementById('filterSelect'); // Get the dropdown

    let currentType = 'cable'; 
    let allPlans = [];
    
    // --- NEW PAGINATION STATE ---
    let currentPage = 0;
    let isLoading = false;
    let hasMoreData = true;

    // 1. Fetch Plans (With Search & Pagination Support)
    async function fetchPlans(isInitial = false, type = null) {
        if (type) currentType = type;

        if (isLoading || (!hasMoreData && !isInitial)) return;

        // Visual toggle for Cable/Internet tabs
        if(currentType === 'cable') {
            tabCable.classList.add('active'); tabInternet.classList.remove('active');
            tabCable.querySelector('input').checked = true; tabInternet.querySelector('input').checked = false;
        } else {
            tabInternet.classList.add('active'); tabCable.classList.remove('active');
            tabInternet.querySelector('input').checked = true; tabCable.querySelector('input').checked = false;
        }

        const userId = sessionStorage.getItem('user_id');
        if (!userId) {
            window.location.href = 'login.html';
            return;
        }

        if (isInitial) {
            currentPage = 0;
            hasMoreData = true;
            tableBody.innerHTML = '';
            allPlans = [];
        }

        isLoading = true;
        try {
            const searchTerm = searchInput.value.trim();
            const searchType = filterSelect.value;

            // Call Python Backend
            const res = await window.pywebview.api.get_plans({ 
                type: currentType,
                page: currentPage,
                search_term: searchTerm,
                search_type: searchType
            });
            
            if(res.ok) {
                allPlans = [...allPlans, ...res.data];
                renderTable(res.data, !isInitial);
                hasMoreData = res.has_more;
                currentPage++;
            } else {
                console.error("Error fetching plans:", res.error);
                if (isInitial) {
                    tableBody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 20px;">Error loading data.</td></tr>`;
                }
            }
        } catch (error) {
            console.error("API Error:", error);
            showToast("Could not load subscriptions. Please check your internet connection.", 'warning');
        }
        isLoading = false;
    }

    // 2. Render Table Function
    function renderTable(data, append = false) {
        if (!append) tableBody.innerHTML = '';

        if (data.length === 0 && !append) {
            tableBody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 20px; color: #666;">No plans found.</td></tr>';
            return;
        }

        data.forEach(plan => {
            const count = plan.customer_count !== undefined ? plan.customer_count : 0;
            
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${plan.name || 'Unnamed Plan'}</td>
                <td style="text-align: center;">${plan.price || 0}</td>
                <td style="text-align: center;">${plan.duration || 0}</td>
                <td style="text-align: center;">${count}</td>
                <td style="text-align: center;"><button class="btn-open" onclick="openPlan('${plan.id}', '${currentType}')">Open</button></td>
            `;
            tableBody.appendChild(tr);
        });
    }

    // 3. Search Logic (Real-time Backend Search)
    let searchTimeout = null;
    searchInput.addEventListener('input', (e) => {
        if (searchTimeout) clearTimeout(searchTimeout);
        // Wait 300ms after typing stops to prevent database spam
        searchTimeout = setTimeout(() => {
            fetchPlans(true); 
        }, 300);
    });

    filterSelect.addEventListener('change', () => {
        const oldSearchText = searchInput.value.trim();
        searchInput.value = '';
        
        // Only fetch/reload the table if there was an active search to clear
        if (oldSearchText !== '') {
            fetchPlans(true);
        }

        const val = filterSelect.value;
        const isNumeric = val === 'price' || val === 'duration';
        searchInput.inputMode = isNumeric ? 'numeric' : 'text';
        searchInput.oninput = isNumeric
            ? (e) => { e.target.value = e.target.value.replace(/[^0-9.]/g, ''); }
            : null;

        if (val === 'name')          searchInput.placeholder = 'Search Plan...';
        else if (val === 'price')    searchInput.placeholder = 'Enter Price';
        else if (val === 'duration') searchInput.placeholder = 'Enter Duration (Days)';
    }); 

    // 4. Tab Listeners
    tabCable.addEventListener('click', () => {
        if (currentType !== 'cable') fetchPlans(true, 'cable');
    });
    tabInternet.addEventListener('click', () => {
        if (currentType !== 'internet') fetchPlans(true, 'internet');
    });

    // 5. Detect Scroll to Load More
    const scrollWrapper = document.querySelector('.table-scroll-wrapper');
    if (scrollWrapper) {
        scrollWrapper.addEventListener('scroll', () => {
            const { scrollTop, scrollHeight, clientHeight } = scrollWrapper;
            // If we are within 10px of the bottom, load more
            if (scrollTop + clientHeight >= scrollHeight - 10) {
                fetchPlans(false);
            }
        });
    }

    // Initial Load 
    if (window.pywebview) {
        fetchPlans(true, 'cable');
    } else {
        window.addEventListener('pywebviewready', () => fetchPlans(true, 'cable'));
    }
});

// Global function for "Open" button
function openPlan(id, type) {
    sessionStorage.setItem('current_plan_id', id);
    sessionStorage.setItem('current_plan_type', type);
    window.location.href = 'planinfo.html';
}
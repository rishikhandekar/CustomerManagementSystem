/* frontend/js/customer.js */

document.addEventListener('DOMContentLoaded', async () => {
    const pendingToast = sessionStorage.getItem('pending_customer_toast');
    if (pendingToast) {
        // Split the message and the type (e.g., "Message Text|success")
        const [msg, type] = pendingToast.split('|');
        showToast(msg, type || 'info');
        sessionStorage.removeItem('pending_customer_toast');
    }
    const filterType = document.getElementById('filterType');
    const filterInput = document.getElementById('filterInput');
    const tableBody = document.getElementById('customerTableBody');
    const btnAdd = document.querySelector('.btn-add');

    let allCustomers = []; 
    let currentPage = 0;    // ✅ Track the current page
    let isLoading = false;  // ✅ Prevent double-loading
    let hasMoreData = true; // ✅ Track if database has more rows

    // 1. Fetch Customers from Backend (With Pagination)
    async function fetchCustomers(isInitial = false) {
        if (isLoading || (!hasMoreData && !isInitial)) return;

        const userId = sessionStorage.getItem('user_id');
        if (!userId) {
            window.location.href = 'login.html';
            return;
        }

        if (isInitial) {
            currentPage = 0;
            hasMoreData = true;
            tableBody.innerHTML = '';
            allCustomers = [];
        }

        isLoading = true;
        try {
            // Call Python API with page number
            // Read what the user typed in the search box
            const searchTerm = filterInput.value.trim();
            const searchType = filterType.value;

            // Send the page number AND the search text to Python
            const res = await window.pywebview.api.get_customers({ 
                page: currentPage,
                search_term: searchTerm,
                search_type: searchType
            });
            
            if (res.ok) {
                allCustomers = [...allCustomers, ...res.data];
                renderTable(res.data, !isInitial); // true means append
                hasMoreData = res.has_more;
                currentPage++;
            } else {
                console.error("Error fetching customers:", res.error);
                if (isInitial) {
                    tableBody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 20px;">Error loading data.</td></tr>`;
                }
            }
        } catch (error) {
            console.error("API Error:", error);
        }
        isLoading = false;
    }

    // 2. Render Table Function (With Append Support)
    function renderTable(data, append = false) {
        if (!append) {
            tableBody.innerHTML = ''; 
        }

        if (data.length === 0 && !append) {
            tableBody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 20px; color: #666;">No customers found.</td></tr>`;
            return;
        }

        const template = document.getElementById('customerRowTemplate');

        data.forEach(cust => {
            let displayId = '---';
            if (cust.customer_seq_id) {
                displayId = cust.customer_seq_id.toString().padStart(5, '0');
            }

            const displayAddress = cust.short_address || '-';

            const clone = template.content.cloneNode(true);
            const row = clone.querySelector('tr');

            row.querySelector('.td-name').textContent = cust.name;
            row.querySelector('.td-phone').textContent = cust.phone;
            row.querySelector('.td-address').textContent = displayAddress;
            row.querySelector('.td-id span').textContent = `#${displayId}`;
            row.querySelector('.btn-open').onclick = () => openCustomer(cust.id);

            tableBody.appendChild(row);
        });
    }

    // 3. Filter Logic (Real-time Backend Search)
    let searchTimeout = null;
    filterInput.addEventListener('input', (e) => {
        if (searchTimeout) clearTimeout(searchTimeout);
        
        // Wait 300ms after typing stops so we don't spam the database
        searchTimeout = setTimeout(() => {
            fetchCustomers(true); // true means clear table and load page 0 of search results
        }, 300);
    });

    // 4. UI Logic: Change Input Placeholder
    filterType.addEventListener('change', () => {
        const oldSearchText = filterInput.value.trim();
        filterInput.value = '';
        
        // ✅ THE FIX: Only fetch/reload the table if there was an active search to clear!
        if (oldSearchText !== '') {
            fetchCustomers(true); 
        }

        const isNumeric = filterType.value === 'phone' || filterType.value === 'id';
        filterInput.inputMode = isNumeric ? 'numeric' : 'text';
        filterInput.oninput = isNumeric
            ? (e) => { e.target.value = e.target.value.replace(/[^0-9]/g, ''); }
            : null;

        switch(filterType.value) {
            case 'name':    filterInput.placeholder = 'Enter Name'; break;
            case 'phone':   filterInput.placeholder = 'Enter Phone No'; break;
            case 'id':      filterInput.placeholder = 'Enter ID'; break;
            case 'address': filterInput.placeholder = 'Enter Short Address'; break;
            default:        filterInput.placeholder = 'Search...';
        }
    });

    // 5. Add Customer Redirect
    if (btnAdd) {
        btnAdd.addEventListener('click', () => {
            window.location.href = 'addcustomer.html';
        });
    }

    // ✅ Detect when user reaches the bottom of the scroll wrapper
    const scrollWrapper = document.querySelector('.table-scroll-wrapper');
    scrollWrapper.addEventListener('scroll', () => {
        const { scrollTop, scrollHeight, clientHeight } = scrollWrapper;
        // If we are within 10px of the bottom, load more
        if (scrollTop + clientHeight >= scrollHeight - 10) {
            fetchCustomers();
        }
    });

    // Initial Load
    // Wait for pywebview to be ready if it isn't already
    if (window.pywebview) {
        fetchCustomers(true); // ✅ Add 'true' here
    } else {
        window.addEventListener('pywebviewready', () => fetchCustomers(true)); // ✅ Wrap in an arrow function with 'true'
    }
});

// Global function to handle "Open" button click
function openCustomer(customerId) {
    sessionStorage.setItem('current_customer_id', customerId);
    window.location.href = 'customerinfo.html'; // ✅ Redirects now
}
/* frontend/js/deletedcustomers.js */
loadLayout('customers'); 

let allDeletedCustomers = []; // ✅ Store all data globally for searching

document.addEventListener('DOMContentLoaded', () => {
    if (window.pywebview) {
        fetchDeletedList();
    } else {
        window.addEventListener('pywebviewready', fetchDeletedList);
    }

    // ✅ Search Logic Setup
    const searchType = document.getElementById('searchType');
    const searchInput = document.getElementById('searchInput');

    // Change placeholder text based on dropdown selection
    searchType.addEventListener('change', (e) => {
        const val = e.target.value;
        searchInput.value = '';

        const isNumeric = val === 'phone' || val === 'id';
        searchInput.inputMode = isNumeric ? 'numeric' : 'text';
        searchInput.oninput = isNumeric
            ? (e) => { e.target.value = e.target.value.replace(/[^0-9]/g, ''); }
            : null;

        if (val === 'name')    searchInput.placeholder = "Enter Name";
        else if (val === 'id') searchInput.placeholder = "Enter ID";
        else if (val === 'phone') searchInput.placeholder = "Enter Phone No";
        else if (val === 'address') searchInput.placeholder = "Enter Address";

        filterAndRenderTable();
    });

    // Trigger filter when typing
    searchInput.addEventListener('input', filterAndRenderTable);
});

async function fetchDeletedList() {
    const userId = sessionStorage.getItem('user_id');
    if (!userId) return;

    try {
        const res = await window.pywebview.api.get_deleted_customers({ user_id: userId });
        
        if (res.ok) {
            allDeletedCustomers = res.data || []; // Save data to global array
            filterAndRenderTable(); // Render initially
        } else {
            console.error("Failed to load deleted customers:", res.error);
        }
    } catch (err) {
        console.error("System error:", err);
    }
}

// ✅ Filter Logic Function
function filterAndRenderTable() {
    const searchTerm = document.getElementById('searchInput').value.toLowerCase().trim();
    const searchType = document.getElementById('searchType').value;

    const filteredData = allDeletedCustomers.filter(cust => {
        if (!searchTerm) return true; // Show all if search is empty

        let valueToCheck = "";

        if (searchType === 'name') {
            valueToCheck = cust.name || "";
        } else if (searchType === 'phone') {
            valueToCheck = (cust.phone || "") + (cust.alt_phone || ""); // Search both phone fields
        } else if (searchType === 'address') {
            valueToCheck = cust.short_address || "";
        } else if (searchType === 'id') {
            // Pad ID to match the 4-digit display (e.g., 0005)
            valueToCheck = String(cust.customer_seq_id || 0).padStart(4, '0');
        }

        return valueToCheck.toLowerCase().includes(searchTerm);
    });

    renderTable(filteredData);
}

function renderTable(data) {
    const tableBody = document.getElementById('deletedTableBody');
    tableBody.innerHTML = '';

    if (data.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 30px; color: #666;">No deleted customers match your search.</td></tr>';
        return;
    }

    data.forEach(cust => {
        const displayId = String(cust.customer_seq_id || 0).padStart(4, '0');
        const row = `
            <tr>
                <td>${displayId}</td>
                <td>${cust.name || '-'}</td>
                <td>${cust.phone || '-'}</td>
                <td>${cust.alt_phone || '-'}</td>
                <td>${cust.short_address || '-'}</td>
            </tr>
        `;
        tableBody.innerHTML += row;
    });
}
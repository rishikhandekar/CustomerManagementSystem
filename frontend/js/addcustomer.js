/* frontend/js/addcustomer.js */
loadLayout('customers');

document.addEventListener('DOMContentLoaded', () => {
    // --- Elements ---
    const toggleCable = document.getElementById('toggleCable');
    const toggleInternet = document.getElementById('toggleInternet');
    const cableSection = document.getElementById('cableSection');
    const internetSection = document.getElementById('internetSection');
    
    const cableGrid = document.getElementById('cableGrid');
    const internetGrid = document.getElementById('internetGrid');
    const loadMoreCableBtn = document.getElementById('loadMoreCable');
    const loadMoreInternetBtn = document.getElementById('loadMoreInternet');
    const btnSubmit = document.getElementById('btnSubmit');

    // --- Modal Elements ---
    const adjModal = document.getElementById('planAdjustmentModal');
    const btnCloseAdjModal = document.getElementById('btnCloseAdjModal');
    const btnCancelAdj = document.getElementById('btnCancelAdj');
    const btnConfirmAdj = document.getElementById('btnConfirmAdj');
    
    const adjModalTitle = document.getElementById('adjModalTitle');
    const adjModalPlanName = document.getElementById('adjModalPlanName');
    const adjBasePrice = document.getElementById('adjBasePrice');
    const adjAddCharge = document.getElementById('adjAddCharge');
    const adjDiscount = document.getElementById('adjDiscount');
    const adjNetAmount = document.getElementById('adjNetAmount');

    // --- State ---
    let cablePlans = [];
    let internetPlans = [];
    let cableLimit = 5;
    let internetLimit = 5;
    
    // Store selected plan objects { id, type, price, additional_charge, discount_amount, final_amount, etc. }
    let selectedPlans = new Map(); 

    // Temp variable for the plan currently being edited in the modal
    let pendingPlanSelection = null; 

    // --- 1. Toggle Logic ---
    toggleCable.addEventListener('click', () => {
        toggleCable.classList.toggle('active');
        if (toggleCable.classList.contains('active')) {
            cableSection.classList.remove('hidden');
            if (cablePlans.length === 0) loadCablePlans(); // Fetch if not loaded
        } else {
            cableSection.classList.add('hidden');
            // ✅ FIX: Remove all selected cable plans from memory when toggled off
            for (let [key, plan] of selectedPlans.entries()) {
                if (plan.type === 'cable') selectedPlans.delete(key);
            }
            // ✅ Re-render the grid to visually uncheck the boxes in the background
            if (cablePlans.length > 0) renderPlans(cablePlans, cableGrid, cableLimit, 'cable');
        }
    });

    toggleInternet.addEventListener('click', () => {
        toggleInternet.classList.toggle('active');
        if (toggleInternet.classList.contains('active')) {
            internetSection.classList.remove('hidden');
            if (internetPlans.length === 0) loadInternetPlans(); // Fetch if not loaded
        } else {
            internetSection.classList.add('hidden');
            // ✅ FIX: Remove all selected internet plans from memory when toggled off
            for (let [key, plan] of selectedPlans.entries()) {
                if (plan.type === 'internet') selectedPlans.delete(key);
            }
            // ✅ Re-render the grid to visually uncheck the boxes in the background
            if (internetPlans.length > 0) renderPlans(internetPlans, internetGrid, internetLimit, 'internet');
        }
    });

    // --- 2. Load Plans Logic ---
    async function loadCablePlans() {
        const userId = sessionStorage.getItem('user_id');
        const res = await window.pywebview.api.get_plans({ user_id: userId, type: 'cable' });
        
        if (res.ok) {
            cablePlans = res.data; 
            renderPlans(cablePlans, cableGrid, cableLimit, 'cable');
        } else {
            console.error("Error loading cable plans:", res.error);
        }
    }

    async function loadInternetPlans() {
        const userId = sessionStorage.getItem('user_id');
        const res = await window.pywebview.api.get_plans({ user_id: userId, type: 'internet' });
        
        if (res.ok) {
            internetPlans = res.data;
            internetPlans.forEach(p => p.name = p.name || `${p.speed_mbps} Mbps Plan`); // Ensure name exists
            renderPlans(internetPlans, internetGrid, internetLimit, 'internet');
        } else {
            console.error("Error loading internet plans:", res.error);
        }
    }

    // --- 3. Render Logic ---
    function renderPlans(plans, gridElement, limit, type) {
        gridElement.innerHTML = '';
        const visiblePlans = plans.slice(0, limit);
        const cardTemplate = document.getElementById('planSelectionCardTemplate');

        visiblePlans.forEach(plan => {
            // Clone the template
            const clone = cardTemplate.content.cloneNode(true);
            const card = clone.querySelector('.plan-card');
            const checkbox = clone.querySelector('.plan-checkbox');
            const nameSpan = clone.querySelector('.plan-name');
            const basePriceSmall = clone.querySelector('.plan-base-price');
            const selectedDetailsDiv = clone.querySelector('.plan-selected-details');
            const netAmountDiv = clone.querySelector('.plan-net-amount');
            const breakdownDiv = clone.querySelector('.plan-breakdown');

            // Check if this plan is already selected
            const isSelected = selectedPlans.has(plan.id);
            if (isSelected) {
                card.classList.add('selected');
                checkbox.checked = true;
            }

            // Name Logic 
            let displayName = plan.name;
            if (type === 'internet' && !displayName) {
                displayName = `${plan.speed_mbps} Mbps Plan`;
            }
            plan.computedName = displayName; // Store computed name
            nameSpan.textContent = displayName;

            // Fill Amount Details
            if (isSelected) {
                const stored = selectedPlans.get(plan.id);
                // Hide standard base price, show selected breakdown
                basePriceSmall.style.display = 'none';
                selectedDetailsDiv.style.display = 'block';
                
                netAmountDiv.textContent = `Net: ₹${stored.final_amount}`;
                breakdownDiv.textContent = `(Base: ₹${plan.price} + ${stored.additional_charge} - ${stored.discount_amount})`;
                clone.querySelector('.plan-duration-selected').textContent = `${plan.duration} Days`;
            } else {
                // Show standard base price, hide selected breakdown
                basePriceSmall.textContent = `Base: ₹${plan.price}`;
                basePriceSmall.style.display = 'block';
                selectedDetailsDiv.style.display = 'none';
                clone.querySelector('.plan-duration').textContent = `${plan.duration} Days`;
            }

            // Click Handler
            card.addEventListener('click', (e) => {
                // If already selected, just deselect instantly (no modal needed to remove)
                if (selectedPlans.has(plan.id)) {
                    selectedPlans.delete(plan.id);
                    renderPlans(plans, gridElement, limit, type); // Re-render to update UI
                    return;
                }

                // If NOT selected, OPEN MODAL to ask for details
                openAdjustmentModal(plan, type);
            });

            gridElement.appendChild(clone);
        });

        // Handle "Load More" visibility
        const loadMoreBtn = type === 'cable' ? loadMoreCableBtn : loadMoreInternetBtn;
        if (limit >= plans.length) {
            loadMoreBtn.style.display = 'none';
        } else {
            loadMoreBtn.style.display = 'inline-block';
        }
    }

    // --- 4. Modal Logic (The New Part) ---
    function openAdjustmentModal(plan, type) {
        pendingPlanSelection = { ...plan, type: type }; // Clone plan to pending
        
        adjModalPlanName.innerText = plan.computedName;
        adjBasePrice.value = plan.price;
        document.getElementById('adjDuration').value = `${plan.duration} Days`;
        adjAddCharge.value = 0;
        adjDiscount.value = 0;
        
        // Initial Net Calc
        updateNetCalc();

        adjModal.classList.remove('hidden');
        adjAddCharge.focus();
    }

    function updateNetCalc() {
        if(!pendingPlanSelection) return;
        const base = parseFloat(pendingPlanSelection.price) || 0;
        const add = parseFloat(adjAddCharge.value) || 0;
        const disc = parseFloat(adjDiscount.value) || 0;
        
        let net = (base + add) - disc;
        if (net < 0) net = 0;
        
        adjNetAmount.innerText = net;
    }

    adjAddCharge.addEventListener('input', updateNetCalc);
    adjDiscount.addEventListener('input', updateNetCalc);

    // Cancel Modal
    const closeModal = () => {
        adjModal.classList.add('hidden');
        pendingPlanSelection = null;
    };
    if(btnCloseAdjModal) btnCloseAdjModal.addEventListener('click', closeModal);
    if(btnCancelAdj) btnCancelAdj.addEventListener('click', closeModal);

    // Confirm Modal
    if(btnConfirmAdj) {
        btnConfirmAdj.addEventListener('click', () => {
            if (!pendingPlanSelection) return;

            const add = parseFloat(adjAddCharge.value) || 0;
            const disc = parseFloat(adjDiscount.value) || 0;
            const base = parseFloat(pendingPlanSelection.price) || 0;
            let net = (base + add) - disc;
            if (net < 0) net = 0;

            // ✅ SAVE TO SELECTED MAP with extra fields
            selectedPlans.set(pendingPlanSelection.id, {
                ...pendingPlanSelection,
                additional_charge: add,
                discount_amount: disc,
                final_amount: net
            });

            // Refresh the grid to show checkmark and new price
            if (pendingPlanSelection.type === 'cable') {
                renderPlans(cablePlans, cableGrid, cableLimit, 'cable');
            } else {
                renderPlans(internetPlans, internetGrid, internetLimit, 'internet');
            }

            closeModal();
        });
    }

    // --- 5. Load More Handlers ---
    loadMoreCableBtn.addEventListener('click', () => {
        cableLimit += 10;
        renderPlans(cablePlans, cableGrid, cableLimit, 'cable');
    });

    loadMoreInternetBtn.addEventListener('click', () => {
        internetLimit += 10;
        renderPlans(internetPlans, internetGrid, internetLimit, 'internet');
    });

    // --- 6. Submit Logic ---
    btnSubmit.addEventListener('click', async () => {
        // A. Inputs
        const name = document.getElementById('custName').value.trim();
        const phone = document.getElementById('custPhone').value.trim();
        const email = document.getElementById('custEmail').value.trim();
        const aadhaar = document.getElementById('custAadhaar').value.trim();
        const altPhone = document.getElementById('custAltPhone').value.trim();
        
        // New Address Fields
        const shortAddress = document.getElementById('custShortAddress').value.trim();
        const longAddress = document.getElementById('custLongAddress').value.trim();

        // B. Validation
        if (!name || !phone || !aadhaar || !shortAddress || !longAddress) {
            alert("Please fill all required fields (*)");
            return;
        }

        if (selectedPlans.size === 0) {
            alert("Please select at least one Subscription Plan.");
            return;
        }

        const userId = sessionStorage.getItem('user_id');
        if (!userId) { alert("Session Error. Please login."); return; }

        btnSubmit.innerText = "Saving...";
        btnSubmit.disabled = true;

        try {
            // C. Create Customer Payload
            const customerData = {
                user_id: userId,
                name: name,
                phone: phone,
                alt_phone: altPhone, 
                email: email,
                aadhaar_number: aadhaar,
                short_address: shortAddress, 
                long_address: longAddress,   
                advance_balance: 0
            };

            // D. Create Subscription List (Including new charges)
            const subscriptionList = Array.from(selectedPlans.values()).map(p => ({
                plan_id: p.id,
                plan_type: p.type,
                price: p.price,
                plan_name: p.computedName || p.name || 'Unknown Plan',
                
                // ✅ PASS NEW FIELDS TO BACKEND
                additional_charge: p.additional_charge,
                discount_amount: p.discount_amount
            }));

            const payload = {
                customer: customerData,
                subscriptions: subscriptionList
            };

            // E. Send to Python Backend
            const res = await window.pywebview.api.create_customer_with_plans(payload);

            if (res.ok) {
                alert("Customer Added Successfully!");
                window.location.href = "customer.html";
            } else {
                alert("Error: " + JSON.stringify(res.error));
                btnSubmit.innerText = "Submit";
                btnSubmit.disabled = false;
            }

        } catch (err) {
            console.error(err);
            alert("Unexpected error occurred.");
            btnSubmit.innerText = "Submit";
            btnSubmit.disabled = false;
        }
    });
});
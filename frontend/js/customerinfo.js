/* frontend/js/customerinfo.js */
loadLayout('customers');

document.addEventListener('DOMContentLoaded', () => {

    // ✅ SHARED SAFETY HELPER: Prevents XSS from user-entered data in innerHTML
    function escapeHtml(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // --- Elements ---
    const toggleCable = document.getElementById('viewCable');
    const toggleInternet = document.getElementById('viewInternet');
    const planContainer = document.getElementById('planDetailsContainer');
    const noPlanMsg = document.getElementById('noPlanMessage');
    const planTabsContainer = document.getElementById('multiPlanTabs');
    const deletedMainView = document.getElementById('deletedPlansMainView');
    const planHeaderRow = document.querySelector('.plan-header-row');

    // Buttons
    const btnEdit = document.getElementById('btnEdit');
    const btnSubmit = document.getElementById('btnSubmit');
    const btnCancel = document.getElementById('btnCancel');
    const footerDefault = document.getElementById('footerDefault');
    const footerEdit = document.getElementById('footerEdit');
    const btnRemovePlan = document.getElementById('btnRemovePlan');
    const btnToggleStatus = document.getElementById('btnToggleStatus'); 
    const btnHistory = document.getElementById('btnHistory'); // Renamed button
    const btnWhatsappReminder = document.getElementById('btnWhatsappReminder');
    const historyContainer = document.getElementById('historyContainer');
    const planFormsWrapper = document.getElementById('planFormsWrapper');
    const paymentHistoryBody = document.getElementById('paymentHistoryBody');

    // Modal Elements (Add Plan)
    const addModal = document.getElementById('addPlanModal');
    const addModalGrid = document.getElementById('availablePlansGrid');
    const closeAddModal = document.getElementById('btnCloseModal');
    
    const addConfirmSection = document.getElementById('addPlanConfirmSection');
    const addConfirmText = document.getElementById('addPlanConfirmText');
    const btnCancelAddPlan = document.getElementById('btnCancelAddPlan');
    const btnConfirmAddPlan = document.getElementById('btnConfirmAddPlan');

    // Remove Plan Modal Elements
    const removeModal = document.getElementById('removePlanModal');
    const removeModalPlanName = document.getElementById('removeModalPlanName');
    const btnCancelRemove = document.getElementById('btnCancelRemove');
    const btnConfirmRemove = document.getElementById('btnConfirmRemove');

    // --- PAYMENT MODAL ELEMENTS ---
    const btnPay = document.getElementById('btnPay');
    const btnPayYes = document.getElementById('btnPayYes');
    const btnPayNo = document.getElementById('btnPayNo');

    // ✅ NEW: Excess Payment Modal Elements
    const excessModal = document.getElementById('paymentExcessModal');
    const btnExcessUpcoming = document.getElementById('btnExcessUpcoming');
    const btnExcessAdvance = document.getElementById('btnExcessAdvance');
    const btnCloseExcessModal = document.getElementById('btnCloseExcessModal');

    // ✅ NEW: Start Plan Modal Elements
    const startPlanModal = document.getElementById('startPlanModal');
    const btnStartCurrentOnly = document.getElementById('btnStartCurrentOnly');
    const btnStartBoth = document.getElementById('btnStartBoth');
    const btnCloseStartModal = document.getElementById('btnCloseStartModal');

    // --- State ---
    let customerProfile = {};
    let subscriptions = [];
    let currentView = sessionStorage.getItem('pay_tab_type') || 'cable'; 
    let activeSubId = null; 
    let isEditMode = false;
    let selectedPlanToAdd = null;
    let isViewingDeletedPlan = false; // ✅ NEW FLAG

    // ✅ CHEQUE FIELD TOGGLE LOGIC (Placed correctly at top)
    const payModeSelect = document.getElementById('payMode');
    const chequeContainer = document.getElementById('chequeInputContainer');

    if (payModeSelect) {
        payModeSelect.addEventListener('change', () => {
            if (payModeSelect.value === 'cheque') {
                chequeContainer.classList.remove('hidden');
            } else {
                chequeContainer.classList.add('hidden');
                document.getElementById('payChequeNo').value = ""; // Clear if hidden
            }
        });
    }

    // =========================================================
    // ✅ NEW: MULTI-PLAN WHATSAPP REMINDER POPUP LOGIC
    // =========================================================

    let selectedWaPlanIds = []; // Stores the selected plans

    // 2. Main Reminder Button Click -> Opens Plan Selection
    if (btnWhatsappReminder) {
        btnWhatsappReminder.addEventListener('click', () => {
            if (!subscriptions || subscriptions.length === 0) {
                showToast("No plans available for this customer.", 'warning');
                return;
            }

            const checklist = document.getElementById('waPlanChecklist');
            checklist.innerHTML = '';
            
            subscriptions.forEach(s => {
                const p = parseFloat(s.pending_amount) || 0;
                const c = parseFloat(s.current_amount) || 0;
                const o = parseFloat(s.other_service_charges) || 0;
                const u = parseFloat(s.upcoming_amount) || 0;
                const totalCurr = p + c + o;
                const totalUpc = totalCurr + u;

                const statusTag = s.status === 'active' ? '<span style="color:#2e7d32; font-size:11px; font-weight:bold;">(Active)</span>' : '<span style="color:#c62828; font-size:11px; font-weight:bold;">(Inactive)</span>';

                checklist.innerHTML += `
                    <label style="display:flex; align-items:flex-start; gap:12px; padding:12px; border:1px solid #ddd; border-radius:6px; cursor:pointer; background:#fafafa; transition:0.2s;">
                        <input type="checkbox" class="wa-plan-checkbox" value="${s.id}" checked style="margin-top:4px; transform: scale(1.3);">
                        <div style="flex:1;">
                            <div style="font-weight:bold; font-size:15px; color:#333;">${escapeHtml(s.plan_name_cached || 'Plan')} ${statusTag}</div>
                            <div style="font-size:13px; color:#555; margin-top:6px; line-height:1.5;">
                                Current Due: <strong style="color:#f57f17;">₹${totalCurr}</strong> |
                                OSC: <strong style="color:#f57f17;">₹${o}</strong> |
                                Total Till Upcoming: <strong style="color:#1976d2;">₹${totalUpc}</strong>
                            </div>
                        </div>
                    </label>
                `;
            });

            const multiModal = document.getElementById('waMultiPlanModal');
            multiModal.classList.remove('hidden');
            multiModal.style.display = 'flex';
        });
    }

    // 3. "Next" Button -> Calculates Aggregates & Opens Options Modal
    document.getElementById('btnWaNextToOptions').addEventListener('click', () => {
        const checkboxes = document.querySelectorAll('.wa-plan-checkbox:checked');
        selectedWaPlanIds = Array.from(checkboxes).map(cb => cb.value);

        if (selectedWaPlanIds.length === 0) {
            showToast("Please select at least one plan.", 'warning');
            return;
        }

        let aggCurr = 0, aggUpc = 0, aggOsc = 0, aggOnlyUpc = 0;

        selectedWaPlanIds.forEach(id => {
            const s = subscriptions.find(sub => String(sub.id) === String(id));
            if (s) {
                const p = parseFloat(s.pending_amount) || 0;
                const c = parseFloat(s.current_amount) || 0;
                const o = parseFloat(s.other_service_charges) || 0;
                const u = parseFloat(s.upcoming_amount) || 0;
                aggCurr += (p + c + o);
                aggOsc += o;
                aggOnlyUpc += u;
                aggUpc += (p + c + o + u);
            }
        });

        document.getElementById('btnWaCurrent').innerText = `Total Current Due (₹${aggCurr})`;
        document.getElementById('btnWaUpcoming').innerText = `Total Till Upcoming (₹${aggUpc})`;
        document.getElementById('btnWaOsc').innerText = `Only OSC (₹${aggOsc})`;
        document.getElementById('btnWaOnlyUpcoming').innerText = `Only Upcoming Plan (₹${aggOnlyUpc})`;

        const multiModal = document.getElementById('waMultiPlanModal');
        multiModal.classList.add('hidden');
        multiModal.style.display = 'none';
        document.getElementById('whatsappOptionsModal').classList.remove('hidden');
    });

    let pendingMsgType = null; // Stores the choice before language is selected

    // 1. Handlers for the 4 Options (Opens Language Modal)
    ['Current', 'Upcoming', 'Osc', 'OnlyUpcoming'].forEach(type => {
        const btn = document.getElementById(`btnWa${type}`);
        if (btn) {
            btn.addEventListener('click', () => {
                document.getElementById('whatsappOptionsModal').classList.add('hidden');
                pendingMsgType = type === 'OnlyUpcoming' ? 'only_upcoming' : type.toLowerCase();
                document.getElementById('whatsappLangModal').classList.remove('hidden');
            });
        }
    });

    // 2. Handlers for the 8 Languages (Triggers Python Bot)
    document.querySelectorAll('.lang-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const langCode = btn.getAttribute('data-lang');
            document.getElementById('whatsappLangModal').classList.add('hidden');

            const custId = sessionStorage.getItem('current_customer_id');
            const originalText = btnWhatsappReminder.innerText;

            btnWhatsappReminder.innerText = "Translating & Opening Bot...";
            btnWhatsappReminder.disabled = true;

            try {
                const res = await window.pywebview.api.send_whatsapp_reminder({
                    subscription_ids: selectedWaPlanIds, // ✅ Send LIST of selected plans
                    customer_id: custId,
                    message_type: pendingMsgType,
                    language: langCode
                });

                if (res.ok) {
                    showToast("WhatsApp bot started! Opening browser...", 'success');
                } else {
                    showToast("Failed to send reminder: " + res.error, 'error');
                }
            } catch (err) {
                showToast("System Error: " + err, 'error');
            } finally {
                btnWhatsappReminder.innerText = originalText;
                btnWhatsappReminder.disabled = false;
            }
        });
    });

    // --- 1. Fetch Logic ---
    async function fetchDetails(preserveState = false) {
        // ✅ CRITICAL FIX: Block Event objects from pretending to be "true"
        if (typeof preserveState !== 'boolean') preserveState = false;

        const custId = sessionStorage.getItem('current_customer_id');
        const userId = sessionStorage.getItem('user_id');

        if (!custId || !userId) {
            sessionStorage.setItem('pending_customer_toast', 'No customer selected. Going back.|error');
            window.location.href = 'customer.html';
            return;
        }

        try {
            const res = await window.pywebview.api.get_customer_details({ 
                user_id: userId, 
                customer_id: custId 
            });

            if (res.ok) {
                customerProfile = res.data.profile;
                subscriptions = res.data.subscriptions;
                
                // ✅ 1. CALCULATE GLOBAL TOTALS (ALL PLANS)
                calculateGlobalTotals();

                // Send silently to database to keep Dashboard accurate
                if (window.pywebview && window.pywebview.api) {
                    window.pywebview.api.sync_customer_totals({
                        customer_id: custId
                    });
                }

                renderProfile();
                
                // ✅ Read the memory to see if we clicked a specific plan from the Payments page
                const targetSubId = sessionStorage.getItem('target_sub_id');
                sessionStorage.removeItem('target_sub_id');

                if (preserveState && currentView) {
                    switchView(currentView, activeSubId);
                } else if (targetSubId && targetSubId !== 'undefined' && targetSubId !== 'null') {
                    // ✅ Find the exact plan we clicked
                    const targetSub = subscriptions.find(s => String(s.id) === String(targetSubId));
                    if (targetSub) {
                        const typeToOpen = targetSub.cable_plan_id ? 'cable' : 'internet';
                        switchView(typeToOpen, targetSub.id); 
                    } else {
                        // Fallback if ID wasn't found
                        const hasCable = subscriptions.find(s => s.cable_plan_id);
                        switchView(hasCable ? 'cable' : 'internet');
                    }
                } else {
                    // Standard loading logic if we didn't come from the Payments page
                    const hasCable = subscriptions.find(s => s.cable_plan_id);
                    const hasNet = subscriptions.find(s => s.internet_plan_id);

                    if (hasCable) switchView('cable');
                    else if (hasNet) switchView('internet');
                    else switchView('cable'); 
                }
            } else {
                showToast("Error fetching details: " + res.error, 'error');
            }
        } catch (err) {
            showToast("System Error: " + err, 'error');
        }
    }

    // --- 2. Render Profile ---
    function renderProfile() {
        document.getElementById('infoName').value = customerProfile.name || '';
        document.getElementById('infoPhone').value = customerProfile.phone || '';
        document.getElementById('infoEmail').value = customerProfile.email || '-';
        document.getElementById('infoAadhaar').value = customerProfile.aadhaar_number || '';
        document.getElementById('infoAltPhone').value = customerProfile.alt_phone || '-'; 
        document.getElementById('infoShortAddr').value = customerProfile.short_address || '-';
        document.getElementById('infoLongAddr').value = customerProfile.long_address || '-';
        
        const seqId = customerProfile.customer_seq_id ? customerProfile.customer_seq_id.toString().padStart(5, '0') : '---';
        document.getElementById('infoCustId').value = `#${seqId}`;
        
        document.getElementById('infoNotes').value = customerProfile.notes || '';
    }

    // ✅ Helper: Calculate Global Totals (Top Fields)
    function calculateGlobalTotals() {
        let globalCurrent = 0;
        let globalUpcoming = 0;

        subscriptions.forEach(s => {
            const p = parseFloat(s.pending_amount) || 0;
            const c = parseFloat(s.current_amount) || 0;
            const o = parseFloat(s.other_service_charges) || 0;
            const u = parseFloat(s.upcoming_amount) || 0;

            const tillCurr = p + c + o;
            const tillUp = tillCurr + u;

            globalCurrent += tillCurr;
            globalUpcoming += tillUp;
        });

        document.getElementById('infoTotalPendingCurrent').value = `₹${globalCurrent}`;
        document.getElementById('infoTotalPendingUpcoming').value = `₹${globalUpcoming}`;

        return globalCurrent; 
    }

    // --- 3. Toggle Logic ---
    toggleCable.addEventListener('click', () => switchView('cable'));
    toggleInternet.addEventListener('click', () => switchView('internet'));

    function switchView(type, targetSubId = null) {

            // ✅ CLEANUP: Remove injected Transfer button when switching back to active view
        const fPendingEl = document.getElementById('fPending');
        if (fPendingEl) {
            const oldDebtGroup = fPendingEl.parentElement.querySelector('.debt-btn-group');
            if (oldDebtGroup) oldDebtGroup.remove();
            fPendingEl.style.paddingRight = "";
        }

        // ✅ 1. RESET UI: Make sure hidden elements come back when switching tabs
        if(typeof resetUIForActive === 'function') {
            resetUIForActive();
        }

        // ✅ SAFETY CHECK: Ensure elements exist before accessing classList
        if (planFormsWrapper) planFormsWrapper.classList.remove('hidden');
        if (historyContainer) historyContainer.classList.add('hidden');
        if (btnHistory) btnHistory.innerText = "History";
        
        currentView = type;
        
        // --- ✅ NEW LOGIC: Calculate Type-Specific Pending ---
        const isCable = type === 'cable';
        const typeLabel = isCable ? "Cable" : "Net";

        // Filter subscriptions strictly by type
        const typeSubs = subscriptions.filter(s => 
            isCable ? s.cable_plan_id : s.internet_plan_id
        );

        let typeSumCurrent = 0;
        let typeSumUpcoming = 0;

        typeSubs.forEach(s => {
            const p = parseFloat(s.pending_amount) || 0;
            const c = parseFloat(s.current_amount) || 0;
            const o = parseFloat(s.other_service_charges) || 0;
            const u = parseFloat(s.upcoming_amount) || 0;

            const tillCurr = p + c + o;
            const tillUp = tillCurr + u;

            typeSumCurrent += tillCurr;
            typeSumUpcoming += tillUp;
        });

        // Update the new Text Elements beside the toggles
        const elTotalCurr = document.getElementById('typeTotalCurrentText');
        const elTotalUpc = document.getElementById('typeTotalUpcomingText');

        if (elTotalCurr) {
            elTotalCurr.innerText = `Total ${typeLabel} Pending (till Current) : ₹${typeSumCurrent}`;
        }
        if (elTotalUpc) {
            elTotalUpc.innerText = `Total ${typeLabel} Pending (till Upcoming) : ₹${typeSumUpcoming}`;
        }
        // -----------------------------------------------------------

        planTabsContainer.innerHTML = '';
        planTabsContainer.classList.add('hidden');

        if (type === 'cable') {
            toggleCable.classList.add('active');
            toggleInternet.classList.remove('active');
            document.getElementById('planTitle').innerText = "Cable Plan Details";
            document.getElementById('lblSpecific').innerText = "Setup Box ID No";
        } else {
            toggleInternet.classList.add('active');
            toggleCable.classList.remove('active');
            document.getElementById('planTitle').innerText = "Internet Plan Details";
            document.getElementById('lblSpecific').innerText = "Plan Mbps";
        }

        const matchingSubs = typeSubs; 

        if (matchingSubs.length > 0 || isEditMode) {
            planContainer.classList.remove('hidden');
            noPlanMsg.classList.add('hidden');

            let planToShow = matchingSubs.length > 0 ? matchingSubs[0] : null;
            if (targetSubId) {
                const found = matchingSubs.find(s => String(s.id) === String(targetSubId));
                if (found) planToShow = found;
            }

            // ✅ RENDER TABS + DELETED BUTTON
            if (matchingSubs.length >= 0 || isEditMode) { 
                planTabsContainer.classList.remove('hidden');
                planTabsContainer.innerHTML = ''; // Clear previous tabs

                // A. Render Active Plan Tabs
                matchingSubs.forEach((sub, index) => {
                    const btn = document.createElement('button');
                    btn.className = 'plan-tab-btn';
                    const planName = sub.plan_name_cached || `${type === 'cable' ? 'Cable' : 'Net'} Plan ${index + 1}`;
                    btn.innerText = planName;
                    
                    if (planToShow && sub.id === planToShow.id) btn.classList.add('active');

                    btn.addEventListener('click', () => {
                        // Switch UI to Active Mode
                        document.querySelectorAll('.plan-tab-btn').forEach(b => b.classList.remove('active'));
                        btn.classList.add('active');
                        
                        // Show Forms, Hide Deleted View
                        planHeaderRow.classList.remove('hidden');
                        planFormsWrapper.classList.remove('hidden');
                        deletedMainView.classList.add('hidden');
                        historyContainer.classList.add('hidden');
                        btnHistory.innerText = "History";

                        renderPlanDetails(sub);
                    });
                    planTabsContainer.appendChild(btn);
                });

                // B. ✅ Render "Deleted Plans" Button (FIXED TO RIGHT)
                const btnDel = document.createElement('button');
                btnDel.className = 'plan-tab-btn';
                // CSS MAGIC: This pushes the button to the far right
                btnDel.style.marginLeft = 'auto'; 
                btnDel.style.border = '1px solid #ffcdd2';
                btnDel.style.backgroundColor = '#ffebee';
                btnDel.style.color = '#c62828';
                btnDel.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4h6v2"></path></svg> Deleted Plans`;
                
                // ✅ UPDATED: Fetch Deleted Plans & Render as TABS
                btnDel.addEventListener('click', async () => {
                    const custId = sessionStorage.getItem('current_customer_id');
                    btnDel.innerText = "Loading...";
                    try {
                        const res = await window.pywebview.api.get_deleted_plans({ customer_id: custId });
                        if (res.ok) {
                            renderDeletedTabs(res.data);
                        } else {
                            showToast("Error: " + res.error, 'error');
                            btnDel.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4h6v2"></path></svg> Deleted Plans`;
                        }
                    } catch (e) {
                        showToast("API Error: Restart main.py", 'error');
                    }
                });
                planTabsContainer.appendChild(btnDel);

                // C. Add Plan Button (Edit Mode)
                if (isEditMode) {
                    const addBtn = document.createElement('button');
                    addBtn.className = 'add-plan-btn'; 
                    addBtn.innerHTML = `<span>+</span> Add Plan`;
                    addBtn.style.marginLeft = "10px";
                    addBtn.addEventListener('click', openAddPlanModal);
                    planTabsContainer.appendChild(addBtn);
                }
            }

            // Initial Render of Active Plan (if not in deleted mode)
            if (planToShow) {
                renderPlanDetails(planToShow);
                // Ensure standard view is visible
                planHeaderRow.classList.remove('hidden');
                planFormsWrapper.classList.remove('hidden');
                deletedMainView.classList.add('hidden');
            }

        } else {
            planContainer.classList.add('hidden');
            noPlanMsg.classList.remove('hidden');
            activeSubId = null;
        }
    }

    function renderPlanDetails(sub) {
        activeSubId = sub.id; 

        // ✅ RESET UI
        const payRow = document.querySelector('.payment-row');
        if(payRow) payRow.classList.remove('hidden');
        
        const actions = document.querySelector('.plan-actions');
        if(actions) actions.classList.remove('hidden');

        ['fCurrent', 'fUpcoming', 'calcTotalCurrent', 'calcTotalUpcoming'].forEach(id => {
            const el = document.getElementById(id);
            if(el && el.parentElement) el.parentElement.style.display = ''; 
        });
        
        document.getElementById('planTitle').style.color = ''; 
        
        const tabPay = document.getElementById('tabPaymentHistory');
        if(tabPay) tabPay.style.display = 'inline-block';
        
        // 1. Fetch Data
        let displayPrice = sub.price; 
        let displayDuration = sub.duration ? `${sub.duration} Days` : "30 Days"; 
        let displayName = sub.plan_name_cached || 'Unknown Plan';
        let specificInfo = '';

        // 2. Handle Specifics
        if (currentView === 'cable') {
            specificInfo = sub.setup_box_id || ''; 
        } else {
            specificInfo = sub.plan_mbps || (sub.internet_plans ? `${sub.internet_plans.speed_mbps} Mbps` : '');
        }

        // 3. Update Text Fields
        document.getElementById('pName').value = displayName;
        document.getElementById('pPrice').value = displayPrice;        
        document.getElementById('pDuration').value = displayDuration; 
        
        document.getElementById('pLastActive').value = sub.activation_date || '';
        document.getElementById('pRenewal').value = sub.current_billing_end_date || '';
        document.getElementById('pSpecificId').value = specificInfo;

        document.getElementById('fPending').value = sub.pending_amount || 0;
        document.getElementById('fCurrent').value = sub.current_amount || 0;
        document.getElementById('fUpcoming').value = sub.upcoming_amount || 0;
        document.getElementById('hiddenUpcomingPlanPrice').value = sub.upcoming_plan_price || sub.price || 0;
        document.getElementById('fOther').value = sub.other_service_charges || 0;

        document.getElementById('fAdditional').value = (sub.upcoming_additional_charge !== null && sub.upcoming_additional_charge !== undefined) ? sub.upcoming_additional_charge : (sub.additional_charge || 0);
        document.getElementById('fDiscount').value = (sub.upcoming_discount_amount !== null && sub.upcoming_discount_amount !== undefined) ? sub.upcoming_discount_amount : (sub.discount_amount || 0);

        document.getElementById('fAdvance').value = sub.advance_balance || 0;

        // ✅ NEW: Calculate exactly how much they ALREADY paid for the upcoming cycle
        window.baseUpcomingPrice = parseFloat(sub.upcoming_plan_price || sub.price || 0);
        const uAdd = parseFloat(document.getElementById('fAdditional').value) || 0;
        const uDisc = parseFloat(document.getElementById('fDiscount').value) || 0;
        let uTotal = (window.baseUpcomingPrice + uAdd) - uDisc;
        if (uTotal < 0) uTotal = 0;
        
        let uDebt = parseFloat(sub.upcoming_amount) || 0;
        window.currentUpcomingPaid = uTotal - uDebt;
        if (window.currentUpcomingPaid < 0) window.currentUpcomingPaid = 0;

        // ✅ CALL CALCULATION
        calculateTotals(); 
        
        // 5. Status & Buttons
        const status = sub.status || 'inactive';
        const pStatus = document.getElementById('pStatus');
        const isActive = status === 'active';

        pStatus.className = `status-badge ${isActive ? 'status-active' : 'status-inactive'}`;
        pStatus.innerHTML = `
            <span class="status-dot ${isActive ? 'dot-active' : 'dot-inactive'}"></span>
            ${isActive ? 'Active' : 'Inactive'}
        `;
        
        if (isActive) {
            btnToggleStatus.innerText = "Stop Plan";
            btnToggleStatus.className = "btn-action btn-red";
        } else {
            btnToggleStatus.innerText = "Start Plan";
            btnToggleStatus.className = "btn-action btn-green";
        }
    }

    // ✅ SMART CALCULATION LOGIC
    function calculateTotals() {
        // ✅ Use hidden field for upcoming_plan_price — no scope issues
        const upcomingPlanPrice = parseFloat(document.getElementById('hiddenUpcomingPlanPrice')?.value) || 0;
        const planPrice = upcomingPlanPrice > 0
            ? upcomingPlanPrice
            : parseFloat(document.getElementById('pPrice').value) || 0;

        const pend = parseFloat(document.getElementById('fPending').value) || 0;
        const curr = parseFloat(document.getElementById('fCurrent').value) || 0;
        const other = parseFloat(document.getElementById('fOther').value) || 0;

        const addInput = document.getElementById('fAdditional');
        const discInput = document.getElementById('fDiscount');
        const upcomingInput = document.getElementById('fUpcoming');

        const additional = parseFloat(addInput.value) || 0;
        const discount = parseFloat(discInput.value) || 0;

        let calculatedUpcoming = (planPrice + additional) - discount;
        if (calculatedUpcoming < 0) calculatedUpcoming = 0;

        let displayUpcoming = parseFloat(upcomingInput.value) || 0;

        if (document.activeElement === addInput || document.activeElement === discInput) {
            // ✅ FIX: Calculate the NEW total, then SUBTRACT what was already paid!
            let newTotal = (planPrice + additional) - discount;
            if (newTotal < 0) newTotal = 0;
            
            let newDebt = newTotal - (window.currentUpcomingPaid || 0);
            if (newDebt < 0) newDebt = 0; // If they overpaid, debt is 0

            displayUpcoming = calculatedUpcoming;
            upcomingInput.value = displayUpcoming;
        }

        document.getElementById('calcTotalCurrent').value = pend + curr + other;
        document.getElementById('calcTotalUpcoming').value = pend + curr + other + displayUpcoming;
    }

    ['fPending', 'fCurrent', 'fUpcoming', 'fAdditional', 'fDiscount', 'fOther'].forEach(id => {
        const el = document.getElementById(id);
        if(el) el.addEventListener('input', calculateTotals);
    });

    // -------------------------------------------------------------------------
    // ✅ 4. START/STOP BUTTON LISTENER (UPDATED WITH ADVANCE CHECK)
    // -------------------------------------------------------------------------
    
    // Modal Button Handlers
    if (btnCloseStartModal) btnCloseStartModal.addEventListener('click', () => startPlanModal.classList.add('hidden'));
    
    if (btnStartCurrentOnly) {
        btnStartCurrentOnly.addEventListener('click', () => {
            startPlanModal.classList.add('hidden');
            performToggleAPI(activeSubId, 'start', false); // pay_upcoming = false
        });
    }

    if (btnStartBoth) {
        btnStartBoth.addEventListener('click', () => {
            startPlanModal.classList.add('hidden');
            performToggleAPI(activeSubId, 'start', true); // pay_upcoming = true
        });
    }

    // Main Toggle Logic
    if (btnToggleStatus) {
        btnToggleStatus.addEventListener('click', async () => {
            if (!activeSubId) return;

            // ✅ FIX: Get status from the actual subscription data, not the DOM element
            // (DOM element might be hidden or have stale data when viewing history)
            const currentSub = subscriptions.find(s => s.id === activeSubId);
            if (!currentSub) {
                showToast("Plan not found.", 'error');
                return;
            }
            
            const currentStatus = (currentSub.status || 'inactive').toLowerCase();
            const action = currentStatus === 'active' ? 'stop' : 'start';
            
            // --- STOP LOGIC (Simple) ---
            if (action === 'stop') {
                if (!confirm("Stop this plan? It will become Inactive.")) return;
                await performToggleAPI(activeSubId, 'stop');
                return;
            }

            // --- START LOGIC (Complex) ---
            if (!confirm("Start this plan? It will reactivate from TODAY and recalculate validity.")) return;

            // Check Advance vs Cost
            const advance = parseFloat(document.getElementById('fAdvance').value) || 0;
            // NOTE: On 'Start', the visible 'Upcoming' becomes the 'Current' bill.
            const costToStart = parseFloat(document.getElementById('fUpcoming').value) || 0;

            // Elements to update dynamic text
            const btn1 = document.getElementById('btnStartCurrentOnly');
            const btn2 = document.getElementById('btnStartBoth');
            const textCase1 = document.getElementById('startPlanTextCase1');
            const textCase2 = document.getElementById('startPlanTextCase2');

            // Hide both text elements initially to ensure a clean slate
            if (textCase1) textCase1.classList.add('hidden');
            if (textCase2) textCase2.classList.add('hidden');

            // CASE 1: Current is 0 (Already Paid), but User has Advance -> Ask about Next Month
            if (costToStart === 0 && advance > 0) {
                if (textCase1) textCase1.classList.remove('hidden'); // Show Case 1 HTML
                btn1.innerText = "No, Keep in Advance";
                btn2.innerText = "Yes, Pay Upcoming";
                
                if(startPlanModal) startPlanModal.classList.remove('hidden');
                else await performToggleAPI(activeSubId, 'start', false); // Fallback
            }
            // CASE 2: Have enough for Current, AND extra for Upcoming -> Ask
            else if (advance > costToStart && costToStart > 0) {
                if (textCase2) textCase2.classList.remove('hidden'); // Show Case 2 HTML
                btn1.innerText = "Current Only";
                btn2.innerText = "Current & Upcoming";
                
                if(startPlanModal) startPlanModal.classList.remove('hidden');
                else await performToggleAPI(activeSubId, 'start', true);
            } 
            // CASE 3: Standard (Advance <= Cost, or 0) -> Just start (Backend handles partial pay)
            else {
                await performToggleAPI(activeSubId, 'start', true);
            }
        });
    }

    async function performToggleAPI(subId, action, payUpcomingWithAdvance = true) {
        try {
            // ✅ Remember if we're currently viewing history
            const wasViewingHistory = !historyContainer.classList.contains('hidden');
            
            const res = await window.pywebview.api.toggle_subscription_status({
                subscription_id: subId,
                action: action,
                pay_upcoming_with_advance: payUpcomingWithAdvance
            });

            if (res.ok) {
                await fetchDetails(true); 
                
                // ✅ If we were viewing history, switch back to history view
                if (wasViewingHistory) {
                    planFormsWrapper.classList.add('hidden');
                    historyContainer.classList.remove('hidden');
                    btnHistory.innerText = "Plan Details";
                    
                    // Reload the appropriate history based on context
                    const tabPlan = document.getElementById('tabPlanHistory');
                    if (tabPlan && tabPlan.classList.contains('active')) {
                        await loadPlanHistory();
                    } else {
                        await loadPaymentHistory();
                    }
                }
            } else {
                showToast("Error: " + res.error, 'error');
            }
        } catch (err) {
            showToast("System Error: " + err, 'error');
        }
    }

    // -------------------------------------------------------------------------
    // ✅ HISTORY VIEW LOGIC (TAB SWITCHING FIXED)
    // -------------------------------------------------------------------------
    
    if (btnHistory) {
        btnHistory.addEventListener('click', async () => {
            // Check if History is currently visible
            const isHistoryVisible = !historyContainer.classList.contains('hidden');

            if (isHistoryVisible) {
                // -> GO BACK TO PLAN DETAILS
                historyContainer.classList.add('hidden');
                planFormsWrapper.classList.remove('hidden'); // Show Forms
                
                btnHistory.innerText = "History";
            } else {
                // -> SHOW HISTORY
                planFormsWrapper.classList.add('hidden'); // Hide Forms
                historyContainer.classList.remove('hidden'); // Show History
                
                btnHistory.innerText = "Plan Details"; // Change Button Text
                
                // Load Data
                await loadPaymentHistory();
            }
        });
    }

    async function loadPaymentHistory() {
        const custId = sessionStorage.getItem('current_customer_id');
        const viewBody = document.getElementById('paymentHistoryBody');
        const rowTemplate = document.getElementById('paymentRowTemplate');
        const msgTemplate = document.getElementById('paymentMsgTemplate');
        
        // Ensure elements exist before proceeding
        if (!viewBody || !rowTemplate || !msgTemplate) return;

        // --- Helper Function for Loading, Empty, and Error messages ---
        function showMessage(text, isError = false, isEmpty = false) {
            viewBody.innerHTML = '';
            const clone = msgTemplate.content.cloneNode(true);
            const td = clone.querySelector('.pay-msg-cell');
            
            td.textContent = text;
            if (isError) {
                td.style.color = 'red';
                td.style.padding = '15px';
            }
            if (isEmpty) {
                td.classList.add('empty-history');
            }
            viewBody.appendChild(clone);
        }

        // Show initial loading state
        showMessage('Loading transactions...');

        try {
            const res = await window.pywebview.api.get_payment_history({ customer_id: custId });
            
            if (res.ok) {
                const payments = res.data || [];
                viewBody.innerHTML = '';

                if (payments.length === 0) {
                    showMessage('No payment transactions found.', false, true);
                    return;
                }

                // --- Render Payment Rows ---
                payments.forEach(pay => {
                    const clone = rowTemplate.content.cloneNode(true);
                    
                    // 1. Set Date & Time
                    clone.querySelector('.pay-date-text').textContent = pay.date;
                    const timeEl = clone.querySelector('.pay-time-text');
                    
                    if (pay.created_at) {
                        const t = new Date(pay.created_at);
                        timeEl.textContent = t.toLocaleTimeString('en-IN', {
                            timeZone: 'Asia/Kolkata',
                            hour: '2-digit', minute: '2-digit', hour12: true
                        });
                    } else {
                        timeEl.style.display = 'none'; // Hide if no time exists
                    }
                    
                    // 2. Set Amount & Mode
                    clone.querySelector('.pay-amount').textContent = `₹${pay.amount}`;
                    clone.querySelector('.pay-mode').textContent = pay.mode ? pay.mode.toUpperCase() : '-';

                    // 3. Set Dynamic Details/Cheque info
                    const detailEl = clone.querySelector('.pay-detail');
                    if (pay.mode === 'cheque') {
                        const span = document.createElement('span');
                        span.style.cssText = "color:#1565c0; font-weight:500;";
                        span.textContent = `Cheque: ${pay.cheque_number || 'N/A'}`;
                        detailEl.appendChild(span);
                    } else if (pay.mode === 'transfer') {
                        const span = document.createElement('span');
                        span.style.cssText = "color:#e65100; font-weight:600;";
                        span.textContent = pay.cheque_number || 'Transfer';
                        detailEl.appendChild(span);
                    } else {
                        detailEl.textContent = "Payment Received";
                    }

                    viewBody.appendChild(clone);
                });
            } else {
                showMessage(`Error: ${res.error}`, true);
            }
        } catch (err) {
            showMessage('System Error', true);
        }
    }

    // ✅ SHARED HELPER: Processes payment list into OSC/transfer/rev buckets
    function extractCyclePaymentAmounts(currentCyclePayments) {
        let oscPaidAmt = 0;
        let planTransferredAmt = 0;
        let oscTransferredAmt = 0;
        let revAmount = 0;

        if (currentCyclePayments) {
            currentCyclePayments.forEach(p => {
                const detailsLower = (p.details || "").toLowerCase();
                const modeLower = (p.mode || "").toLowerCase();

                if (detailsLower.includes("transferred to")) {
                    if (detailsLower.includes("osc")) {
                        oscTransferredAmt += Math.abs(parseFloat(p.amount || 0));
                    } else {
                        planTransferredAmt += Math.abs(parseFloat(p.amount || 0));
                    }
                } else if (detailsLower.includes("debt rev") || modeLower.includes("deleted plan adjustment") || detailsLower.includes("added as osc")) {
                    revAmount += Math.abs(parseFloat(p.amount || 0));
                } else if (detailsLower.includes("other charges") || detailsLower.includes("other service charges") || modeLower.includes("other charges")) {
                    oscPaidAmt += parseFloat(p.amount || 0);
                }
            });
        }

        return { oscPaidAmt, planTransferredAmt, oscTransferredAmt, revAmount };
    }

    // ✅ SHARED HELPER: Used by both loadPlanHistory and renderHistoryTableManually
    function calculateOscDisplay(originalTotal, paid, prevSnapshot, transferredAmount = 0, revAmount = 0) {
        let html = '-';
        if (originalTotal > 0) {
            let tag = "(Add)";
            let breakdown = "";

            if (prevSnapshot > 0) {
                const diff = originalTotal - prevSnapshot;
                if (Math.abs(diff) < 1) tag = "(Prev)"; 
                else if (diff > 0) {
                    tag = "(Upd)";
                    if (revAmount > 0) {
                        const standardAdd = diff - revAmount;
                        if (standardAdd > 0) breakdown = `<span style="color:#555;">(₹${prevSnapshot} Prev + ₹${standardAdd} Add + ₹${revAmount} Recv)</span>`;
                        else breakdown = `<span style="color:#555;">(₹${prevSnapshot} Prev + ₹${revAmount} Recv)</span>`;
                    } else {
                        breakdown = `<span style="color:#555;">(₹${prevSnapshot} Prev + ₹${diff} Add)</span>`;
                    }
                } else if (diff < 0) {
                    tag = "(Upd)";
                    breakdown = `<span style="color:#555;">(₹${prevSnapshot} Prev - ₹${Math.abs(diff)} Sub)</span>`;
                }
            } else {
                // ✅ FIX: Calculate Add/Sub even if there is NO previous snapshot
                if (revAmount > 0) {
                    const manualAdd = originalTotal - revAmount;
                    if (manualAdd > 0) {
                        tag = "(Upd)";
                        breakdown = `<span style="color:#555;">(₹${revAmount} Recv + ₹${manualAdd} Add)</span>`;
                    } else if (manualAdd < 0) {
                        tag = "(Upd)";
                        breakdown = `<span style="color:#555;">(₹${revAmount} Recv - ₹${Math.abs(manualAdd)} Sub)</span>`;
                    } else {
                        tag = "(Recv)";
                    }
                }
            }

            const remaining = originalTotal - paid - transferredAmount;

            if (remaining <= 0 && transferredAmount === 0 && paid > 0) {
                html = `₹${originalTotal} <span style="font-weight:bold; color:#2e7d32;">(Paid)</span>`;
            } else {
                html = `₹${originalTotal} <span style="font-weight:bold; color:#1565c0;">${tag}</span>`;
            }

            if (breakdown) html += `<div style="font-size:10px; margin-top:2px;">${breakdown}</div>`;
            
            if (paid > 0 || transferredAmount > 0) {
                let pText = [];
                if (paid > 0) pText.push(`₹${paid} paid`);
                if (transferredAmount > 0) pText.push(`₹${transferredAmount} transferred`);
                let color = transferredAmount > 0 ? '#c62828' : '#2e7d32'; 
                html += `<div style="font-size:10px; color:${color}; margin-top:2px; font-weight:bold;">(${pText.join(' + ')})</div>`;
            }
        }
        return html;
    }

    // ✅ CORRECTED: loadPlanHistory (Template Based - Logic Unchanged)
    async function loadPlanHistory() {
        const viewPlan = document.getElementById('planHistoryView');
        const tplTable = document.getElementById('planHistoryTableTemplate');
        const tplUpcoming = document.getElementById('planRowUpcomingTemplate');
        const tplCurrent = document.getElementById('planRowCurrentTemplate');
        const tplPast = document.getElementById('planRowPastTemplate');
        const tplMsg = document.getElementById('planMsgTemplate');

        if (!viewPlan || !tplTable || !tplUpcoming || !tplCurrent || !tplPast || !tplMsg) return;

        // Helper function to show text messages based on the template
        function showMessage(text, isError = false, isEmpty = false) {
            viewPlan.innerHTML = '';
            const clone = tplMsg.content.cloneNode(true);
            const p = clone.querySelector('.plan-msg-cell');
            p.innerHTML = text;
            if (isError) p.style.color = 'red';
            if (isEmpty) p.classList.add('empty-history');
            viewPlan.appendChild(clone);
        }

        showMessage('Loading plan history...');

        if (!activeSubId) {
            showMessage('No active plan selected.', false, true);
            return;
        }

        try {
            // 1. Fetch History
            const histRes = await window.pywebview.api.get_history_logs({ subscription_id: activeSubId });
            if (!histRes.ok) {
                showMessage(`Error: ${histRes.error}`, true);
                return;
            }

            const logs = histRes.data || [];
            const currentSub = subscriptions.find(s => s.id === activeSubId);

            let cStartDate = new Date().toISOString();
            let cEndDate = '-';
            let isActive = false;

            if (currentSub) {
                isActive = (currentSub.status === 'active');
                cStartDate = currentSub.current_billing_start_date || new Date().toISOString();
                cEndDate = currentSub.current_billing_end_date || '-';
            }

            // 2. Fetch Payments
            let currentCyclePayments = [];
            if (currentSub) { 
                try {
                    const payRes = await window.pywebview.api.get_cycle_payments({
                        subscription_id: activeSubId,
                        cycle_start_date: cStartDate
                    });
                    if (payRes.ok) currentCyclePayments = payRes.data || [];
                } catch (e) { console.log("Current Payment fetch error", e); }
            }

            // Setup Table Wrapper
            const tableClone = tplTable.content.cloneNode(true);
            const tbody = tableClone.querySelector('tbody');

            // --- A. UPCOMING ROW ---
            if (currentSub) {
                const uBase = parseFloat(currentSub.upcoming_plan_price || currentSub.price) || 0;
                const uAdd = parseFloat(currentSub.upcoming_additional_charge !== null ? currentSub.upcoming_additional_charge : currentSub.additional_charge) || 0;
                const uDisc = parseFloat(currentSub.upcoming_discount_amount !== null ? currentSub.upcoming_discount_amount : currentSub.discount_amount) || 0;
                const uBill = (uBase + uAdd) - uDisc;
                const uDebt = parseFloat(currentSub.upcoming_amount) || 0;
                let uPaid = uBill - uDebt;
                if (uPaid < 0) uPaid = 0;

                const upClone = tplUpcoming.content.cloneNode(true);
                upClone.querySelector('.td-plan').textContent = currentSub.plan_name_cached || 'Next Plan';
                upClone.querySelector('.td-base').textContent = `₹${uBase}`;
                upClone.querySelector('.td-add').textContent = uAdd > 0 ? '+' + uAdd : '-';
                upClone.querySelector('.td-disc').textContent = uDisc > 0 ? '-' + uDisc : '-';
                upClone.querySelector('.td-bill').textContent = `₹${uBill}`;
                upClone.querySelector('.td-paid').textContent = `₹${uPaid}`;
                upClone.querySelector('.btn-view').onclick = () => openViewDates(currentSub.id, cStartDate, '', true);
                
                tbody.appendChild(upClone);
            }

            // --- B. CURRENT / MOST RECENT ROW ---
            if (currentSub) {
                const cBase = parseFloat(currentSub.price) || 0;
                const cAdd = parseFloat(currentSub.additional_charge) || 0;
                const cDisc = parseFloat(currentSub.discount_amount) || 0;
                const cOtherRemaining = parseFloat(currentSub.other_service_charges) || 0;
                const cBillPlanOnly = (cBase + cAdd) - cDisc;
                const totalPending = parseFloat(currentSub.current_amount) || 0;

                const { oscPaidAmt, planTransferredAmt, oscTransferredAmt, revAmount } = extractCyclePaymentAmounts(currentCyclePayments);

                let perceivedPaid = cBillPlanOnly - totalPending;
                if (perceivedPaid < 0) perceivedPaid = 0;
                let planPaidAmt = perceivedPaid - planTransferredAmt;
                if (planPaidAmt < 0) planPaidAmt = 0;

                const cTotalOsc = cOtherRemaining + oscPaidAmt + oscTransferredAmt;
                let lastHistorySnapshot = 0;
                if (logs.length > 0) lastHistorySnapshot = parseFloat(logs[0].osc_snapshot) || 0;

                const oscDisplay = calculateOscDisplay(cTotalOsc, oscPaidAmt, lastHistorySnapshot, oscTransferredAmt, revAmount);
                
                const displayStart = cStartDate.includes('T') ? cStartDate.split('T')[0] : cStartDate;
                const displayEnd = cEndDate.includes('T') ? cEndDate.split('T')[0] : cEndDate;

                let rowLabel = "CURRENT";
                let statusHtml = "";
                let rowColor = "#f57f17"; 
                let rowBg = "#f9fbe7";
                let borderLeft = "#fbc02d"; 
                
                let dateHtml = `${displayStart} to ${displayEnd}`;

                if (isActive) {
                    statusHtml = '<span style="background:#fff9c4; color:#fbc02d; padding:2px 6px; border-radius:10px; font-size:10px;">ACTIVE</span>';
                } else {
                    rowLabel = "MOST RECENT";
                    rowColor = "#546e7a"; 
                    rowBg = "#eceff1";
                    borderLeft = "#78909c"; 

                    dateHtml = `
                        <div>${displayStart} to ${displayEnd}</div>
                        <div style="color:#c62828; font-weight:bold; font-size:10px; margin-top:2px;">(STOPPED)</div>
                    `;

                    const totalDebt = totalPending + cOtherRemaining;
                    const isTransferredOut = (oscTransferredAmt > 0 || planTransferredAmt > 0 || currentSub.status === 'transferred');

                    if (isTransferredOut) {
                        statusHtml = '<span style="background:#e1bee7; color:#7b1fa2; padding:2px 6px; border-radius:10px; font-size:10px;">TRANSFERRED</span>';
                    } else if (totalDebt <= 0.5) {
                        statusHtml = '<span style="background:#c8e6c9; color:#2e7d32; padding:2px 6px; border-radius:10px; font-size:10px;">CLEARED</span>';
                    } else if (planPaidAmt > 0 || oscPaidAmt > 0) {
                        statusHtml = '<span style="background:#ffcc80; color:#e65100; padding:2px 6px; border-radius:10px; font-size:10px;">PARTIAL</span>';
                    } else {
                        statusHtml = '<span style="background:#ffcdd2; color:#c62828; padding:2px 6px; border-radius:10px; font-size:10px;">UNPAID</span>';
                    }
                }

                const curClone = tplCurrent.content.cloneNode(true);
                const tr = curClone.querySelector('tr');
                tr.style.backgroundColor = rowBg;
                tr.style.opacity = '0.9';
                tr.style.borderLeft = `3px solid ${borderLeft}`;
                
                const tdLabel = curClone.querySelector('.td-label');
                tdLabel.textContent = rowLabel;
                tdLabel.style.color = rowColor;

                curClone.querySelector('.td-date').innerHTML = dateHtml;
                curClone.querySelector('.td-plan').textContent = currentSub.plan_name_cached || 'Current';
                curClone.querySelector('.td-base').textContent = `₹${cBase}`;
                curClone.querySelector('.td-add').textContent = cAdd > 0 ? '+' + cAdd : '-';
                curClone.querySelector('.td-disc').textContent = cDisc > 0 ? '-' + cDisc : '-';
                curClone.querySelector('.td-other').innerHTML = oscDisplay;
                curClone.querySelector('.td-bill').textContent = `₹${cBillPlanOnly}`;
                curClone.querySelector('.td-paid').textContent = `₹${planPaidAmt}`;
                curClone.querySelector('.td-status').innerHTML = statusHtml;
                curClone.querySelector('.btn-view').onclick = () => openViewDates(currentSub.id, cStartDate, cEndDate, false);

                tbody.appendChild(curClone);
            }

            // --- C. PAST HISTORY ---
            // ✅ FASTER: Fire all API calls at the same time instead of one by one
            const allPastPayments = await Promise.all(
                logs.map(log =>
                    window.pywebview.api.get_cycle_payments({
                        subscription_id: activeSubId,
                        cycle_start_date: log.start_date
                    }).catch(() => ({ ok: false, data: [] }))
                )
            );

            for (let i = 0; i < logs.length; i++) {
                const log = logs[i];
                let start = (log.start_date || '-').split('T')[0];
                let end = (log.end_date || '-').split('T')[0];
                const base = parseFloat(log.price) || 0;
                const add = parseFloat(log.additional_charge) || 0;
                const disc = parseFloat(log.discount_amount) || 0;
                const bill = parseFloat(log.bill_amount) || 0;
                const remainingSnap = parseFloat(log.osc_snapshot) || 0;
                const paidOsc = parseFloat(log.osc_paid_amount) || parseFloat(log.calculated_osc_paid) || 0;
                const originalOSC = remainingSnap + paidOsc;
                const olderHistorySnapshot = (i + 1 < logs.length) ? (parseFloat(logs[i + 1].osc_snapshot) || 0) : 0;
                
                const pastPayments = (allPastPayments[i]?.ok ? allPastPayments[i].data : []) || [];

                let pTransferredAmount = 0;
                let pRevAmount = 0;
                pastPayments.forEach(p => {
                    const d = (p.details || "").toLowerCase();
                    const m = (p.mode || "").toLowerCase();
                    if (d.includes("transferred to") && d.includes("osc")) {
                        pTransferredAmount += Math.abs(parseFloat(p.amount || 0));
                    }
                    if (d.includes("debt rev") || m.includes("deleted plan adjustment") || d.includes("added as osc")) {
                        pRevAmount += Math.abs(parseFloat(p.amount || 0));
                    }
                });

                const oscDisplay = calculateOscDisplay(originalOSC, paidOsc, olderHistorySnapshot, pTransferredAmount, pRevAmount);

                const pastClone = tplPast.content.cloneNode(true);
                pastClone.querySelector('.td-start').textContent = start;
                pastClone.querySelector('.td-end').textContent = `to ${end}`;
                pastClone.querySelector('.td-plan').textContent = log.plan_name || '-';
                pastClone.querySelector('.td-base').textContent = `₹${base}`;
                pastClone.querySelector('.td-add').textContent = add || '-';
                pastClone.querySelector('.td-disc').textContent = disc || '-';
                pastClone.querySelector('.td-other').innerHTML = oscDisplay;
                pastClone.querySelector('.td-bill').textContent = `₹${bill}`;
                pastClone.querySelector('.td-paid').textContent = `₹${log.paid_amount}`;
                pastClone.querySelector('.td-status').innerHTML = `<span style="background:#c8e6c9; color:#2e7d32; padding:2px 6px; border-radius:10px; font-size:10px;">${(log.status||'').toUpperCase()}</span>`;
                pastClone.querySelector('.btn-view').onclick = () => openViewDates(log.id, log.start_date, log.end_date, false);

                tbody.appendChild(pastClone);
            }

            viewPlan.innerHTML = '';
            viewPlan.appendChild(tableClone);
        } catch (err) {
            showMessage(`System Error: ${err.message}`, true);
        }
    }

    // ✅ Tab Switching Logic (Unchanged)
    const tabPay = document.getElementById('tabPaymentHistory');
    const tabPlan = document.getElementById('tabPlanHistory');
    const viewPay = document.getElementById('paymentHistoryView');
    const viewPlan = document.getElementById('planHistoryView');

    if (tabPay && tabPlan) {
        tabPay.addEventListener('click', () => {
            tabPay.classList.add('active');
            tabPlan.classList.remove('active');
            viewPay.classList.remove('hidden');
            viewPlan.classList.add('hidden');
        });

        tabPlan.addEventListener('click', () => {
            tabPlan.classList.add('active');
            tabPay.classList.remove('active');
            viewPlan.classList.remove('hidden');
            viewPay.classList.add('hidden');
            
            // ✅ Actually load the data when clicked
            if (!isViewingDeletedPlan) {
                loadPlanHistory();
            }
        });
    }

    // ---------------------------------------------------------
    // ✅ DELETED PLANS LOGIC
    // ---------------------------------------------------------

    // ✅ CORRECTED: renderHistoryTableManually (Template Based - Logic 100% Unchanged)
    async function renderHistoryTableManually(logs, currentSub, currentCyclePayments) {
        const viewPlan = document.getElementById('planHistoryView');
        const tplTable = document.getElementById('archivedHistoryTableTemplate');
        const tplRecent = document.getElementById('archivedRowRecentTemplate');
        const tplPast = document.getElementById('archivedRowPastTemplate');
        const tplMsg = document.getElementById('archivedMsgTemplate');

        if (!viewPlan || !tplTable || !tplRecent || !tplPast || !tplMsg) return;

        
        // Set up the table wrapper
        viewPlan.innerHTML = '';
        const tableClone = tplTable.content.cloneNode(true);
        const tbody = tableClone.querySelector('tbody');

        // --- 1. RENDER 'MOST RECENT' ROW (The Yellow Row) ---
        if (currentSub) {
            const cBase = parseFloat(currentSub.price) || 0;
            const cAdd = parseFloat(currentSub.additional_charge) || 0;
            const cDisc = parseFloat(currentSub.discount_amount) || 0;
            const cOtherRemaining = parseFloat(currentSub.other_service_charges) || 0;
            const cBillPlanOnly = (cBase + cAdd) - cDisc;
            const totalPending = parseFloat(currentSub.current_amount) || 0;

            const { oscPaidAmt, planTransferredAmt, oscTransferredAmt, revAmount } = extractCyclePaymentAmounts(currentCyclePayments);

            let perceivedPaid = cBillPlanOnly - totalPending;
            if (perceivedPaid < 0) perceivedPaid = 0;
            
            let planPaidAmt = perceivedPaid - planTransferredAmt;
            if (planPaidAmt < 0) planPaidAmt = 0;
            
            const cTotalOsc = cOtherRemaining + oscPaidAmt + oscTransferredAmt;

            let lastHistorySnapshot = 0;
            if (logs.length > 0) {
                lastHistorySnapshot = parseFloat(logs[0].osc_snapshot) || 0;
            }

            const oscDisplay = calculateOscDisplay(cTotalOsc, oscPaidAmt, lastHistorySnapshot, oscTransferredAmt, revAmount);
            
            const cStartDate = currentSub.current_billing_start_date || "";
            const cEndDate = currentSub.current_billing_end_date || "";
            const displayStart = cStartDate.includes('T') ? cStartDate.split('T')[0] : cStartDate;
            const displayEnd = cEndDate.includes('T') ? cEndDate.split('T')[0] : cEndDate;

            const totalDebt = totalPending + cOtherRemaining;
            let statusHtml = "";
            
            const isTransferredOut = (oscTransferredAmt > 0 || planTransferredAmt > 0 || currentSub.status === 'transferred');

            if (isTransferredOut) {
                 statusHtml = '<span style="background:#e1bee7; color:#7b1fa2; padding:2px 6px; border-radius:10px; font-size:10px;">TRANSFERRED</span>';
            } else if (totalDebt <= 0.5) {
                 statusHtml = '<span style="background:#c8e6c9; color:#2e7d32; padding:2px 6px; border-radius:10px; font-size:10px;">CLEARED</span>';
            } else if (planPaidAmt > 0 || oscPaidAmt > 0) {
                 statusHtml = '<span style="background:#ffcc80; color:#e65100; padding:2px 6px; border-radius:10px; font-size:10px;">PARTIAL</span>';
            } else {
                 statusHtml = '<span style="background:#ffcdd2; color:#c62828; padding:2px 6px; border-radius:10px; font-size:10px;">UNPAID</span>';
            }

            // Clone and populate Recent Template
            const recClone = tplRecent.content.cloneNode(true);
            recClone.querySelector('.td-date').textContent = `${displayStart} to ${displayEnd}`;
            recClone.querySelector('.td-plan').textContent = currentSub.plan_name_cached || '-';
            recClone.querySelector('.td-base').textContent = `₹${cBase}`;
            recClone.querySelector('.td-add').textContent = cAdd > 0 ? '+' + cAdd : '-';
            recClone.querySelector('.td-disc').textContent = cDisc > 0 ? '-' + cDisc : '-';
            recClone.querySelector('.td-other').innerHTML = oscDisplay;
            recClone.querySelector('.td-bill').textContent = `₹${cBillPlanOnly}`;
            recClone.querySelector('.td-paid').textContent = `₹${planPaidAmt}`;
            recClone.querySelector('.td-status').innerHTML = statusHtml;
            recClone.querySelector('.btn-view').onclick = () => openViewDates(currentSub.id, cStartDate, cEndDate, false);

            tbody.appendChild(recClone);
        }

        // --- 2. RENDER PAST HISTORY ROWS ---
        if (!logs || logs.length === 0) {
            if(!currentSub) {
                const msgClone = tplMsg.content.cloneNode(true);
                tbody.appendChild(msgClone);
            }
        } else {
            // ✅ FASTER: Fire all API calls at the same time instead of one by one
            const allPastPayments = await Promise.all(
                logs.map(log =>
                    window.pywebview.api.get_cycle_payments({
                        subscription_id: log.subscription_id || currentSub.id,
                        cycle_start_date: log.start_date
                    }).catch(() => ({ ok: false, data: [] }))
                )
            );
            for (let i = 0; i < logs.length; i++) {
                const log = logs[i];
                let start = (log.start_date || '-').split('T')[0];
                let end = (log.end_date || '-').split('T')[0];
                
                const add = parseFloat(log.additional_charge) || 0;
                const disc = parseFloat(log.discount_amount) || 0;

                const remainingSnap = parseFloat(log.osc_snapshot) || 0;
                const paidOsc = parseFloat(log.osc_paid_amount) || 0; 
                const originalOSC = remainingSnap + paidOsc;
                
                const olderHistorySnapshot = (i + 1 < logs.length) ? (parseFloat(logs[i + 1].osc_snapshot) || 0) : 0;
                
                const pastPayments = (allPastPayments[i]?.ok ? allPastPayments[i].data : []) || [];

                let pTransferredAmount = 0;
                let pRevAmount = 0;
                pastPayments.forEach(p => {
                    const d = (p.details || "").toLowerCase();
                    const m = (p.mode || "").toLowerCase();
                    if (d.includes("transferred to") && d.includes("osc")) {
                        pTransferredAmount += Math.abs(parseFloat(p.amount || 0));
                    }
                    if (d.includes("debt rev") || m.includes("deleted plan adjustment") || d.includes("added as osc")) {
                        pRevAmount += Math.abs(parseFloat(p.amount || 0));
                    }
                });

                // Pass the actual database numbers instead of "0, 0"!
                const oscDisplay = calculateOscDisplay(originalOSC, paidOsc, olderHistorySnapshot, pTransferredAmount, pRevAmount);
                
                let statusStyle = '';
                if (log.status === 'transferred') statusStyle = 'background:#e1bee7; color:#7b1fa2;';
                else if (log.status === 'cleared') statusStyle = 'background:#c8e6c9; color:#2e7d32;';
                else if (log.status === 'partial') statusStyle = 'background:#ffcc80; color:#e65100;';
                else statusStyle = 'background:#ffcdd2; color:#c62828;';

                // Clone and populate Past Template
                const pastClone = tplPast.content.cloneNode(true);
                pastClone.querySelector('.td-start').textContent = start;
                pastClone.querySelector('.td-end').textContent = `to ${end}`;
                pastClone.querySelector('.td-plan').textContent = log.plan_name || '-';
                pastClone.querySelector('.td-base').textContent = `₹${log.price}`;
                pastClone.querySelector('.td-add').textContent = add > 0 ? '+' + add : '-';
                pastClone.querySelector('.td-disc').textContent = disc > 0 ? '-' + disc : '-';
                pastClone.querySelector('.td-other').innerHTML = oscDisplay;
                pastClone.querySelector('.td-bill').textContent = `₹${log.bill_amount}`;
                pastClone.querySelector('.td-paid').textContent = `₹${log.paid_amount}`;
                
                const statusBadge = pastClone.querySelector('.status-badge-archived');
                statusBadge.style.cssText = `${statusStyle} padding:2px 6px; border-radius:10px; font-size:10px;`;
                statusBadge.textContent = (log.status||'').toUpperCase();

                pastClone.querySelector('.btn-view').onclick = () => openViewDates(log.id, log.start_date, log.end_date, false);

                tbody.appendChild(pastClone);
            }
        }
        
        // Append the constructed table to the DOM
        viewPlan.appendChild(tableClone);
    }

    // --- 5. EDIT MODE LOGIC ---
    const personalFields = ['infoName', 'infoPhone', 'infoAltPhone', 'infoEmail', 'infoAadhaar', 'infoShortAddr', 'infoLongAddr', 'infoNotes'];
    const pencilFields = ['pSpecificId', 'fAdditional', 'fDiscount'];

    if(btnEdit) {
        btnEdit.addEventListener('click', () => {
            isEditMode = true; 
            footerDefault.classList.add('hidden');
            footerEdit.classList.remove('hidden');
            if(btnRemovePlan) btnRemovePlan.classList.remove('hidden');

            personalFields.forEach(id => {
                const el = document.getElementById(id);
                if(el) { el.readOnly = false; el.classList.add('editable-pencil'); }
            });

            pencilFields.forEach(id => {
                const el = document.getElementById(id);
                if(id === 'pSpecificId' && currentView === 'internet') return; 
                if(el) { el.readOnly = false; el.classList.add('editable-pencil'); }
            });
            switchView(currentView, activeSubId);
        });
    }

    if(btnCancel) {
        btnCancel.addEventListener('click', () => {
            isEditMode = false;
            footerEdit.classList.add('hidden');
            footerDefault.classList.remove('hidden');
            if(btnRemovePlan) btnRemovePlan.classList.add('hidden');

            document.querySelectorAll('.editable, .editable-pencil, .editable-date').forEach(el => {
                el.readOnly = true;
                el.classList.remove('editable', 'editable-pencil', 'editable-date');
            });

            renderProfile();
            if(activeSubId) {
                const exists = subscriptions.find(s => s.id === activeSubId);
                if(exists) {
                    renderPlanDetails(exists);
                    switchView(currentView, activeSubId);
                } else {
                    switchView(currentView);
                }
            } else {
                switchView(currentView);
            }
        });
    }

    function updateRenewalDate() {
        const dateStr = document.getElementById('pLastActive').value;
        if(!dateStr) return;
        const dateObj = new Date(dateStr);
        if(isNaN(dateObj)) return;

        let dur = 30;
        const durText = document.getElementById('pDuration').value;
        if (durText) {
            const parsed = parseInt(durText);
            if (!isNaN(parsed)) dur = parsed;
        }
        dateObj.setDate(dateObj.getDate() + dur);
        const yyyy = dateObj.getFullYear();
        const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
        const dd = String(dateObj.getDate()).padStart(2, '0');
        document.getElementById('pRenewal').value = `${yyyy}-${mm}-${dd}`;
    }

    // --- 6. ADD PLAN MODAL LOGIC ---
    if(closeAddModal) {
        closeAddModal.addEventListener('click', () => addModal.classList.add('hidden'));
    }

    async function openAddPlanModal() {
        const userId = sessionStorage.getItem('user_id');
        const custId = sessionStorage.getItem('current_customer_id');
        selectedPlanToAdd = null; 
        addModal.classList.remove('hidden');
        addConfirmSection.classList.add('hidden'); 
        document.getElementById('modalTitle').innerText = `Add New ${currentView === 'cable' ? 'Cable' : 'Internet'} Plan`;
        addModalGrid.innerHTML = '<p style="padding:20px; text-align:center;">Loading Plans...</p>';

        try {
            const res = await window.pywebview.api.get_available_plans({ 
                user_id: userId, 
                customer_id: custId,
                type: currentView 
            });
            if (res.ok) {
                renderAvailablePlans(res.data);
            } else {
                addModalGrid.innerHTML = `<p style="color:red; padding:20px;">Error: ${res.error}</p>`;
            }
        } catch (err) {
            console.error(err);
            addModalGrid.innerHTML = `<p style="color:red; padding:20px;">System Error.</p>`;
        }
    }

    function renderAvailablePlans(plans) {
        const addModalGrid = document.getElementById('availablePlansGrid');
        const noPlansTpl = document.getElementById('noPlansMsgTemplate');
        const cardTpl = document.getElementById('planCardTemplate');
        
        addModalGrid.innerHTML = '';
        
        if (plans.length === 0) {
            addModalGrid.appendChild(noPlansTpl.content.cloneNode(true));
            return;
        }

        const confirmSection = document.getElementById('addPlanConfirmSection');
        const confirmPlanName = document.getElementById('confirmPlanName');
        const iAdd = document.getElementById('newPlanAdd');
        const iDisc = document.getElementById('newPlanDisc');
        const iNet = document.getElementById('newPlanNet');

        plans.forEach(plan => {
            let name = plan.name;
            if (currentView === 'internet' && !name) name = `${plan.speed_mbps} Mbps Plan`;

            // Clone the card template
            const cardClone = cardTpl.content.cloneNode(true);
            const cardDiv = cardClone.querySelector('.selection-card');
            
            cardClone.querySelector('.card-name').textContent = name;
            cardClone.querySelector('.card-price').textContent = `₹${plan.price}`;
            cardClone.querySelector('.card-duration').textContent = `${plan.duration} Days`;
            
            cardDiv.addEventListener('click', () => {
                document.querySelectorAll('.selection-card').forEach(c => c.classList.remove('selected'));
                cardDiv.classList.add('selected');
                selectedPlanToAdd = { planObj: plan, name: name };

                // Fill the static HTML inputs with the selected plan's data
                confirmPlanName.textContent = name;
                iAdd.value = 0;
                iDisc.value = 0;
                iNet.textContent = plan.price;
                
                confirmSection.classList.remove('hidden');

                // ✅ SAFE LOGIC: Using .oninput prevents the bug of stacking multiple listeners 
                // every time you click a different card!
                function updateModalTotal() {
                    const base = parseFloat(plan.price) || 0;
                    const add = parseFloat(iAdd.value) || 0;
                    const disc = parseFloat(iDisc.value) || 0;
                    let total = (base + add) - disc;
                    if(total < 0) total = 0;
                    iNet.textContent = total;
                }
                
                if(iAdd) iAdd.oninput = updateModalTotal;
                if(iDisc) iDisc.oninput = updateModalTotal;
            });
            
            addModalGrid.appendChild(cardClone);
        });
    }

    if(btnCancelAddPlan) {
        btnCancelAddPlan.addEventListener('click', () => {
            document.querySelectorAll('.selection-card').forEach(c => c.classList.remove('selected'));
            selectedPlanToAdd = null;
            addConfirmSection.classList.add('hidden');
        });
    }

    if(btnConfirmAddPlan) {
        btnConfirmAddPlan.addEventListener('click', async () => {
            if(!selectedPlanToAdd) return;
            const custId = sessionStorage.getItem('current_customer_id');
            const userId = sessionStorage.getItem('user_id');
            const { planObj, name } = selectedPlanToAdd;
            const addCharge = document.getElementById('newPlanAdd').value || 0;
            const discAmount = document.getElementById('newPlanDisc').value || 0;

            try {
                const res = await window.pywebview.api.add_subscription_to_customer({
                    user_id: userId,
                    customer_id: custId,
                    plan_id: planObj.id,
                    type: currentView,
                    plan_name: name,
                    price: planObj.price,
                    additional_charge: addCharge,
                    discount_amount: discAmount
                });

                if (res.ok) {
                    showToast("Plan Added Successfully!", 'success');
                    addModal.classList.add('hidden');
                    await fetchDetails(true); 
                } else {
                    showToast("Error adding plan: " + res.error, 'error');
                }
            } catch (err) {
                showToast("Error: " + err, 'error');
            }
        });
    }

    if(btnSubmit) {
        btnSubmit.addEventListener('click', async () => {
            const custId = sessionStorage.getItem('current_customer_id');
            const userId = sessionStorage.getItem('user_id');
            btnSubmit.innerText = "Saving...";
            btnSubmit.disabled = true;

            let subData = {
                additional_charge: document.getElementById('fAdditional').value,
                discount_amount: document.getElementById('fDiscount').value,
            };

            if (currentView === 'internet') {
                subData.plan_mbps = document.getElementById('pSpecificId').value;
            } else {
                subData.setup_box_id = document.getElementById('pSpecificId').value;
            }

            const payload = {
                user_id: userId,
                customer_id: custId,
                subscription_id: activeSubId, 
                profile: {
                    name: document.getElementById('infoName').value,
                    phone: document.getElementById('infoPhone').value,
                    alt_phone: document.getElementById('infoAltPhone').value,
                    email: document.getElementById('infoEmail').value,
                    aadhaar: document.getElementById('infoAadhaar').value,
                    short_address: document.getElementById('infoShortAddr').value,
                    long_address: document.getElementById('infoLongAddr').value,
                    notes: document.getElementById('infoNotes').value,
                },
                subscription: subData 
            };

            try {
                const res = await window.pywebview.api.update_customer_info(payload);
                if(res.ok) {
                    showToast("Saved Successfully!", 'success');
                    isEditMode = false;
                    if(btnRemovePlan) btnRemovePlan.classList.add('hidden');
                    await fetchDetails(true); 
                    btnCancel.click(); 
                } else {
                    showToast("Error saving: " + res.error, 'error');
                }
            } catch(e) {
                showToast("Error: " + e, 'error');
            }
            btnSubmit.innerText = "Submit";
            btnSubmit.disabled = false;
        });
    }

    if (btnRemovePlan) {
        btnRemovePlan.addEventListener('click', () => {
            if (!activeSubId) return;
            const planName = document.getElementById('pName').value || 'this plan';
            if(removeModalPlanName) removeModalPlanName.innerText = planName;
            removeModal.classList.remove('hidden');
        });
    }

    if (btnCancelRemove) {
        btnCancelRemove.addEventListener('click', () => {
            removeModal.classList.add('hidden');
        });
    }

    if (btnConfirmRemove) {
        btnConfirmRemove.addEventListener('click', async () => {
            if (!activeSubId) return;
            const idToDelete = activeSubId; 
            activeSubId = null;
            try {
                const res = await window.pywebview.api.remove_subscription({ subscription_id: idToDelete });
                if (res.ok) {
                    removeModal.classList.add('hidden');
                    await fetchDetails(true); 
                } else {
                    showToast("Error removing plan: " + res.error, 'error');
                }
            } catch (err) {
                showToast("System Error: " + err, 'error');
            }
        });
    }

    // -------------------------------------------------------------------------
    // ✅ 9. PAYMENT LOGIC (UPDATED WITH CHAINED MODAL & EXCESS CHECK)
    // -------------------------------------------------------------------------

    // =========================================================
    // 1. INITIAL "PAY" BUTTON CLICK (Validation & Routing)
    // =========================================================
    if(btnPay) {
        btnPay.addEventListener('click', () => {
            // Get the payment amount entered by the user
            const amount = parseFloat(document.getElementById('payAmount').value);
            
            // Basic validation: Ensure amount is valid and greater than 0
            if (!amount || amount <= 0) {
                showToast("Please enter a valid amount.", 'warning');
                return;
            }
            // Ensure a plan is actually selected before paying
            if (!activeSubId) {
                showToast("No active subscription selected.", 'warning');
                return;
            }

            // Get the selected payment mode (cash, cheque, upi, etc.)
            const mode = document.getElementById('payMode').value;
            const chequeVal = document.getElementById('payChequeNo').value;
            
            // Cheque validation: If 'cheque' is selected, the cheque number cannot be empty
            if (mode === 'cheque' && !chequeVal.trim()) {
                showToast("Please enter the Cheque Number.", 'warning');
                document.getElementById('payChequeNo').focus(); 
                return;
            }

            // Calculate Total Due for the CURRENTLY VIEWED plan (Pending + Current + Other Charges)
            const pend = parseFloat(document.getElementById('fPending').value) || 0;
            const curr = parseFloat(document.getElementById('fCurrent').value) || 0;
            const other = parseFloat(document.getElementById('fOther').value) || 0;
            const totalDueCurrentPlan = pend + curr + other;

            // Calculate Global Total Due across ALL plans for this customer
            const totalGlobalCurrent = calculateGlobalTotals();

            // --- MODAL ROUTING LOGIC ---
            // Decide which popup to show based on how much they are paying
            if (amount > totalDueCurrentPlan) {
                // User is overpaying for the current plan.
                
                // Check if the current plan's debt equals the total debt across all plans.
                // (Math.abs < 0.01 is used to safely compare decimals).
                if (Math.abs(totalGlobalCurrent - totalDueCurrentPlan) < 0.01) {
                    // Scenario A: Customer only has debt on THIS single plan.
                    // Ask if they want to pay the Upcoming bill or keep the extra in Advance.
                    document.getElementById('paymentOverpaySingleModal').classList.remove('hidden');
                } else {
                    // Scenario B: Customer has debt on OTHER plans too.
                    // Ask if they want to use the extra money to clear other plans or pay this plan's Upcoming bill.
                    document.getElementById('paymentOverpayMultiModal').classList.remove('hidden');
                }
            } else {
                // Standard Payment (Amount is less than or equal to current plan due).
                // Just ask if they are paying Other Service Charges (OSC) first.
                document.getElementById('paymentPriorityModal').classList.remove('hidden');
            }
        });
    }

    // =========================================================
    // --- MODAL 1: Standard Payment (Normal Amount) ---
    // =========================================================
    if(btnPayYes) {
        // User clicked "Yes" - Prioritize paying Other Service Charges (OSC) first.
        btnPayYes.addEventListener('click', () => {
            document.getElementById('paymentPriorityModal').classList.add('hidden');
            // submitPayment(payOtherFirst = true, clearUpcomingToo = false)
            submitPayment(true, false);
        });
    }
    if(btnPayNo) {
        // User clicked "No" - Prioritize paying the base Plan bill first.
        btnPayNo.addEventListener('click', () => {
            document.getElementById('paymentPriorityModal').classList.add('hidden');
            // submitPayment(payOtherFirst = false, clearUpcomingToo = false)
            submitPayment(false, false); 
        });
    }

    // =========================================================
    // --- MODAL 2: Single Plan Overpay ---
    // =========================================================
    const btnOverpayAdvance = document.getElementById('btnOverpayAdvance');
    const btnOverpayUpcomingSingle = document.getElementById('btnOverpayUpcomingSingle');
    
    if(btnOverpayAdvance) {
        // User wants to clear current bill and dump the rest into the wallet (Advance)
        btnOverpayAdvance.addEventListener('click', () => {
            document.getElementById('paymentOverpaySingleModal').classList.add('hidden');
            // submitPayment(payOtherFirst = true, clearUpcomingToo = false)
            submitPayment(true, false);
        });
    }
    if(btnOverpayUpcomingSingle) {
        // User wants to clear current bill AND pay the upcoming cycle in advance
        btnOverpayUpcomingSingle.addEventListener('click', () => {
            document.getElementById('paymentOverpaySingleModal').classList.add('hidden');
            // submitPayment(payOtherFirst = false, clearUpcomingToo = true)
            submitPayment(false, true);
        });
    }

    // =========================================================
    // --- MODAL 3: Multi-Plan Overpay ---
    // =========================================================
    const btnOverpayOtherPlans = document.getElementById('btnOverpayOtherPlans');
    const btnOverpayUpcomingMulti = document.getElementById('btnOverpayUpcomingMulti');
    
    if(btnOverpayOtherPlans) {
        // User wants to use the extra money to pay off their other active plans
        btnOverpayOtherPlans.addEventListener('click', () => {
            document.getElementById('paymentOverpayMultiModal').classList.add('hidden');
            
            const amount = parseFloat(document.getElementById('payAmount').value) || 0;
            const totalGlobalCurrent = calculateGlobalTotals(); 

            // Excess Check: Are they paying more than the combined debt of ALL plans?
            if (amount > totalGlobalCurrent) {
                if(excessModal) {
                    excessModal.classList.remove('hidden');
                }
                return;
            }

            // If it's a partial payment across multiple plans, ask for priority (Plan vs OSC)
            document.getElementById('paymentPrioritySelectModal').classList.remove('hidden');
        });
    }
    
    if(btnOverpayUpcomingMulti) {
        // User ignores other plans and just wants to pre-pay the upcoming bill for THIS plan
        btnOverpayUpcomingMulti.addEventListener('click', () => {
            document.getElementById('paymentOverpayMultiModal').classList.add('hidden');
            // submitPayment(payOtherFirst = false, clearUpcomingToo = true)
            submitPayment(false, true);
        });
    }

    // =========================================================
    // --- MODAL 4: Priority Select (For Cross-Plan Distribution) ---
    // =========================================================
    const btnPriorityOther = document.getElementById('btnPriorityOther');
    const btnPriorityPlan = document.getElementById('btnPriorityPlan');
    
    if(btnPriorityOther) {
        // Distribute money across all plans, clearing OSCs before Plan bills
        btnPriorityOther.addEventListener('click', () => {
            document.getElementById('paymentPrioritySelectModal').classList.add('hidden');
            // submitPayment(payOtherFirst = true, clearUpcomingToo = false, forceCrossPlan = true)
            submitPayment(true, false, true); 
        });
    }
    
    if(btnPriorityPlan) {
        // Distribute money across all plans, clearing Plan bills before OSCs
        btnPriorityPlan.addEventListener('click', () => {
            document.getElementById('paymentPrioritySelectModal').classList.add('hidden');
            // submitPayment(payOtherFirst = false, clearUpcomingToo = false, forceCrossPlan = true)
            submitPayment(false, false, true); 
        });
    }

    // =========================================================
    // --- MODAL 5: Global Excess Payment (Leftover Cash) ---
    // =========================================================
    if(btnExcessUpcoming) {
        // Clear all current debts across all plans, then use remainder for ALL upcoming plans
        btnExcessUpcoming.addEventListener('click', () => {
            if(excessModal) excessModal.classList.add('hidden');
            // submitPayment(payOtherFirst = true, clearUpcomingToo = true, forceCrossPlan = true)
            submitPayment(true, true, true); 
        });
    }

    if(btnExcessAdvance) {
        // Clear all current debts across all plans, then put remainder in Advance Wallet
        btnExcessAdvance.addEventListener('click', () => {
            if(excessModal) excessModal.classList.add('hidden');
            // submitPayment(payOtherFirst = true, clearUpcomingToo = false, forceCrossPlan = true)
            submitPayment(true, false, true); 
        });
    }

    if(btnCloseExcessModal) {
        btnCloseExcessModal.addEventListener('click', () => {
            excessModal.classList.add('hidden');
        });
    }

    // ---------------------------------------------------------
    // ✅ 10. ADVANCE ADJUSTMENT LOGIC
    // ---------------------------------------------------------
    
    const btnAdjustAmount = document.getElementById('btnAdjustAmount');
    const btnAdjustOtherPlans = document.getElementById('btnAdjustOtherPlans');
    
    // Modals
    const adjAmountModal = document.getElementById('adjAmountModal');
    const adjExcessModal = document.getElementById('adjExcessModal');
    const adjPartialModal = document.getElementById('adjPartialModal');

    // 1. "Adjust Amount" Click
    if(btnAdjustAmount) {
        btnAdjustAmount.addEventListener('click', async () => {
            const advance = parseFloat(document.getElementById('fAdvance').value) || 0;
            if(advance <= 0) {
                showToast("No Advance Balance to adjust.", 'warning');
                return;
            }

            // ✅ CHECK: Are we on a deleted plan?
            if (isViewingDeletedPlan) {
                const custId = sessionStorage.getItem('current_customer_id');
                btnAdjustAmount.innerText = "...";
                
                try {
                    const res = await window.pywebview.api.get_deleted_plans({ customer_id: custId });
                    btnAdjustAmount.innerText = "Adjust Amount";
                    
                    if(res.ok) {
                        const deletedPlans = res.data || [];
                        if (deletedPlans.length > 1) {
                            // Show Deleted Multi-Popup
                            document.getElementById('delScopeModal').classList.remove('hidden');
                            document.getElementById('delScopeModal').style.display = 'flex';
                        } else {
                            // Auto-Adjust for Single Deleted Plan
                            if (confirm("Adjust Advance for this deleted plan?")) {
                                performAdvanceAdjustment('deleted_single_adjust');
                            }
                        }
                    } else {
                        showToast("Error checking plans: " + res.error, 'error');
                    }
                } catch(e) {
                    showToast("System Error: " + e, 'error');
                    btnAdjustAmount.innerText = "Adjust Amount";
                }
                return;
            }

            // Standard Active Logic
            adjAmountModal.classList.remove('hidden');
        });
    }

    // Handlers for Adjust Amount Modal
    const btnAdjOther = document.getElementById('btnAdjOther');
    const btnAdjUpcoming = document.getElementById('btnAdjUpcoming');

    if(btnAdjOther) {
        btnAdjOther.addEventListener('click', () => {
            adjAmountModal.classList.add('hidden');
            performAdvanceAdjustment('single_other');
        });
    }
    if(btnAdjUpcoming) {
        btnAdjUpcoming.addEventListener('click', () => {
            adjAmountModal.classList.add('hidden');
            performAdvanceAdjustment('single_upcoming');
        });
    }

    // 2. "Adjust Other Plans" Click
    if(btnAdjustOtherPlans) {
        btnAdjustOtherPlans.addEventListener('click', () => {
            const advance = parseFloat(document.getElementById('fAdvance').value) || 0;
            if(advance <= 0) {
                showToast("No Advance Balance to adjust.", 'warning');
                return;
            }

            // Calculate Global Total Pending (Current only)
            const totalGlobalCurrent = calculateGlobalTotals(); // Returns float of P+C+O for all plans

            if (advance > totalGlobalCurrent) {
                // Excess Scenario
                adjExcessModal.classList.remove('hidden');
            } else {
                // Partial Scenario
                adjPartialModal.classList.remove('hidden');
            }
        });
    }

    // Handlers for Excess Modal
    const btnAdjExcessCurrent = document.getElementById('btnAdjExcessCurrent');
    const btnAdjExcessAll = document.getElementById('btnAdjExcessAll');

    if(btnAdjExcessCurrent) {
        btnAdjExcessCurrent.addEventListener('click', () => {
            adjExcessModal.classList.add('hidden');
            performAdvanceAdjustment('multi_excess_current');
        });
    }
    if(btnAdjExcessAll) {
        btnAdjExcessAll.addEventListener('click', () => {
            adjExcessModal.classList.add('hidden');
            performAdvanceAdjustment('multi_excess_all');
        });
    }

    // Handlers for Partial Modal
    const btnAdjPriorityOther = document.getElementById('btnAdjPriorityOther');
    const btnAdjPriorityPlan = document.getElementById('btnAdjPriorityPlan');

    if(btnAdjPriorityOther) {
        btnAdjPriorityOther.addEventListener('click', () => {
            adjPartialModal.classList.add('hidden');
            performAdvanceAdjustment('multi_partial_other');
        });
    }
    if(btnAdjPriorityPlan) {
        btnAdjPriorityPlan.addEventListener('click', () => {
            adjPartialModal.classList.add('hidden');
            performAdvanceAdjustment('multi_partial_plan');
        });
    }

    // ✅ CRITICAL FIX 2: Attach to 'window' and safely grab the ID
    window.performAdvanceAdjustment = async function(strategyOverride = null) {
        const advanceInput = document.getElementById('fAdvance');
        const amount = parseFloat(advanceInput.value) || 0;
        const custId = sessionStorage.getItem('current_customer_id');
        
        // Grab the active ID from our global variable first, fallback to session storage
        const subId = activeSubId || sessionStorage.getItem('current_subscription_id');

        // Check if ID is truly missing
        if (!subId || subId === "null" || subId === "undefined") {
            showToast("Error: Subscription ID is missing. Please click the plan tab again.", 'error');
            return;
        }

        // 1. Determine Strategy
        let strategy = strategyOverride;

        if (!strategy) {
            const radios = document.getElementsByName('adjStrategy');
            for (const r of radios) {
                if (r.checked) {
                    strategy = r.value;
                    break;
                }
            }
        }

        if (!strategy) {
            showToast("Please select an adjustment method.", 'warning');
            return;
        }

        // 2. UI Feedback
        const btn = document.getElementById('btnAdjustAmount');
        const originalText = btn ? btn.innerText : 'Adjust Amount';
        if (btn) btn.innerText = "Processing...";

        try {
            const res = await window.pywebview.api.adjust_advance_balance({
                subscription_id: subId,
                customer_id: custId,
                strategy: strategy
            });

            if (res.ok) {
                showToast("Adjustment Successful!", 'success');
                await fetchDetails(true);
            } else {
                showToast("Adjustment Failed: " + res.error, 'error');
            }
        } catch (e) {
            showToast("System Error: " + e, 'error');
        } finally {
            if (btn) btn.innerText = originalText;
            
            // Close modals
            ['delScopeModal', 'delPriorityModal', 'adjustAmountModal'].forEach(id => {
                const m = document.getElementById(id);
                if (m) m.classList.add('hidden');
            });
        }
    };

    // =========================================================
    // ✅ NEW: TRANSFER ADVANCE FROM DELETED TO ACTIVE PLAN
    // =========================================================
    const btnTransferAdvance = document.getElementById('btnTransferAdvance');
    const transferAdvanceModal = document.getElementById('transferAdvanceModal');
    const activePlansForTransfer = document.getElementById('activePlansForTransfer');
    const btnConfirmTransferAdvance = document.getElementById('btnConfirmTransferAdvance');
    let targetTransferPlanId = null;

    if (btnTransferAdvance) {
        btnTransferAdvance.addEventListener('click', () => {
            const advance = parseFloat(document.getElementById('fAdvance').value) || 0;
            
            if (advance <= 0) {
                showToast("No Advance Balance available to transfer.", 'warning');
                return;
            }

            document.getElementById('transferAmtDisplay').innerText = advance;
            activePlansForTransfer.innerHTML = '';
            targetTransferPlanId = null;
            btnConfirmTransferAdvance.disabled = true;

            // 'subscriptions' global array natively excludes deleted plans from backend
            if (!subscriptions || subscriptions.length === 0) {
                activePlansForTransfer.innerHTML = '<p style="color:#c62828; font-size:13px; text-align:center;">No active plans available to receive the transfer.</p>';
            } else {
                subscriptions.forEach(plan => {
                    const div = document.createElement('div');
                    div.style.cssText = "padding:10px; border:1px solid #ccc; border-radius:6px; cursor:pointer; background:#f9f9f9; transition:0.2s;";
                    div.innerHTML = `
                        <div style="font-weight:bold; color:#333;">${plan.plan_name_cached || 'Plan'}</div>
                        <div style="font-size:12px; color:#666;">Current Advance: ₹${plan.advance_balance || 0}</div>
                    `;
                    
                    div.onclick = () => {
                        // Deselect others visually
                        Array.from(activePlansForTransfer.children).forEach(c => {
                            c.style.borderColor = '#ccc';
                            c.style.background = '#f9f9f9';
                        });
                        // Highlight selected
                        div.style.borderColor = '#7b1fa2';
                        div.style.background = '#f3e5f5';
                        targetTransferPlanId = plan.id;
                        btnConfirmTransferAdvance.disabled = false;
                    };
                    activePlansForTransfer.appendChild(div);
                });
            }

            transferAdvanceModal.classList.remove('hidden');
        });
    }

    if (btnConfirmTransferAdvance) {
        btnConfirmTransferAdvance.addEventListener('click', async () => {
            if (!targetTransferPlanId || !activeSubId) return;
            
            btnConfirmTransferAdvance.innerText = "Processing...";
            btnConfirmTransferAdvance.disabled = true;
            const custId = sessionStorage.getItem('current_customer_id');

            try {
                // Calls the brand new Python function
                const res = await window.pywebview.api.transfer_advance_balance({
                    source_id: activeSubId, // Deleted Plan
                    target_id: targetTransferPlanId, // Active Plan
                    customer_id: custId
                });

                if (res.ok) {
                    showToast("Advance Transfer Successful!", 'success');
                    // ✅ Close modal and reset state before refreshing
                    transferAdvanceModal.classList.add('hidden');
                    targetTransferPlanId = null;
                    await fetchDetails(true);
                } else {
                    showToast("Transfer Failed: " + res.error, 'error');
                }
            } catch (e) {
                showToast("System Error: " + e, 'error');
            } finally {
                btnConfirmTransferAdvance.innerText = "Transfer";
                btnConfirmTransferAdvance.disabled = false;
            }
        });
    }

    // ✅ UPDATED submitPayment with Validation
    async function submitPayment(payOtherFirst, clearUpcomingToo = false, forceCrossPlan = false) {
        const amount = parseFloat(document.getElementById('payAmount').value);
        const mode = document.getElementById('payMode').value;
        const chequeNo = document.getElementById('payChequeNo').value;

        // ✅ SAFETY CHECK: Fail if cheque is selected but empty
        if (mode === 'cheque' && !chequeNo.trim()) {
            showToast("Payment Failed: Cheque Number is required.", 'error');
            return;
        }

        const custId = sessionStorage.getItem('current_customer_id');
        const userId = sessionStorage.getItem('user_id');

        try {
            const res = await window.pywebview.api.process_payment({
                user_id: userId,
                customer_id: custId,
                subscription_id: activeSubId,
                amount: amount,
                mode: mode,
                cheque_number: chequeNo,
                pay_other_first: payOtherFirst, 
                clear_upcoming_too: clearUpcomingToo,
                force_cross_plan: forceCrossPlan 
            });

            if (res.ok) {
                showToast("Payment Successful!", 'success');
                document.getElementById('payAmount').value = ""; 
                document.getElementById('payChequeNo').value = ""; 
                
                // Reset UI
                const chequeContainer = document.getElementById('chequeInputContainer');
                if(chequeContainer) chequeContainer.classList.add('hidden'); 
                document.getElementById('payMode').value = "cash"; 
                
                await fetchDetails(true); 
            } else {
                showToast("Payment Error: " + res.error, 'error');
            }
        } catch (err) {
            showToast("System Error: " + err, 'error');
        }
    }

    // --- ✅ UPDATED: Advance History Button ---
    const btnShowAdvLogs = document.getElementById('btnShowAdvLogs');
    if (btnShowAdvLogs) {
        btnShowAdvLogs.addEventListener('click', async () => {
            const modal = document.getElementById('viewAdvanceModal');
            const tbody = document.getElementById('advanceHistoryBody');
            modal.classList.remove('hidden');
            tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;">Loading...</td></tr>';

            try {
                const res = await window.pywebview.api.get_advance_logs({ subscription_id: activeSubId });
                if(res.ok) {
                    const logs = res.data || [];
                    
                    // ✅ NEW FILTER LOGIC:
                    // 1. Hide "Received from" (Internal Transfers)
                    // 2. Hide Standard Payments (containing CASH or CHEQUE), UNLESS it is "Excess"
                    const visibleLogs = logs.filter(l => {
                        const r = (l.reason || "").toLowerCase();
                        
                        // Rule 1: Hide internal book-keeping transfers, EXCEPT advance transfers from deleted plans
                        if (r.includes("received from") && !r.includes("remaining amount")) return false;

                        // Rule 2: Hide direct payments (Cash/Cheque) that didn't touch Advance
                        // If it says "CASH" or "CHEQUE" but does NOT say "excess", hide it.
                        if ((r.includes("(cash)") || r.includes("(cheque)")) && !r.includes("excess")) {
                            return false;
                        }

                        return true;
                    });

                    if(visibleLogs.length === 0) {
                        tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; color:#666;">No advance history.</td></tr>';
                        return;
                    }
                    
                    let html = '';
                    visibleLogs.forEach(l => {
                        const isAdd = l.amount > 0;
                        const color = isAdd ? '#2e7d32' : '#c62828';
                        const sign = isAdd ? '+' : '';
                        
                        const date = new Date(l.created_at).toLocaleString('en-IN', {
                            timeZone: 'Asia/Kolkata',
                            day: '2-digit', month: '2-digit', year: 'numeric',
                            hour: '2-digit', minute: '2-digit', hour12: true
                        });
                        
                        let displayReason = l.reason || '-';
                        // Make labels friendlier
                        if (displayReason.includes("Payment for Cycle") && displayReason.includes("ADVANCE")) {
                            displayReason = "Plan Auto-Payment (Wallet)";
                        } else if (displayReason.includes("Adj:")) {
                            displayReason = displayReason.replace("Adj:", "Adjusted:");
                        }

                        html += `
                            <tr>
                                <td style="font-size:12px;">${date}</td>
                                <td style="font-weight:600; color:${color};">${sign}₹${l.amount}</td>
                                <td style="font-size:13px;">${displayReason}</td>
                            </tr>
                        `;
                    });
                    tbody.innerHTML = html;
                }
            } catch(e) { showToast("Error: " + e, 'error'); }
        });
    }

    // --- ✅ UPDATED: View Dates Helper (Strict Backend Call) ---
    // --- ✅ HELPER: Open View Dates Modal (Global) ---
    window.openViewDates = async function(historyId, startDateStr, endDateStr, isUpcomingView = false) {
        const modal = document.getElementById('viewDatesModal');
        const list = document.getElementById('allocationsList');
        
        modal.classList.remove('hidden');
        list.innerHTML = '<p style="padding:10px;">Loading details from database...</p>';

        // ✅ STRICT ID GENERATION
        // If Upcoming Row clicked -> Send 'UPCOMING'
        // If Current/History Row clicked -> Send the Full ISO String (Date + Time)
        const cycleId = isUpcomingView ? 'UPCOMING' : startDateStr;

        try {
            const res = await window.pywebview.api.get_cycle_payments({
                subscription_id: activeSubId,
                history_id: historyId,
                cycle_start_date: cycleId // <--- Sends the precise timestamp
            });
            
            if (res.ok) {
                renderRows(res.data);
            } else {
                list.innerHTML = `<p style="color:red; padding:10px;">Error: ${res.error}</p>`;
            }

        } catch (err) {
            console.error(err);
            list.innerHTML = `<p style="color:red; padding:10px;">System Error: ${err.message}</p>`;
            showToast("System Error: " + err.message, 'error');
        }

        // ... (Keep your renderRows function below this) ...
        function renderRows(rows) {
             // Paste the updated renderRows function I gave you earlier here
             if (!rows || rows.length === 0) {
                list.innerHTML = '<p style="padding:10px; color:#666;">No payment records found for this cycle.</p>';
                return;
            }

            let html = '<table class="history-table" style="width:100%;"><thead><tr><th>Date</th><th>Type</th><th>Details</th><th>Amount</th></tr></thead><tbody>';
            
            rows.forEach(row => {
                const dateObj = new Date(row.date);
                const dateDisplay = isNaN(dateObj) ? row.date : dateObj.toLocaleString('en-IN', {
                    timeZone: 'Asia/Kolkata',
                    day: '2-digit', month: '2-digit', year: 'numeric',
                    hour: '2-digit', minute: '2-digit', hour12: true
                });

                const isTransfer = row.mode.includes("Transfer") || row.details.includes("Received from");
                let typeColor = '#2e7d32'; // Green
                if (isTransfer) typeColor = '#6a1b9a'; // Purple
                if (row.type === 'REFUND') typeColor = '#c62828'; // Red
                
                let typeHtml = `<span style="color:${typeColor}; font-weight:600;">${isTransfer ? 'ADJUSTMENT' : row.type}</span>`;
                let rowStyle = isTransfer ? "background-color: #f3e5f5;" : (row.mode.includes("Other Charges") ? "background-color: #fff3e0;" : "");
                const displayDetails = row.details.replace("(UPCOMING_ADJ)", "").trim();

                // ✅ FIX 2: Intercept the backend fallback and force it to display NET BANKING
                let displayMode = row.mode;
                if (displayMode === "Advance Adjustment" && (displayDetails.includes("(BANK)") || displayDetails.includes("(NET BANKING)"))) {
                    displayMode = "NET BANKING";
                }

                html += `
                    <tr style="${rowStyle}">
                        <td>${dateDisplay}</td>
                        <td>${typeHtml}</td>
                        <td style="font-size:12px;"><div style="font-weight:600;">${displayMode}</div><div style="font-size:11px; color:#666;">${displayDetails}</div></td>
                        <td style="font-weight:600; color:#2e7d32;">₹${row.amount}</td>
                    </tr>`;
            });
            html += '</tbody></table>';
            list.innerHTML = html;
        }
    };
    
    // ---------------------------------------------------------
    // ✅ NEW: DELETED PLANS TAB LOGIC & HELPER
    // ---------------------------------------------------------

    // 1. Helper to Reset UI to "Active Mode"
    function resetUIForActive() {
        isViewingDeletedPlan = false; // ✅ Set Flag FALSE
        const payRow = document.querySelector('.payment-row');
        if(payRow) payRow.classList.remove('hidden');

        const actions = document.querySelector('.plan-actions');
        if(actions) actions.classList.remove('hidden');

        // ✅ NEW: Button Swapping (Active Mode)
        const btnAdjustOther = document.getElementById('btnAdjustOtherPlans');
        const btnTransfer = document.getElementById('btnTransferAdvance');
        if (btnAdjustOther) btnAdjustOther.classList.remove('hidden');
        if (btnTransfer) btnTransfer.classList.add('hidden');

        // Reset Payment Tab Visibility
        const tabPay = document.getElementById('tabPaymentHistory');
        if(tabPay) {
            tabPay.style.display = 'inline-block';
            tabPay.classList.add('active'); // Default to Payment History active
        }

        // ✅ CRITICAL FIX: Reset the Plan History Tab text
        const tabPlan = document.getElementById('tabPlanHistory');
        if(tabPlan) {
            tabPlan.innerText = "Plan History"; // Reset text from "Archived History"
            tabPlan.classList.remove('active'); // Ensure it's not the active tab initially
        }
        
        // Ensure the correct view is showing (Payment View by default)
        const viewPay = document.getElementById('paymentHistoryView');
        const viewPlan = document.getElementById('planHistoryView');
        if(viewPay) viewPay.classList.remove('hidden');
        if(viewPlan) viewPlan.classList.add('hidden');

        // ✅ UPDATED: Reset ALL fields that might have been hidden in Deleted View
        const fieldsToReset = [
            'fCurrent', 'fUpcoming', 'calcTotalCurrent', 'calcTotalUpcoming', // Financials
            'pPrice', 'pDuration', 'pRenewal', // Dates & Price
            'fPending', 'fAdditional', 'fDiscount', 'fOther', 'fAdvance' // Other inputs
        ];

        fieldsToReset.forEach(id => {
            const el = document.getElementById(id);
            if(el && el.parentElement) el.parentElement.style.display = ''; 
        });

        // Hide history container initially
        if(historyContainer) historyContainer.classList.add('hidden');
        
        // Reset Main History Button Text
        if(document.getElementById('btnHistory')) document.getElementById('btnHistory').innerText = "History";
        
        document.getElementById('planTitle').style.color = '';
        
        // Hide the old deleted grid view if open
        if(deletedMainView) deletedMainView.classList.add('hidden');
    }

    // 2. Render Tabs for Deleted Plans
    function renderDeletedTabs(plans) {
        planTabsContainer.innerHTML = ''; 

        // Back Button
        const btnBack = document.createElement('button');
        btnBack.className = 'plan-tab-btn';
        btnBack.style.backgroundColor = '#f5f5f5';
        btnBack.style.fontWeight = 'bold';
        btnBack.innerHTML = `&larr; Back to Active`;
        btnBack.onclick = () => {
            switchView(currentView); // Reload active view
        };
        planTabsContainer.appendChild(btnBack);

        if(!plans || plans.length === 0) {
            const msg = document.createElement('span');
            msg.innerText = "No deleted plans found.";
            msg.style.padding = "10px";
            msg.style.color = "#888";
            planTabsContainer.appendChild(msg);
            return;
        }

        // Tabs
        plans.forEach(plan => {
            const btn = document.createElement('button');
            btn.className = 'plan-tab-btn';
            btn.style.borderColor = '#ef9a9a';
            btn.style.color = '#c62828';
            btn.style.background = '#fff5f5';
            btn.innerText = plan.plan_name;
            
            btn.onclick = () => {
                document.querySelectorAll('.plan-tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                renderDeletedPlanView(plan);
            };
            planTabsContainer.appendChild(btn);
        });

        // Auto-click first one
        if(plans.length > 0 && planTabsContainer.children[1]) {
            planTabsContainer.children[1].click();
        }
    }

    // ✅ CORRECTED: renderDeletedPlanView (Shows Mbps, Pending & Advance)
    async function renderDeletedPlanView(archivedPlan) {
        // 1. Set Global Active ID
        activeSubId = archivedPlan.id; 
        isViewingDeletedPlan = true; // ✅ Set Flag TRUE

        // ✅ CRITICAL FIX: Keep sessionStorage in sync so API calls don't send "null"
        sessionStorage.setItem('current_subscription_id', archivedPlan.id);

        // ✅ NEW: Button Swapping (Deleted Mode)
        const btnAdjustOther = document.getElementById('btnAdjustOtherPlans');
        const btnTransfer = document.getElementById('btnTransferAdvance');
        if (btnAdjustOther) btnAdjustOther.classList.add('hidden');
        if (btnTransfer) btnTransfer.classList.remove('hidden');

        // UI Setup
        const planHeaderRow = document.querySelector('.plan-header-row');
        const planFormsWrapper = document.getElementById('planFormsWrapper');
        const deletedMainView = document.getElementById('deletedPlansMainView');
        const noPlanMsg = document.getElementById('noPlanMessage');
        const historyContainer = document.getElementById('historyContainer');

        planHeaderRow.classList.remove('hidden');
        planFormsWrapper.classList.remove('hidden');
        if(deletedMainView) deletedMainView.classList.add('hidden'); 
        noPlanMsg.classList.add('hidden');
        
        // Header Info
        const titleEl = document.getElementById('planTitle');
        if (titleEl) { 
            titleEl.innerText = `Archived: ${archivedPlan.plan_name}`; 
            titleEl.style.color = '#c62828'; 
        }
        
        // Hide Actions & Inputs
        document.querySelector('.plan-actions').classList.add('hidden');
        document.querySelector('.payment-row').classList.add('hidden');
        
        // --- 1. POPULATE BASIC INFO ---
        document.getElementById('pName').value = archivedPlan.plan_name;

        // --- 2. POPULATE SPECIFIC ID (Mbps / Box No) ---
        let specificInfo = '';
        
        // ✅ CORRECTED: Use the archived plan's OWN data to check if it's Cable or Internet!
        if (archivedPlan.cable_plan_id) {
             specificInfo = archivedPlan.setup_box_id 
                 || (archivedPlan.backup_data && archivedPlan.backup_data.setup_box_id) 
                 || '';
             if(document.getElementById('lblSpecific')) document.getElementById('lblSpecific').innerText = "Setup Box ID No";
        } else {
             // 1. Check direct data, 2. Check relational data, 3. Check hidden backup data
             specificInfo = archivedPlan.plan_mbps 
                 || (archivedPlan.internet_plans ? `${archivedPlan.internet_plans.speed_mbps} Mbps` : null)
                 || (archivedPlan.backup_data && archivedPlan.backup_data.plan_mbps ? archivedPlan.backup_data.plan_mbps : null)
                 || '';
                 
             // Ultimate Fallback: If DB data is entirely missing, extract it directly from the Plan's Name!
             if (!specificInfo && archivedPlan.plan_name) {
                 const match = archivedPlan.plan_name.match(/(\d+\s*Mbps)/i);
                 if (match) specificInfo = match[1];
             }

             if(document.getElementById('lblSpecific')) document.getElementById('lblSpecific').innerText = "Plan Mbps";
        }

        const pSpecific = document.getElementById('pSpecificId');
        pSpecific.value = specificInfo;
        pSpecific.readOnly = true;

        // --- 3. POPULATE PENDING & ADVANCE (And Make Visible) ---
        const fPending = document.getElementById('fPending');
        const fAdvance = document.getElementById('fAdvance');

        // ✅ FIX: Sum Pending, Current, and OSC to show Total Debt since the other boxes are hidden
        const pAmt = parseFloat(archivedPlan.pending_amount) || 0;
        const cAmt = parseFloat(archivedPlan.current_amount) || 0;
        const oAmt = parseFloat(archivedPlan.other_service_charges) || 0;
        const totalDebt = pAmt + cAmt + oAmt;

        fPending.value = pAmt + cAmt + oAmt;
        fAdvance.value = archivedPlan.advance_balance || 0;

        fPending.readOnly = true;
        fAdvance.readOnly = true;

        // ✅ Inject Transfer Debt Button inside Pending Input Container
        const parentPending = fPending.parentElement;
        parentPending.style.position = 'relative';
        parentPending.style.display = 'block';

        // Remove old group if exists
        const oldDebtGroup = parentPending.querySelector('.debt-btn-group');
        if(oldDebtGroup) oldDebtGroup.remove();

        if (totalDebt > 0) {
            const btnDebtGroup = document.createElement('div');
            btnDebtGroup.className = 'debt-btn-group';
            btnDebtGroup.style.cssText = `
                position: absolute; top: 50%; right: 5px; transform: translateY(-50%); display: flex; z-index: 10;
            `;
            btnDebtGroup.innerHTML = `
                <button type="button" onclick="openTransferDebtModal(${totalDebt})" style="background:#ffebee; color:#c62828; border:1px solid #ffcdd2; padding:3px 8px; font-size:11px; font-weight:bold; cursor:pointer; border-radius:4px; line-height:1;">Transfer</button>
            `;
            fPending.style.paddingRight = "70px"; 
            parentPending.appendChild(btnDebtGroup);
        }

        // Ensure their containers are visible (unhide if previously hidden)
        if(pSpecific.parentElement) pSpecific.parentElement.style.display = '';
        if(fPending.parentElement) fPending.parentElement.style.display = '';
        if(fAdvance.parentElement) fAdvance.parentElement.style.display = '';

        // --- 4. HIDE ONLY UNWANTED FIELDS ---
        // (Note: Removed 'fPending' and 'fAdvance' from this list so they stay visible)
        const fieldsToHide = [
            'pPrice', 'pDuration', 'pLastActive', 'pRenewal', 
            'fCurrent', 'fUpcoming', 
            'calcTotalCurrent', 'calcTotalUpcoming', 
            'fAdditional', 'fDiscount', 'fOther'
        ];

        fieldsToHide.forEach(id => {
            const el = document.getElementById(id); 
            if(el && el.parentElement) el.parentElement.style.display = 'none'; 
        });

        // Show History Container
        if(historyContainer) historyContainer.classList.remove('hidden');
        
        // Setup Tabs
        const tabPayment = document.getElementById('tabPaymentHistory');
        const tabPlan = document.getElementById('tabPlanHistory');
        if(tabPayment) { tabPayment.style.display = 'none'; tabPayment.classList.remove('active'); }
        document.getElementById('paymentHistoryView').classList.add('hidden');
        
        if(tabPlan) { 
            tabPlan.innerText = "Archived History"; 
            tabPlan.classList.add('active'); 
        }
        document.getElementById('planHistoryView').classList.remove('hidden');
        document.getElementById('planHistoryView').innerHTML = '<p style="padding:20px; text-align:center;">Loading history...</p>';

        // Fetch Payments for the "Most Recent" Cycle
        let currentCyclePayments = [];
        const cStartDate = archivedPlan.current_billing_start_date;
        
        if (cStartDate) {
            try {
                const payRes = await window.pywebview.api.get_cycle_payments({
                    subscription_id: archivedPlan.id,
                    cycle_start_date: cStartDate
                });
                if (payRes.ok) currentCyclePayments = payRes.data || [];
            } catch (e) { console.error("Archived Payment Fetch Error", e); }
        }

        // Render History
        const historyData = archivedPlan.backup_data.history || [];
        await renderHistoryTableManually(historyData, archivedPlan, currentCyclePayments);
    }
    
    // =========================================================
    // ✅ NEW: OSC MODAL (CENTERED POPUP)
    // =========================================================

    let currentOscOp = null; 

    // Global Open Function
    window.openOscModal = function(op) {
        currentOscOp = op;
        const title = document.getElementById('oscModalTitle');
        const btn = document.getElementById('btnConfirmOsc');
        const modal = document.getElementById('oscModal');
        
        if (op === 'add') {
            title.innerText = "Add Other Charge";
            btn.style.backgroundColor = "#2e7d32"; // Green
            btn.innerText = "Add";
        } else {
            title.innerText = "Subtract Other Charge";
            btn.style.backgroundColor = "#c62828"; // Red
            btn.innerText = "Subtract";
        }
        
        document.getElementById('oscInputAmount').value = '';
        modal.style.display = 'flex'; // Flex centers it because of the inline CSS
        
        setTimeout(() => document.getElementById('oscInputAmount').focus(), 100);
    };

    // Confirm Logic
    const confirmBtn = document.getElementById('btnConfirmOsc');
    if(confirmBtn) {
        confirmBtn.onclick = async () => {
            const amount = parseFloat(document.getElementById('oscInputAmount').value);
            if (!amount || amount <= 0) {
                showToast("Please enter a valid amount", 'warning');
                return;
            }

            if (!activeSubId) return;
            const custId = sessionStorage.getItem('current_customer_id');
            
            confirmBtn.innerText = "Saving...";
            confirmBtn.disabled = true;

            try {
                const res = await window.pywebview.api.update_subscription_osc({
                    subscription_id: activeSubId,
                    customer_id: custId,
                    amount: amount,
                    operation: currentOscOp
                });

                if (res.ok) {
                    document.getElementById('oscModal').style.display = 'none';
                    await fetchDetails(true); 
                } else {
                    showToast("Error: " + res.error, 'error');
                }
            } catch (e) {
                showToast("System Error: " + e, 'error');
            } finally {
                confirmBtn.disabled = false;
                confirmBtn.innerText = currentOscOp === 'add' ? "Add" : "Subtract";
            }
        };
    }

    // =========================================================
    // ✅ NEW: TRANSFER DEBT LOGIC
    // =========================================================
    let targetDebtTransferPlanId = null;

    window.openTransferDebtModal = function(debtAmount) {
        const modal = document.getElementById('transferDebtModal');
        const listContainer = document.getElementById('activePlansForDebtTransfer');
        const btnConfirm = document.getElementById('btnConfirmTransferDebt');
        
        if (!modal) return;

        document.getElementById('transferDebtAmtDisplay').innerText = debtAmount;
        listContainer.innerHTML = '';
        targetDebtTransferPlanId = null;
        btnConfirm.disabled = true;

        if (!subscriptions || subscriptions.length === 0) {
            listContainer.innerHTML = '<p style="color:#c62828; font-size:13px; text-align:center;">No active plans available to receive the debt.</p>';
        } else {
            subscriptions.forEach(plan => {
                const div = document.createElement('div');
                div.style.cssText = "padding:10px; border:1px solid #ccc; border-radius:6px; cursor:pointer; background:#f9f9f9; transition:0.2s;";
                div.innerHTML = `
                    <div style="font-weight:bold; color:#333;">${plan.plan_name_cached || 'Plan'}</div>
                    <div style="font-size:12px; color:#666;">Current OSC: ₹${plan.other_service_charges || 0}</div>
                `;
                
                div.onclick = () => {
                    Array.from(listContainer.children).forEach(c => {
                        c.style.borderColor = '#ccc'; c.style.background = '#f9f9f9';
                    });
                    div.style.borderColor = '#c62828'; div.style.background = '#ffebee';
                    targetDebtTransferPlanId = plan.id;
                    btnConfirm.disabled = false;
                };
                listContainer.appendChild(div);
            });
        }
        modal.classList.remove('hidden');
    };

    const btnConfirmTransferDebt = document.getElementById('btnConfirmTransferDebt');
    if (btnConfirmTransferDebt) {
        btnConfirmTransferDebt.addEventListener('click', async () => {
            if (!targetDebtTransferPlanId || !activeSubId) return;
            
            btnConfirmTransferDebt.innerText = "Processing...";
            btnConfirmTransferDebt.disabled = true;
            const custId = sessionStorage.getItem('current_customer_id');

            try {
                const res = await window.pywebview.api.transfer_debt_to_active_plan({
                    source_id: activeSubId, 
                    target_id: targetDebtTransferPlanId, 
                    customer_id: custId
                });

                if (res.ok) {
                    showToast("Debt Transfer Successful!", 'success');
                    document.getElementById('transferDebtModal').classList.add('hidden');
                    targetDebtTransferPlanId = null;
                    await fetchDetails(true);
                } else {
                    showToast("Transfer Failed: " + res.error, 'error');
                }
            } catch (e) {
                showToast("System Error: " + e, 'error');
            } finally {
                btnConfirmTransferDebt.innerText = "Transfer Debt";
                btnConfirmTransferDebt.disabled = false;
                document.getElementById('transferDebtModal').classList.add('hidden');
            }
        });
    }

    window.handleDelScope = function(choice) {
        // 1. Hide the Scope Modal
        const scopeModal = document.getElementById('delScopeModal');
        scopeModal.classList.add('hidden');
        scopeModal.style.display = 'none'; // Force hide
        
        if (choice === 'single') {
            // Case 1: Adjust ONLY this plan
            performAdvanceAdjustment('deleted_single_adjust');
        } else {
            // Case 2: Multi-Plan -> Open Priority Modal
            const priorityModal = document.getElementById('delPriorityModal');
            priorityModal.classList.remove('hidden');
            priorityModal.style.display = 'flex'; // Force Show
        }
    };

    window.handleDelPriority = function(priority) {
        // 1. Hide the Priority Modal
        const priorityModal = document.getElementById('delPriorityModal');
        priorityModal.classList.add('hidden');
        priorityModal.style.display = 'none'; // Force hide
        
        // 2. Call Adjustment with selected priority
        if (priority === 'osc') {
            performAdvanceAdjustment('deleted_multi_priority_osc'); // 1. OSC -> 2. Plan
        } else {
            performAdvanceAdjustment('deleted_multi_priority_plan'); // 1. Plan -> 2. OSC
        }
    };

    
    // ✅ Handle Delete Customer Logic
    const btnDeleteCust = document.getElementById('btnDelete');
    const deleteCustModal = document.getElementById('deleteCustomerModal');
    const btnCancelDeleteCust = document.getElementById('btnCancelDeleteCust');
    const btnConfirmDeleteCust = document.getElementById('btnConfirmDeleteCust');

    if (btnDeleteCust) {
        btnDeleteCust.addEventListener('click', () => {
            deleteCustModal.classList.remove('hidden');
        });
    }

    if (btnCancelDeleteCust) {
        btnCancelDeleteCust.addEventListener('click', () => {
            deleteCustModal.classList.add('hidden');
        });
    }

    if (btnConfirmDeleteCust) {
        btnConfirmDeleteCust.addEventListener('click', async () => {
            btnConfirmDeleteCust.innerText = "Deleting...";
            btnConfirmDeleteCust.disabled = true;

            const customerId = sessionStorage.getItem('current_customer_id');
            const userId = sessionStorage.getItem('user_id');

            try {
                const res = await window.pywebview.api.delete_customer({
                    user_id: userId,
                    customer_id: customerId
                });

                if (res.ok) {
                    sessionStorage.setItem('pending_customer_toast', 'Customer deleted successfully!|success');
                    window.location.href = 'customer.html';
                } else {
                    showToast("Failed to delete customer: " + res.error, 'error');
                    btnConfirmDeleteCust.innerText = "Yes, Delete";
                    btnConfirmDeleteCust.disabled = false;
                }
            } catch (err) {
                showToast("System error: " + err, 'error');
                btnConfirmDeleteCust.innerText = "Yes, Delete";
                btnConfirmDeleteCust.disabled = false;
            }
        });
    }

    if (window.pywebview) {
        fetchDetails(false);
    } else {
        window.addEventListener('pywebviewready', () => fetchDetails(false));
    }
});
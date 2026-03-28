/* frontend/js/layout.js */

async function loadLayout(activePage) {
    try {
        const response = await fetch('layout.html');
        const html = await response.text();
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;

        const sidebarHTML = tempDiv.querySelector('.sidebar').outerHTML;
        const headerHTML = tempDiv.querySelector('.top-header').outerHTML;

        const sidebarPlace = document.getElementById('sidebar-placeholder');
        const headerPlace = document.getElementById('header-placeholder');

        if (sidebarPlace) sidebarPlace.innerHTML = sidebarHTML;
        if (headerPlace) headerPlace.innerHTML = headerHTML;

        const profileIcon = document.querySelector('.user-profile');
        if (profileIcon) {
            profileIcon.addEventListener('click', () => {
                window.location.href = 'profile.html';
            });
        }

        const activeNavId = `nav-${activePage}`;
        const activeNavItem = document.getElementById(activeNavId);
        if (activeNavItem) activeNavItem.classList.add('active');

        // ✅ LOGOUT LOGIC: Properly clears session, token and stops bot
        const logoutBtn = document.getElementById('globalLogout');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', async (e) => {
                e.preventDefault();

                try {
                    await window.pywebview.api.logout_active_user();
                } catch (err) {
                    console.error("Logout error:", err);
                }

                sessionStorage.clear();
                window.location.href = 'login.html';
            });
        }
        
    } catch (error) {
        console.error("Error loading layout:", error);
    }
}

// ── Create Toast Container (injected on every page) ────────
(function() {
    const container = document.createElement('div');
    container.id = 'toastContainer';
    container.style.cssText = `
        position: fixed;
        bottom: 30px;
        right: 30px;
        z-index: 99999;
        display: flex;
        flex-direction: column;
        gap: 10px;
        pointer-events: none;
    `;
    document.body.appendChild(container);
})();

// ── showToast — works on EVERY page (self-creating container) ──────
window.showToast = function(message, type = 'error', duration = 4000) {
    // Ensure container exists (layout pages already have it; auth pages get it here)
    let container = document.getElementById('toastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        container.style.cssText = `
            position: fixed;
            bottom: 30px;
            right: 30px;
            z-index: 99999;
            display: flex;
            flex-direction: column;
            gap: 10px;
            pointer-events: none;
        `;
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `cms-toast cms-toast-${type}`;
    toast.textContent = message;

    container.appendChild(toast);

    // Trigger fade-in on next frame
    requestAnimationFrame(() => {
        requestAnimationFrame(() => toast.classList.add('cms-toast-visible'));
    });

    // Auto-dismiss
    setTimeout(() => {
        toast.classList.remove('cms-toast-visible');
        toast.addEventListener('transitionend', () => toast.remove(), { once: true });
    }, duration);
};

// ── Network error message detector ───────────────────────────────────
// The backend's friendly() already returns these strings when offline.
// Use this helper in catch blocks to show a specific offline message.
window.isNetworkError = function(msg) {
    const m = (msg || '').toLowerCase();
    return m.includes('connection') || m.includes('timeout') ||
           m.includes('internet')   || m.includes('network') ||
           m.includes('offline')    || m.includes('timed out');
};

// ── Offline Banner — shows/hides automatically ───────────────────────
(function() {
    const banner = document.createElement('div');
    banner.id = 'offlineBanner';
    banner.className = 'offline-banner';
    banner.innerHTML = `
        <span>&#9888;</span>
        <span>No internet connection — some features may not work until you reconnect.</span>
    `;
    document.body.appendChild(banner);

    function updateBanner() {
        if (!navigator.onLine) {
            banner.classList.add('offline-banner-visible');
        } else {
            banner.classList.remove('offline-banner-visible');
        }
    }

    window.addEventListener('offline', updateBanner);
    window.addEventListener('online',  updateBanner);
    updateBanner(); // Check immediately on page load
})();
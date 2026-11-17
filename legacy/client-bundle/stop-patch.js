// Stak Stop Button Patch — Network Interceptor Approach (100% Reliable)
(function() {
    let activeController = null;
    let activeProjectId = null;
    let stopButton = null;

    // Extract project ID from URL like /api/projects/abc123/...
    function extractProjectId(url) {
        if (!url) return null;
        const match = String(url).match(/\/api\/projects\/([a-zA-Z0-9]+)/);
        return match ? match[1] : null;
    }

    // Check if this is an AI generation request we should intercept
    function isGenerationRequest(url, options) {
        if (!options || options.method !== 'POST') return false;
        const urlStr = String(url);
        // New build: POST /api/projects
        // Chat/edits: POST /api/projects/:id/messages
        // Answers: POST /api/projects/:id/answers
        return /\/api\/projects($|\/)/.test(urlStr) &&
               (/\/messages$/.test(urlStr) || /\/answers$/.test(urlStr) || urlStr === '/api/projects' || urlStr === '/api/projects/');
    }

    const originalFetch = window.fetch;
    window.fetch = function(url, options) {
        // Intercept AI generation requests
        if (isGenerationRequest(url, options)) {
            const pid = extractProjectId(url);
            if (pid) activeProjectId = pid;

            // Create abort controller and attach to fetch
            activeController = new AbortController();
            options = { ...options, signal: activeController.signal };

            // Show button IMMEDIATELY
            showStopButton();
        }

        return originalFetch(url, options).finally(() => {
            // Hide button when request completes (success or error)
            hideStopButton();
            activeController = null;
            // Keep activeProjectId so stop button still works if user clicks after response
        });
    };

    function createStopButton() {
        if (stopButton) return stopButton;
        stopButton = document.createElement('button');
        stopButton.id = 'stak-stop-btn';
        stopButton.innerHTML = '⬛ Stop Generating';
        stopButton.style.cssText = 'position:fixed; bottom:100px; right:20px; z-index:99999; background:#ef4444; color:white; border:none; padding:12px 24px; border-radius:8px; font-weight:bold; font-family:sans-serif; font-size:14px; cursor:pointer; box-shadow:0 4px 12px rgba(0,0,0,0.5); transition: all 0.2s;';
        stopButton.onmouseover = () => { stopButton.style.background = '#dc2626'; };
        stopButton.onmouseout = () => { stopButton.style.background = '#ef4444'; };
        stopButton.onclick = stopGeneration;
        document.body.appendChild(stopButton);
        return stopButton;
    }

    function showStopButton() {
        const btn = createStopButton();
        btn.style.display = 'block';
    }

    function hideStopButton() {
        if (stopButton) stopButton.style.display = 'none';
    }

    async function stopGeneration() {
        // 1. Abort the in-flight fetch request
        if (activeController) {
            activeController.abort();
            activeController = null;
        }

        // 2. Send stop signal to backend
        const pid = activeProjectId;
        if (pid) {
            try {
                // Use originalFetch to avoid interception loop
                await originalFetch(`/api/projects/${pid}/stop`, { method: 'POST' });
            } catch (e) {
                console.warn('[stop-patch] Failed to stop backend job:', e);
            }
        }

        // 3. Hide button immediately
        hideStopButton();

        // 4. Show toast notification
        const toast = document.createElement('div');
        toast.innerText = '🛑 Generation stopped';
        toast.style.cssText = 'position:fixed; bottom:150px; right:20px; z-index:99999; background:#333; color:white; padding:10px 20px; border-radius:8px; font-family:sans-serif; font-size:14px; box-shadow:0 4px 12px rgba(0,0,0,0.5);';
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);

        // 5. Reload to refresh UI state (backend job is stopped)
        setTimeout(() => window.location.reload(), 1500);
    }
})();
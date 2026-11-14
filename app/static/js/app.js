// AuditGate - Modern Shopify Polaris Storefront & Merchant Governance Controller
// Zero Dark Mode - Pure Light E-Commerce Aesthetics

let currentThreadId = "thread_ORD_" + Math.random().toString(36).substring(2, 8).toUpperCase();
let voiceEnabled = true;
let currentAudio = null;
let cachedAuditLogs = [];

document.addEventListener("DOMContentLoaded", () => {
    initApp();
});

function initApp() {
    setupEventListeners();
    setupTabs();
    updateThreadDisplay();
    fetchLivePolicy();
    fetchPendingRequests();
    fetchAuditLogs();

    // Live sync polling with MongoDB Atlas every 3 seconds
    setInterval(() => {
        fetchLivePolicy();
        fetchPendingRequests();
        fetchAuditLogs();
    }, 3000);
}

function setupTabs() {
    const tabGovBtn = document.getElementById("tab-governance-btn");
    const tabAuditBtn = document.getElementById("tab-audit-btn");
    const viewGov = document.getElementById("view-governance");
    const viewAudit = document.getElementById("view-audit");

    if (tabGovBtn && tabAuditBtn && viewGov && viewAudit) {
        tabGovBtn.addEventListener("click", () => {
            tabGovBtn.classList.add("active");
            tabGovBtn.setAttribute("aria-selected", "true");
            tabAuditBtn.classList.remove("active");
            tabAuditBtn.setAttribute("aria-selected", "false");

            viewGov.classList.remove("hidden");
            viewAudit.classList.add("hidden");
        });

        tabAuditBtn.addEventListener("click", () => {
            tabAuditBtn.classList.add("active");
            tabAuditBtn.setAttribute("aria-selected", "true");
            tabGovBtn.classList.remove("active");
            tabGovBtn.setAttribute("aria-selected", "false");

            viewAudit.classList.remove("hidden");
            viewGov.classList.add("hidden");

            // Refresh audit logs immediately upon opening Tab 2
            fetchAuditLogs();
        });
    }
}

function updateThreadDisplay() {
    const threadElem = document.getElementById("active-thread-id");
    if (threadElem) {
        threadElem.innerText = currentThreadId;
    }
}

function setupEventListeners() {
    const chatForm = document.getElementById("chat-form");
    const chatInput = document.getElementById("chat-input");
    const voiceToggle = document.getElementById("voice-toggle-btn");
    const schemaTestBtn = document.getElementById("schema-test-btn");
    const updatePolicyBtn = document.getElementById("update-policy-btn");
    const newThreadBtn = document.getElementById("new-thread-btn");
    const clearQueueBtn = document.getElementById("clear-queue-btn");
    const clearStaleBtn = document.getElementById("clear-stale-btn");
    const clearAllPendingBtn = document.getElementById("clear-all-pending-btn");
    const closeBsonModalBtn = document.getElementById("close-bson-modal-btn");
    const copyBsonBtn = document.getElementById("copy-bson-btn");
    const bsonModal = document.getElementById("bson-modal");

    if (clearAllPendingBtn) {
        clearAllPendingBtn.addEventListener("click", clearPendingQueue);
    }

    if (bsonModal) {
        bsonModal.addEventListener("click", (e) => {
            if (e.target === bsonModal) {
                bsonModal.classList.add("hidden");
            }
        });
    }

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && bsonModal && !bsonModal.classList.contains("hidden")) {
            bsonModal.classList.add("hidden");
        }
    });

    if (chatForm) {
        chatForm.addEventListener("submit", (e) => {
            e.preventDefault();
            const msg = chatInput.value.trim();
            if (msg) {
                sendChatMessage(msg);
                chatInput.value = "";
            }
        });
    }

    if (voiceToggle) {
        voiceToggle.addEventListener("click", () => {
            voiceEnabled = !voiceEnabled;
            updateVoiceToggleButton();
            if (!voiceEnabled && currentAudio) {
                currentAudio.pause();
                stopAudioVisualizer();
            }
        });
    }

    if (schemaTestBtn) {
        schemaTestBtn.addEventListener("click", runSchemaValidationTest);
    }

    if (updatePolicyBtn) {
        updatePolicyBtn.addEventListener("click", updatePolicyFromInput);
    }

    if (newThreadBtn) {
        newThreadBtn.addEventListener("click", startNewSession);
    }

    if (clearQueueBtn) {
        clearQueueBtn.addEventListener("click", clearPendingQueue);
    }

    if (clearStaleBtn) {
        clearStaleBtn.addEventListener("click", clearPendingQueue);
    }

    if (closeBsonModalBtn) {
        closeBsonModalBtn.addEventListener("click", () => {
            document.getElementById("bson-modal").classList.add("hidden");
        });
    }

    if (copyBsonBtn) {
        copyBsonBtn.addEventListener("click", () => {
            const code = document.getElementById("bson-modal-code").innerText;
            navigator.clipboard.writeText(code);
            showToast("MongoDB Atlas BSON document copied to clipboard!");
        });
    }

    // Interactive Order Preset Cards
    document.querySelectorAll(".order-preset-card").forEach(card => {
        card.addEventListener("click", () => {
            const prompt = card.getAttribute("data-prompt");
            if (prompt) {
                sendChatMessage(prompt);
            }
        });
    });
}

function startNewSession() {
    currentThreadId = "thread_ORD_" + Math.random().toString(36).substring(2, 8).toUpperCase();
    updateThreadDisplay();
    const messagesContainer = document.getElementById("chat-messages");
    messagesContainer.innerHTML = "";
    appendSystemMessage(`New customer session started: ${currentThreadId}`);
    showToast("Started fresh customer order session.");
}

async function clearPendingQueue() {
    try {
        const res = await fetch("/api/refund-requests?status=PENDING");
        const data = await res.json();
        const pending = data.requests || [];
        if (pending.length === 0) {
            showToast("Queue is already clear. No pending items.");
            return;
        }

        // Cleanly resolve pending items via the existing reject endpoint
        let resolved = 0;
        for (const req of pending) {
            await fetch(`/api/reject/${req.request_id}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ manager_notes: "Dismissed via Demo Queue Cleanup" })
            });
            resolved++;
        }

        showToast(`Cleared ${resolved} pending request(s) from governance queue.`);
        fetchPendingRequests();
        fetchAuditLogs();
    } catch (e) {
        console.error("Error clearing queue:", e);
    }
}

function updateVoiceToggleButton() {
    const btn = document.getElementById("voice-toggle-btn");
    if (!btn) return;
    if (voiceEnabled) {
        btn.innerHTML = `
            <span class="h-2 w-2 rounded-full bg-[#008060] mr-1.5"></span>
            <span>Voice: <strong>ON</strong></span>
        `;
        btn.className = "px-3 py-1.5 text-xs font-medium rounded-lg bg-[#E3F1DF] border border-[#B7DDB1] text-[#006E52] hover:bg-[#D5EBD0] flex items-center transition";
    } else {
        btn.innerHTML = `
            <span class="h-2 w-2 rounded-full bg-[#8C9196] mr-1.5"></span>
            <span>Voice: <strong>MUTED</strong></span>
        `;
        btn.className = "px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-100 border border-gray-300 text-gray-600 hover:bg-gray-200 flex items-center transition";
    }
}

// -------------------------------------------------------------
// Customer Chat & ElevenLabs Voice
// -------------------------------------------------------------

async function sendChatMessage(message) {
    appendUserMessage(message);
    showChatLoading(true);

    try {
        const response = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                message: message,
                thread_id: currentThreadId,
                customer_id: "customer_01"
            })
        });

        const data = await response.json();
        showChatLoading(false);

        if (response.ok) {
            appendAgentMessage(data.response, data.status, data.request_id, data.audio_base64);

            if (voiceEnabled && data.audio_base64) {
                playAudioFromBase64(data.audio_base64);
            }

            fetchPendingRequests();
            fetchAuditLogs();
        } else {
            appendSystemMessage("Error: " + (data.detail || "Failed to process request"));
        }
    } catch (err) {
        showChatLoading(false);
        appendSystemMessage("Network error communicating with store concierge.");
        console.error(err);
    }
}

function appendUserMessage(text) {
    const container = document.getElementById("chat-messages");
    const div = document.createElement("div");
    div.className = "flex justify-end mb-4 animate-fade-in";
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    div.innerHTML = `
        <div class="max-w-[82%] rounded-2xl rounded-tr-sm bg-[#EBF5F0] border border-[#CDE5D8] px-4 py-3 text-sm text-[#202223] shadow-sm">
            <p class="leading-relaxed font-normal">${escapeHtml(text)}</p>
            <div class="flex items-center justify-end gap-1.5 mt-1 text-[11px] text-[#6D7175]">
                <span>Customer</span>
                <span>•</span>
                <span>${timeStr}</span>
            </div>
        </div>
    `;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function appendAgentMessage(text, status, requestId, audioB64) {
    const container = document.getElementById("chat-messages");
    const div = document.createElement("div");
    div.className = "flex justify-start mb-4 animate-fade-in";
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    let pillHtml = `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-100 text-gray-700 border border-gray-300">Policy Checked</span>`;

    if (status === "AUTO_APPROVED") {
        pillHtml = `
            <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#E3F1DF] text-[#006E52] border border-[#B7DDB1]">
                <svg class="w-3 h-3 mr-1 text-[#008060]" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"></path></svg>
                Auto-Approved (≤ Policy Limit)
            </span>
        `;
    } else if (status === "PENDING_APPROVAL") {
        pillHtml = `
            <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#FFF5EA] text-[#B98900] border border-[#FFE0B2]">
                <svg class="w-3 h-3 mr-1 text-[#B98900]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                Paused for Human Manager (> Limit)
            </span>
        `;
    } else if (status === "HUMAN_APPROVED") {
        pillHtml = `
            <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#EBF5FF] text-[#0066CC] border border-[#B8DAFF]">
                <svg class="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"></path></svg>
                Manager Approved
            </span>
        `;
    } else if (status === "HUMAN_REJECTED") {
        pillHtml = `
            <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#FDEBE7] text-[#D82C0D] border border-[#FACDC6]">
                <svg class="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"></path></svg>
                Manager Declined
            </span>
        `;
    }

    const audioButtonHtml = audioB64 ? `
        <button onclick="playAudioFromBase64('${audioB64}')" class="mt-2.5 inline-flex items-center px-2.5 py-1 text-xs font-semibold rounded-md bg-[#FAF9F6] border border-[#E1E3E5] text-[#008060] hover:bg-[#EBF5F0] hover:border-[#B7DDB1] transition">
            <svg class="w-3.5 h-3.5 mr-1.5" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd"></path></svg>
            Replay ElevenLabs Voice
        </button>
    ` : '';

    div.innerHTML = `
        <div class="max-w-[88%] rounded-2xl rounded-tl-sm bg-[#FFFFFF] border border-[#E1E3E5] p-4 text-sm text-[#202223] shadow-sm">
            <div class="flex items-center justify-between gap-2 mb-2">
                <div class="flex items-center gap-1.5">
                    <div class="w-5 h-5 rounded-full bg-[#E3F1DF] text-[#008060] flex items-center justify-center font-bold text-[10px]">
                        VG
                    </div>
                    <span class="text-xs font-bold text-[#202223]">Verve Concierge</span>
                    <span class="text-[11px] font-mono text-[#6D7175]">(agent_01)</span>
                </div>
                ${pillHtml}
            </div>
            <p class="leading-relaxed text-[#202223]">${escapeHtml(text)}</p>
            ${requestId ? `
                <div class="mt-2 px-2.5 py-1 rounded bg-[#FAF9F6] border border-[#EDEEEF] inline-flex items-center gap-1.5 text-[11px] text-[#6D7175]">
                    <span>Atlas Request ID:</span>
                    <strong class="font-mono text-[#B98900]">${escapeHtml(requestId)}</strong>
                </div>
            ` : ''}
            <div>
                ${audioButtonHtml}
            </div>
            <div class="mt-2 text-[10px] text-[#8C9196] text-right font-mono">${timeStr}</div>
        </div>
    `;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function appendSystemMessage(text) {
    const container = document.getElementById("chat-messages");
    const div = document.createElement("div");
    div.className = "flex justify-center my-3 animate-fade-in";
    div.innerHTML = `
        <div class="bg-[#FAF9F6] border border-[#E1E3E5] rounded-full px-3.5 py-1 text-[11px] text-[#6D7175] shadow-xs">
            ${escapeHtml(text)}
        </div>
    `;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function showChatLoading(show) {
    const loader = document.getElementById("chat-loader");
    if (loader) {
        loader.style.display = show ? "flex" : "none";
    }
}

// -------------------------------------------------------------
// Audio Player & Mint Sound Wave Visualizer
// -------------------------------------------------------------

function playAudioFromBase64(base64DataUri) {
    if (!base64DataUri) return;

    if (currentAudio) {
        currentAudio.pause();
    }

    currentAudio = new Audio(base64DataUri);
    startAudioVisualizer();

    currentAudio.onended = () => {
        stopAudioVisualizer();
    };

    currentAudio.onerror = () => {
        stopAudioVisualizer();
        console.warn("ElevenLabs audio playback failed or was interrupted.");
    };

    currentAudio.play().catch(e => {
        console.warn("Autoplay blocked by browser. User interaction required:", e);
        stopAudioVisualizer();
    });
}

function startAudioVisualizer() {
    const vis = document.getElementById("audio-visualizer");
    if (vis) vis.style.display = "flex";
}

function stopAudioVisualizer() {
    const vis = document.getElementById("audio-visualizer");
    if (vis) vis.style.display = "none";
}

// -------------------------------------------------------------
// Live Policy Engine (MongoDB policies collection)
// -------------------------------------------------------------

async function fetchLivePolicy() {
    try {
        const res = await fetch("/api/policies");
        const data = await res.json();
        if (data.success && data.policy) {
            const limit = data.policy.max_auto_refund;
            const heroElem = document.getElementById("live-policy-limit-hero");
            if (heroElem) {
                heroElem.innerText = `$${limit.toFixed(2)}`;
            }
            const input = document.getElementById("policy-limit-input");
            if (input && document.activeElement !== input) {
                input.value = limit;
            }
        }
    } catch (e) {
        console.error("Error fetching live policy:", e);
    }
}

async function updatePolicyFromInput() {
    const input = document.getElementById("policy-limit-input");
    const val = parseFloat(input.value);
    if (isNaN(val) || val < 0) {
        alert("Please enter a valid positive limit.");
        return;
    }

    try {
        const res = await fetch("/api/policies", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ max_auto_refund: val, agent_id: "agent_01" })
        });
        const data = await res.json();
        if (res.ok) {
            fetchLivePolicy();
            showToast(`MongoDB Atlas policy updated: limit is now $${val.toFixed(2)} USD`);
        } else {
            alert("Error updating policy: " + data.detail);
        }
    } catch (e) {
        console.error(e);
        alert("Network error updating policy");
    }
}

// -------------------------------------------------------------
// Human-in-the-Loop Review Queue (MongoDB refund_requests)
// -------------------------------------------------------------

async function fetchPendingRequests() {
    try {
        const res = await fetch("/api/refund-requests?status=PENDING");
        const data = await res.json();
        if (data.success) {
            renderPendingRequests(data.requests || []);
        }
    } catch (e) {
        console.error("Error fetching pending requests:", e);
    }
}

function renderPendingRequests(requests) {
    const tbody = document.getElementById("pending-requests-tbody");
    const countBadge = document.getElementById("pending-count-badge");
    const tabBadge = document.getElementById("tab-pending-badge");
    
    if (countBadge) countBadge.innerText = requests.length;
    if (tabBadge) tabBadge.innerText = requests.length;

    if (!tbody) return;

    if (requests.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="4" class="py-12 text-center">
                    <div class="w-9 h-9 mx-auto mb-2 rounded-full bg-[#E3F1DF] text-[#008060] flex items-center justify-center">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
                    </div>
                    <p class="text-xs font-bold text-[#202223]">Queue Clear</p>
                    <p class="text-[11px] text-[#6D7175] mt-0.5">All customer requests are operating within autonomous policy bounds.</p>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = requests.map(req => {
        const isInjection = /override|ignore|jailbreak|bypass|hack/i.test(req.reason || "");
        const formattedDate = req.created_at ? new Date(req.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : "Just now";

        return `
            <tr class="hover:bg-[#FAF9F6] transition">
                <td class="whitespace-nowrap">
                    <div class="flex items-center gap-1.5">
                        <span class="font-mono text-xs font-bold text-[#B98900] bg-[#FFF5EA] px-2 py-0.5 rounded border border-[#FFE0B2]">
                            ${escapeHtml(req.request_id)}
                        </span>
                        ${isInjection ? `
                            <span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#FDEBE7] text-[#D82C0D] border border-[#FACDC6]">
                                ⚠️ Prompt Injection
                            </span>
                        ` : ''}
                    </div>
                    <div class="text-[10px] text-[#6D7175] font-mono mt-0.5 flex items-center gap-1">
                        <span>${formattedDate}</span>
                        <span>•</span>
                        <span class="truncate max-w-[120px]" title="${escapeHtml(req.thread_id)}">${escapeHtml(req.thread_id)}</span>
                    </div>
                </td>
                <td>
                    <div class="text-xs text-[#202223] max-w-xs md:max-w-sm truncate cursor-help" title="${escapeHtml(req.reason)}">
                        ${escapeHtml(req.reason)}
                    </div>
                    <div class="text-[10px] text-[#6D7175] mt-0.5">
                        Applied Limit: <strong class="font-mono">$${parseFloat(req.policy_limit_applied || 50).toFixed(2)}</strong>
                    </div>
                </td>
                <td class="text-right whitespace-nowrap">
                    <span class="text-sm font-extrabold text-[#202223] font-mono">$${parseFloat(req.amount).toFixed(2)}</span>
                    <span class="text-[10px] text-[#6D7175] block -mt-0.5">USD</span>
                </td>
                <td class="text-right whitespace-nowrap">
                    <div class="inline-flex items-center gap-1.5">
                        <button onclick="approveRequest('${req.request_id}')" class="btn-emerald px-3 py-1.5 text-xs flex items-center gap-1 shadow-2xs">
                            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"></path></svg>
                            <span>Approve</span>
                        </button>
                        <button onclick="rejectRequest('${req.request_id}')" class="px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-white border border-[#D82C0D] text-[#D82C0D] hover:bg-[#FDEBE7] transition flex items-center gap-1">
                            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                            <span>Decline</span>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join("");
}

async function approveRequest(requestId) {
    try {
        const res = await fetch(`/api/approve/${requestId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ manager_notes: "Approved via Polaris Governance Console" })
        });
        const data = await res.json();
        if (res.ok) {
            showToast(`Request ${requestId} APPROVED. LangGraph resumed.`);
            fetchPendingRequests();
            fetchAuditLogs();
            if (voiceEnabled && data.data && data.data.audio_base64) {
                playAudioFromBase64(data.data.audio_base64);
            }
        } else {
            alert("Approval error: " + data.detail);
        }
    } catch (e) {
        console.error(e);
    }
}

async function rejectRequest(requestId) {
    try {
        const res = await fetch(`/api/reject/${requestId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ manager_notes: "Declined via Polaris Governance Console" })
        });
        const data = await res.json();
        if (res.ok) {
            showToast(`Request ${requestId} DECLINED. LangGraph resumed.`);
            fetchPendingRequests();
            fetchAuditLogs();
            if (voiceEnabled && data.data && data.data.audio_base64) {
                playAudioFromBase64(data.data.audio_base64);
            }
        } else {
            alert("Rejection error: " + data.detail);
        }
    } catch (e) {
        console.error(e);
    }
}

// -------------------------------------------------------------
// Live Immutable Audit Ledger (MongoDB audit_logs)
// -------------------------------------------------------------

async function fetchAuditLogs() {
    try {
        const res = await fetch("/api/audit-logs?limit=40");
        const data = await res.json();
        if (data.success) {
            cachedAuditLogs = data.logs || [];
            renderAuditLogs(cachedAuditLogs);
        }
    } catch (e) {
        console.error("Error fetching audit logs:", e);
    }
}

function renderAuditLogs(logs) {
    const tbody = document.getElementById("audit-logs-tbody");
    const countBadge = document.getElementById("audit-count-badge");
    const tabBadge = document.getElementById("tab-audit-badge");
    
    if (countBadge) countBadge.innerText = logs.length;
    if (tabBadge) tabBadge.innerText = logs.length;
    if (!tbody) return;

    if (logs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="py-12 text-center text-xs text-[#6D7175]">No audit logs recorded in MongoDB Atlas yet.</td></tr>`;
        return;
    }

    tbody.innerHTML = logs.map((log, index) => {
        let badgeHtml = "";
        let eventName = "Refund Review";

        if (log.decision === "AUTO_APPROVED") {
            badgeHtml = `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#E3F1DF] text-[#006E52] border border-[#B7DDB1]">Auto-Approved</span>`;
            eventName = "Autonomous Execution";
        } else if (log.decision === "PENDING_APPROVAL") {
            badgeHtml = `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#FFF5EA] text-[#B98900] border border-[#FFE0B2]">Pending Review</span>`;
            eventName = "Human Gate Paused";
        } else if (log.decision === "HUMAN_APPROVED") {
            badgeHtml = `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#EBF5FF] text-[#0066CC] border border-[#B8DAFF]">Manager Approved</span>`;
            eventName = "HITL Override Resumed";
        } else if (log.decision === "HUMAN_REJECTED") {
            badgeHtml = `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#FDEBE7] text-[#D82C0D] border border-[#FACDC6]">Declined</span>`;
            eventName = "Manager Decline Resumed";
        } else if (log.decision === "BLOCKED_BY_SCHEMA") {
            badgeHtml = `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#F3E8FF] text-[#7E22CE] border border-[#D8B4FE]">Blocked (Schema)</span>`;
            eventName = "$jsonSchema Tamper Block";
        } else {
            badgeHtml = `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-100 text-gray-700 border border-gray-300">${escapeHtml(log.decision || "LOG")}</span>`;
        }

        const dateStr = log.timestamp ? new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : "Just now";
        const rawId = log._id || "";
        const shortId = rawId.length > 12 ? rawId.substring(0, 10) + "..." : rawId;

        return `
            <tr class="hover:bg-[#FAF9F6] transition text-xs">
                <td class="text-[#6D7175] font-mono whitespace-nowrap">${dateStr}</td>
                <td>
                    <div class="font-bold text-[#202223]">${eventName}</div>
                    <div class="text-[10px] text-[#6D7175] font-mono">Agent: ${escapeHtml(log.agent_id || "agent_01")}</div>
                </td>
                <td class="text-right font-extrabold text-[#202223] font-mono whitespace-nowrap">
                    $${parseFloat(log.user_requested_amount || 0).toFixed(2)}
                </td>
                <td class="whitespace-nowrap">
                    ${badgeHtml}
                </td>
                <td class="whitespace-nowrap">
                    <span class="px-2 py-0.5 rounded font-mono text-[11px] bg-[#FAF9F6] border border-[#E1E3E5] text-[#6D7175]" title="${escapeHtml(rawId)}">
                        ${escapeHtml(shortId)}
                    </span>
                </td>
                <td class="text-right whitespace-nowrap">
                    <button onclick="openBsonInspector(${index})" class="px-2.5 py-1 text-xs font-semibold rounded-md bg-white border border-[#E1E3E5] text-[#202223] hover:border-[#008060] hover:text-[#008060] hover:bg-[#FAF9F6] transition inline-flex items-center gap-1.5 shadow-2xs">
                        <svg class="w-3.5 h-3.5 text-[#008060]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"></path></svg>
                        <span>Inspect BSON</span>
                    </button>
                </td>
            </tr>
        `;
    }).join("");
}

function openBsonInspector(index) {
    const log = cachedAuditLogs[index];
    if (!log) return;

    const modal = document.getElementById("bson-modal");
    const code = document.getElementById("bson-modal-code");
    code.innerText = JSON.stringify(log, null, 2);
    modal.classList.remove("hidden");
}

// -------------------------------------------------------------
// Schema Validation Live Test for Judges
// -------------------------------------------------------------

async function runSchemaValidationTest() {
    const banner = document.getElementById("schema-result-card");
    const pre = document.getElementById("schema-error-code");

    try {
        const res = await fetch("/api/test-schema-enforcement", { method: "POST" });
        const data = await res.json();

        if (data.success && data.result) {
            const r = data.result;
            banner.classList.remove("hidden");

            if (r.blocked) {
                pre.innerText = JSON.stringify(r.raw_rejection || r, null, 2);
                showToast("MongoDB Atlas physically rejected the invalid document (Code 121)!");
            } else {
                pre.innerText = JSON.stringify(r, null, 2);
            }
            fetchAuditLogs();
        }
    } catch (e) {
        console.error(e);
        alert("Failed to execute schema validation test.");
    }
}

// Utility Helpers
function escapeHtml(text) {
    if (!text) return "";
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function showToast(msg) {
    const toast = document.getElementById("toast-notification");
    const text = document.getElementById("toast-text");
    if (toast && text) {
        text.innerText = msg;
        toast.classList.remove("translate-y-20", "opacity-0");
        toast.classList.add("translate-y-0", "opacity-100");
        setTimeout(() => {
            toast.classList.remove("translate-y-0", "opacity-100");
            toast.classList.add("translate-y-20", "opacity-0");
        }, 4000);
    }
}

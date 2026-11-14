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
    const closeBsonModalBtn = document.getElementById("close-bson-modal-btn");
    const copyBsonBtn = document.getElementById("copy-bson-btn");

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
    const container = document.getElementById("pending-requests-container");
    const countBadge = document.getElementById("pending-count-badge");
    if (countBadge) {
        countBadge.innerText = requests.length;
    }

    if (!container) return;

    if (requests.length === 0) {
        container.innerHTML = `
            <div class="py-10 text-center bg-[#FAF9F6] border border-[#E1E3E5] rounded-xl">
                <div class="w-10 h-10 mx-auto mb-2 rounded-full bg-[#E3F1DF] text-[#008060] flex items-center justify-center">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
                </div>
                <h4 class="text-sm font-semibold text-[#202223]">Queue Clear</h4>
                <p class="text-xs text-[#6D7175] mt-0.5">All customer requests are operating within autonomous policy bounds.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = requests.map(req => {
        const isInjection = /override|ignore|jailbreak|bypass|hack/i.test(req.reason || "");
        const formattedDate = req.created_at ? new Date(req.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : "Just now";

        return `
            <div class="bg-white border border-[#E1E3E5] rounded-xl p-4 mb-3.5 shadow-sm hover:shadow-md transition">
                <div class="flex items-center justify-between mb-2">
                    <div class="flex items-center gap-2">
                        <span class="px-2 py-0.5 rounded font-mono text-xs font-bold bg-[#FFF5EA] text-[#B98900] border border-[#FFE0B2]">
                            ${escapeHtml(req.request_id)}
                        </span>
                        <span class="text-xs text-[#6D7175]">${formattedDate}</span>
                    </div>
                    <div class="text-base font-extrabold text-[#202223] font-mono">
                        $${parseFloat(req.amount).toFixed(2)} <span class="text-xs font-normal text-[#6D7175]">USD</span>
                    </div>
                </div>

                ${isInjection ? `
                    <div class="mb-2 px-2.5 py-1 rounded bg-[#FDEBE7] border border-[#FACDC6] flex items-center gap-1.5 text-xs font-bold text-[#D82C0D]">
                        <svg class="w-4 h-4 text-[#D82C0D]" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"></path></svg>
                        Adversarial Override Keywords Detected
                    </div>
                ` : ''}

                <div class="bg-[#F6F6F7] border border-[#EDEEEF] rounded-lg p-2.5 mb-3 text-xs text-[#202223] leading-relaxed">
                    <span class="text-[#6D7175] font-semibold block mb-0.5">Customer Claim / Reason:</span>
                    ${escapeHtml(req.reason)}
                </div>

                <div class="flex items-center justify-between text-[11px] text-[#6D7175] font-mono mb-3 pt-1 border-t border-[#EDEEEF]">
                    <span>Thread: ${escapeHtml(req.thread_id.substring(0, 16))}...</span>
                    <span>Applied Limit: <strong>$${parseFloat(req.policy_limit_applied || 50).toFixed(2)}</strong></span>
                </div>

                <div class="flex gap-2">
                    <button onclick="approveRequest('${req.request_id}')" class="flex-1 btn-emerald py-2 text-xs flex items-center justify-center gap-1.5">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"></path></svg>
                        Approve & Resume
                    </button>
                    <button onclick="rejectRequest('${req.request_id}')" class="px-4 py-2 text-xs font-semibold rounded-lg bg-white border border-[#D82C0D] text-[#D82C0D] hover:bg-[#FDEBE7] transition flex items-center justify-center gap-1">
                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                        Reject
                    </button>
                </div>
            </div>
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
    if (countBadge) countBadge.innerText = logs.length;
    if (!tbody) return;

    if (logs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="py-8 text-center text-xs text-[#6D7175]">No audit logs recorded in MongoDB Atlas yet.</td></tr>`;
        return;
    }

    tbody.innerHTML = logs.map((log, index) => {
        let pillClass = "bg-gray-100 text-gray-700 border-gray-300";
        if (log.decision === "AUTO_APPROVED") {
            pillClass = "bg-[#E3F1DF] text-[#006E52] border-[#B7DDB1]";
        } else if (log.decision === "PENDING_APPROVAL") {
            pillClass = "bg-[#FFF5EA] text-[#B98900] border-[#FFE0B2]";
        } else if (log.decision === "HUMAN_APPROVED") {
            pillClass = "bg-[#EBF5FF] text-[#0066CC] border-[#B8DAFF]";
        } else if (log.decision === "HUMAN_REJECTED") {
            pillClass = "bg-[#FDEBE7] text-[#D82C0D] border-[#FACDC6]";
        } else if (log.decision === "BLOCKED_BY_SCHEMA") {
            pillClass = "bg-[#F3E8FF] text-[#7E22CE] border-[#D8B4FE]";
        }

        const dateStr = log.timestamp ? new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : "Just now";
        const shortId = (log._id || "").substring(0, 8);

        return `
            <tr class="border-b border-[#EDEEEF] hover:bg-[#FAF9F6] transition text-xs">
                <td class="py-3 px-3.5 text-[#6D7175] font-mono whitespace-nowrap">${dateStr}</td>
                <td class="py-3 px-3.5">
                    <span class="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold border uppercase tracking-wider ${pillClass}">
                        ${escapeHtml(log.decision)}
                    </span>
                </td>
                <td class="py-3 px-3.5 font-bold text-[#202223] font-mono">
                    $${parseFloat(log.user_requested_amount || 0).toFixed(2)}
                </td>
                <td class="py-3 px-3.5 text-[#6D7175] font-mono">
                    $${parseFloat(log.policy_limit_applied || 0).toFixed(2)}
                </td>
                <td class="py-3 px-3.5 text-[#202223] max-w-xs truncate" title="${escapeHtml(log.reason || '')}">
                    ${escapeHtml(log.reason || '')}
                </td>
                <td class="py-3 px-3.5 text-right">
                    <button onclick="openBsonInspector(${index})" class="px-2 py-1 text-[11px] font-mono font-semibold rounded bg-white border border-[#E1E3E5] text-[#202223] hover:bg-[#F6F6F7] hover:border-[#008060] hover:text-[#008060] transition">
                        ${shortId}... BSON
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

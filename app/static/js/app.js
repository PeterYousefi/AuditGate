// AuditGate — Shopify Editions & Sidekick Flagship Craft Controller
// Full-Viewport 100vh Split Canvas • Live MongoDB Atlas HITL Governance

let currentThreadId = "thread_ORD_" + Math.random().toString(36).substring(2, 8).toUpperCase();
let voiceEnabled = true;
let currentAudio = null;
let cachedAuditLogs = [];
let cachedPolicyLimit = 50.0;

document.addEventListener("DOMContentLoaded", () => {
    initApp();
});

function initApp() {
    setupEventListeners();
    setupTabs();
    setupPolicyControls();
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

// -------------------------------------------------------------
// Navigation & Tab Switching (Segmented Pills)
// -------------------------------------------------------------

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

// -------------------------------------------------------------
// Interactive Policy Controls (Slider + Presets + Input)
// -------------------------------------------------------------

function setupPolicyControls() {
    const slider = document.getElementById("policy-slider");
    const input = document.getElementById("policy-limit-input");

    if (slider && input) {
        slider.addEventListener("input", (e) => {
            const val = parseFloat(e.target.value);
            input.value = val;
            updatePresetPillsActiveState(val);
        });

        input.addEventListener("input", (e) => {
            const val = parseFloat(e.target.value);
            if (!isNaN(val)) {
                slider.value = Math.min(Math.max(val, 0), 500);
                updatePresetPillsActiveState(val);
            }
        });
    }
}

function setPolicyPreset(amount) {
    const slider = document.getElementById("policy-slider");
    const input = document.getElementById("policy-limit-input");

    if (input) input.value = amount;
    if (slider) slider.value = Math.min(Math.max(amount, 0), 500);

    updatePresetPillsActiveState(amount);
    showToast(`Preset $${amount}.00 selected. Click 'Update Policy' to commit to MongoDB.`);
}

function updatePresetPillsActiveState(currentVal) {
    document.querySelectorAll(".policy-preset-pill").forEach(pill => {
        const text = pill.innerText.replace("$", "").trim();
        const pillVal = parseFloat(text);
        if (pillVal === currentVal) {
            pill.classList.add("active");
        } else {
            pill.classList.remove("active");
        }
    });
}

// -------------------------------------------------------------
// Event Listeners & Setup
// -------------------------------------------------------------

function setupEventListeners() {
    const chatForm = document.getElementById("chat-form");
    const chatInput = document.getElementById("chat-input");
    const voiceToggle = document.getElementById("voice-toggle-btn");
    const schemaTestBtn = document.getElementById("schema-test-btn");
    const updatePolicyBtn = document.getElementById("update-policy-btn");
    const resetDemoBtn = document.getElementById("reset-demo-btn");
    const clearAllPendingBtn = document.getElementById("clear-all-pending-btn");
    const closeBsonModalBtn = document.getElementById("close-bson-modal-btn");
    const copyBsonBtn = document.getElementById("copy-bson-btn");
    const bsonModal = document.getElementById("bson-modal");

    if (clearAllPendingBtn) {
        clearAllPendingBtn.addEventListener("click", clearPendingQueue);
    }

    if (resetDemoBtn) {
        resetDemoBtn.addEventListener("click", resetDemoSession);
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

async function resetDemoSession() {
    await clearPendingQueue();
    currentThreadId = "thread_ORD_" + Math.random().toString(36).substring(2, 8).toUpperCase();
    updateThreadDisplay();
    const messagesContainer = document.getElementById("chat-messages");
    if (messagesContainer) {
        messagesContainer.innerHTML = "";
        appendSystemMessage(`Demo environment reset. Clean slate: ${currentThreadId}`);
    }
    showToast("Demo environment reset. Fresh order session ready.");
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

        // Cleanly dismiss pending items via reject endpoint
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
            <span class="h-2 w-2 rounded-full bg-[#10B981]"></span>
            <span>Voice: <strong>ON</strong></span>
        `;
        btn.className = "px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#008060]/20 border border-[#008060]/50 text-[#34D399] hover:bg-[#008060]/30 flex items-center gap-1.5 transition";
    } else {
        btn.innerHTML = `
            <span class="h-2 w-2 rounded-full bg-[#9CA3AF]"></span>
            <span>Voice: <strong>MUTED</strong></span>
        `;
        btn.className = "px-3 py-1.5 text-xs font-semibold rounded-lg bg-white/10 border border-white/15 text-white/60 hover:bg-white/15 flex items-center gap-1.5 transition";
    }
}

// -------------------------------------------------------------
// Customer Chat & ElevenLabs Voice (Editorial Personal Shopper)
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
    if (!container) return;
    const div = document.createElement("div");
    div.className = "flex justify-end mb-4 animate-fade-in";
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    div.innerHTML = `
        <div class="customer-card-bubble">
            <p class="leading-relaxed text-xs font-normal">${escapeHtml(text)}</p>
            <div class="flex items-center justify-end gap-1.5 mt-1 text-[10px] text-[#6D7175]">
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
    if (!container) return;
    const div = document.createElement("div");
    div.className = "flex justify-start mb-4 animate-fade-in";
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    let borderClass = "state-auto-approved";
    let pillHtml = `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-100 text-gray-700 border border-gray-300">Policy Checked</span>`;
    let receiptStatus = "Policy Evaluated";

    if (status === "AUTO_APPROVED") {
        borderClass = "state-auto-approved";
        receiptStatus = `Auto-Approved (≤ $${cachedPolicyLimit.toFixed(2)} limit)`;
        pillHtml = `
            <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#E3F1DF] text-[#006E52] border border-[#B7DDB1]">
                <svg class="w-3 h-3 mr-1 text-[#008060]" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"></path></svg>
                Auto-Approved (≤ Policy Limit)
            </span>
        `;
    } else if (status === "PENDING_APPROVAL") {
        borderClass = "state-pending-approval";
        receiptStatus = `Paused in MongoDB (> $${cachedPolicyLimit.toFixed(2)} limit)`;
        pillHtml = `
            <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#FFFBEB] text-[#D97706] border border-[#FDE68A]">
                <svg class="w-3 h-3 mr-1 text-[#D97706]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                Paused for Human Manager Gate
            </span>
        `;
    } else if (status === "HUMAN_APPROVED") {
        borderClass = "state-auto-approved";
        receiptStatus = "Manager Override Approved";
        pillHtml = `
            <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#EBF5FF] text-[#0066CC] border border-[#B8DAFF]">
                Manager Approved
            </span>
        `;
    } else if (status === "HUMAN_REJECTED") {
        borderClass = "state-blocked";
        receiptStatus = "Manager Declined Refund";
        pillHtml = `
            <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#FEF2F2] text-[#DC2626] border border-[#FECACA]">
                Manager Declined
            </span>
        `;
    }

    const audioButtonHtml = audioB64 ? `
        <button onclick="playAudioFromBase64('${audioB64}')" class="mt-2 inline-flex items-center px-2.5 py-1 text-xs font-semibold rounded-md bg-[#FAF9F6] border border-[#E5E7EB] text-[#008060] hover:bg-[#EBF5F0] hover:border-[#B7DDB1] transition">
            <svg class="w-3.5 h-3.5 mr-1" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd"></path></svg>
            Replay ElevenLabs Voice
        </button>
    ` : '';

    div.innerHTML = `
        <div class="agent-card-bubble ${borderClass}">
            <div class="flex items-center justify-between gap-2 mb-2 pb-1.5 border-b border-[#F0F2F5]">
                <div class="flex items-center gap-1.5">
                    <div class="w-5 h-5 rounded-full bg-[#E3F1DF] text-[#008060] flex items-center justify-center font-bold text-[10px]">
                        VS
                    </div>
                    <span class="text-xs font-bold text-[#1A1A1A]">Verve Concierge</span>
                    <span class="text-[10px] font-mono text-[#6D7175]">(agent_01)</span>
                </div>
                ${pillHtml}
            </div>
            
            <p class="leading-relaxed text-xs text-[#202223]">${escapeHtml(text)}</p>

            <!-- Embedded Mini-Receipt Verification Card -->
            <div class="mini-receipt-card text-[#4B5563]">
                <div class="flex justify-between items-center">
                    <span>Policy Limit: <strong>$${cachedPolicyLimit.toFixed(2)} USD</strong></span>
                    <span>Status: <strong class="text-[#1A1A1A]">${escapeHtml(receiptStatus)}</strong></span>
                </div>
                ${requestId ? `
                    <div class="flex justify-between items-center mt-1 pt-1 border-t border-dashed border-gray-200">
                        <span>MongoDB Request ID:</span>
                        <strong class="font-mono text-[#D97706]">${escapeHtml(requestId)}</strong>
                    </div>
                ` : ''}
            </div>

            <div class="flex items-center justify-between mt-2">
                <div>${audioButtonHtml}</div>
                <div class="text-[10px] text-[#9CA3AF] font-mono">${timeStr}</div>
            </div>
        </div>
    `;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function appendSystemMessage(text) {
    const container = document.getElementById("chat-messages");
    if (!container) return;
    const div = document.createElement("div");
    div.className = "flex justify-center my-2.5 animate-fade-in";
    div.innerHTML = `
        <div class="bg-[#F3EFEA] border border-[#E8E5DF] rounded-full px-3.5 py-0.5 text-[10px] text-[#6D7175] font-medium">
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
// Audio Player & Animated Equalizer Bars
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
            cachedPolicyLimit = limit;

            const heroElem = document.getElementById("live-policy-limit-hero");
            if (heroElem) {
                heroElem.innerText = `$${limit.toFixed(2)}`;
            }

            const input = document.getElementById("policy-limit-input");
            const slider = document.getElementById("policy-slider");

            if (input && document.activeElement !== input) {
                input.value = limit;
            }
            if (slider && document.activeElement !== slider) {
                slider.value = Math.min(Math.max(limit, 0), 500);
            }

            updatePresetPillsActiveState(limit);
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
            cachedPolicyLimit = val;
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

function renderPendingRequests(rawRequests) {
    const tbody = document.getElementById("pending-requests-tbody");
    const countBadge = document.getElementById("pending-count-badge");
    const tabBadge = document.getElementById("tab-pending-badge");

    // Deduplicate by request_id
    const seen = new Set();
    const requests = [];
    for (const r of rawRequests) {
        if (!seen.has(r.request_id)) {
            seen.add(r.request_id);
            requests.push(r);
        }
    }

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
                    <p class="text-xs font-bold text-[#1A1A1A]">Governance Queue Clear</p>
                    <p class="text-[11px] text-[#6D7175] mt-0.5">All customer requests are operating within autonomous policy bounds.</p>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = requests.map(req => {
        const isInjection = /override|ignore|jailbreak|bypass|hack/i.test(req.reason || "");
        const formattedDate = req.created_at ? new Date(req.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : "Just now";
        const dotColor = isInjection ? "bg-[#DC2626]" : "bg-[#D97706]";

        return `
            <tr class="hover:bg-[#FAFBFB] transition">
                <td class="whitespace-nowrap">
                    <div class="flex items-center gap-1.5">
                        <span class="h-2 w-2 rounded-full ${dotColor} flex-shrink-0"></span>
                        <span class="font-mono text-xs font-bold text-[#D97706] bg-[#FFFBEB] px-2 py-0.5 rounded border border-[#FDE68A]">
                            ${escapeHtml(req.request_id)}
                        </span>
                        ${req.order_id ? `
                            <span class="font-mono text-[10px] font-semibold text-[#1A1A1A] bg-[#F3F4F6] px-1.5 py-0.5 rounded border border-[#E5E7EB]">
                                #${escapeHtml(req.order_id)}
                            </span>
                        ` : ''}
                        ${isInjection ? `
                            <span class="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-[#FEF2F2] text-[#DC2626] border border-[#FECACA]">
                                ⚠️ Prompt Injection
                            </span>
                        ` : ''}
                    </div>
                    <div class="text-[10px] text-[#6D7175] font-mono mt-1 flex items-center gap-1">
                        <span>${formattedDate}</span>
                        <span>•</span>
                        <span class="truncate max-w-[110px]" title="${escapeHtml(req.thread_id)}">${escapeHtml(req.thread_id)}</span>
                    </div>
                </td>
                <td>
                    <div class="text-xs text-[#202223] max-w-xs md:max-w-sm truncate cursor-help" title="${escapeHtml(req.reason)}">
                        ${escapeHtml(req.reason)}
                    </div>
                    <div class="text-[10px] text-[#6D7175] mt-0.5 flex items-center gap-1">
                        <span class="px-1.5 py-0.2 rounded bg-amber-50 text-amber-700 border border-amber-200 font-mono text-[9px]">
                            Exceeds $${parseFloat(req.policy_limit_applied || 50).toFixed(2)} limit
                        </span>
                    </div>
                </td>
                <td class="text-right whitespace-nowrap">
                    <span class="text-sm font-extrabold text-[#1A1A1A] font-mono">$${parseFloat(req.amount).toFixed(2)}</span>
                    <span class="text-[9px] text-[#6D7175] block -mt-0.5">USD</span>
                </td>
                <td class="text-right whitespace-nowrap">
                    <div class="inline-flex items-center gap-1.5">
                        <button onclick="approveRequest('${req.request_id}')" class="btn-emerald px-3 py-1.5 text-xs flex items-center gap-1 shadow-xs">
                            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"></path></svg>
                            <span>Approve</span>
                        </button>
                        <button onclick="rejectRequest('${req.request_id}')" class="btn-secondary-white px-2.5 py-1.5 text-xs text-[#DC2626] hover:bg-[#FEF2F2] hover:border-[#FECACA] flex items-center gap-1 transition">
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
            body: JSON.stringify({ manager_notes: "Approved via Shopify Editions Governance Console" })
        });
        const data = await res.json();
        if (res.ok) {
            const respData = data.data || {};
            const finalResp = respData.final_response || `Refund request ${requestId} has been approved by manager.`;
            const audioB64 = respData.audio_base64;

            appendAgentMessage(finalResp, "HUMAN_APPROVED", requestId, audioB64);
            showToast(`Request ${requestId} APPROVED. LangGraph resumed.`);
            fetchPendingRequests();
            fetchAuditLogs();

            if (voiceEnabled && audioB64) {
                playAudioFromBase64(audioB64);
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
            body: JSON.stringify({ manager_notes: "Declined via Shopify Editions Governance Console" })
        });
        const data = await res.json();
        if (res.ok) {
            const respData = data.data || {};
            const finalResp = respData.final_response || `Refund request ${requestId} has been declined by manager.`;
            const audioB64 = respData.audio_base64;

            appendAgentMessage(finalResp, "HUMAN_REJECTED", requestId, audioB64);
            showToast(`Request ${requestId} DECLINED. LangGraph resumed.`);
            fetchPendingRequests();
            fetchAuditLogs();

            if (voiceEnabled && audioB64) {
                playAudioFromBase64(audioB64);
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
            badgeHtml = `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#E3F1DF] text-[#006E52] border border-[#B7DDB1]">AUTO-APPROVED</span>`;
            eventName = "Autonomous Execution";
        } else if (log.decision === "PENDING_APPROVAL") {
            badgeHtml = `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#FFFBEB] text-[#D97706] border border-[#FDE68A]">PENDING-APPROVAL</span>`;
            eventName = "HITL Gate Paused";
        } else if (log.decision === "HUMAN_APPROVED") {
            badgeHtml = `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#EBF5FF] text-[#0066CC] border border-[#B8DAFF]">HUMAN-APPROVED</span>`;
            eventName = "HITL Override Resumed";
        } else if (log.decision === "HUMAN_REJECTED") {
            badgeHtml = `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#FEF2F2] text-[#DC2626] border border-[#FECACA]">DECLINED</span>`;
            eventName = "Manager Decline Resumed";
        } else if (log.decision === "BLOCKED_BY_SCHEMA") {
            badgeHtml = `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#F3E8FF] text-[#7E22CE] border border-[#D8B4FE]">BLOCKED (SCHEMA)</span>`;
            eventName = "$jsonSchema Tamper Block";
        } else {
            badgeHtml = `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-100 text-gray-700 border border-gray-300">${escapeHtml(log.decision || "LOG")}</span>`;
        }

        const dateStr = log.timestamp ? new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : "Just now";
        const rawId = log._id || "";
        const shortId = rawId.length > 12 ? rawId.substring(0, 10) + "..." : rawId;

        return `
            <tr class="hover:bg-[#FAFBFB] transition text-xs">
                <td class="text-[#6D7175] font-mono whitespace-nowrap">${dateStr}</td>
                <td>
                    <div class="font-bold text-[#1A1A1A]">${eventName}</div>
                    <div class="text-[10px] text-[#6D7175] font-mono">Agent: ${escapeHtml(log.agent_id || "agent_01")}</div>
                </td>
                <td class="text-right font-extrabold text-[#1A1A1A] font-mono whitespace-nowrap">
                    $${parseFloat(log.user_requested_amount || 0).toFixed(2)}
                </td>
                <td class="whitespace-nowrap">
                    ${badgeHtml}
                </td>
                <td class="whitespace-nowrap">
                    <span class="px-2 py-0.5 rounded font-mono text-[11px] bg-[#FAF9F6] border border-[#E5E7EB] text-[#6D7175]" title="${escapeHtml(rawId)}">
                        ${escapeHtml(shortId)}
                    </span>
                </td>
                <td class="text-right whitespace-nowrap">
                    <button onclick="openBsonInspector(${index})" class="btn-secondary-white px-2.5 py-1 text-xs inline-flex items-center gap-1.5 shadow-2xs">
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
                showToast("MongoDB Atlas physically rejected invalid write (Code 121)!");
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

// -------------------------------------------------------------
// Utility Helpers
// -------------------------------------------------------------

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

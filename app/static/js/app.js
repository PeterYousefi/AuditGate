// AuditGate — Single-Column Centered AI Stage Controller
// Perplexity & Apple Intelligence Inspired • Live MongoDB Atlas HITL Governance

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
    setupPresetButtons();
    updateThreadDisplay();
    fetchLivePolicy();
    fetchAuditLogs();

    // Background sync with MongoDB Atlas every 4 seconds
    setInterval(() => {
        fetchLivePolicy();
        fetchAuditLogs();
    }, 4000);
}

function updateThreadDisplay() {
    const threadElem = document.getElementById("active-thread-id");
    if (threadElem) {
        threadElem.innerText = currentThreadId;
    }
}

// -------------------------------------------------------------
// Top Bar & Global Event Listeners
// -------------------------------------------------------------

function setupEventListeners() {
    const chatForm = document.getElementById("chat-form");
    const chatInput = document.getElementById("chat-input");
    const voiceToggle = document.getElementById("voice-toggle-btn");
    const resetBtn = document.getElementById("reset-session-btn");
    const testSchemaBtn = document.getElementById("test-schema-btn");
    
    // Drawer elements
    const drawerOpenBtn = document.getElementById("audit-drawer-open-btn");
    const drawerCloseBtn = document.getElementById("close-audit-drawer-btn");
    const drawer = document.getElementById("audit-drawer");
    const refreshAuditBtn = document.getElementById("refresh-audit-logs-btn");

    // BSON Modal elements
    const bsonModal = document.getElementById("bson-modal");
    const bsonCloseBtn = document.getElementById("close-bson-modal-btn");
    const copyBsonBtn = document.getElementById("copy-bson-btn");

    // Chat form submit
    if (chatForm && chatInput) {
        chatForm.addEventListener("submit", (e) => {
            e.preventDefault();
            const msg = chatInput.value.trim();
            if (msg) {
                sendChatMessage(msg);
                chatInput.value = "";
            }
        });
    }

    // Voice toggle
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

    // Reset demo session
    if (resetBtn) {
        resetBtn.addEventListener("click", resetDemoSession);
    }

    // Test Schema Guard
    if (testSchemaBtn) {
        testSchemaBtn.addEventListener("click", runSchemaValidationTest);
    }

    // Scenario chips
    document.querySelectorAll(".scenario-chip").forEach(chip => {
        chip.addEventListener("click", () => {
            const prompt = chip.getAttribute("data-prompt");
            if (prompt) {
                sendChatMessage(prompt);
            }
        });
    });

    // Drawer open / close
    if (drawerOpenBtn && drawer) {
        drawerOpenBtn.addEventListener("click", () => {
            drawer.classList.remove("hidden");
            fetchAuditLogs();
        });
    }

    if (drawerCloseBtn && drawer) {
        drawerCloseBtn.addEventListener("click", () => {
            drawer.classList.add("hidden");
        });
    }

    if (drawer) {
        drawer.addEventListener("click", (e) => {
            if (e.target === drawer) {
                drawer.classList.add("hidden");
            }
        });
    }

    if (refreshAuditBtn) {
        refreshAuditBtn.addEventListener("click", () => {
            fetchAuditLogs();
            showToast("Audit logs refreshed from MongoDB Atlas.");
        });
    }

    // BSON Modal
    if (bsonCloseBtn && bsonModal) {
        bsonCloseBtn.addEventListener("click", () => {
            bsonModal.classList.add("hidden");
        });
    }

    if (bsonModal) {
        bsonModal.addEventListener("click", (e) => {
            if (e.target === bsonModal) {
                bsonModal.classList.add("hidden");
            }
        });
    }

    if (copyBsonBtn) {
        copyBsonBtn.addEventListener("click", () => {
            const code = document.getElementById("bson-modal-code").innerText;
            navigator.clipboard.writeText(code);
            showToast("MongoDB BSON Document copied to clipboard!");
        });
    }

    // Escape key closes modals / drawer
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            if (drawer && !drawer.classList.contains("hidden")) {
                drawer.classList.add("hidden");
            }
            if (bsonModal && !bsonModal.classList.contains("hidden")) {
                bsonModal.classList.add("hidden");
            }
        }
    });
}

// -------------------------------------------------------------
// Interactive Preset Buttons ($25, $50, $200, $500)
// Immediately updates live rule in MongoDB policies without server restart
// -------------------------------------------------------------

function setupPresetButtons() {
    document.querySelectorAll(".policy-preset-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const val = parseFloat(btn.getAttribute("data-val"));
            if (!isNaN(val)) {
                setPolicyPreset(val);
            }
        });
    });
}

async function setPolicyPreset(amount) {
    try {
        const heroElem = document.getElementById("hero-policy-limit");
        if (heroElem) {
            heroElem.innerText = `$${amount.toFixed(2)}`;
        }
        updatePresetButtonsActiveState(amount);

        const res = await fetch("/api/policies", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ max_auto_refund: amount, agent_id: "agent_01" })
        });

        const data = await res.json();
        if (res.ok) {
            cachedPolicyLimit = amount;
            showToast(`MongoDB Policy Updated: Auto-Refund Limit is now $${amount.toFixed(2)} USD`);
            fetchLivePolicy();
        } else {
            showToast(`Error updating policy: ${data.detail || 'Failed'}`);
        }
    } catch (e) {
        console.error("Failed to set policy preset:", e);
        showToast("Network error updating MongoDB policy limit.");
    }
}

function updatePresetButtonsActiveState(currentVal) {
    document.querySelectorAll(".policy-preset-btn").forEach(btn => {
        const val = parseFloat(btn.getAttribute("data-val"));
        if (val === currentVal) {
            btn.classList.add("active");
        } else {
            btn.classList.remove("active");
        }
    });
}

async function fetchLivePolicy() {
    try {
        const res = await fetch("/api/policies");
        const data = await res.json();
        if (data.success && data.policy) {
            const limit = parseFloat(data.policy.max_auto_refund || 50.0);
            cachedPolicyLimit = limit;
            
            const heroElem = document.getElementById("hero-policy-limit");
            if (heroElem) {
                heroElem.innerText = `$${limit.toFixed(2)}`;
            }

            const welcomeRef = document.getElementById("welcome-limit-ref");
            if (welcomeRef) {
                welcomeRef.innerText = `$${limit.toFixed(2)}`;
            }

            updatePresetButtonsActiveState(limit);
        }
    } catch (e) {
        console.error("Error fetching live policy:", e);
    }
}

// -------------------------------------------------------------
// Voice Toggle & Visualizer
// -------------------------------------------------------------

function updateVoiceToggleButton() {
    const btn = document.getElementById("voice-toggle-btn");
    if (!btn) return;

    if (voiceEnabled) {
        btn.innerHTML = `
            <span class="h-2.5 w-2.5 rounded-full bg-[#059669]"></span>
            <span>Voice: <strong>ON</strong></span>
            <div id="audio-visualizer" class="hidden items-center gap-0.5 ml-1">
                <span class="equalizer-bar"></span>
                <span class="equalizer-bar"></span>
                <span class="equalizer-bar"></span>
                <span class="equalizer-bar"></span>
                <span class="equalizer-bar"></span>
            </div>
        `;
        btn.className = "h-[42px] px-4 text-[15px] font-bold rounded-full bg-[#F3F4F6] hover:bg-[#E5E7EB] border border-[#EAEAEA] text-[#111827] flex items-center gap-2 transition";
    } else {
        btn.innerHTML = `
            <span class="h-2.5 w-2.5 rounded-full bg-[#9CA3AF]"></span>
            <span>Voice: <strong>MUTED</strong></span>
        `;
        btn.className = "h-[42px] px-4 text-[15px] font-bold rounded-full bg-[#F3F4F6] hover:bg-[#E5E7EB] border border-[#EAEAEA] text-[#6B7280] flex items-center gap-2 transition";
    }
}

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
        console.warn("ElevenLabs audio playback failed or interrupted.");
    };

    currentAudio.play().catch(e => {
        console.warn("Autoplay blocked by browser policy:", e);
        stopAudioVisualizer();
    });
}

function startAudioVisualizer() {
    const vis = document.getElementById("audio-visualizer");
    if (vis) vis.classList.replace("hidden", "flex");
}

function stopAudioVisualizer() {
    const vis = document.getElementById("audio-visualizer");
    if (vis) vis.classList.replace("flex", "hidden");
}

// -------------------------------------------------------------
// Conversational Chat Stream & HITL Inline Cards
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
            // Render Agent Response
            appendAgentMessage(data.response, data.status, data.request_id, data.audio_base64, message);

            if (voiceEnabled && data.audio_base64) {
                playAudioFromBase64(data.audio_base64);
            }

            fetchAuditLogs();
        } else {
            appendSystemMessage("Error: " + (data.detail || "Failed to process chat message"));
        }
    } catch (err) {
        showChatLoading(false);
        appendSystemMessage("Network error communicating with agent concierge.");
        console.error(err);
    }
}

function appendUserMessage(text) {
    const container = document.getElementById("chat-messages");
    if (!container) return;

    const div = document.createElement("div");
    div.className = "flex justify-end animate-fade-in";
    div.innerHTML = `
        <div class="user-msg-pill">
            <p>${escapeHtml(text)}</p>
        </div>
    `;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function appendAgentMessage(text, status, requestId, audioB64, userPrompt) {
    const container = document.getElementById("chat-messages");
    if (!container) return;

    // Check if this requires an Inline HITL Decision Card
    if (status === "PENDING_APPROVAL" && requestId) {
        renderInlineHitlCard(container, text, requestId, userPrompt, audioB64);
        return;
    }

    // Normal Agent Response Card
    const div = document.createElement("div");
    div.className = "agent-msg-card animate-fade-in";

    let badgeHtml = "";
    if (status === "AUTO_APPROVED") {
        badgeHtml = `
            <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-[#E6F7F0] text-[#047857] border border-[#B7EBD5]">
                <svg class="w-3.5 h-3.5 mr-1 text-[#059669]" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"></path></svg>
                Auto-Approved (≤ $${cachedPolicyLimit.toFixed(2)} Limit)
            </span>
        `;
    } else {
        badgeHtml = `
            <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-[#F3F4F6] text-[#4B5563] border border-[#EAEAEA]">
                Policy Verified
            </span>
        `;
    }

    const audioButtonHtml = audioB64 ? `
        <button onclick="playAudioFromBase64('${audioB64}')" class="mt-3 inline-flex items-center px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#FAFAFA] border border-[#EAEAEA] text-[#059669] hover:bg-[#E6F7F0] transition">
            <svg class="w-3.5 h-3.5 mr-1.5" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd"></path></svg>
            Replay Voice Response
        </button>
    ` : '';

    div.innerHTML = `
        <div class="flex items-center justify-between gap-2 mb-2 pb-2 border-b border-[#F0F0F0]">
            <div class="flex items-center gap-2">
                <div class="w-7 h-7 rounded-full bg-[#E6F7F0] text-[#059669] flex items-center justify-center font-bold text-xs">
                    AG
                </div>
                <span class="text-sm font-bold text-[#111827]">AuditGate Concierge</span>
                <span class="text-xs font-mono text-[#6B7280]">(agent_01)</span>
            </div>
            ${badgeHtml}
        </div>

        <p class="text-[18px] leading-[1.6] text-[#111827]">${escapeHtml(text)}</p>

        <div class="mt-3 pt-2.5 border-t border-[#F0F0F0] flex flex-wrap items-center justify-between gap-2 text-xs text-[#6B7280]">
            <div class="flex items-center gap-2">
                <span>Rule: <strong class="text-[#111827] font-mono">≤ $${cachedPolicyLimit.toFixed(2)}</strong></span>
                <span>•</span>
                <span>Audit: <strong class="text-[#059669]">$jsonSchema Guaranteed</strong></span>
            </div>
            <div>${audioButtonHtml}</div>
        </div>
    `;

    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

// -------------------------------------------------------------
// INLINE HITL DECISION CARD
// Rendered right inside the chat stream when > policy limit
// -------------------------------------------------------------

function renderInlineHitlCard(container, text, requestId, userPrompt, audioB64) {
    // Extract amount and order id from prompt or text
    let amount = "250.00";
    const amtMatch = (userPrompt || text).match(/\$\s*(\d+(?:\.\d{1,2})?)/);
    if (amtMatch) {
        amount = parseFloat(amtMatch[1]).toFixed(2);
    }

    let orderId = "ORD-1089";
    const ordMatch = (userPrompt || text).match(/(?:#\s*|ORD-)(\d+)/i);
    if (ordMatch) {
        orderId = "ORD-" + ordMatch[1];
    }

    const isInjection = /override|ignore|bypass|jailbreak|hack/i.test(userPrompt || "");
    const cardId = "hitl-card-" + requestId;

    const div = document.createElement("div");
    div.id = cardId;
    div.className = "hitl-inline-card animate-fade-in";

    div.innerHTML = `
        <!-- Agent explanation message -->
        <div class="flex items-center justify-between gap-2 mb-3 pb-2 border-b border-[#F0F0F0]">
            <div class="flex items-center gap-2">
                <div class="w-7 h-7 rounded-full bg-[#FEF3C7] text-[#D97706] flex items-center justify-center font-bold text-xs">
                    ⏳
                </div>
                <span class="text-sm font-bold text-[#111827]">AuditGate Concierge</span>
                <span class="text-xs font-mono text-[#6B7280]">(agent_01)</span>
            </div>
            <div class="flex items-center gap-2">
                ${isInjection ? `
                    <span class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-[#FEE2E2] text-[#DC2626] border border-[#FECACA]">
                        ⚠️ Security Guardrail Flagged
                    </span>
                ` : ''}
                <span class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-[#FEF3C7] text-[#D97706] border border-[#FDE68A]">
                    Human Manager Gate Paused
                </span>
            </div>
        </div>

        <p class="text-[18px] leading-[1.6] text-[#111827] mb-4">${escapeHtml(text)}</p>

        <!-- Decision Box -->
        <div class="p-5 rounded-2xl bg-[#FAFAFA] border border-[#EAEAEA]">
            <div class="text-[12px] font-bold uppercase tracking-wider text-[#6B7280]">
                Pending Refund Request
            </div>

            <div class="text-[40px] font-black text-[#111827] font-mono leading-none my-2">
                $${amount} <span class="text-base font-semibold text-[#6B7280] font-sans">USD</span>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-[#4B5563] mt-3 pt-3 border-t border-[#EAEAEA]">
                <div>
                    <span class="text-[#6B7280]">Order Reference:</span>
                    <strong class="font-mono text-[#111827] ml-1">#${escapeHtml(orderId)}</strong>
                </div>
                <div>
                    <span class="text-[#6B7280]">MongoDB Request ID:</span>
                    <strong class="font-mono text-[#D97706] ml-1">${escapeHtml(requestId)}</strong>
                </div>
                <div>
                    <span class="text-[#6B7280]">Applied Policy Limit:</span>
                    <strong class="font-mono text-[#111827] ml-1">$${cachedPolicyLimit.toFixed(2)}</strong>
                </div>
                <div>
                    <span class="text-[#6B7280]">Execution State:</span>
                    <strong class="text-[#D97706] ml-1">Paused in Atlas Checkpoint</strong>
                </div>
            </div>

            <!-- Action Buttons -->
            <div id="${cardId}-actions" class="flex items-center gap-3 mt-5">
                <button 
                    onclick="approveInlineRequest('${requestId}', '${cardId}', '${amount}', '${orderId}')" 
                    class="h-[44px] px-6 text-[15px] font-bold rounded-xl bg-[#059669] hover:bg-[#047857] text-white flex items-center gap-2 shadow-sm transition"
                >
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"></path></svg>
                    <span>Approve & Resume</span>
                </button>

                <button 
                    onclick="rejectInlineRequest('${requestId}', '${cardId}', '${amount}', '${orderId}')" 
                    class="h-[44px] px-6 text-[15px] font-bold rounded-xl bg-white border border-[#FECACA] text-[#DC2626] hover:bg-[#FEE2E2] flex items-center gap-2 transition"
                >
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    <span>Decline</span>
                </button>
            </div>
        </div>
    `;

    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

async function approveInlineRequest(requestId, cardId, amount, orderId) {
    try {
        const res = await fetch(`/api/approve/${requestId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ manager_notes: "Approved via Inline Decision Card" })
        });

        const data = await res.json();
        if (res.ok) {
            const respData = data.data || {};
            const finalResp = respData.final_response || `Refund of $${amount} for order #${orderId} has been successfully approved by manager.`;
            const audioB64 = respData.audio_base64;

            // Transition the inline card to confirmed green receipt
            const card = document.getElementById(cardId);
            if (card) {
                card.classList.remove("hitl-inline-card");
                card.classList.add("hitl-inline-card", "resolved-approved");
                
                const actionsContainer = document.getElementById(`${cardId}-actions`);
                if (actionsContainer) {
                    actionsContainer.innerHTML = `
                        <div class="w-full flex items-center justify-between p-3 rounded-xl bg-[#E6F7F0] border border-[#B7EBD5] text-[#047857]">
                            <div class="flex items-center gap-2 font-bold text-sm">
                                <svg class="w-5 h-5 text-[#059669]" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"></path></svg>
                                <span>Resolved: Manager Approved & Resumed in LangGraph</span>
                            </div>
                            <span class="font-mono text-xs text-[#059669]">Status: HUMAN_APPROVED</span>
                        </div>
                    `;
                }
            }

            // Append resumed agent response bubble
            appendAgentMessage(finalResp, "HUMAN_APPROVED", requestId, audioB64);
            showToast(`Request ${requestId} APPROVED. LangGraph execution resumed.`);
            fetchAuditLogs();

            if (voiceEnabled && audioB64) {
                playAudioFromBase64(audioB64);
            }
        } else {
            showToast("Approval error: " + (data.detail || "Failed"));
        }
    } catch (e) {
        console.error(e);
        showToast("Network error approving request.");
    }
}

async function rejectInlineRequest(requestId, cardId, amount, orderId) {
    try {
        const res = await fetch(`/api/reject/${requestId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ manager_notes: "Declined via Inline Decision Card" })
        });

        const data = await res.json();
        if (res.ok) {
            const respData = data.data || {};
            const finalResp = respData.final_response || `Refund request for order #${orderId} was declined by manager.`;
            const audioB64 = respData.audio_base64;

            // Transition the inline card to confirmed red receipt
            const card = document.getElementById(cardId);
            if (card) {
                card.classList.remove("hitl-inline-card");
                card.classList.add("hitl-inline-card", "resolved-declined");

                const actionsContainer = document.getElementById(`${cardId}-actions`);
                if (actionsContainer) {
                    actionsContainer.innerHTML = `
                        <div class="w-full flex items-center justify-between p-3 rounded-xl bg-[#FEE2E2] border border-[#FECACA] text-[#DC2626]">
                            <div class="flex items-center gap-2 font-bold text-sm">
                                <svg class="w-5 h-5 text-[#DC2626]" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"></path></svg>
                                <span>Resolved: Manager Declined & Resumed in LangGraph</span>
                            </div>
                            <span class="font-mono text-xs text-[#DC2626]">Status: HUMAN_REJECTED</span>
                        </div>
                    `;
                }
            }

            // Append resumed agent response bubble
            appendAgentMessage(finalResp, "HUMAN_REJECTED", requestId, audioB64);
            showToast(`Request ${requestId} DECLINED. LangGraph execution resumed.`);
            fetchAuditLogs();

            if (voiceEnabled && audioB64) {
                playAudioFromBase64(audioB64);
            }
        } else {
            showToast("Rejection error: " + (data.detail || "Failed"));
        }
    } catch (e) {
        console.error(e);
        showToast("Network error rejecting request.");
    }
}

function appendSystemMessage(text) {
    const container = document.getElementById("chat-messages");
    if (!container) return;
    const div = document.createElement("div");
    div.className = "flex justify-center my-2 animate-fade-in";
    div.innerHTML = `
        <div class="bg-[#F3F4F6] border border-[#EAEAEA] rounded-full px-4 py-1 text-xs text-[#6B7280] font-medium">
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
// Session Reset & Queue Clearing
// -------------------------------------------------------------

async function resetDemoSession() {
    try {
        const res = await fetch("/api/refund-requests?status=PENDING");
        const data = await res.json();
        const pending = data.requests || [];
        for (const req of pending) {
            await fetch(`/api/reject/${req.request_id}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ manager_notes: "Cleared on Session Reset" })
            });
        }
    } catch (e) {
        console.warn("Queue reset warning:", e);
    }

    currentThreadId = "thread_ORD_" + Math.random().toString(36).substring(2, 8).toUpperCase();
    updateThreadDisplay();

    const messages = document.getElementById("chat-messages");
    if (messages) {
        messages.innerHTML = `
            <div class="agent-msg-card animate-fade-in">
                <div class="flex items-center justify-between gap-2 mb-3 pb-2 border-b border-[#F0F0F0]">
                    <div class="flex items-center gap-2">
                        <div class="w-7 h-7 rounded-full bg-[#E6F7F0] text-[#059669] flex items-center justify-center font-bold text-xs">
                            AG
                        </div>
                        <span class="text-sm font-bold text-[#111827]">AuditGate Concierge</span>
                        <span class="text-xs font-mono text-[#6B7280]">(agent_01)</span>
                    </div>
                    <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-[#E6F7F0] text-[#047857] border border-[#B7EBD5]">
                        <span class="h-2 w-2 rounded-full bg-[#059669] mr-1.5 animate-pulse"></span>
                        Live Policy Engine Active
                    </span>
                </div>

                <p class="text-[18px] leading-[1.6] text-[#111827]">
                    Welcome to <strong>AuditGate</strong>. I am your autonomous customer concierge governed by real-time MongoDB Atlas policy controls.
                </p>

                <p class="text-[16px] text-[#4B5563] mt-2 leading-[1.6]">
                    Requests within the active threshold (<strong class="text-[#059669] font-mono" id="welcome-limit-ref">$${cachedPolicyLimit.toFixed(2)}</strong>) are auto-approved and recorded directly to the immutable audit log. Any requests exceeding this rule pause execution in MongoDB checkpoints for human manager approval.
                </p>

                <div class="mt-4 p-3 bg-[#FAFAFA] border border-[#EAEAEA] rounded-xl flex items-center justify-between text-xs text-[#6B7280]">
                    <div class="flex items-center gap-1.5">
                        <span>Active Thread:</span>
                        <span id="active-thread-id" class="font-mono font-bold text-[#111827]">${currentThreadId}</span>
                    </div>
                    <div class="flex items-center gap-3">
                        <span>Policy Store: <strong class="text-[#111827]">MongoDB Atlas</strong></span>
                        <span>Audit Guard: <strong class="text-[#059669]">$jsonSchema</strong></span>
                    </div>
                </div>
            </div>
        `;
    }

    showToast("Session reset. Fresh thread initialized.");
    fetchAuditLogs();
}

// -------------------------------------------------------------
// Live MongoDB Atlas Audit Logs (Slide-Over Drawer)
// -------------------------------------------------------------

async function fetchAuditLogs() {
    try {
        const res = await fetch("/api/audit-logs?limit=40");
        const data = await res.json();
        if (data.success) {
            cachedAuditLogs = data.logs || [];
            renderDrawerAuditLogs(cachedAuditLogs);
        }
    } catch (e) {
        console.error("Error fetching audit logs:", e);
    }
}

function renderDrawerAuditLogs(logs) {
    const tbody = document.getElementById("drawer-audit-tbody");
    const countPill = document.getElementById("audit-count-pill");

    if (countPill) countPill.innerText = logs.length;
    if (!tbody) return;

    if (logs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="py-8 text-center text-xs text-[#6B7280]">No audit documents in MongoDB Atlas yet.</td></tr>`;
        return;
    }

    tbody.innerHTML = logs.map((log, index) => {
        let badgeHtml = "";
        let eventName = "Refund Review";

        if (log.decision === "AUTO_APPROVED") {
            badgeHtml = `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#E6F7F0] text-[#047857]">AUTO-APPROVED</span>`;
            eventName = "Autonomous Execution";
        } else if (log.decision === "PENDING_APPROVAL") {
            badgeHtml = `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#FEF3C7] text-[#D97706]">PENDING_APPROVAL</span>`;
            eventName = "HITL Gate Paused";
        } else if (log.decision === "HUMAN_APPROVED") {
            badgeHtml = `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#EFF6FF] text-[#1D4ED8]">HUMAN_APPROVED</span>`;
            eventName = "Manager Override";
        } else if (log.decision === "HUMAN_REJECTED") {
            badgeHtml = `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#FEE2E2] text-[#DC2626]">HUMAN_REJECTED</span>`;
            eventName = "Manager Declined";
        } else if (log.decision === "BLOCKED_BY_SCHEMA") {
            badgeHtml = `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#FAF5FF] text-[#7E22CE]">BLOCKED_SCHEMA</span>`;
            eventName = "$jsonSchema Tamper Block";
        } else {
            badgeHtml = `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-100 text-gray-700">${escapeHtml(log.decision || "LOG")}</span>`;
        }

        const dateStr = log.timestamp ? new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : "Just now";
        const rawId = log._id || "";
        const shortId = rawId.length > 10 ? rawId.substring(0, 8) + "..." : rawId;

        return `
            <tr class="hover:bg-[#FAFAFA] transition text-xs">
                <td class="py-2.5 text-[#6B7280] font-mono whitespace-nowrap">${dateStr}</td>
                <td class="py-2.5">
                    <div class="font-bold text-[#111827]">${eventName}</div>
                    <div class="text-[10px] text-[#6B7280] font-mono">ID: ${escapeHtml(shortId)}</div>
                </td>
                <td class="py-2.5 text-right font-extrabold text-[#111827] font-mono whitespace-nowrap">
                    $${parseFloat(log.user_requested_amount || 0).toFixed(2)}
                </td>
                <td class="py-2.5 whitespace-nowrap">
                    ${badgeHtml}
                </td>
                <td class="py-2.5 text-right whitespace-nowrap">
                    <button onclick="openBsonInspector(${index})" class="px-2.5 py-1 text-xs font-semibold rounded-lg bg-[#FAFAFA] border border-[#EAEAEA] hover:bg-[#F3F4F6] text-[#059669] transition">
                        View BSON
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
    if (modal && code) {
        code.innerText = JSON.stringify(log, null, 2);
        modal.classList.remove("hidden");
    }
}

// -------------------------------------------------------------
// Test Schema Guard ($jsonSchema Physical Enforcement Test)
// -------------------------------------------------------------

async function runSchemaValidationTest() {
    try {
        const res = await fetch("/api/test-schema-enforcement", { method: "POST" });
        const data = await res.json();

        if (data.success && data.result) {
            const r = data.result;
            if (r.blocked) {
                showToast(`MongoDB Atlas $jsonSchema Enforced: Physical write rejected with Code ${r.error_code || 121} (DocumentValidationFailure)!`, "amber");
            } else {
                showToast("Schema test executed.");
            }
            fetchAuditLogs();
        }
    } catch (e) {
        console.error(e);
        showToast("Error running schema validation test.");
    }
}

// -------------------------------------------------------------
// Utilities & Toast System (Large 16px font)
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

function showToast(msg, type = "emerald") {
    const toast = document.getElementById("toast-notification");
    const text = document.getElementById("toast-text");
    const dot = document.getElementById("toast-indicator");

    if (toast && text) {
        text.innerText = msg;
        if (dot) {
            dot.className = type === "amber" ? "h-3 w-3 rounded-full bg-[#D97706] flex-shrink-0" : "h-3 w-3 rounded-full bg-[#059669] flex-shrink-0";
        }

        toast.classList.remove("translate-y-20", "opacity-0");
        toast.classList.add("translate-y-0", "opacity-100");

        setTimeout(() => {
            toast.classList.remove("translate-y-0", "opacity-100");
            toast.classList.add("translate-y-20", "opacity-0");
        }, 4500);
    }
}

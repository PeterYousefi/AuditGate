// AuditGate — Single-Column Centered AI Stage Controller
// Strict Flexbox Layout • Dedicated Approvals Drawer • Reliable ElevenLabs Playback

let currentThreadId = "thread_ORD_" + Math.random().toString(36).substring(2, 8).toUpperCase();
let voiceEnabled = true;
let currentAudio = null;
let cachedAuditLogs = [];
let cachedPendingRequests = [];
let cachedPolicyLimit = 50.0;
let audioCounter = 0;

// Global in-memory cache for audio base64 data URIs (avoids HTML attribute quotation / truncation errors)
window.audioCache = {};

document.addEventListener("DOMContentLoaded", () => {
    initApp();
});

function initApp() {
    setupEventListeners();
    setupPresetButtons();
    updateThreadDisplay();
    fetchLivePolicy();
    fetchPendingRequests();
    fetchAuditLogs();

    // Background sync with MongoDB Atlas every 3 seconds
    setInterval(() => {
        fetchLivePolicy();
        fetchPendingRequests();
        fetchAuditLogs();
    }, 3000);
}

// -------------------------------------------------------------
// Auto-Scroll Helper (Guarantees bottom messages are never hidden)
// -------------------------------------------------------------

function scrollToBottom(smooth = true) {
    const container = document.getElementById("chat-container");
    if (container) {
        requestAnimationFrame(() => {
            container.scrollTo({
                top: container.scrollHeight,
                behavior: smooth ? 'smooth' : 'auto'
            });
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
// Browser Audio Context Unlocking (User gesture handling)
// -------------------------------------------------------------

function unlockAudio() {
    try {
        if (!window.audioContextInstance) {
            window.audioContextInstance = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (window.audioContextInstance.state === 'suspended') {
            window.audioContextInstance.resume();
        }
    } catch (e) {
        console.warn("Audio unlock notice:", e);
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
    
    // Drawers
    const approvalsDrawerOpenBtn = document.getElementById("approvals-drawer-open-btn");
    const approvalsDrawerCloseBtn = document.getElementById("close-approvals-drawer-btn");
    const approvalsDrawer = document.getElementById("approvals-drawer");
    const refreshApprovalsBtn = document.getElementById("refresh-approvals-btn");
    const clearAllPendingBtn = document.getElementById("clear-all-pending-btn");

    const auditDrawerOpenBtn = document.getElementById("audit-drawer-open-btn");
    const auditDrawerCloseBtn = document.getElementById("close-audit-drawer-btn");
    const auditDrawer = document.getElementById("audit-drawer");
    const refreshAuditBtn = document.getElementById("refresh-audit-logs-btn");

    // BSON Modal
    const bsonModal = document.getElementById("bson-modal");
    const bsonCloseBtn = document.getElementById("close-bson-modal-btn");
    const copyBsonBtn = document.getElementById("copy-bson-btn");

    // Chat form submit
    if (chatForm && chatInput) {
        chatForm.addEventListener("submit", (e) => {
            e.preventDefault();
            unlockAudio();
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
            unlockAudio();
            voiceEnabled = !voiceEnabled;
            updateVoiceToggleButton();
            if (!voiceEnabled && currentAudio) {
                currentAudio.pause();
                stopAudioVisualizer();
            }
            showToast(voiceEnabled ? "Voice output enabled (ElevenLabs)." : "Voice output muted.");
        });
    }

    // Reset demo session
    if (resetBtn) {
        resetBtn.addEventListener("click", () => {
            unlockAudio();
            resetDemoSession();
        });
    }

    // Test Schema Guard
    if (testSchemaBtn) {
        testSchemaBtn.addEventListener("click", runSchemaValidationTest);
    }

    // Scenario chips
    document.querySelectorAll(".scenario-chip").forEach(chip => {
        chip.addEventListener("click", () => {
            unlockAudio();
            const prompt = chip.getAttribute("data-prompt");
            if (prompt) {
                sendChatMessage(prompt);
            }
        });
    });

    // Approvals Drawer Open / Close
    if (approvalsDrawerOpenBtn && approvalsDrawer) {
        approvalsDrawerOpenBtn.addEventListener("click", () => {
            approvalsDrawer.classList.remove("hidden");
            fetchPendingRequests();
        });
    }

    if (approvalsDrawerCloseBtn && approvalsDrawer) {
        approvalsDrawerCloseBtn.addEventListener("click", () => {
            approvalsDrawer.classList.add("hidden");
        });
    }

    if (approvalsDrawer) {
        approvalsDrawer.addEventListener("click", (e) => {
            if (e.target === approvalsDrawer) {
                approvalsDrawer.classList.add("hidden");
            }
        });
    }

    if (refreshApprovalsBtn) {
        refreshApprovalsBtn.addEventListener("click", () => {
            fetchPendingRequests();
            showToast("Pending approvals refreshed.");
        });
    }

    if (clearAllPendingBtn) {
        clearAllPendingBtn.addEventListener("click", clearAllPendingRequests);
    }

    // Audit Log Drawer Open / Close
    if (auditDrawerOpenBtn && auditDrawer) {
        auditDrawerOpenBtn.addEventListener("click", () => {
            auditDrawer.classList.remove("hidden");
            fetchAuditLogs();
        });
    }

    if (auditDrawerCloseBtn && auditDrawer) {
        auditDrawerCloseBtn.addEventListener("click", () => {
            auditDrawer.classList.add("hidden");
        });
    }

    if (auditDrawer) {
        auditDrawer.addEventListener("click", (e) => {
            if (e.target === auditDrawer) {
                auditDrawer.classList.add("hidden");
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
            if (approvalsDrawer && !approvalsDrawer.classList.contains("hidden")) {
                approvalsDrawer.classList.add("hidden");
            }
            if (auditDrawer && !auditDrawer.classList.contains("hidden")) {
                auditDrawer.classList.add("hidden");
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
            unlockAudio();
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
// ElevenLabs Audio Player & Sound Visualizer
// -------------------------------------------------------------

function updateVoiceToggleButton() {
    const dot = document.getElementById("voice-dot");
    const statusText = document.getElementById("voice-status-text");
    const btn = document.getElementById("voice-toggle-btn");
    if (!dot || !statusText || !btn) return;

    if (voiceEnabled) {
        dot.className = "h-2 w-2 rounded-full bg-[#059669]";
        statusText.innerText = "ON";
        btn.className = "h-[38px] px-3.5 text-[14px] font-medium rounded-full bg-[#F3F4F6] hover:bg-[#E5E7EB] border border-[#EAEAEA] text-[#111827] flex items-center gap-2 transition";
    } else {
        dot.className = "h-2 w-2 rounded-full bg-[#9CA3AF]";
        statusText.innerText = "MUTED";
        btn.className = "h-[38px] px-3.5 text-[14px] font-medium rounded-full bg-[#F3F4F6] hover:bg-[#E5E7EB] border border-[#EAEAEA] text-[#6B7280] flex items-center gap-2 transition";
    }
}

function playAudioFromBase64(base64DataUri) {
    if (!base64DataUri) return;
    
    try {
        if (currentAudio) {
            currentAudio.pause();
            currentAudio = null;
        }

        currentAudio = new Audio(base64DataUri);
        startAudioVisualizer();

        currentAudio.onended = () => {
            stopAudioVisualizer();
        };

        currentAudio.onerror = (err) => {
            stopAudioVisualizer();
            console.warn("ElevenLabs audio playback failed or interrupted:", err);
        };

        const playPromise = currentAudio.play();
        if (playPromise !== undefined) {
            playPromise.catch(e => {
                console.warn("Autoplay blocked by browser policy. User gesture required:", e);
                stopAudioVisualizer();
            });
        }
    } catch (err) {
        console.error("Audio playback error:", err);
        stopAudioVisualizer();
    }
}

// Replays audio from the global cache via a safe string ID
window.replayAudioByKey = function(audioKey) {
    unlockAudio();
    const dataUri = window.audioCache[audioKey];
    if (dataUri) {
        playAudioFromBase64(dataUri);
    } else {
        showToast("Audio not found or expired.");
    }
};

function startAudioVisualizer() {
    const vis = document.getElementById("audio-visualizer");
    const dot = document.getElementById("voice-dot");
    if (vis) vis.classList.replace("hidden", "flex");
    if (dot && voiceEnabled) {
        dot.classList.add("animate-ping");
    }
}

function stopAudioVisualizer() {
    const vis = document.getElementById("audio-visualizer");
    const dot = document.getElementById("voice-dot");
    if (vis) vis.classList.replace("flex", "hidden");
    if (dot) {
        dot.classList.remove("animate-ping");
    }
}

// Fallback voice synthesis if `/api/chat` returns null audio
async function fetchFallbackTTS(text, audioKeyToStore, callback) {
    try {
        const res = await fetch("/api/voice/tts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: text })
        });
        const data = await res.json();
        if (data.success && data.audio_base64) {
            window.audioCache[audioKeyToStore] = data.audio_base64;
            if (callback) callback(data.audio_base64);
            if (voiceEnabled) {
                playAudioFromBase64(data.audio_base64);
            }
        }
    } catch (e) {
        console.warn("Fallback TTS unavailable:", e);
    }
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
            const hasAudio = !!data.audio_base64;
            let audioKey = null;

            if (hasAudio) {
                audioKey = "audio_" + (++audioCounter);
                window.audioCache[audioKey] = data.audio_base64;
            }

            // Render Agent Message or Inline HITL Card
            appendAgentMessage(data.response, data.status, data.request_id, audioKey, message);

            // Play ElevenLabs audio automatically if voice is on
            if (voiceEnabled) {
                if (hasAudio) {
                    playAudioFromBase64(data.audio_base64);
                } else {
                    // Attempt fallback TTS if audio was not pre-generated
                    const fallbackKey = "audio_" + (++audioCounter);
                    fetchFallbackTTS(data.response, fallbackKey, (b64) => {
                        updateReplayButtonsWithKey(fallbackKey);
                    });
                }
            }

            fetchPendingRequests();
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
    scrollToBottom(true);
}

function appendAgentMessage(text, status, requestId, audioKey, userPrompt) {
    const container = document.getElementById("chat-messages");
    if (!container) return;

    // Check if this requires an Inline HITL Decision Card
    if (status === "PENDING_APPROVAL" && requestId) {
        renderInlineHitlCard(container, text, requestId, userPrompt, audioKey);
        return;
    }

    // Normal Agent Response Card (15px typography, 1.5 line-height)
    const div = document.createElement("div");
    div.className = "agent-msg-card animate-fade-in";

    let badgeHtml = "";
    if (status === "AUTO_APPROVED") {
        badgeHtml = `
            <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-[#E6F7F0] text-[#047857] border border-[#B7EBD5]">
                <svg class="w-3 h-3 mr-1 text-[#059669]" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"></path></svg>
                Refund Processed
            </span>
        `;
    } else {
        badgeHtml = `
            <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-[#F3F4F6] text-[#4B5563] border border-[#EAEAEA]">
                Support Concierge
            </span>
        `;
    }

    const audioButtonHtml = audioKey ? `
        <button onclick="window.replayAudioByKey('${audioKey}')" class="replay-audio-btn inline-flex items-center px-2.5 py-1 text-xs font-semibold rounded-lg bg-[#FAFAFA] border border-[#EAEAEA] text-[#059669] hover:bg-[#E6F7F0] transition">
            <svg class="w-3.5 h-3.5 mr-1" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd"></path></svg>
            Replay Voice Response
        </button>
    ` : `<span class="pending-audio-slot"></span>`;

    div.innerHTML = `
        <div class="flex items-center justify-between gap-2 mb-2 pb-2 border-b border-[#F0F0F0]">
            <div class="flex items-center gap-2">
                <div class="w-6 h-6 rounded-full bg-[#E6F7F0] text-[#059669] flex items-center justify-center font-bold text-[11px]">
                    AG
                </div>
                <span class="text-xs font-bold text-[#111827]">AuditGate Concierge</span>
                <span class="text-[11px] font-mono text-[#6B7280]">(agent_01)</span>
            </div>
            ${badgeHtml}
        </div>

        <p class="text-[15px] leading-[1.5] text-[#111827]">${escapeHtml(text)}</p>

        <div class="mt-3 pt-2 border-t border-[#F0F0F0] flex items-center justify-between text-xs text-[#6B7280]">
            <span class="text-[11px] text-[#9CA3AF]">Support Assistant • Verified</span>
            <div>${audioButtonHtml}</div>
        </div>
    `;

    container.appendChild(div);
    scrollToBottom(true);
}

// -------------------------------------------------------------
// INLINE HITL DECISION CARD
// Rendered right inside the chat stream when > policy limit
// -------------------------------------------------------------

function renderInlineHitlCard(container, text, requestId, userPrompt, audioKey) {
    // Extract amount and order id
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

    const audioButtonHtml = audioKey ? `
        <button onclick="window.replayAudioByKey('${audioKey}')" class="replay-audio-btn inline-flex items-center px-2.5 py-1 text-xs font-semibold rounded-lg bg-white border border-[#EAEAEA] text-[#059669] hover:bg-[#E6F7F0] transition">
            <svg class="w-3.5 h-3.5 mr-1" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd"></path></svg>
            Replay Voice Response
        </button>
    ` : '';

    div.innerHTML = `
        <!-- Customer-facing explanation message (zero internal leak) -->
        <div class="flex items-center justify-between gap-2 mb-2 pb-2 border-b border-[#F0F0F0]">
            <div class="flex items-center gap-2">
                <div class="w-6 h-6 rounded-full bg-[#E6F7F0] text-[#059669] flex items-center justify-center font-bold text-[11px]">
                    AG
                </div>
                <span class="text-xs font-bold text-[#111827]">AuditGate Concierge</span>
                <span class="text-[11px] font-mono text-[#6B7280]">(agent_01)</span>
            </div>
            <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-[#FEF3C7] text-[#D97706] border border-[#FDE68A]">
                Review in Progress
            </span>
        </div>

        <p class="text-[15px] leading-[1.5] text-[#111827] mb-3">${escapeHtml(text)}</p>

        <!-- Internal Manager Review Box (displays triggered rule for merchant/auditor) -->
        <div class="p-4 rounded-xl bg-[#FAFAFA] border border-[#EAEAEA]">
            <div class="flex items-center justify-between">
                <div class="text-[11px] font-bold uppercase tracking-wider text-[#6B7280]">
                    Manager Review Required
                </div>
                <div class="flex items-center gap-2">
                    ${audioButtonHtml}
                </div>
            </div>

            <div class="text-[32px] font-black text-[#111827] font-mono leading-none my-1.5">
                $${amount} <span class="text-sm font-semibold text-[#6B7280] font-sans">USD</span>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-[#4B5563] mt-2.5 pt-2.5 border-t border-[#EAEAEA]">
                <div>
                    <span class="text-[#6B7280]">Order Reference:</span>
                    <strong class="font-mono text-[#111827] ml-1">#${escapeHtml(orderId)}</strong>
                </div>
                <div>
                    <span class="text-[#6B7280]">MongoDB Request ID:</span>
                    <strong class="font-mono text-[#D97706] ml-1">${escapeHtml(requestId)}</strong>
                </div>
                <div>
                    <span class="text-[#6B7280]">Triggered Rule:</span>
                    <strong class="font-mono text-[#D97706] ml-1">${isInjection ? 'Prompt Injection Flagged' : `Exceeds $${cachedPolicyLimit.toFixed(2)} live policy threshold`}</strong>
                </div>
                <div>
                    <span class="text-[#6B7280]">Atlas Checkpoint:</span>
                    <strong class="text-[#059669] ml-1">Paused in MongoDB</strong>
                </div>
            </div>

            <!-- Action Buttons -->
            <div id="${cardId}-actions" class="flex items-center gap-2.5 mt-3.5">
                <button 
                    onclick="approveInlineRequest('${requestId}', '${cardId}', '${amount}', '${orderId}')" 
                    class="h-[38px] px-5 text-[14px] font-bold rounded-xl bg-[#059669] hover:bg-[#047857] text-white flex items-center gap-1.5 shadow-sm transition"
                >
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"></path></svg>
                    <span>Approve & Resume</span>
                </button>

                <button 
                    onclick="rejectInlineRequest('${requestId}', '${cardId}', '${amount}', '${orderId}')" 
                    class="h-[38px] px-5 text-[14px] font-bold rounded-xl bg-white border border-[#FECACA] text-[#DC2626] hover:bg-[#FEE2E2] flex items-center gap-1.5 transition"
                >
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    <span>Decline</span>
                </button>
            </div>
        </div>
    `;

    container.appendChild(div);
    scrollToBottom(true);
}

async function approveInlineRequest(requestId, cardId, amount, orderId) {
    unlockAudio();
    try {
        const res = await fetch(`/api/approve/${requestId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ manager_notes: "Approved via Inline Decision Card" })
        });

        const data = await res.json();
        if (res.ok) {
            const respData = data.data || {};
            const finalResp = respData.final_response || `Good news! Your $${amount} refund has been approved and processed.`;
            const audioB64 = respData.audio_base64;

            let audioKey = null;
            if (audioB64) {
                audioKey = "audio_" + (++audioCounter);
                window.audioCache[audioKey] = audioB64;
            }

            // Transition the inline card to confirmed green receipt
            const card = document.getElementById(cardId);
            if (card) {
                card.classList.remove("hitl-inline-card");
                card.classList.add("hitl-inline-card", "resolved-approved");
                
                const actionsContainer = document.getElementById(`${cardId}-actions`);
                if (actionsContainer) {
                    actionsContainer.innerHTML = `
                        <div class="w-full flex items-center justify-between p-2.5 rounded-xl bg-[#E6F7F0] border border-[#B7EBD5] text-[#047857]">
                            <div class="flex items-center gap-2 font-bold text-xs">
                                <svg class="w-4 h-4 text-[#059669]" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"></path></svg>
                                <span>Resolved: Manager Approved & Resumed in LangGraph</span>
                            </div>
                            <span class="font-mono text-[11px] text-[#059669]">HUMAN_APPROVED</span>
                        </div>
                    `;
                }
            }

            // Append resumed agent response bubble
            appendAgentMessage(finalResp, "HUMAN_APPROVED", requestId, audioKey);
            showToast(`Request ${requestId} APPROVED. LangGraph execution resumed.`);
            fetchPendingRequests();
            fetchAuditLogs();

            if (voiceEnabled && audioB64) {
                playAudioFromBase64(audioB64);
            }
            scrollToBottom(true);
        } else {
            showToast("Approval error: " + (data.detail || "Failed"));
        }
    } catch (e) {
        console.error(e);
        showToast("Network error approving request.");
    }
}

async function rejectInlineRequest(requestId, cardId, amount, orderId) {
    unlockAudio();
    try {
        const res = await fetch(`/api/reject/${requestId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ manager_notes: "Declined via Inline Decision Card" })
        });

        const data = await res.json();
        if (res.ok) {
            const respData = data.data || {};
            const finalResp = respData.final_response || "Thank you for waiting. After review, your refund request was declined.";
            const audioB64 = respData.audio_base64;

            let audioKey = null;
            if (audioB64) {
                audioKey = "audio_" + (++audioCounter);
                window.audioCache[audioKey] = audioB64;
            }

            // Transition the inline card to confirmed red receipt
            const card = document.getElementById(cardId);
            if (card) {
                card.classList.remove("hitl-inline-card");
                card.classList.add("hitl-inline-card", "resolved-declined");

                const actionsContainer = document.getElementById(`${cardId}-actions`);
                if (actionsContainer) {
                    actionsContainer.innerHTML = `
                        <div class="w-full flex items-center justify-between p-2.5 rounded-xl bg-[#FEE2E2] border border-[#FECACA] text-[#DC2626]">
                            <div class="flex items-center gap-2 font-bold text-xs">
                                <svg class="w-4 h-4 text-[#DC2626]" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"></path></svg>
                                <span>Resolved: Manager Declined & Resumed in LangGraph</span>
                            </div>
                            <span class="font-mono text-[11px] text-[#DC2626]">HUMAN_REJECTED</span>
                        </div>
                    `;
                }
            }

            // Append resumed agent response bubble
            appendAgentMessage(finalResp, "HUMAN_REJECTED", requestId, audioKey);
            showToast(`Request ${requestId} DECLINED. LangGraph execution resumed.`);
            fetchPendingRequests();
            fetchAuditLogs();

            if (voiceEnabled && audioB64) {
                playAudioFromBase64(audioB64);
            }
            scrollToBottom(true);
        } else {
            showToast("Rejection error: " + (data.detail || "Failed"));
        }
    } catch (e) {
        console.error(e);
        showToast("Network error rejecting request.");
    }
}

function updateReplayButtonsWithKey(audioKey) {
    document.querySelectorAll(".pending-audio-slot").forEach(slot => {
        slot.outerHTML = `
            <button onclick="window.replayAudioByKey('${audioKey}')" class="replay-audio-btn inline-flex items-center px-2.5 py-1 text-xs font-semibold rounded-lg bg-[#FAFAFA] border border-[#EAEAEA] text-[#059669] hover:bg-[#E6F7F0] transition">
                <svg class="w-3.5 h-3.5 mr-1" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd"></path></svg>
                Replay Voice Response
            </button>
        `;
    });
}

function appendSystemMessage(text) {
    const container = document.getElementById("chat-messages");
    if (!container) return;
    const div = document.createElement("div");
    div.className = "flex justify-center my-2 animate-fade-in";
    div.innerHTML = `
        <div class="bg-[#F3F4F6] border border-[#EAEAEA] rounded-full px-3.5 py-1 text-xs text-[#6B7280] font-medium">
            ${escapeHtml(text)}
        </div>
    `;
    container.appendChild(div);
    scrollToBottom(true);
}

function showChatLoading(show) {
    const loader = document.getElementById("chat-loader");
    if (loader) {
        loader.style.display = show ? "flex" : "none";
        if (show) {
            scrollToBottom(true);
        }
    }
}

// -------------------------------------------------------------
// Dedicated Approvals Drawer (refund_requests)
// -------------------------------------------------------------

async function fetchPendingRequests() {
    try {
        const res = await fetch("/api/refund-requests?status=PENDING");
        const data = await res.json();
        if (data.success) {
            cachedPendingRequests = data.requests || [];
            renderPendingApprovals(cachedPendingRequests);
        }
    } catch (e) {
        console.error("Error fetching pending requests:", e);
    }
}

function renderPendingApprovals(rawRequests) {
    const countPill = document.getElementById("pending-count-pill");
    const listContainer = document.getElementById("approvals-drawer-list");

    // Deduplicate by request_id
    const seen = new Set();
    const requests = [];
    for (const r of rawRequests) {
        if (!seen.has(r.request_id)) {
            seen.add(r.request_id);
            requests.push(r);
        }
    }

    if (countPill) countPill.innerText = requests.length;
    if (!listContainer) return;

    if (requests.length === 0) {
        listContainer.innerHTML = `
            <div class="py-12 text-center">
                <div class="w-10 h-10 mx-auto mb-2 rounded-full bg-[#E6F7F0] text-[#059669] flex items-center justify-center">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"></path></svg>
                </div>
                <h3 class="text-sm font-bold text-[#111827]">Governance Queue Clear</h3>
                <p class="text-xs text-[#6B7280] mt-1 max-w-xs mx-auto">No pending requests require human intervention at this time.</p>
            </div>
        `;
        return;
    }

    listContainer.innerHTML = requests.map(req => {
        const isInjection = /override|ignore|jailbreak|bypass|hack/i.test(req.reason || "");
        const dateStr = req.created_at ? new Date(req.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "Just now";

        return `
            <div class="p-4 rounded-xl border border-[#EAEAEA] bg-white shadow-2xs hover:border-[#D1D5DB] transition">
                <div class="flex items-center justify-between mb-2">
                    <div class="flex items-center gap-2">
                        <span class="font-mono text-xs font-bold text-[#D97706] bg-[#FFFBEB] px-2 py-0.5 rounded border border-[#FDE68A]">
                            ${escapeHtml(req.request_id)}
                        </span>
                        ${req.order_id ? `
                            <span class="font-mono text-xs font-semibold text-[#111827] bg-[#F3F4F6] px-1.5 py-0.5 rounded">
                                #${escapeHtml(req.order_id)}
                            </span>
                        ` : ''}
                        ${isInjection ? `
                            <span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#FEE2E2] text-[#DC2626]">
                                ⚠️ Guardrail Flagged
                            </span>
                        ` : ''}
                    </div>
                    <span class="text-base font-extrabold text-[#111827] font-mono">$${parseFloat(req.amount || 0).toFixed(2)}</span>
                </div>

                <p class="text-xs text-[#4B5563] mb-3 line-clamp-2" title="${escapeHtml(req.reason)}">
                    ${escapeHtml(req.reason || "Customer refund request")}
                </p>

                <div class="flex items-center justify-between pt-2 border-t border-[#F0F0F0] text-[11px] text-[#6B7280]">
                    <span>${dateStr} • Limit: $${parseFloat(req.policy_limit_applied || 50).toFixed(2)}</span>
                    <div class="flex items-center gap-2">
                        <button onclick="approveFromDrawer('${req.request_id}')" class="px-3 py-1 text-xs font-bold rounded-lg bg-[#059669] hover:bg-[#047857] text-white transition">
                            Approve
                        </button>
                        <button onclick="rejectFromDrawer('${req.request_id}')" class="px-2.5 py-1 text-xs font-bold rounded-lg bg-white border border-[#FECACA] text-[#DC2626] hover:bg-[#FEE2E2] transition">
                            Decline
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join("");
}

async function approveFromDrawer(requestId) {
    unlockAudio();
    try {
        const res = await fetch(`/api/approve/${requestId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ manager_notes: "Approved via Governance Approvals Drawer" })
        });
        const data = await res.json();
        if (res.ok) {
            const respData = data.data || {};
            const finalResp = respData.final_response || "Good news! Your refund has been approved and processed.";
            const audioB64 = respData.audio_base64;

            let audioKey = null;
            if (audioB64) {
                audioKey = "audio_" + (++audioCounter);
                window.audioCache[audioKey] = audioB64;
            }

            appendAgentMessage(finalResp, "HUMAN_APPROVED", requestId, audioKey);
            showToast(`Request ${requestId} APPROVED. LangGraph resumed.`);
            fetchPendingRequests();
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

async function rejectFromDrawer(requestId) {
    unlockAudio();
    try {
        const res = await fetch(`/api/reject/${requestId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ manager_notes: "Declined via Governance Approvals Drawer" })
        });
        const data = await res.json();
        if (res.ok) {
            const respData = data.data || {};
            const finalResp = respData.final_response || "Thank you for waiting. After review, your refund request was declined.";
            const audioB64 = respData.audio_base64;

            let audioKey = null;
            if (audioB64) {
                audioKey = "audio_" + (++audioCounter);
                window.audioCache[audioKey] = audioB64;
            }

            appendAgentMessage(finalResp, "HUMAN_REJECTED", requestId, audioKey);
            showToast(`Request ${requestId} DECLINED. LangGraph resumed.`);
            fetchPendingRequests();
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

async function clearAllPendingRequests() {
    try {
        const res = await fetch("/api/refund-requests?status=PENDING");
        const data = await res.json();
        const pending = data.requests || [];
        if (pending.length === 0) {
            showToast("No pending requests to clear.");
            return;
        }

        for (const req of pending) {
            await fetch(`/api/reject/${req.request_id}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ manager_notes: "Dismissed via Drawer Queue Clear" })
            });
        }

        showToast(`Cleared ${pending.length} pending request(s).`);
        fetchPendingRequests();
        fetchAuditLogs();
    } catch (e) {
        console.error("Error clearing pending queue:", e);
    }
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
            badgeHtml = `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#E6F7F0] text-[#047857]">AUTO_APPROVED</span>`;
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
        messages.innerHTML = "";
    }

    showToast("Session reset. Fresh thread initialized.");
    fetchPendingRequests();
    fetchAuditLogs();
}

// -------------------------------------------------------------
// Utilities & Toast System
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
        }, 4000);
    }
}

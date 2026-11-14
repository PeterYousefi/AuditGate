// AuditGate Frontend Application Logic

let currentThreadId = "thread_" + Math.random().toString(36).substring(2, 9);
let voiceEnabled = true;
let currentAudio = null;

// Initialize on page load
document.addEventListener("DOMContentLoaded", () => {
    initApp();
});

function initApp() {
    setupEventListeners();
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

function setupEventListeners() {
    const chatForm = document.getElementById("chat-form");
    const chatInput = document.getElementById("chat-input");
    const voiceToggle = document.getElementById("voice-toggle-btn");
    const schemaTestBtn = document.getElementById("schema-test-btn");
    const updatePolicyBtn = document.getElementById("update-policy-btn");
    const newThreadBtn = document.getElementById("new-thread-btn");

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
        newThreadBtn.addEventListener("click", () => {
            currentThreadId = "thread_" + Math.random().toString(36).substring(2, 9);
            document.getElementById("active-thread-id").innerText = currentThreadId;
            const messagesContainer = document.getElementById("chat-messages");
            messagesContainer.innerHTML = "";
            appendSystemMessage("Started new conversation session: " + currentThreadId);
        });
    }

    // Preset buttons
    document.querySelectorAll(".preset-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const promptText = btn.getAttribute("data-prompt");
            if (promptText) {
                sendChatMessage(promptText);
            }
        });
    });
}

function updateVoiceToggleButton() {
    const btn = document.getElementById("voice-toggle-btn");
    if (voiceEnabled) {
        btn.innerHTML = `<span class="h-2 w-2 rounded-full bg-emerald-400 mr-2"></span> Voice: ON`;
        btn.className = "px-3 py-1 text-xs font-semibold rounded-full bg-emerald-950/80 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-900/80 flex items-center transition";
    } else {
        btn.innerHTML = `<span class="h-2 w-2 rounded-full bg-gray-500 mr-2"></span> Voice: MUTED`;
        btn.className = "px-3 py-1 text-xs font-semibold rounded-full bg-gray-800 border border-gray-700 text-gray-400 hover:bg-gray-700 flex items-center transition";
    }
}

// -------------------------------------------------------------
// Customer Chat & Voice
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
            
            // Auto play voice if enabled and returned
            if (voiceEnabled && data.audio_base64) {
                playAudioFromBase64(data.audio_base64);
            }

            // Immediately refresh governance consoles
            fetchPendingRequests();
            fetchAuditLogs();
        } else {
            appendSystemMessage("Error: " + (data.detail || "Failed to process request"));
        }
    } catch (err) {
        showChatLoading(false);
        appendSystemMessage("Network error communicating with agent.");
        console.error(err);
    }
}

function appendUserMessage(text) {
    const container = document.getElementById("chat-messages");
    const div = document.createElement("div");
    div.className = "flex justify-end mb-4 animate-fade-in";
    div.innerHTML = `
        <div class="max-w-[80%] rounded-2xl rounded-tr-sm bg-blue-600 px-4 py-3 text-sm text-white shadow-md">
            <p class="leading-relaxed">${escapeHtml(text)}</p>
            <span class="block text-[10px] text-blue-200 mt-1 text-right">Customer</span>
        </div>
    `;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function appendAgentMessage(text, status, requestId, audioB64) {
    const container = document.getElementById("chat-messages");
    const div = document.createElement("div");
    div.className = "flex justify-start mb-4 animate-fade-in";

    let badgeClass = "bg-gray-800 text-gray-300 border-gray-700";
    let badgeText = status || "COMPLETED";

    if (status === "AUTO_APPROVED") {
        badgeClass = "bg-emerald-950/80 text-emerald-400 border-emerald-700/50";
        badgeText = "✓ Auto-Approved ($" + text.match(/\$[0-9]+(\.[0-9]+)?/)?.[0] + ")";
    } else if (status === "PENDING_APPROVAL") {
        badgeClass = "bg-amber-950/80 text-amber-400 border-amber-700/50";
        badgeText = "⏸ Paused (HITL Manager Gate)";
    } else if (status === "HUMAN_APPROVED") {
        badgeClass = "bg-blue-950/80 text-blue-400 border-blue-700/50";
        badgeText = "✓ Human Approved";
    } else if (status === "HUMAN_REJECTED") {
        badgeClass = "bg-rose-950/80 text-rose-400 border-rose-700/50";
        badgeText = "✕ Human Declined";
    }

    const audioButtonHtml = audioB64 ? `
        <button onclick="playAudioFromBase64('${audioB64}')" class="mt-2 text-[11px] inline-flex items-center text-emerald-400 hover:text-emerald-300 transition">
            <svg class="w-3.5 h-3.5 mr-1" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd"></path></svg>
            Replay ElevenLabs Voice
        </button>
    ` : '';

    div.innerHTML = `
        <div class="max-w-[85%] rounded-2xl rounded-tl-sm bg-gray-900 border border-gray-800 px-4 py-3 text-sm text-gray-200 shadow-md">
            <div class="flex items-center justify-between mb-1.5 gap-2">
                <span class="text-[11px] font-semibold text-emerald-400 flex items-center">
                    <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5"></span>
                    AuditGate Agent (agent_01)
                </span>
                <span class="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full border ${badgeClass}">
                    ${badgeText}
                </span>
            </div>
            <p class="leading-relaxed text-gray-300">${escapeHtml(text)}</p>
            ${requestId ? `<div class="mt-2 text-[11px] text-gray-400 font-mono">Request ID: <span class="text-amber-400">${requestId}</span></div>` : ''}
            ${audioButtonHtml}
        </div>
    `;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function appendSystemMessage(text) {
    const container = document.getElementById("chat-messages");
    const div = document.createElement("div");
    div.className = "flex justify-center my-2";
    div.innerHTML = `
        <div class="bg-gray-800/80 border border-gray-700/60 rounded-full px-3 py-1 text-[11px] text-gray-400">
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
// ElevenLabs Audio Player
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
        console.warn("ElevenLabs audio playback failed or interrupted.");
    };

    currentAudio.play().catch(e => {
        console.warn("Autoplay blocked by browser. User interaction needed:", e);
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
// Live Policy Engine (MongoDB policies)
// -------------------------------------------------------------

async function fetchLivePolicy() {
    try {
        const res = await fetch("/api/policies");
        const data = await res.json();
        if (data.success && data.policy) {
            const limit = data.policy.max_auto_refund;
            document.getElementById("live-policy-limit").innerText = `$${limit.toFixed(2)}`;
            const input = document.getElementById("policy-limit-input");
            if (document.activeElement !== input) {
                input.value = limit;
            }
            document.getElementById("policy-agent-role").innerText = data.policy.role || "support_agent";
            document.getElementById("policy-currency").innerText = data.policy.currency || "USD";
        }
    } catch (e) {
        console.error("Error fetching live policy:", e);
    }
}

async function updatePolicyFromInput() {
    const input = document.getElementById("policy-limit-input");
    const val = parseFloat(input.value);
    if (isNaN(val) || val < 0) {
        alert("Please enter a valid positive number for max_auto_refund.");
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
            showToast(`Policy updated in MongoDB Atlas: $${val.toFixed(2)}`);
        } else {
            alert("Error updating policy: " + data.detail);
        }
    } catch (e) {
        console.error(e);
        alert("Network error updating policy");
    }
}

// -------------------------------------------------------------
// Human-in-the-Loop Gate (MongoDB refund_requests)
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
    countBadge.innerText = requests.length;

    if (requests.length === 0) {
        container.innerHTML = `
            <div class="py-8 text-center text-gray-500 text-xs">
                <svg class="w-8 h-8 mx-auto mb-2 opacity-40 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                No pending requests. All transactions within autonomous threshold.
            </div>
        `;
        return;
    }

    container.innerHTML = requests.map(req => `
        <div class="bg-gray-800/90 border border-amber-500/40 rounded-xl p-3.5 mb-3 shadow-lg transition hover:border-amber-500/70">
            <div class="flex items-center justify-between mb-2">
                <span class="font-mono text-xs font-bold text-amber-400">${escapeHtml(req.request_id)}</span>
                <span class="text-sm font-extrabold text-white bg-amber-950/60 border border-amber-600/40 px-2 py-0.5 rounded">
                    $${parseFloat(req.amount).toFixed(2)} USD
                </span>
            </div>
            <p class="text-xs text-gray-300 mb-2 leading-relaxed">
                <span class="text-gray-400 font-semibold">Reason:</span> ${escapeHtml(req.reason)}
            </p>
            <div class="flex items-center justify-between text-[11px] text-gray-400 mb-3 font-mono">
                <span>Thread: ${escapeHtml(req.thread_id.substring(0, 14))}...</span>
                <span>Limit Applied: $${parseFloat(req.policy_limit_applied || 50).toFixed(2)}</span>
            </div>
            <div class="flex gap-2">
                <button onclick="approveRequest('${req.request_id}')" class="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs py-1.5 rounded-lg shadow transition flex items-center justify-center">
                    <svg class="w-3.5 h-3.5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
                    Approve (Resume)
                </button>
                <button onclick="rejectRequest('${req.request_id}')" class="flex-1 bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs py-1.5 rounded-lg shadow transition flex items-center justify-center">
                    <svg class="w-3.5 h-3.5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    Reject
                </button>
            </div>
        </div>
    `).join("");
}

async function approveRequest(requestId) {
    try {
        const res = await fetch(`/api/approve/${requestId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ manager_notes: "Approved via Governance Console" })
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
            body: JSON.stringify({ manager_notes: "Declined via Governance Console" })
        });
        const data = await res.json();
        if (res.ok) {
            showToast(`Request ${requestId} REJECTED. LangGraph resumed.`);
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
// Tamper-Proof Audit Trail (MongoDB audit_logs & $jsonSchema)
// -------------------------------------------------------------

async function fetchAuditLogs() {
    try {
        const res = await fetch("/api/audit-logs?limit=40");
        const data = await res.json();
        if (data.success) {
            renderAuditLogs(data.logs || []);
        }
    } catch (e) {
        console.error("Error fetching audit logs:", e);
    }
}

function renderAuditLogs(logs) {
    const tbody = document.getElementById("audit-logs-tbody");
    if (!tbody) return;

    if (logs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="py-6 text-center text-gray-500 text-xs">No audit logs recorded yet.</td></tr>`;
        return;
    }

    tbody.innerHTML = logs.map(log => {
        let badge = "bg-gray-800 text-gray-400 border-gray-700";
        if (log.decision === "AUTO_APPROVED") {
            badge = "bg-emerald-950/80 text-emerald-400 border-emerald-600/40";
        } else if (log.decision === "PENDING_APPROVAL") {
            badge = "bg-amber-950/80 text-amber-400 border-amber-600/40";
        } else if (log.decision === "HUMAN_APPROVED") {
            badge = "bg-blue-950/80 text-blue-400 border-blue-600/40";
        } else if (log.decision === "HUMAN_REJECTED") {
            badge = "bg-rose-950/80 text-rose-400 border-rose-600/40";
        } else if (log.decision === "BLOCKED_BY_SCHEMA") {
            badge = "bg-purple-950/90 text-purple-300 border-purple-500/50 font-extrabold";
        }

        const dateStr = log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : "";

        return `
            <tr class="border-b border-gray-800/60 hover:bg-gray-800/30 transition text-xs">
                <td class="py-2.5 px-3 text-gray-400 font-mono whitespace-nowrap">${dateStr}</td>
                <td class="py-2.5 px-3">
                    <span class="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase ${badge}">
                        ${escapeHtml(log.decision)}
                    </span>
                </td>
                <td class="py-2.5 px-3 font-semibold text-gray-200">
                    $${parseFloat(log.user_requested_amount || 0).toFixed(2)}
                </td>
                <td class="py-2.5 px-3 text-gray-400">
                    $${parseFloat(log.policy_limit_applied || 0).toFixed(2)}
                </td>
                <td class="py-2.5 px-3 text-gray-300 max-w-xs truncate" title="${escapeHtml(log.reason || '')}">
                    ${escapeHtml(log.reason || '')}
                </td>
            </tr>
        `;
    }).join("");
}

// -------------------------------------------------------------
// Live Schema Enforcement Demonstration for Judges
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
                showToast("MongoDB Atlas physically rejected the invalid insert!");
            } else {
                pre.innerText = JSON.stringify(r, null, 2);
            }
            fetchAuditLogs();
        }
    } catch (e) {
        console.error(e);
        alert("Failed to execute schema test");
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

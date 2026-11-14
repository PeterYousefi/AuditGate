# 🛡️ AuditGate — Agents You Can Audit

> **Hackathon MVP for the "Agents You Can Audit" Track**  
> An autonomous AI customer support agent governed in real-time by **MongoDB Atlas** as the strict identity, policy, state, and tamper-proof audit layer, powered by **FastAPI**, **LangGraph**, and **ElevenLabs**.

[![Python 3.11+](https://img.shields.io/badge/python-3.11+-blue.svg)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688.svg)](https://fastapi.tiangolo.com)
[![MongoDB Atlas](https://img.shields.io/badge/MongoDB-Atlas%20$jsonSchema-47A248.svg)](https://www.mongodb.com/atlas)
[![LangGraph](https://img.shields.io/badge/LangGraph-Checkpoint%20HITL-FF6F00.svg)](https://langchain-ai.github.io/langgraph/)
[![ElevenLabs](https://img.shields.io/badge/ElevenLabs-Flash%20Voice%20TTS-black.svg)](https://elevenlabs.io/)

---

## 🏛️ Core Architecture & MongoDB Atlas Layer

AuditGate treats **MongoDB Atlas** not merely as a database, but as the **authoritative governance kernel** controlling what the autonomous AI agent can and cannot do:

```text
                               +-----------------------------+
                               |     Customer Web Chat       |
                               | (Presets / Custom / Voice)  |
                               +--------------+--------------+
                                              |
                                              v
                               +-----------------------------+
                               |       FastAPI Backend       |
                               +--------------+--------------+
                                              |
                                              v
                               +-----------------------------+
                               |   LangGraph Agent State     |
                               +--------------+--------------+
                                              |
                     +------------------------+------------------------+
                     | (1. Query Live Policy)                           | (2. Persist Checkpoint)
                     v                                                  v
         +-----------------------+                         +-------------------------+
         |  MongoDB 'policies'   |                         | MongoDB Atlas Saver     |
         |  Collection (Live)    |                         | (checkpoints collection)|
         +-----------+-----------+                         +-------------------------+
                     |
        +------------+------------+
        |                         |
[Amount <= Limit]          [Amount > Limit]
        |                         |
        v                         v
+------------------+     +-------------------------------+
| Immediate Refund |     | LangGraph interrupt() Paused  |
| Tool Execution   |     | Insert into 'refund_requests' |
+--------+---------+     +---------------+---------------+
         |                               |
         |                               v
         |               +-------------------------------+
         |               | MongoDB Change Stream Listener|
         |               | (Watches for APPROVED/REJECT) |
         |               +---------------+---------------+
         |                               | (Resume Thread)
         +---------------+---------------+
                         |
                         v
         +-------------------------------+
         |   MongoDB Engine $jsonSchema  |
         |  Rejection on Tampering (121) |
         +---------------+---------------+
                         |
                         v
         +-------------------------------+
         | ElevenLabs Real-Time Voice TTS|
         +-------------------------------+
```

---

## 🌟 Key Capabilities

### 1. Identity & Policy Layer (`policies` Collection)
- **Zero Hardcoding:** The agent NEVER has hardcoded financial thresholds in Python.
- **Live Querying:** Before executing any refund tool, the agent performs a live query against `policies`:
  ```json
  {"role": "support_agent", "agent_id": "agent_01", "max_auto_refund": 50.0, "currency": "USD"}
  ```
- **Instant Live Obedience:** Edit `max_auto_refund` directly inside MongoDB Atlas or from the UI during a demo, and the agent immediately respects the new threshold on the next message without restarting the server.

### 2. Human-in-the-Loop Gate (`refund_requests` + Change Streams)
- **Automatic Execution (<= Policy Limit):** Requests for $20 are instantly approved and logged as `AUTO_APPROVED`.
- **LangGraph Checkpointed Pause (> Policy Limit):** Requests for $250 trigger a LangGraph `interrupt()`, checkpointing the paused execution thread into MongoDB Atlas via `langgraph-checkpoint-mongodb` and creating a `PENDING` document in `refund_requests`.
- **Change Stream Interception:** A background daemon thread watches MongoDB Atlas Change Streams. When a document's status transitions to `APPROVED` or `REJECTED` (via the UI buttons or direct MongoDB Atlas document edits), the paused thread resumes immediately.

### 3. Tamper-Proof Audit Trail (`audit_logs` + `$jsonSchema`)
- **Engine-Level Non-Repudiation:** MongoDB Atlas enforces strict programmatic `$jsonSchema` validation on startup. The database engine physically rejects any write missing:
  - `timestamp`
  - `thread_id`
  - `agent_id`
  - `user_requested_amount`
  - `policy_limit_applied`
  - `decision` (`AUTO_APPROVED`, `PENDING_APPROVAL`, `HUMAN_APPROVED`, `HUMAN_REJECTED`, or `BLOCKED_BY_SCHEMA`)
  - `reason`
- **Live "Test Schema Enforcement" Demo:** Click the button in the UI to trigger an unauthorized, malformed write. MongoDB Atlas physically throws `Document failed validation (Code 121)`, proving to judges that rogue agents or bad actors cannot bypass the audit trail.

### 4. ElevenLabs Voice Output
- Every final agent verdict (approval, HITL escalation, or manager decision) is synthesized into natural speech via ElevenLabs (`eleven_flash_v2_5`) and played automatically in the browser with an animated sound visualizer.
- Automatic graceful fallback to text-only if voice limits or network issues occur.

---

## 🚀 Quickstart Guide

### 1. Clone & Setup Environment
```bash
git clone https://github.com/PeterYousefi/AuditGate.git
cd AuditGate

# Create virtual environment
python3.11 -m venv venv
source venv/bin/activate

# Install frozen dependencies
pip install -r requirements.txt
```

### 2. Configure Credentials (`.env`)
Ensure `.env` exists in the workspace root:
```env
MONGODB_URI="mongodb+srv://<username>:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority"
GEMINI_API_KEY="your-gemini-api-key"
ELEVENLABS_API_KEY="your-elevenlabs-api-key"
ELEVENLABS_VOICE_ID="21m00Tcm4TlvDq8ikWAM"
MONGODB_DB_NAME="auditable_agent"
```

### 3. Run Automated Tests
AuditGate includes a comprehensive test suite covering MongoDB connectivity, schema validation, and LangGraph HITL workflows:
```bash
PYTHONPATH=. pytest -v tests/
```

### 4. Start the Application
```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```
Open your browser at **[http://localhost:8000](http://localhost:8000)**.

---

## 🎬 3-Minute Live Demo Walkthrough for Judges

1. **Test 1: Auto-Approved Autonomous Transaction (<= $50)**
   - Click the preset button: **"Ask for $20 Refund"**.
   - Notice the agent executes immediately, logs `AUTO_APPROVED` in the right-hand audit table, and speaks the confirmation via ElevenLabs.
2. **Test 2: Human-in-the-Loop Escalation Gate (> $50)**
   - Click the preset button: **"Ask for $250 Refund"**.
   - Notice the agent informs the customer that $250 exceeds the live limit ($50).
   - LangGraph halts at an engine interrupt, saves its checkpoint in Atlas, and a pending card appears in the **Human-in-the-Loop Governance Gate**.
   - Click **Approve (Resume)**. Watch the LangGraph thread resume from MongoDB Atlas, settle the refund, log `HUMAN_APPROVED`, and play the approval voice.
3. **Test 3: Prompt Injection Adversarial Defense**
   - Click the preset button: **"Prompt Injection ($500 Override)"**.
   - Watch the agent maintain deterministic guardrails: even under jailbreak prompts, the MongoDB policy layer enforces the $50 limit and routes the request to human review.
4. **Test 4: Physical `$jsonSchema` Tamper-Proofing Demonstration**
   - Click **"Test Schema Enforcement"** in the console.
   - The UI reveals the raw MongoDB Atlas engine error: `Document failed validation (Code 121)` missing required fields `['decision', 'policy_limit_applied', 'timestamp']`. This proves rogue agents cannot insert unauthenticated or spoofed records!
5. **Test 5: Dynamic Policy Update**
   - In the Live Policy Override input, change the limit from `$50` to `$100` and click **Update Atlas** (or edit directly in MongoDB Atlas).
   - Now ask for a **$75 Refund**. It will immediately be auto-approved without restarting the server!

---

## 📂 Project Structure

```text
AuditGate/
├── app/
│   ├── config.py                 # Pydantic Settings & environment config
│   ├── database/
│   │   ├── mongodb.py            # Singleton MongoDB Atlas connection pool
│   │   ├── schema_validator.py   # Strict $jsonSchema validator for audit_logs
│   │   ├── policy_service.py     # Live dynamic policy queries (no caching)
│   │   └── audit_service.py      # Tamper-proof audit logging & schema tests
│   ├── agent/
│   │   ├── state.py              # LangGraph AgentState
│   │   ├── tools.py              # Governed tools querying live Atlas policies
│   │   ├── graph.py              # LangGraph StateGraph with HITL interrupts
│   │   └── hitl_manager.py       # Change Stream listener & thread resume manager
│   ├── voice/
│   │   └── elevenlabs_client.py  # ElevenLabs TTS integration with fallback
│   ├── api/
│   │   ├── routes_chat.py        # /api/chat endpoint
│   │   ├── routes_governance.py  # /api/policies, /api/refund-requests, /approve, /reject
│   │   ├── routes_audit.py       # /api/audit-logs, /api/test-schema-enforcement
│   │   └── routes_voice.py       # /api/voice/tts
│   ├── static/
│   │   ├── css/styles.css        # Dark-mode styling & sound wave animations
│   │   ├── js/app.js             # Client SPA logic, voice playback, Atlas sync
│   │   └── index.html            # Dark-mode split-screen dashboard
│   └── main.py                   # FastAPI lifespan, startup seeding, & static mounting
├── tests/
│   ├── test_mongodb_connection.py# Atlas connectivity & collections test
│   ├── test_schema_enforcement.py# $jsonSchema Code 121 rejection test
│   ├── test_policy_governance.py # Live policy obedience & LangGraph HITL test
│   └── test_api_endpoints.py     # FastAPI TestClient endpoints test
├── requirements.txt              # Frozen Python dependencies
├── .env.example                  # Template environment variables
├── .gitignore                    # Protects .env, venv, and cache
└── README.md                     # Documentation & Judge Walkthrough
```

---

## ⚖️ Hackathon Compliance
- **No Streamlit:** Strictly built with Python FastAPI + vanilla HTML/Tailwind/JS.
- **Agents You Can Audit Track:** Comprehensive implementation of identity, policy, state, and audit using MongoDB Atlas.

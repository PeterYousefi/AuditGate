# 🏆 Hackathon Judge Evaluation Guide

## Track: "Agents You Can Audit"

This guide details how AuditGate satisfies and exceeds every evaluation criterion:

| Requirement | Implementation in AuditGate | How to Verify |
| :--- | :--- | :--- |
| **Identity & Policy Layer** | MongoDB `policies` collection stores role, agent ID, and financial limits. Agent queries MongoDB live before tool execution with zero hardcoded numbers. | Edit `max_auto_refund` in Atlas Compass or Cloud UI during demo. On next prompt, agent instantly obeys new limit. |
| **Human-in-the-Loop Gate** | LangGraph pauses on amounts exceeding limit via `interrupt()`, checkpointing execution state into MongoDB Atlas `checkpoints`. | Send a $250 refund request. Watch request appear in pending list. Click Approve to resume LangGraph thread from Atlas. |
| **Change Streams** | MongoDB Change Stream background daemon watches `refund_requests`. | Update document status from `PENDING` to `APPROVED` directly in MongoDB Atlas. Watch LangGraph thread resume automatically! |
| **Tamper-Proof Audit Trail** | MongoDB Atlas engine physically enforces `$jsonSchema` with `validationLevel: strict`. | Click **"Test Schema Enforcement"** in UI. See raw `Code 121` rejection response from MongoDB Atlas. |
| **ElevenLabs Voice** | Every verdict synthesized into audio via ElevenLabs `eleven_flash_v2_5` and played automatically. | Listen to voice responses during demo or use Replay Voice buttons. |
| **No Streamlit** | 100% compliant: built using Python FastAPI + clean HTML/Tailwind/JS. | Inspect `app/main.py` and `app/static/index.html`. |

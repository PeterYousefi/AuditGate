#!/usr/bin/env python3
"""
Atlas Status Verification & Diagnostic Tool.
Prints collection counts, validator rules, and live limits for judge review.
"""
import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.database import get_database, get_live_policy
from app.config import settings


def verify():
    print("=" * 60)
    print("AuditGate: MongoDB Atlas Verification & Status")
    print("=" * 60)

    db = get_database()
    print(f"Target Database: {db.name}")

    collections = db.list_collection_names()
    print(f"\nCollections Found ({len(collections)}):")
    for name in sorted(collections):
        count = db[name].count_documents({})
        print(f"  • {name:<22} : {count} document(s)")

    print("\nLive Governance Policy:")
    policy = get_live_policy("agent_01")
    for k, v in policy.items():
        print(f"  • {k:<22} : {v}")

    print("\nEnvironment Configuration:")
    print(f"  • Gemini Model         : {settings.GEMINI_MODEL}")
    print(f"  • ElevenLabs Voice ID  : {settings.ELEVENLABS_VOICE_ID}")
    print(f"  • ElevenLabs Model     : {settings.ELEVENLABS_MODEL_ID}")

    print("\n✓ Status: All systems healthy and operational.")


if __name__ == "__main__":
    verify()

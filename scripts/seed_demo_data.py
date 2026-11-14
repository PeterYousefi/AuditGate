#!/usr/bin/env python3
"""
Seed script to initialize sample demo data in MongoDB Atlas
for the AuditGate Hackathon demonstration.
"""
import sys
import os
from datetime import datetime, timezone

# Ensure project root is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.database import (
    init_schema_validation,
    seed_default_policy_if_missing,
    get_collection
)
from app.database.audit_service import record_audit_log


def main():
    print("=" * 60)
    print("AuditGate: Seeding Demo Data in MongoDB Atlas")
    print("=" * 60)

    # 1. Schema validation
    print("\n[1/3] Initializing strict $jsonSchema validation...")
    init_schema_validation()

    # 2. Seed default policy
    print("\n[2/3] Verifying default policy in 'policies'...")
    policy = seed_default_policy_if_missing()
    print(f"      Current Policy Limit: ${policy.get('max_auto_refund'):.2f} USD")

    # 3. Seed baseline audit log
    print("\n[3/3] Recording initial baseline audit trail entry...")
    record_audit_log(
        thread_id="system_init_thread",
        agent_id="agent_01",
        user_requested_amount=0.0,
        policy_limit_applied=float(policy.get("max_auto_refund", 50.0)),
        decision="AUTO_APPROVED",
        reason="System initialized and ready for live hackathon demo.",
        metadata={"event": "initialization_complete"}
    )

    print("\n✓ Seeding completed successfully. AuditGate is live!")


if __name__ == "__main__":
    main()

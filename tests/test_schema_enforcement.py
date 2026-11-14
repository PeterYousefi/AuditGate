import pytest
from app.database import init_schema_validation, get_collection
from app.database.audit_service import (
    record_audit_log,
    test_invalid_schema_insert as execute_schema_test,
    list_audit_logs
)


def test_schema_validation_blocks_unauthorized_write():
    """
    CRITICAL TAMPER-PROOF AUDIT REQUIREMENT:
    Proves that MongoDB Atlas physical engine-level $jsonSchema validation
    rejects any insert missing required fields (Code 121: Document failed validation).
    """
    init_schema_validation()
    result = execute_schema_test()
    
    assert result["blocked"] is True, "MongoDB Atlas should have physically blocked the incomplete document!"
    assert result["error_code"] == 121, f"Expected MongoDB validation error code 121, got {result.get('error_code')}"


def test_schema_validation_allows_valid_audit_log():
    """Confirms that properly formed audit logs succeed and are persisted in Atlas."""
    log = record_audit_log(
        thread_id="test_automated_thread",
        agent_id="agent_01",
        user_requested_amount=15.0,
        policy_limit_applied=50.0,
        decision="AUTO_APPROVED",
        reason="Automated test assertion for valid schema insert",
        metadata={"test": True}
    )
    assert "_id" in log
    assert log["decision"] == "AUTO_APPROVED"

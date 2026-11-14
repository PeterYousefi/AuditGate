from typing import TypedDict, Optional, List, Dict, Any


class AgentState(TypedDict):
    """
    Typed state dictionary for LangGraph workflow.
    Checkpointing via MongoDBSaver guarantees state persistence in MongoDB Atlas.
    """
    thread_id: str
    customer_id: str
    user_message: str
    intent: str  # "REFUND" or "GENERAL"
    requested_amount: Optional[float]
    order_id: Optional[str]
    email: Optional[str]
    is_prompt_injection: Optional[bool]
    currency: str
    reason: Optional[str]
    policy_limit_applied: Optional[float]
    status: str  # "INIT", "AUTO_APPROVED", "PENDING_APPROVAL", "HUMAN_APPROVED", "HUMAN_REJECTED", "PROMPT_INJECTION_DETECTED"
    request_id: Optional[str]
    final_response: Optional[str]
    audio_base64: Optional[str]
    history: List[Dict[str, str]]
    manager_decision: Optional[str]
    approved: Optional[bool]
    decided_by: Optional[str]
    precedent_citation: Optional[str]

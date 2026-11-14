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
    currency: str
    reason: Optional[str]
    policy_limit_applied: Optional[float]
    status: str  # "INIT", "AUTO_APPROVED", "PENDING_APPROVAL", "HUMAN_APPROVED", "HUMAN_REJECTED", "PROMPT_INJECTION_BLOCKED"
    request_id: Optional[str]
    final_response: Optional[str]
    audio_base64: Optional[str]
    history: List[Dict[str, str]]

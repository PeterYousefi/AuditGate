import logging
from typing import Dict, Any, List
from app.database.mongodb import get_collection, get_async_collection
from app.database.orders_service import format_currency

logger = logging.getLogger(__name__)

AUDIT_LOGS_COLLECTION = "audit_logs"


def get_audit_analytics_pipeline() -> List[Dict[str, Any]]:
    """
    Returns the single MongoDB aggregation pipeline with indexed $match before $facet:
    1. decision_counts: $group by decision
    2. amount_buckets: $bucket with boundaries [0, 50, 200, 1000]
    3. summary_kpis: security block rate, total amount, average audited amount
    """
    return [
        # Indexed $match stage before $facet
        {
            "$match": {
                "decision": {"$exists": True, "$ne": None}
            }
        },
        {
            "$facet": {
                # 1. Decision Breakdown
                "decision_counts": [
                    {
                        "$group": {
                            "_id": "$decision",
                            "count": {"$sum": 1},
                            "total_amount": {"$sum": "$user_requested_amount"}
                        }
                    },
                    {"$sort": {"count": -1}}
                ],
                # 2. Dollar-Amount Risk Buckets [0, 50, 200, 1000+]
                "amount_buckets": [
                    {
                        "$bucket": {
                            "groupBy": "$user_requested_amount",
                            "boundaries": [0, 50, 200, 1000],
                            "default": "1000+",
                            "output": {
                                "count": {"$sum": 1},
                                "total_amount": {"$sum": "$user_requested_amount"}
                            }
                        }
                    }
                ],
                # 3. Overall Summary KPIs
                "summary_kpis": [
                    {
                        "$group": {
                            "_id": None,
                            "total_audited_count": {"$sum": 1},
                            "total_audited_amount": {"$sum": "$user_requested_amount"},
                            "avg_audited_amount": {"$avg": "$user_requested_amount"},
                            "security_blocks": {
                                "$sum": {
                                    "$cond": [
                                        {"$in": ["$decision", ["SECURITY_BLOCK", "BLOCKED_BY_SCHEMA"]]},
                                        1,
                                        0
                                    ]
                                }
                            },
                            "auto_approvals": {
                                "$sum": {
                                    "$cond": [
                                        {"$eq": ["$decision", "AUTO_APPROVED"]},
                                        1,
                                        0
                                    ]
                                }
                            },
                            "human_escalations": {
                                "$sum": {
                                    "$cond": [
                                        {"$in": ["$decision", ["PENDING_APPROVAL", "ESCALATED_TO_HUMAN", "HUMAN_APPROVED", "HUMAN_REJECTED"]]},
                                        1,
                                        0
                                    ]
                                }
                            }
                        }
                    }
                ]
            }
        }
    ]


def compute_audit_analytics() -> Dict[str, Any]:
    """
    Executes the $facet aggregation pipeline on MongoDB Atlas 'audit_logs'
    and formats KPI metrics for the Audit & Analytics drawer.
    """
    col = get_collection(AUDIT_LOGS_COLLECTION)
    pipeline = get_audit_analytics_pipeline()
    raw = list(col.aggregate(pipeline))

    if not raw:
        return {
            "total_count": 0,
            "total_amount_formatted": "$0",
            "avg_amount_formatted": "$0",
            "security_block_rate": "0.0%",
            "decision_breakdown": {},
            "buckets": [],
            "kpis": {}
        }

    facet_result = raw[0]
    decision_counts = facet_result.get("decision_counts", [])
    amount_buckets = facet_result.get("amount_buckets", [])
    summary_list = facet_result.get("summary_kpis", [])
    kpi_raw = summary_list[0] if summary_list else {}

    total_count = kpi_raw.get("total_audited_count", 0)
    total_amount = float(kpi_raw.get("total_audited_amount", 0.0))
    avg_amount = float(kpi_raw.get("avg_audited_amount", 0.0))
    security_blocks = kpi_raw.get("security_blocks", 0)

    block_rate = (security_blocks / total_count * 100.0) if total_count > 0 else 0.0

    # Decision dictionary
    decisions = {d["_id"]: d["count"] for d in decision_counts}

    # Format buckets
    bucket_labels = {
        0: "$0 - $50 (Auto Tier)",
        50: "$50 - $200 (HITL Review Tier)",
        200: "$200 - $1000 (Executive Review)",
        "1000+": "$1000+ (High Risk)"
    }
    formatted_buckets = []
    for b in amount_buckets:
        boundary = b["_id"]
        label = bucket_labels.get(boundary, f"${boundary}+")
        formatted_buckets.append({
            "boundary": str(boundary),
            "label": label,
            "count": b.get("count", 0),
            "total_amount": b.get("total_amount", 0.0),
            "total_formatted": format_currency(b.get("total_amount", 0.0))
        })

    return {
        "success": True,
        "total_count": total_count,
        "total_events": total_count,
        "total_amount": total_amount,
        "total_amount_formatted": format_currency(total_amount),
        "avg_amount": avg_amount,
        "avg_amount_formatted": format_currency(avg_amount),
        "avg_requested_amount": avg_amount,
        "security_blocks": security_blocks,
        "security_block_rate": f"{block_rate:.1f}%",
        "block_rate_percent": round(block_rate, 1),
        "auto_approvals": kpi_raw.get("auto_approvals", 0),
        "auto_approved_count": kpi_raw.get("auto_approvals", 0),
        "human_escalations": kpi_raw.get("human_escalations", 0),
        "decision_breakdown": decisions,
        "buckets": formatted_buckets
    }

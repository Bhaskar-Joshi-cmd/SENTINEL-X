"""Unit tests for the SENTINEL-X rule engine scoring logic.

These cover the pure scoring functions only — no Supabase connection is
required. They lock down the documented behaviour in
``docs/product/PRD.md`` section 8 so future refactors cannot silently change
a score or an alert decision.

Run with:
    cd server && .venv/bin/python -m pytest tests -q
"""
from __future__ import annotations

import pytest

from app.services.impact_engine import _hazard_intensity, _preview_level, _risk_level
from app.services.rule_engine import (
    ALERT_THRESHOLD,
    COMMUNITY_EVIDENCE_MAX,
    _community_ladder,
    _hazard_from_report,
    _level_score,
    _rate_score,
    _risk,
    _safe_float,
)


# --------------------------------------------------------------------------
# _safe_float
# --------------------------------------------------------------------------

@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (5, 5.0),
        ("5.5", 5.5),
        (None, None),
        ("not-a-number", None),
        ({}, None),
    ],
)
def test_safe_float(value, expected):
    assert _safe_float(value) == expected


# --------------------------------------------------------------------------
# _level_score — river level factor, maximum 60
# --------------------------------------------------------------------------

def test_level_score_zero_below_warning():
    assert _level_score(2.9, 3.0, 4.0, 6.0) == 0.0


def test_level_score_zero_when_thresholds_missing():
    assert _level_score(5.0, None, 4.0, 6.0) == 0.0
    assert _level_score(None, 3.0, 4.0, 6.0) == 0.0


def test_level_score_never_exceeds_60():
    for level in (3.0, 4.0, 5.0, 6.0, 99.0):
        assert _level_score(level, 3.0, 4.0, 6.0) <= 60.0


def test_level_score_increases_monotonically():
    scores = [_level_score(level, 3.0, 4.0, 6.0) for level in (2.0, 3.0, 3.5, 4.0, 5.0, 6.0, 7.0)]
    assert scores == sorted(scores)


def test_level_score_above_hfl_is_maximum():
    assert _level_score(6.0, 3.0, 4.0, 6.0) == 60.0


# --------------------------------------------------------------------------
# _rate_score — rate of rise factor, maximum 20
# --------------------------------------------------------------------------

@pytest.mark.parametrize(
    ("rate", "expected"),
    [
        (None, 0.0),
        (0.0, 0.0),
        (-0.5, 0.0),      # falling river contributes nothing
        (0.01, 10.0),      # slow but positive rise
        (0.02, 10.0),      # boundary is inclusive
        (0.021, 20.0),     # fast rise
        (1.0, 20.0),
    ],
)
def test_rate_score(rate, expected):
    assert _rate_score(rate) == expected


@pytest.mark.parametrize(
    ("total", "level", "priority", "recommends"),
    [
        (0.0, "normal", "P3", False),
        (24.99, "normal", "P3", False),
        (25.0, "watch", "P3", False),
        (49.99, "watch", "P3", False),
        (50.0, "warning", "P2", False),
        (69.99, "warning", "P2", False),
        (70.0, "high", "P1", True),
        (84.99, "high", "P1", True),
        (85.0, "critical", "P0", True),
        (100.0, "critical", "P0", True),
    ],
)
def test_risk_bands(total, level, priority, recommends):
    assert _risk(total) == (level, priority, recommends)


def test_alert_threshold_is_70():
    assert ALERT_THRESHOLD == 70.0
    assert _risk(ALERT_THRESHOLD - 0.01)[2] is False
    assert _risk(ALERT_THRESHOLD)[2] is True


def test_only_high_and_critical_recommend_an_alert():
    """The human gate is never automatic below the threshold."""
    recommended = [t for t in range(0, 101) if _risk(float(t))[2]]
    assert min(recommended) == int(ALERT_THRESHOLD)


@pytest.mark.parametrize(
    ("report_type", "hazard"),
    [
        ("flood", "flash_flood"),
        ("water_rise", "flash_flood"),
        ("landslide", "landslide"),
        ("avalanche", "avalanche"),
        ("other", "unknown"),
        ("blocked_route", "unknown"),
    ],
)
def test_hazard_from_report(report_type, hazard):
    assert _hazard_from_report(report_type) == hazard


def _report(**overrides):
    row = {
        "report_type": "flood",
        "verification_status": "submitted",
        "reporter_user_id": None,
        "village_id": "v1",
        "submitted_at": "2026-01-01T00:00:00Z",
        "metadata": {},
    }
    row.update(overrides)
    return row


def test_no_reports_scores_zero():
    assert _community_ladder([]) == (0.0, [])


def test_non_hazard_report_scores_zero():
    assert _community_ladder([_report(report_type="blocked_route")])[0] == 0.0


def test_disputed_report_scores_zero():
    assert _community_ladder([_report(verification_status="not_confirmed")])[0] == 0.0
    assert _community_ladder([_report(verification_status="rejected")])[0] == 0.0


def test_single_isolated_report_still_scores_one():
    """An isolated village must never be ignored — the core design guarantee."""
    score, reasons = _community_ladder([_report()])
    assert score == 1.0
    assert reasons


def test_same_person_twice_scores_one():
    reports = [
        _report(reporter_user_id="user-a", submitted_at="2026-01-02T00:00:00Z"),
        _report(reporter_user_id="user-a", submitted_at="2026-01-01T00:00:00Z"),
    ]
    assert _community_ladder(reports)[0] == 1.0


def test_two_independent_reporters_score_two():
    reports = [
        _report(reporter_user_id="user-a", submitted_at="2026-01-02T00:00:00Z"),
        _report(reporter_user_id="user-b", submitted_at="2026-01-01T00:00:00Z"),
    ]
    score, reasons = _community_ladder(reports)
    assert score == 2.0
    assert any("independent" in r.lower() for r in reasons)


def test_field_confirmation_by_third_party_adds_two():
    reports = [
        _report(reporter_user_id="user-a", submitted_at="2026-01-03T00:00:00Z"),
        _report(reporter_user_id="user-b", submitted_at="2026-01-02T00:00:00Z"),
        _report(
            reporter_user_id="user-c",
            verification_status="field_confirmed",
            submitted_at="2026-01-01T00:00:00Z",
            metadata={"verified_by": "user-manager"},
        ),
    ]
    score, reasons = _community_ladder(reports)
    assert score == 4.0
    assert any("field confirmation" in r.lower() for r in reasons)


def test_manager_confirming_own_report_adds_nothing():
    """A manager must not manufacture independent evidence for themselves."""
    reports = [
        _report(
            reporter_user_id="user-manager",
            verification_status="field_confirmed",
            metadata={"verified_by": "user-manager"},
        ),
    ]
    assert _community_ladder(reports)[0] == 1.0


def test_village_authority_corroboration_completes_ladder():
    reports = [
        _report(reporter_user_id="user-a", submitted_at="2026-01-04T00:00:00Z"),
        _report(reporter_user_id="user-b", submitted_at="2026-01-03T00:00:00Z"),
        _report(
            reporter_user_id="user-c",
            verification_status="field_confirmed",
            submitted_at="2026-01-02T00:00:00Z",
            metadata={"verified_by": "user-manager"},
        ),
        _report(
            reporter_user_id="user-va",
            verification_status="corroborated",
            submitted_at="2026-01-01T00:00:00Z",
        ),
    ]
    score, reasons = _community_ladder(reports)
    assert score == COMMUNITY_EVIDENCE_MAX == 5.0
    assert any("corroboration" in r.lower() for r in reasons)


def test_ladder_never_exceeds_maximum():
    reports = [
        _report(
            reporter_user_id=f"user-{i}",
            verification_status="corroborated",
            submitted_at=f"2026-01-{i:02d}",
        )
        for i in range(1, 29)
    ]
    score, _ = _community_ladder(reports)
    assert score <= COMMUNITY_EVIDENCE_MAX


def test_persisted_risk_level_is_db_safe():
    """The DB CHECK only accepts critical/high, so persisted rows must too."""
    for risk in (0.0, 40.0, 65.0, 79.9, 80.0, 100.0):
        assert _risk_level(risk) in {"critical", "high"}


def test_preview_level_uses_full_vocabulary():
    assert _preview_level(95) == "critical"
    assert _preview_level(70) == "high"
    assert _preview_level(55) == "moderate"
    assert _preview_level(10) == "low"


def test_hazard_intensity_is_clamped():
    assert _hazard_intensity(None) == 0.5
    assert _hazard_intensity({"confidence_score": 0}) == 0.0
    assert _hazard_intensity({"confidence_score": 100}) == 1.0
    assert _hazard_intensity({"confidence_score": 500}) == 1.0
    assert _hazard_intensity({"confidence_score": -50}) == 0.0



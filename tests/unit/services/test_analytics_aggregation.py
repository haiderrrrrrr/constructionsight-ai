import pytest

from app.services.risk import risk_rules


pytestmark = [pytest.mark.unit]


@pytest.mark.testcase(
    tc_id="TC-UNIT-RISK-001",
    objective="risk_rules._clamp clamps values into default [0, 100] range",
    precondition="None",
    steps=["Call _clamp with -1, 50, 101", "Assert outputs are 0, 50, 100"],
    test_data={"values": [-1, 50, 101]},
    expected_result="Values are clamped to [0, 100]",
    post_condition="No side effects",
)
def test_clamp_default_range():
    assert risk_rules._clamp(-1) == 0.0
    assert risk_rules._clamp(50) == 50
    assert risk_rules._clamp(101) == 100.0


@pytest.mark.testcase(
    tc_id="TC-UNIT-RISK-002",
    objective="risk_rules._clamp clamps values into custom range",
    precondition="None",
    steps=["Call _clamp with custom bounds", "Assert outputs are within bounds"],
    test_data={"lo": 10, "hi": 20},
    expected_result="Values are clamped to [10, 20]",
    post_condition="No side effects",
)
def test_clamp_custom_range():
    assert risk_rules._clamp(0, 10, 20) == 10
    assert risk_rules._clamp(15, 10, 20) == 15
    assert risk_rules._clamp(50, 10, 20) == 20


@pytest.mark.testcase(
    tc_id="TC-UNIT-RISK-003",
    objective="risk_rules._classify returns correct risk level for boundaries",
    precondition="None",
    steps=["Call _classify across thresholds", "Assert low/moderate/high/critical mapping"],
    test_data={"thresholds": [0, 24.99, 25, 49.99, 50, 74.99, 75]},
    expected_result="Correct risk level string returned per threshold",
    post_condition="No side effects",
)
@pytest.mark.parametrize(
    ("score", "level"),
    [
        (0.0, "low"),
        (24.99, "low"),
        (25.0, "moderate"),
        (49.99, "moderate"),
        (50.0, "high"),
        (74.99, "high"),
        (75.0, "critical"),
        (99.0, "critical"),
    ],
)
def test_classify_boundaries(score, level):
    assert risk_rules._classify(score) == level


class _Obj:
    def __init__(self, **kwargs):
        for k, v in kwargs.items():
            setattr(self, k, v)


@pytest.mark.testcase(
    tc_id="TC-UNIT-RISK-004",
    objective="compute_delay_risk exercises activity, workforce, and weather branches",
    precondition="None",
    steps=["Build wf_snap/act_snap/weather inputs that trigger all rules", "Assert score>0 and factors populated"],
    test_data={},
    expected_result="Non-zero score and multiple factors",
    post_condition="No side effects",
)
def test_compute_delay_risk_branches():
    wf = _Obj(worker_count=2, idle_count=1)
    act = _Obj(idle_duration_seconds=3600, activity_score=10)
    zone_settings = _Obj(required_workers=6)
    weather = {"rain_1h": 1.0, "wind_mps": 12.0, "snow_1h": 0.5}
    score, factors = risk_rules.compute_delay_risk(wf, act, weather, zone_settings)
    assert score > 0
    assert any(f["bucket"] == "delay" for f in factors)


@pytest.mark.testcase(
    tc_id="TC-UNIT-RISK-005",
    objective="compute_safety_risk exercises PPE + weather branches",
    precondition="None",
    steps=["Trigger open PPE, critical PPE, rain/visibility, and heat/cold rules", "Assert factors include ppe and weather"],
    test_data={},
    expected_result="Score clamped and factors include expected sources",
    post_condition="No side effects",
)
def test_compute_safety_risk_branches():
    score1, factors1 = risk_rules.compute_safety_risk(3, 2, {"rain_1h": 0.0, "visibility_m": 2500, "temp_c": 39})
    assert score1 > 0
    assert any(f["source"] == "ppe" for f in factors1)
    assert any(f["source"] == "weather" for f in factors1)

    score2, factors2 = risk_rules.compute_safety_risk(0, 0, {"rain_1h": 1.0, "temp_c": -1})
    assert score2 > 0
    assert any("Cold stress" in f["factor"] for f in factors2)


@pytest.mark.testcase(
    tc_id="TC-UNIT-RISK-006",
    objective="compute_productivity_risk exercises utilization, motion, and idle ratio branches",
    precondition="None",
    steps=["Create wf_snap and act_snap that trigger all three rules", "Assert score>0 and factors populated"],
    test_data={},
    expected_result="Non-zero score and multiple factors",
    post_condition="No side effects",
)
def test_compute_productivity_risk_branches():
    wf = _Obj(utilization_score=10.0, worker_count=10, idle_count=8)
    act = _Obj(motion_intensity_score=5.0)
    score, factors = risk_rules.compute_productivity_risk(wf, act)
    assert score > 0
    assert any(f["bucket"] == "productivity" for f in factors)


@pytest.mark.testcase(
    tc_id="TC-UNIT-RISK-007",
    objective="compute_overall applies compound penalty when thresholds crossed",
    precondition="None",
    steps=["Compute overall with and without compound", "Assert compound flag and increased score"],
    test_data={},
    expected_result="Compound adds penalty and compound_flag is True",
    post_condition="No side effects",
)
def test_compute_overall_compound_penalty():
    base, compound = risk_rules.compute_overall(10, 10, 10)
    boosted, compound2 = risk_rules.compute_overall(60, 50, 50)
    assert compound is False
    assert compound2 is True
    assert boosted > base


class _Snap:
    def __init__(self, overall_risk, recorded_at=None):
        self.overall_risk = overall_risk
        self.recorded_at = recorded_at


@pytest.mark.testcase(
    tc_id="TC-UNIT-RISK-008",
    objective="compute_trend returns stable/rising/decreasing based on delta vs last5 avg",
    precondition="None",
    steps=["Call compute_trend for stable, rising, decreasing scenarios", "Assert trend strings"],
    test_data={},
    expected_result="Correct trend classification",
    post_condition="No side effects",
)
def test_compute_trend_variants():
    stable, d0 = risk_rules.compute_trend(50, [_Snap(48), _Snap(52)])
    rising, d1 = risk_rules.compute_trend(70, [_Snap(50), _Snap(52), _Snap(54)])
    decreasing, d2 = risk_rules.compute_trend(30, [_Snap(50), _Snap(52), _Snap(54)])
    assert stable == "stable"
    assert rising == "rising"
    assert decreasing == "decreasing"
    assert d0 == 0.0
    assert d1 > 0
    assert d2 < 0


@pytest.mark.testcase(
    tc_id="TC-UNIT-RISK-009",
    objective="compute_prediction returns prediction only when slope high and predicted score crosses critical",
    precondition="None",
    steps=["Create last20 snapshots with rising slope", "Assert prediction returned and window minutes is 15"],
    test_data={},
    expected_result="Prediction returned for sufficiently rising risk",
    post_condition="No side effects",
)
def test_compute_prediction_success_and_failures():
    from datetime import datetime, timedelta, timezone

    now = datetime.now(timezone.utc)
    last20 = [_Snap(overall_risk=20 + i * 3, recorded_at=now + timedelta(minutes=i)) for i in range(20)]
    pred, window = risk_rules.compute_prediction(70, last20)
    assert pred is not None
    assert window == 15

    pred2, window2 = risk_rules.compute_prediction(70, last20[:5])
    assert pred2 is None
    assert window2 is None


@pytest.mark.testcase(
    tc_id="TC-UNIT-RISK-010",
    objective="generate_recommendations returns expected recommendation items for triggered rules",
    precondition="None",
    steps=["Call generate_recommendations with inputs that hit multiple branches", "Assert multiple recs returned"],
    test_data={},
    expected_result="Recommendations list contains expected severities",
    post_condition="No side effects",
)
def test_generate_recommendations_branches():
    act = _Obj(idle_duration_seconds=3600)

    # compound_flag=True → critical added; medium branch requires compound_flag=False
    recs_compound = risk_rules.generate_recommendations(
        "Zone A",
        delay_risk=70,
        safety_risk=55,
        productivity_risk=70,
        compound_flag=True,
        prediction_risk=90,
        act_snap=act,
        weather={"rain_1h": 1.0},
    )
    severities_compound = {r["severity"] for r in recs_compound}
    assert "critical" in severities_compound
    assert "high" in severities_compound

    # compound_flag=False → medium branch fires for high productivity_risk
    recs_no_compound = risk_rules.generate_recommendations(
        "Zone A",
        delay_risk=70,
        safety_risk=55,
        productivity_risk=70,
        compound_flag=False,
        prediction_risk=None,
        act_snap=act,
        weather={"rain_1h": 1.0},
    )
    severities_no_compound = {r["severity"] for r in recs_no_compound}
    assert "medium" in severities_no_compound

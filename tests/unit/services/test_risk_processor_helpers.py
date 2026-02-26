import pytest

from app.services.risk import risk_processor as rp


pytestmark = [pytest.mark.unit]


class _Snap:
    def __init__(self, **kwargs):
        for k, v in kwargs.items():
            setattr(self, k, v)


@pytest.mark.testcase(
    tc_id="TC-UNIT-RP-001",
    objective="_minutes_since returns None for None input and a float for datetime input",
    precondition="None",
    steps=["Call _minutes_since(None)", "Call _minutes_since(now)", "Assert expected types"],
    test_data={},
    expected_result="None for None input; float for datetime input",
    post_condition="No side effects",
)
def test_minutes_since():
    from datetime import datetime, timedelta, timezone

    assert rp._minutes_since(None) is None
    ts = datetime.now(timezone.utc) - timedelta(minutes=2)
    val = rp._minutes_since(ts)
    assert isinstance(val, float)
    assert val > 0


@pytest.mark.testcase(
    tc_id="TC-UNIT-RP-002",
    objective="_source_scale returns expected scaling across age buckets",
    precondition="None",
    steps=["Call _source_scale for None, fresh, stale, and mid-range ages", "Assert output values in expected ranges"],
    test_data={},
    expected_result="0.0 for None age; 1.0 for fresh; 0.3 for stale; between 0.5..1.0 for mid-range",
    post_condition="No side effects",
)
def test_source_scale():
    assert rp._source_scale(None, 2, 10) == 0.0
    assert rp._source_scale(1.0, 2, 10) == 1.0
    assert rp._source_scale(10.0, 2, 10) == 0.3
    mid = rp._source_scale(6.0, 2, 10)
    assert 0.5 <= mid <= 1.0


@pytest.mark.testcase(
    tc_id="TC-UNIT-RP-003",
    objective="_aggregate_wf returns averaged workforce snapshot namespace",
    precondition="None",
    steps=["Create list of wf snapshots", "Call _aggregate_wf", "Assert aggregated fields exist and are numeric"],
    test_data={},
    expected_result="Aggregated workforce values returned",
    post_condition="No side effects",
)
def test_aggregate_wf():
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc)
    snaps = [
        _Snap(recorded_at=now, worker_count=10, idle_count=2, utilization_score=50.0),
        _Snap(recorded_at=now, worker_count=12, idle_count=4, utilization_score=70.0),
    ]
    agg = rp._aggregate_wf(snaps)
    assert agg is not None
    assert agg.recorded_at == now
    assert agg.worker_count in (11, 12, 10)
    assert isinstance(agg.utilization_score, float)


@pytest.mark.testcase(
    tc_id="TC-UNIT-RP-004",
    objective="_aggregate_act returns averaged activity snapshot namespace",
    precondition="None",
    steps=["Create list of activity snapshots", "Call _aggregate_act", "Assert aggregated fields exist and are numeric"],
    test_data={},
    expected_result="Aggregated activity values returned",
    post_condition="No side effects",
)
def test_aggregate_act():
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc)
    snaps = [
        _Snap(recorded_at=now, activity_score=10.0, motion_intensity_score=20.0, idle_duration_seconds=120),
        _Snap(recorded_at=now, activity_score=30.0, motion_intensity_score=40.0, idle_duration_seconds=360),
    ]
    agg = rp._aggregate_act(snaps)
    assert agg is not None
    assert agg.recorded_at == now
    assert agg.activity_score > 0
    assert agg.motion_intensity_score > 0
    assert agg.idle_duration_seconds == 360


@pytest.mark.testcase(
    tc_id="TC-UNIT-RP-005",
    objective="_should_generate_event returns True for escalations and special flags",
    precondition="None",
    steps=["Call _should_generate_event across cases", "Assert expected boolean outcomes"],
    test_data={},
    expected_result="True when event should be generated, else False",
    post_condition="No side effects",
)
def test_should_generate_event():
    s_low = _Snap(risk_level="low", compound_risk_flag=False, prediction_risk=None)
    s_high = _Snap(risk_level="high", compound_risk_flag=False, prediction_risk=None)
    assert rp._should_generate_event(s_low, None) is False
    assert rp._should_generate_event(s_high, None) is True

    prev = _Snap(risk_level="low", compound_risk_flag=False, prediction_risk=None)
    cur = _Snap(risk_level="moderate", compound_risk_flag=False, prediction_risk=None)
    assert rp._should_generate_event(cur, prev) is True

    prev2 = _Snap(risk_level="moderate", compound_risk_flag=False, prediction_risk=None)
    cur2 = _Snap(risk_level="moderate", compound_risk_flag=True, prediction_risk=None)
    assert rp._should_generate_event(cur2, prev2) is True

    prev3 = _Snap(risk_level="moderate", compound_risk_flag=False, prediction_risk=60)
    cur3 = _Snap(risk_level="moderate", compound_risk_flag=False, prediction_risk=80)
    assert rp._should_generate_event(cur3, prev3) is True

    prev4 = _Snap(risk_level="moderate", compound_risk_flag=False, prediction_risk=80)
    cur4 = _Snap(risk_level="moderate", compound_risk_flag=False, prediction_risk=80)
    assert rp._should_generate_event(cur4, prev4) is False


@pytest.mark.testcase(
    tc_id="TC-UNIT-RP-006",
    objective="_determine_event_type selects correct type based on snapshot state",
    precondition="None",
    steps=["Call _determine_event_type with different state combinations", "Assert returned event type string"],
    test_data={},
    expected_result="Correct event type returned",
    post_condition="No side effects",
)
def test_determine_event_type():
    prev = _Snap(compound_risk_flag=False, prediction_risk=None, overall_risk=80, risk_level="high", weather_rain=None)

    s1 = _Snap(compound_risk_flag=True, prediction_risk=None, overall_risk=90, risk_level="critical", weather_condition=None, weather_rain=None)
    assert rp._determine_event_type(s1, prev) == "compound_risk"

    s2 = _Snap(compound_risk_flag=False, prediction_risk=80, overall_risk=80, risk_level="high", weather_condition=None, weather_rain=None, prediction_window_minutes=15)
    assert rp._determine_event_type(s2, prev) == "prediction_alert"

    prev3 = _Snap(compound_risk_flag=False, prediction_risk=None, overall_risk=60, risk_level="high", weather_condition=None, weather_rain=None)
    s3 = _Snap(compound_risk_flag=False, prediction_risk=None, overall_risk=40, risk_level="moderate", weather_condition=None, weather_rain=None)
    assert rp._determine_event_type(s3, prev3) == "risk_resolved"

    prev4 = _Snap(compound_risk_flag=False, prediction_risk=None, overall_risk=60, risk_level="high", weather_condition=None, weather_rain=None)
    s4 = _Snap(compound_risk_flag=False, prediction_risk=None, overall_risk=60, risk_level="high", weather_condition="rain", weather_rain=1.0)
    assert rp._determine_event_type(s4, prev4) == "weather_impact"

    s5 = _Snap(compound_risk_flag=False, prediction_risk=None, overall_risk=60, risk_level="high", weather_condition=None, weather_rain=None)
    assert rp._determine_event_type(s5, prev) == "risk_escalated"


@pytest.mark.testcase(
    tc_id="TC-UNIT-RP-007",
    objective="_build_event_message returns a readable message for each event type",
    precondition="None",
    steps=["Call _build_event_message for each event type", "Assert expected substrings exist"],
    test_data={},
    expected_result="Messages contain relevant tokens",
    post_condition="No side effects",
)
def test_build_event_message():
    snap = _Snap(
        zone_name="Z1",
        overall_risk=80,
        delay_risk=60,
        safety_risk=50,
        productivity_risk=40,
        prediction_risk=90,
        prediction_window_minutes=15,
        risk_level="critical",
        weather_condition="rain",
        weather_rain=1.2,
    )
    m1 = rp._build_event_message(snap, "compound_risk")
    m2 = rp._build_event_message(snap, "prediction_alert")
    m3 = rp._build_event_message(snap, "risk_resolved")
    m4 = rp._build_event_message(snap, "weather_impact")
    m5 = rp._build_event_message(snap, "risk_escalated")

    assert "Compound risk" in m1
    assert "predicted" in m2
    assert "decreased" in m3
    assert "weather" in m4
    assert "entering" in m5


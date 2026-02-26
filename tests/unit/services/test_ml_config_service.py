"""
Unit Tests — ML Config Service

Tests the ML configuration singleton loading and field defaults.
The MLConfig singleton (id=1) is auto-created on startup.
"""
import allure
import pytest

pytestmark = [
    allure.epic("ConstructionSight-AI"),
    allure.feature("Unit Tests"),
    allure.story("ML Config Service"),
    pytest.mark.unit,
]

from app.models.ml_config import MLConfig


class TestMLConfigSingleton:
    @pytest.mark.testcase(
        tc_id="TC-UNIT-SVC-ML-001",
        objective="MLConfig singleton (id=1) can be created and queried",
        precondition="Test DB with ml_configs table created",
        steps=[
            "Query ml_configs for id=1",
            "If not exists, create with defaults",
            "Assert the config has all required numeric threshold fields non-None",
        ],
        test_data={"id": 1},
        expected_result="MLConfig row exists with non-None stage1_conf",
        post_condition="Transaction rolled back",
    )
    def test_ml_config_has_required_fields(self, db):
        with allure.step("Check or create MLConfig singleton"):
            config = db.query(MLConfig).filter_by(id=1).first()
            if config is None:
                config = MLConfig(
                    id=1,
                    stage1_conf=0.3,
                    stage2_conf=0.5,
                    min_crop_height=40,
                    min_crop_width=20,
                )
                db.add(config)
                db.flush()

        with allure.step("Assert required fields are non-None"):
            assert config.stage1_conf is not None
            assert config.stage2_conf is not None
            assert isinstance(config.stage1_conf, float)

    @pytest.mark.testcase(
        tc_id="TC-UNIT-SVC-ML-002",
        objective="MLConfig confidence values are within valid range [0, 1]",
        precondition="MLConfig exists with stage1_conf and stage2_conf set",
        steps=[
            "Load or create MLConfig",
            "Assert stage1_conf in [0.0, 1.0]",
            "Assert stage2_conf in [0.0, 1.0]",
        ],
        test_data={"stage1_conf": 0.3, "stage2_conf": 0.5},
        expected_result="Confidence values within [0.0, 1.0]",
        post_condition="Transaction rolled back",
    )
    def test_confidence_values_in_range(self, db):
        config = db.query(MLConfig).filter_by(id=1).first()
        if config is None:
            config = MLConfig(id=1, stage1_conf=0.3, stage2_conf=0.5)
            db.add(config)
            db.flush()

        assert 0.0 <= config.stage1_conf <= 1.0
        assert 0.0 <= config.stage2_conf <= 1.0

    @pytest.mark.testcase(
        tc_id="TC-UNIT-SVC-ML-003",
        objective="MLConfig fields can be updated and re-read",
        precondition="MLConfig exists",
        steps=[
            "Load or create MLConfig",
            "Update stage1_conf to 0.7",
            "Flush and re-query",
            "Assert new value persisted",
        ],
        test_data={"new_stage1_conf": 0.7},
        expected_result="stage1_conf updated to 0.7",
        post_condition="Transaction rolled back",
    )
    def test_ml_config_field_update(self, db):
        config = db.query(MLConfig).filter_by(id=1).first()
        if config is None:
            config = MLConfig(id=1, stage1_conf=0.3, stage2_conf=0.5)
            db.add(config)
            db.flush()

        config.stage1_conf = 0.7
        db.flush()

        refreshed = db.query(MLConfig).filter_by(id=1).first()
        assert refreshed.stage1_conf == pytest.approx(0.7)

import math

from app.experiment_registry import ExperimentRegistry
from app.ml.model_service import ModelService, classify_phases


def test_lstm_prediction_is_continuous_power() -> None:
    service = ModelService(ExperimentRegistry())
    prediction = service.predict_single(samples=[3.0] * 30, model_name="lstm")
    assert prediction.source == "real_lstm_model"
    assert prediction.model == "lstm"
    assert isinstance(prediction.predicted_power_kw, float)
    assert math.isfinite(prediction.predicted_power_kw)
    assert 0.5 < prediction.predicted_power_kw < 4.0


def test_phase_classification() -> None:
    phases = classify_phases([3.0, 3.0, 4.0, 4.02, 2.5], threshold=0.05)
    assert phases == [
        "steady_state",
        "steady_state",
        "rising_transition",
        "steady_state",
        "falling_transition",
    ]


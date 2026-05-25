from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_predict_schema_contains_real_lstm_fields() -> None:
    response = client.post(
        "/api/predict",
        json={"model": "lstm", "samples": [{"input_voltage": 3.0} for _ in range(30)]},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["model"] == "lstm"
    assert payload["source"] == "real_lstm_model"
    assert isinstance(payload["predicted_power_kw"], float)
    assert payload["uncertainty_method"] == "split_conformal_prediction"
    assert payload["coverage"] == 0.95


def test_lstm_explainability_uses_temporal_occlusion() -> None:
    response = client.get("/api/results/explainability", params={"experiment_id": "ex_22", "model": "lstm"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["available"] is True
    assert payload["method"] == "temporal_occlusion"
    assert payload["items"]
    assert payload["items"][0]["label"].startswith("t-")


def test_upload_validation_rejects_out_of_range_voltage() -> None:
    response = client.post(
        "/api/predict-sequence",
        json={"model": "baseline", "samples": [{"timestamp": 0, "input_voltage": 11}]},
    )
    assert response.status_code == 422


def test_upload_sequence_accepts_valid_csv() -> None:
    response = client.post(
        "/api/upload-sequence",
        files={"file": ("sequence.csv", b"timestamp,input_voltage\n0,3.0\n1,4.0\n", "text/csv")},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["sample_count"] == 2
    assert payload["has_ground_truth"] is False

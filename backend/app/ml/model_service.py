from __future__ import annotations

import json
import math
import time
from dataclasses import dataclass
from functools import cached_property
from pathlib import Path
from statistics import fmean
from typing import Any, Literal, Sequence

import joblib
import numpy as np
import pandas as pd
from scipy.signal import savgol_filter
from sklearn.linear_model import LinearRegression

from ..config import (
    DATA_DIR,
    LSTM_ARTIFACT_DIR,
    MAINTENANCE_CONSECUTIVE_SAMPLES,
    PHASE_DELTA_THRESHOLD,
    VOLTAGE_MAX,
    VOLTAGE_MIN,
)
from ..experiment_registry import ExperimentRegistry, TRAIN_EXPERIMENTS

try:
    import torch
    from torch import nn
except Exception:  # pragma: no cover - exercised only in lean environments
    torch = None
    nn = None


ModelName = Literal["baseline", "lstm"]
FilterMode = Literal["none", "voltage", "power", "both"]
PhaseName = Literal["steady_state", "rising_transition", "falling_transition"]
AlertStatus = Literal["normal", "anomaly", "maintenance_required"]


@dataclass(frozen=True)
class Prediction:
    model: ModelName
    input_voltage: float
    predicted_power_kw: float
    uncertainty_lower_kw: float
    uncertainty_upper_kw: float
    latency_ms: float
    source: str
    uncertainty_source: str
    filtered_voltage: float | None = None


@dataclass(frozen=True)
class SequencePredictionPoint:
    timestamp: float
    experiment_id: str | None
    input_voltage: float
    ground_truth_power_kw: float | None
    predicted_power_kw: float
    uncertainty_lower_kw: float
    uncertainty_upper_kw: float
    residual: float | None
    phase: PhaseName
    model: ModelName
    latency_ms: float
    alert_status: AlertStatus | None
    severity: str | None
    message: str | None


def assert_voltage(value: float) -> float:
    numeric = float(value)
    if not math.isfinite(numeric):
        raise ValueError("input_voltage must be a finite number")
    if numeric < VOLTAGE_MIN or numeric > VOLTAGE_MAX:
        raise ValueError(f"input_voltage must be between {VOLTAGE_MIN:g}V and {VOLTAGE_MAX:g}V")
    return numeric


def normalize_model_name(model_name: str) -> ModelName:
    normalized = model_name.strip().lower().replace("model_", "").replace("linear", "baseline")
    if normalized in {"baseline", "base"}:
        return "baseline"
    if normalized in {"lstm", "advanced", "sequence"}:
        return "lstm"
    raise ValueError("model must be either 'baseline' or 'lstm'")


def normalize_filter_mode(filter_mode: str | None) -> FilterMode:
    normalized = (filter_mode or "none").strip().lower()
    if normalized not in {"none", "voltage", "power", "both"}:
        raise ValueError("filter_mode must be one of: none, voltage, power, both")
    return normalized  # type: ignore[return-value]


def watts_to_kw(values: np.ndarray | float) -> np.ndarray | float:
    return np.asarray(values, dtype=float) / 1000.0 if not np.isscalar(values) else float(values) / 1000.0


def kw_to_watts(values: np.ndarray | float) -> np.ndarray | float:
    return np.asarray(values, dtype=float) * 1000.0 if not np.isscalar(values) else float(values) * 1000.0


def apply_savgol(values: Sequence[float], requested_window: int = 11) -> np.ndarray:
    numeric = np.asarray(values, dtype=float)
    if numeric.size < 5:
        return numeric
    window = min(requested_window, numeric.size)
    if window % 2 == 0:
        window -= 1
    window = max(window, 5)
    return savgol_filter(numeric, window_length=window, polyorder=2, mode="interp").astype(float)


def classify_phases(voltage: Sequence[float], threshold: float = PHASE_DELTA_THRESHOLD) -> list[PhaseName]:
    values = np.asarray(voltage, dtype=float)
    phases: list[PhaseName] = []
    previous: float | None = None
    for value in values:
        delta = 0.0 if previous is None else float(value - previous)
        if abs(delta) <= threshold:
            phases.append("steady_state")
        elif delta > threshold:
            phases.append("rising_transition")
        else:
            phases.append("falling_transition")
        previous = float(value)
    return phases


if nn is not None:

    class AethelLSTM(nn.Module):
        """Exact deployment architecture from the training notebook checkpoint."""

        def __init__(self, n_features: int, hidden_size: int, num_layers: int, dropout: float) -> None:
            super().__init__()
            self.lstm = nn.LSTM(
                input_size=n_features,
                hidden_size=hidden_size,
                num_layers=num_layers,
                dropout=dropout,
                batch_first=True,
            )
            self.regressor = nn.Sequential(
                nn.LayerNorm(hidden_size),
                nn.Dropout(dropout),
                nn.Linear(hidden_size, hidden_size // 2),
                nn.GELU(),
                nn.Dropout(dropout),
                nn.Linear(hidden_size // 2, 1),
            )

        def forward(self, x: "torch.Tensor") -> "torch.Tensor":
            sequence_output, _ = self.lstm(x)
            last_hidden = sequence_output[:, -1, :]
            return self.regressor(last_hidden).squeeze(-1)

else:  # pragma: no cover
    AethelLSTM = None  # type: ignore[assignment]


class LSTMRegressionModel:
    def __init__(self, artifact_dir: Path) -> None:
        if torch is None or AethelLSTM is None:
            raise RuntimeError("PyTorch is not installed; cannot load the LSTM artifact")

        self.artifact_dir = artifact_dir
        self.model_path = artifact_dir / "aethel_lstm_el_power.pth"
        self.feature_scaler_path = artifact_dir / "feature_scaler.joblib"
        self.target_scaler_path = artifact_dir / "target_scaler.joblib"
        self.config_path = artifact_dir / "deployment_config.json"
        missing = [
            path.name
            for path in (self.model_path, self.feature_scaler_path, self.target_scaler_path, self.config_path)
            if not path.exists()
        ]
        if missing:
            raise FileNotFoundError(
                f"LSTM artifact directory {artifact_dir} is missing: {', '.join(missing)}. "
                "Set AETHEL_LSTM_ARTIFACT_DIR to the deployed model folder."
            )

        self.config = json.loads(self.config_path.read_text(encoding="utf-8"))
        checkpoint = torch.load(self.model_path, map_location="cpu")
        self.checkpoint = checkpoint
        self.feature_columns = list(checkpoint.get("feature_columns", self.config.get("feature_columns", ["input_voltage"])))
        self.target_column = str(checkpoint.get("target_column", self.config.get("target_column", "el_power")))
        self.time_column = str(checkpoint.get("time_column", self.config.get("time_column", "time")))
        self.lookback_steps = int(checkpoint["lookback_steps"])
        self.median_dt_seconds = float(checkpoint.get("median_dt_seconds", self.config.get("median_dt_seconds", 1.0)))

        self.model = AethelLSTM(
            n_features=len(self.feature_columns),
            hidden_size=int(checkpoint["hidden_size"]),
            num_layers=int(checkpoint["num_lstm_layers"]),
            dropout=float(checkpoint["dropout_rate"]),
        )
        self.model.load_state_dict(checkpoint["model_state_dict"])
        self.model.eval()
        self.feature_scaler = joblib.load(self.feature_scaler_path)
        self.target_scaler = joblib.load(self.target_scaler_path)

    @property
    def source(self) -> str:
        return "real_lstm_model"

    def predict_windows(self, voltage_values: Sequence[float], pad_initial: bool = True) -> tuple[np.ndarray, np.ndarray, float]:
        start = time.perf_counter()
        values = np.asarray([assert_voltage(value) for value in voltage_values], dtype=np.float32)
        if values.size == 0:
            raise ValueError("At least one input_voltage sample is required")

        if pad_initial:
            windows = np.stack([self._window_for(values, index) for index in range(values.size)])
            target_indices = np.arange(values.size, dtype=int)
        else:
            if values.size < self.lookback_steps:
                raise ValueError(f"LSTM requires at least {self.lookback_steps} samples for unpadded sequence inference")
            windows = np.stack(
                [values[index - self.lookback_steps + 1 : index + 1] for index in range(self.lookback_steps - 1, values.size)]
            )
            target_indices = np.arange(self.lookback_steps - 1, values.size, dtype=int)

        flat = windows.reshape(-1, 1)
        scaled_flat = self.feature_scaler.transform(flat).astype(np.float32)
        scaled_windows = scaled_flat.reshape(windows.shape[0], self.lookback_steps, len(self.feature_columns))
        predictions_scaled: list[np.ndarray] = []
        with torch.no_grad():
            for start_index in range(0, scaled_windows.shape[0], 2048):
                batch = torch.as_tensor(scaled_windows[start_index : start_index + 2048], dtype=torch.float32)
                predictions_scaled.append(self.model(batch).detach().cpu().numpy().reshape(-1, 1))
        scaled = np.vstack(predictions_scaled)
        predictions_w = self.target_scaler.inverse_transform(scaled).reshape(-1).astype(float)
        latency_ms = (time.perf_counter() - start) * 1000.0
        return target_indices, predictions_w, latency_ms

    def predict_latest(self, voltage_values: Sequence[float]) -> tuple[float, float]:
        _, predictions, latency_ms = self.predict_windows(voltage_values, pad_initial=True)
        return float(predictions[-1]), latency_ms

    def _window_for(self, values: np.ndarray, index: int) -> np.ndarray:
        start = max(0, index - self.lookback_steps + 1)
        window = values[start : index + 1]
        if window.size < self.lookback_steps:
            pad = np.full(self.lookback_steps - window.size, float(window[0]), dtype=np.float32)
            window = np.concatenate([pad, window])
        return window.astype(np.float32)


class BaselineRegressionModel:
    def __init__(self, registry: ExperimentRegistry) -> None:
        self.registry = registry
        self.model = LinearRegression()
        train_frames = [registry.load_frame(experiment_id) for experiment_id in TRAIN_EXPERIMENTS]
        train = pd.concat(train_frames, ignore_index=True)
        self.model.fit(train[["input_voltage"]].to_numpy(dtype=float), train["el_power"].to_numpy(dtype=float))
        residuals_w = train["el_power"].to_numpy(dtype=float) - self.model.predict(train[["input_voltage"]].to_numpy(dtype=float))
        self.residual_std_kw = float(np.std(watts_to_kw(residuals_w)))

    @property
    def source(self) -> str:
        return "linear_regression_baseline_trained_on_train_experiments"

    def predict_values(self, voltage_values: Sequence[float]) -> tuple[np.ndarray, float]:
        start = time.perf_counter()
        values = np.asarray([assert_voltage(value) for value in voltage_values], dtype=float)
        if values.size == 0:
            raise ValueError("At least one input_voltage sample is required")
        predictions = self.model.predict(values.reshape(-1, 1)).astype(float)
        latency_ms = (time.perf_counter() - start) * 1000.0
        return predictions, latency_ms

    @property
    def coefficient_w_per_v(self) -> float:
        return float(self.model.coef_[0])

    @property
    def intercept_w(self) -> float:
        return float(self.model.intercept_)


class ModelService:
    def __init__(
        self,
        registry: ExperimentRegistry | None = None,
        artifact_dir: Path | None = None,
    ) -> None:
        self.registry = registry or ExperimentRegistry(DATA_DIR)
        self.artifact_dir = Path(artifact_dir or LSTM_ARTIFACT_DIR)
        self._lstm: LSTMRegressionModel | None = None
        self._lstm_error: str | None = None
        self._baseline: BaselineRegressionModel | None = None
        self._load_lstm()

    def _load_lstm(self) -> None:
        try:
            self._lstm = LSTMRegressionModel(self.artifact_dir)
            self._lstm_error = None
        except Exception as exc:
            self._lstm = None
            self._lstm_error = str(exc)

    def load_model(self, model_name: str) -> LSTMRegressionModel | BaselineRegressionModel:
        model = normalize_model_name(model_name)
        if model == "baseline":
            return self.baseline
        if self._lstm is None:
            raise RuntimeError(
                f"LSTM model is unavailable: {self._lstm_error}. "
                "TODO: provide a valid PyTorch checkpoint plus feature_scaler.joblib, target_scaler.joblib, and deployment_config.json."
            )
        return self._lstm

    @cached_property
    def baseline(self) -> BaselineRegressionModel:
        return BaselineRegressionModel(self.registry)

    def get_available_models(self) -> list[dict[str, object]]:
        models: list[dict[str, object]] = [
            {
                "id": "baseline",
                "label": "Baseline",
                "family": "linear_regression",
                "source": self.baseline.source,
                "available": True,
            }
        ]
        models.append(
            {
                "id": "lstm",
                "label": "LSTM",
                "family": "sequence_lstm",
                "source": "real_lstm_model" if self._lstm is not None else "unavailable",
                "available": self._lstm is not None,
                "reason": self._lstm_error,
                "lookback_steps": self._lstm.lookback_steps if self._lstm is not None else None,
            }
        )
        return models

    def predict_single(
        self,
        input_voltage: float | None = None,
        samples: Sequence[float] | None = None,
        model_name: str = "lstm",
    ) -> Prediction:
        model = normalize_model_name(model_name)
        voltage_window = list(samples if samples is not None else [assert_voltage(float(input_voltage))])
        if not voltage_window:
            raise ValueError("At least one voltage sample is required")
        latest_voltage = assert_voltage(float(voltage_window[-1]))

        if model == "lstm":
            lstm = self.load_model("lstm")
            prediction_w, latency_ms = lstm.predict_latest(voltage_window)  # type: ignore[union-attr]
            residual_std = self.validation_residual_std_kw("lstm")
            source = lstm.source  # type: ignore[union-attr]
        else:
            predictions_w, latency_ms = self.baseline.predict_values([latest_voltage])
            prediction_w = float(predictions_w[-1])
            residual_std = self.validation_residual_std_kw("baseline")
            source = self.baseline.source

        prediction_kw = float(watts_to_kw(max(prediction_w, 0.0)))
        band = 1.96 * residual_std
        return Prediction(
            model=model,
            input_voltage=latest_voltage,
            predicted_power_kw=prediction_kw,
            uncertainty_lower_kw=max(prediction_kw - band, 0.0),
            uncertainty_upper_kw=prediction_kw + band,
            latency_ms=latency_ms,
            source=source,
            uncertainty_source="residual_based_prediction_band",
            filtered_voltage=None,
        )

    def predict_sequence(
        self,
        frame: pd.DataFrame,
        model_name: str = "lstm",
        experiment_id: str | None = None,
        filter_mode: str | None = "none",
        pad_initial: bool = True,
    ) -> dict[str, object]:
        model = normalize_model_name(model_name)
        mode = normalize_filter_mode(filter_mode)
        prepared = prepare_prediction_frame(frame, mode)
        voltage = prepared["input_voltage"].to_numpy(dtype=float)
        timestamps = prepared["timestamp"].to_numpy(dtype=float)
        truth_kw = prepared["ground_truth_power_kw"].to_numpy(dtype=float) if "ground_truth_power_kw" in prepared else None

        if model == "lstm":
            lstm = self.load_model("lstm")
            target_indices, predictions_w, latency_ms = lstm.predict_windows(voltage, pad_initial=pad_initial)  # type: ignore[union-attr]
            source = lstm.source  # type: ignore[union-attr]
        else:
            predictions_w_all, latency_ms = self.baseline.predict_values(voltage)
            target_indices = np.arange(len(voltage), dtype=int)
            predictions_w = predictions_w_all
            source = self.baseline.source

        predictions_kw = np.asarray(watts_to_kw(np.maximum(predictions_w, 0.0)), dtype=float)
        residual_std = self.validation_residual_std_kw(model)
        band = 1.96 * residual_std
        phases = classify_phases(voltage)
        alert_run = 0
        points: list[dict[str, object]] = []
        per_sample_latency = latency_ms / max(len(target_indices), 1)
        threshold = 3.0 * residual_std

        for offset, index in enumerate(target_indices):
            predicted_kw = float(predictions_kw[offset])
            actual_kw: float | None = None
            residual: float | None = None
            alert_status: AlertStatus | None = None
            severity: str | None = None
            message: str | None = None
            if truth_kw is not None and np.isfinite(truth_kw[index]):
                actual_kw = float(truth_kw[index])
                residual = actual_kw - predicted_kw
                if abs(residual) > threshold:
                    alert_run += 1
                    alert_status = "maintenance_required" if alert_run >= MAINTENANCE_CONSECUTIVE_SAMPLES else "anomaly"
                    severity = _severity(abs(residual), threshold)
                    message = (
                        "Sustained prediction deviation detected."
                        if alert_status == "maintenance_required"
                        else "Prediction residual exceeds validation threshold."
                    )
                else:
                    alert_run = 0
                    alert_status = "normal"
                    severity = "low"
                    message = "Residual is within the validation threshold."

            points.append(
                SequencePredictionPoint(
                    timestamp=float(timestamps[index]),
                    experiment_id=experiment_id,
                    input_voltage=float(voltage[index]),
                    ground_truth_power_kw=actual_kw,
                    predicted_power_kw=predicted_kw,
                    uncertainty_lower_kw=max(predicted_kw - band, 0.0),
                    uncertainty_upper_kw=predicted_kw + band,
                    residual=residual,
                    phase=phases[index],
                    model=model,
                    latency_ms=per_sample_latency,
                    alert_status=alert_status,
                    severity=severity,
                    message=message,
                ).__dict__
            )

        return {
            "model": model,
            "source": source,
            "uncertainty_source": "residual_based_prediction_band",
            "filter_mode": mode,
            "filter_method": "savitzky_golay" if mode != "none" else None,
            "points": points,
            "latency_ms": latency_ms,
        }

    def validation_residual_std_kw(self, model_name: str) -> float:
        model = normalize_model_name(model_name)
        if model == "baseline":
            return max(self.baseline.residual_std_kw, 0.001)

        validation_path = self.artifact_dir / "validation_predictions.csv"
        if validation_path.exists():
            frame = pd.read_csv(validation_path)
            if "residual" in frame.columns:
                return max(float(np.std(watts_to_kw(frame["residual"].to_numpy(dtype=float)))), 0.001)
            if {"y_true", "y_pred"} <= set(frame.columns):
                residual = frame["y_true"].to_numpy(dtype=float) - frame["y_pred"].to_numpy(dtype=float)
                return max(float(np.std(watts_to_kw(residual))), 0.001)
        metrics = self._lstm.config.get("global_validation_metrics", {}) if self._lstm is not None else {}
        rmse_w = float(metrics.get("rmse", 100.0))
        return max(float(watts_to_kw(rmse_w)), 0.001)


def prepare_prediction_frame(frame: pd.DataFrame, filter_mode: FilterMode) -> pd.DataFrame:
    if "input_voltage" not in frame.columns:
        raise ValueError("input_voltage column is required")

    prepared = pd.DataFrame()
    if "time" in frame.columns:
        prepared["timestamp"] = pd.to_numeric(frame["time"], errors="raise").astype(float)
    elif "timestamp" in frame.columns:
        prepared["timestamp"] = pd.to_numeric(frame["timestamp"], errors="raise").astype(float)
    else:
        prepared["timestamp"] = np.arange(len(frame), dtype=float)

    voltage = pd.to_numeric(frame["input_voltage"], errors="raise").astype(float).to_numpy()
    for value in voltage:
        assert_voltage(float(value))
    if filter_mode in {"voltage", "both"}:
        voltage = apply_savgol(voltage)
    prepared["input_voltage"] = voltage

    power_column = "el_power" if "el_power" in frame.columns else "power" if "power" in frame.columns else None
    if power_column is not None:
        power_w = pd.to_numeric(frame[power_column], errors="raise").astype(float).to_numpy()
        if filter_mode in {"power", "both"}:
            power_w = apply_savgol(power_w)
        prepared["ground_truth_power_kw"] = watts_to_kw(power_w)

    return prepared


def _severity(abs_residual: float, threshold: float) -> str:
    if threshold <= 0:
        return "high"
    ratio = abs_residual / threshold
    if ratio >= 2:
        return "high"
    if ratio >= 1.3:
        return "medium"
    return "low"


def model_service_to_legacy_payload(prediction: Prediction) -> dict[str, object]:
    predicted_w = kw_to_watts(prediction.predicted_power_kw)
    low_w = kw_to_watts(prediction.uncertainty_lower_kw)
    high_w = kw_to_watts(prediction.uncertainty_upper_kw)
    return {
        "model": prediction.model,
        "input_voltage": prediction.input_voltage,
        "predicted_power_kw": prediction.predicted_power_kw,
        "predicted_power_w": predicted_w,
        "uncertainty_lower_kw": prediction.uncertainty_lower_kw,
        "uncertainty_upper_kw": prediction.uncertainty_upper_kw,
        "latency_ms": prediction.latency_ms,
        "source": prediction.source,
        "uncertainty_source": prediction.uncertainty_source,
        "predicted_power": predicted_w,
        "confidence_interval": {"low": low_w, "high": high_w},
        "confidence_low": low_w,
        "confidence_high": high_w,
        "model_version": prediction.model,
        "model_source": prediction.source,
        "uncertainty": kw_to_watts((prediction.uncertainty_upper_kw - prediction.uncertainty_lower_kw) / 3.92),
        "filtered_voltage": prediction.filtered_voltage or prediction.input_voltage,
    }


def mean(values: Sequence[float]) -> float | None:
    filtered = [float(value) for value in values if math.isfinite(float(value))]
    return fmean(filtered) if filtered else None


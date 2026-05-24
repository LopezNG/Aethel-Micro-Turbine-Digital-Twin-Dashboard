from __future__ import annotations

import csv
import math
import os
import time
import warnings
from dataclasses import dataclass
from pathlib import Path
from statistics import fmean
from typing import Any, Literal, Sequence

try:
    import joblib
except Exception:  # pragma: no cover - optional in local smoke tests
    joblib = None

try:
    import numpy as np
except Exception:  # pragma: no cover
    np = None

try:
    import pandas as pd
except Exception:  # pragma: no cover
    pd = None

try:
    from scipy.signal import savgol_filter
except Exception:  # pragma: no cover
    savgol_filter = None


ModelVersion = Literal["baseline", "lstm"]

VOLTAGE_MIN = 0.0
VOLTAGE_MAX = 10.0
DEFAULT_DATA_DIR = (
    Path(__file__).resolve().parents[1]
    / "Machine Learning"
    / "micro gas turbine electrical energy prediction dataset"
)
DEFAULT_MODEL_PATH = (
    Path(__file__).resolve().parents[1]
    / "Machine Learning"
    / "best_final_model_pipeline.joblib"
)


@dataclass(frozen=True)
class TelemetrySample:
    time_seconds: float
    input_voltage: float
    el_power: float


@dataclass(frozen=True)
class PredictionResult:
    predicted_power: float
    confidence_low: float
    confidence_high: float
    filtered_voltage: float
    uncertainty: float
    model_version: ModelVersion
    model_source: str
    latency_ms: float


def clamp(value: float, lower: float, upper: float) -> float:
    return min(max(value, lower), upper)


def assert_voltage(value: float) -> float:
    if not math.isfinite(value):
        raise ValueError("input_voltage must be a finite number")
    if value < VOLTAGE_MIN or value > VOLTAGE_MAX:
        raise ValueError(f"input_voltage must be between {VOLTAGE_MIN:g}V and {VOLTAGE_MAX:g}V")
    return value


class TelemetryDatasetRepository:
    """Loads canonical turbine playback experiments from disk with schema checks."""

    def __init__(self, data_dir: Path | None = None) -> None:
        self.data_dir = Path(os.getenv("AETHEL_DATA_DIR", data_dir or DEFAULT_DATA_DIR))
        self._cache: dict[str, list[TelemetrySample]] = {}

    @property
    def datasets(self) -> tuple[str, ...]:
        return ("ex_9", "ex_22")

    def _path_for(self, dataset: str) -> Path:
        if dataset == "ex_9":
            return self.data_dir / "train" / "ex_9.csv"
        if dataset == "ex_22":
            return self.data_dir / "test" / "ex_22.csv"
        raise ValueError(f"Unsupported dataset '{dataset}'. Use one of: {', '.join(self.datasets)}")

    def load(self, dataset: str) -> list[TelemetrySample]:
        if dataset in self._cache:
            return self._cache[dataset]

        path = self._path_for(dataset)
        if not path.exists():
            raise FileNotFoundError(f"Telemetry CSV not found at {path}")

        rows: list[TelemetrySample] = []
        with path.open("r", newline="", encoding="utf-8") as handle:
            reader = csv.DictReader(handle)
            expected = {"time", "input_voltage", "el_power"}
            if set(reader.fieldnames or []) < expected:
                raise ValueError(f"{path.name} must include columns: {', '.join(sorted(expected))}")

            for line_number, row in enumerate(reader, start=2):
                try:
                    time_seconds = float(row["time"])
                    input_voltage = assert_voltage(float(row["input_voltage"]))
                    el_power = max(float(row["el_power"]), 0.0)
                except (TypeError, ValueError) as exc:
                    raise ValueError(f"Invalid telemetry row {line_number} in {path.name}: {exc}") from exc
                rows.append(
                    TelemetrySample(
                        time_seconds=time_seconds,
                        input_voltage=input_voltage,
                        el_power=el_power,
                    )
                )

        if not rows:
            raise ValueError(f"{path.name} did not contain any telemetry rows")

        self._cache[dataset] = rows
        return rows


def _odd_window_size(sample_count: int, requested: int = 11) -> int:
    if sample_count < 5:
        return sample_count if sample_count % 2 == 1 else max(sample_count - 1, 1)
    candidate = min(requested, sample_count)
    if candidate % 2 == 0:
        candidate -= 1
    return max(candidate, 5)


def savitzky_golay(values: Sequence[float], requested_window: int = 11) -> list[float]:
    """Apply Savitzky-Golay smoothing with a deterministic fallback.

    The fallback keeps the service usable in lean containers where SciPy is not
    present, while production images can install SciPy for the exact filter.
    """

    if not values:
        return []

    numeric = [assert_voltage(float(value)) for value in values]
    if len(numeric) < 5:
        return numeric

    window = _odd_window_size(len(numeric), requested_window)
    polyorder = 2 if window >= 5 else 1

    if savgol_filter is not None:
        filtered = savgol_filter(numeric, window_length=window, polyorder=polyorder, mode="interp")
        return [float(value) for value in filtered]

    radius = max((window - 1) // 2, 1)
    smoothed: list[float] = []
    for index in range(len(numeric)):
        left = max(0, index - radius)
        right = min(len(numeric), index + radius + 1)
        smoothed.append(float(fmean(numeric[left:right])))
    return smoothed


def _standard_deviation(values: Sequence[float]) -> float:
    if len(values) < 2:
        return 0.0
    mean = fmean(values)
    variance = fmean([(value - mean) ** 2 for value in values])
    return math.sqrt(max(variance, 0.0))


class TurbineModelManager:
    """Production-facing model registry facade.

    The real deployment path would load model versions by alias from MLflow's
    model registry here, then cache model objects by version/stage.
    """

    def __init__(self, model_path: Path | None = None) -> None:
        self.model_path = Path(os.getenv("AETHEL_MODEL_PATH", model_path or DEFAULT_MODEL_PATH))
        self._external_model: Any | None = None
        self._external_error: str | None = None
        self._warned_external_failure = False
        self._load_external_model()

    def versions(self) -> dict[str, dict[str, str]]:
        return {
            "baseline": {
                "label": "Baseline Linear",
                "family": "filtered-linear-response",
                "source": "deterministic-stub",
            },
            "lstm": {
                "label": "Advanced LSTM",
                "family": "sequence-model",
                "source": "joblib-artifact" if self._external_model is not None else "deterministic-stub",
            },
        }

    def normalize_version(self, model_version: str) -> ModelVersion:
        normalized = model_version.strip().lower().replace("advanced_", "").replace("linear", "baseline")
        if normalized in {"baseline", "base"}:
            return "baseline"
        if normalized in {"lstm", "advanced", "sequence"}:
            return "lstm"
        raise ValueError("model_version must be either 'baseline' or 'lstm'")

    def predict(self, voltage_window: Sequence[float], model_version: str = "lstm") -> PredictionResult:
        start = time.perf_counter()
        version = self.normalize_version(model_version)
        filtered = savitzky_golay(voltage_window)
        if not filtered:
            raise ValueError("At least one input voltage sample is required")

        model_source = "deterministic-stub"
        if version == "baseline":
            predicted_power = self._baseline_predict(filtered)
        else:
            external_prediction = self._predict_with_external_model(filtered)
            if external_prediction is None:
                predicted_power = self._lstm_stub_predict(filtered)
            else:
                predicted_power = external_prediction
                model_source = "joblib-artifact"

        predicted_power = max(float(predicted_power), 0.0)
        uncertainty = self._estimate_uncertainty(voltage_window, filtered, version, model_source)
        confidence_low = max(predicted_power - 1.96 * uncertainty, 0.0)
        confidence_high = predicted_power + 1.96 * uncertainty

        # MLflow hook: log request_id, model_version, input window stats,
        # predicted_power, uncertainty, and latency as inference telemetry.
        latency_ms = (time.perf_counter() - start) * 1000.0

        return PredictionResult(
            predicted_power=predicted_power,
            confidence_low=confidence_low,
            confidence_high=confidence_high,
            filtered_voltage=float(filtered[-1]),
            uncertainty=uncertainty,
            model_version=version,
            model_source=model_source,
            latency_ms=latency_ms,
        )

    def _load_external_model(self) -> None:
        if joblib is None:
            self._external_error = "joblib is not installed"
            return
        if not self.model_path.exists():
            self._external_error = f"model artifact not found at {self.model_path}"
            return

        try:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                self._external_model = joblib.load(self.model_path)
        except Exception as exc:  # pragma: no cover - depends on local artifact
            self._external_model = None
            self._external_error = str(exc)

    def _predict_with_external_model(self, filtered: Sequence[float]) -> float | None:
        if self._external_model is None or not hasattr(self._external_model, "predict"):
            return None

        features = self._build_feature_payload(filtered)
        try:
            raw_prediction = self._external_model.predict(features)
            if np is not None:
                prediction = float(np.asarray(raw_prediction).reshape(-1)[0])
            else:
                prediction = float(raw_prediction[0])
            if math.isfinite(prediction) and prediction > 0:
                return prediction
        except Exception as exc:  # pragma: no cover - artifact schema is external
            if not self._warned_external_failure:
                warnings.warn(
                    f"Falling back to LSTM stub because artifact prediction failed: {exc}",
                    RuntimeWarning,
                    stacklevel=2,
                )
                self._warned_external_failure = True
        return None

    def _build_feature_payload(self, filtered: Sequence[float]) -> Any:
        last = float(filtered[-1])
        trailing = list(filtered[-min(len(filtered), 12) :])
        slope = last - float(filtered[-2]) if len(filtered) > 1 else 0.0
        features = {
            "time": float(len(filtered) - 1),
            "input_voltage": last,
            "voltage_mean_5": float(fmean(trailing[-5:])),
            "voltage_mean_12": float(fmean(trailing)),
            "voltage_std_12": _standard_deviation(trailing),
            "voltage_slope": slope,
            "voltage_lag_1": float(filtered[-2]) if len(filtered) > 1 else last,
            "voltage_lag_2": float(filtered[-3]) if len(filtered) > 2 else last,
        }
        if pd is not None:
            return pd.DataFrame([features])
        return [features]

    def _baseline_predict(self, filtered: Sequence[float]) -> float:
        voltage = float(filtered[-1])
        return 382.0 * voltage + 54.0

    def _lstm_stub_predict(self, filtered: Sequence[float]) -> float:
        alpha = 0.36
        ewma = float(filtered[0])
        for voltage in filtered[1:]:
            ewma = alpha * float(voltage) + (1.0 - alpha) * ewma

        current = float(filtered[-1])
        horizon = min(len(filtered), 9)
        momentum = current - float(filtered[-horizon])
        response_gain = 374.0 + 18.0 * math.tanh((current - 4.0) / 4.0)
        transient_boost = 128.0 * math.tanh(momentum * 1.8)
        return response_gain * ewma + 72.0 + transient_boost

    def _estimate_uncertainty(
        self,
        raw_window: Sequence[float],
        filtered: Sequence[float],
        version: ModelVersion,
        model_source: str,
    ) -> float:
        residuals = [float(raw) - float(smooth) for raw, smooth in zip(raw_window, filtered)]
        residual_std = _standard_deviation(residuals[-24:])
        slope = abs(float(filtered[-1]) - float(filtered[-2])) if len(filtered) > 1 else 0.0
        short_window_penalty = max(0.0, 16.0 - len(filtered)) * 4.5
        transition_penalty = min(slope, 1.5) * 95.0
        source_discount = 0.82 if model_source == "joblib-artifact" else 1.0
        base = 42.0 if version == "lstm" else 68.0
        return max((base + residual_std * 150.0 + transition_penalty + short_window_penalty) * source_discount, 18.0)

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Sequence

import numpy as np
import pandas as pd

from .config import PHASE_DELTA_THRESHOLD, REPORTS_DIR
from .experiment_registry import ExperimentRegistry, TEST_EXPERIMENTS
from .ml.model_service import ModelName, ModelService, classify_phases, normalize_model_name


@dataclass(frozen=True)
class Metrics:
    mae: float
    rmse: float
    r2: float | None
    mape: float | None
    peak_absolute_error: float
    latency_ms: float
    stationary_rmse: float | None
    rising_transition_rmse: float | None
    falling_transition_rmse: float | None


class ResultsService:
    def __init__(
        self,
        registry: ExperimentRegistry,
        model_service: ModelService,
        reports_dir: Path | None = None,
    ) -> None:
        self.registry = registry
        self.model_service = model_service
        self.reports_dir = Path(reports_dir or REPORTS_DIR)
        self._prediction_cache: dict[tuple[str, ModelName, str, bool], dict[str, Any]] = {}

    def predictions(
        self,
        experiment_id: str,
        model_name: str = "lstm",
        filter_mode: str = "none",
        pad_initial: bool = True,
    ) -> dict[str, Any]:
        model = normalize_model_name(model_name)
        cache_key = (experiment_id, model, filter_mode, pad_initial)
        if cache_key not in self._prediction_cache:
            frame = self.registry.load_frame(experiment_id)
            self._prediction_cache[cache_key] = self.model_service.predict_sequence(
                frame=frame,
                model_name=model,
                experiment_id=experiment_id,
                filter_mode=filter_mode,
                pad_initial=pad_initial,
            )
        return self._prediction_cache[cache_key]

    def residuals(self, experiment_id: str, model_name: str = "lstm", filter_mode: str = "none") -> dict[str, Any]:
        payload = self.predictions(experiment_id, model_name, filter_mode, pad_initial=True)
        points = [
            {
                "sample": index,
                "timestamp": point["timestamp"],
                "predicted_power_kw": point["predicted_power_kw"],
                "residual": point["residual"],
                "phase": point["phase"],
            }
            for index, point in enumerate(payload["points"])
            if point["residual"] is not None
        ]
        return {"experiment_id": experiment_id, "model": normalize_model_name(model_name), "points": points}

    def phase_metrics(self, experiment_id: str, model_name: str = "lstm", filter_mode: str = "none") -> dict[str, Any]:
        payload = self.predictions(experiment_id, model_name, filter_mode, pad_initial=True)
        rows = phase_metrics_from_points(payload["points"])
        return {
            "experiment_id": experiment_id,
            "model": normalize_model_name(model_name),
            "threshold": PHASE_DELTA_THRESHOLD,
            "phases": rows,
        }

    def summary(self) -> dict[str, Any]:
        metrics_by_experiment: dict[str, dict[str, Any]] = {}
        overall_rows: list[dict[str, Any]] = []
        for experiment_id in TEST_EXPERIMENTS:
            metrics_by_experiment[experiment_id] = {}
            for model in ("baseline", "lstm"):
                points = self._aligned_points_for_metrics(experiment_id, model)
                metrics = compute_metrics(points)
                metrics_by_experiment[experiment_id][model] = metrics.__dict__
                overall_rows.extend([{**point, "experiment_id": experiment_id, "model": model} for point in points])

        overall: dict[str, Any] = {}
        for model in ("baseline", "lstm"):
            overall[model] = compute_metrics([point for point in overall_rows if point["model"] == model]).__dict__

        return {
            "experiments": metrics_by_experiment,
            "overall": overall,
            "generated_from": "backend_real_model_predictions",
        }

    def feature_importance(self, model_name: str = "lstm") -> dict[str, Any]:
        model = normalize_model_name(model_name)
        if model == "baseline":
            coefficient = abs(self.model_service.baseline.coefficient_w_per_v)
            return {
                "available": True,
                "method": "linear_regression_coefficient",
                "model": model,
                "items": [
                    {
                        "feature": "input_voltage",
                        "importance": 1.0,
                        "raw_value": coefficient,
                        "unit": "abs(watts_per_volt)",
                    }
                ],
            }

        return {
            "available": False,
            "model": model,
            "reason": "Feature importance is not available for the current LSTM without a sequence attribution method.",
            "items": [],
        }

    def cross_correlation(self, experiment_id: str, model_name: str = "lstm", filter_mode: str = "none") -> dict[str, Any]:
        payload = self.predictions(experiment_id, model_name, filter_mode, pad_initial=True)
        points = payload["points"]
        timestamps = np.asarray([point["timestamp"] for point in points], dtype=float)
        voltage = np.asarray([point["input_voltage"] for point in points], dtype=float)
        predicted = np.asarray([point["predicted_power_kw"] for point in points], dtype=float)
        truth = np.asarray(
            [np.nan if point["ground_truth_power_kw"] is None else point["ground_truth_power_kw"] for point in points],
            dtype=float,
        )
        residual = np.asarray([np.nan if point["residual"] is None else point["residual"] for point in points], dtype=float)
        median_dt = float(np.nanmedian(np.diff(timestamps))) if len(timestamps) > 1 else 1.0
        if not math.isfinite(median_dt) or median_dt <= 0:
            median_dt = 1.0
        lags = [0, 1, 2, 3, 4, 5]
        rows = [
            {"label": "Voltage vs Ground Truth", "values": [_lagged_corr(voltage, truth, lag, median_dt) for lag in lags]},
            {"label": "Voltage vs Predicted", "values": [_lagged_corr(voltage, predicted, lag, median_dt) for lag in lags]},
            {"label": "Voltage vs Residual", "values": [_lagged_corr(voltage, residual, lag, median_dt) for lag in lags]},
            {"label": "Predicted vs Ground Truth", "values": [_lagged_corr(predicted, truth, lag, median_dt) for lag in lags]},
        ]
        return {
            "experiment_id": experiment_id,
            "model": normalize_model_name(model_name),
            "lag_unit": "seconds",
            "median_dt_seconds": median_dt,
            "lags": lags,
            "rows": rows,
        }

    def response_characteristics(
        self,
        experiment_id: str,
        model_name: str = "lstm",
        filter_mode: str = "none",
    ) -> dict[str, Any]:
        payload = self.predictions(experiment_id, model_name, filter_mode, pad_initial=True)
        points = payload["points"]
        characteristics = calculate_response_characteristics(points)
        return {
            "experiment_id": experiment_id,
            "model": normalize_model_name(model_name),
            "available": len(characteristics) > 0,
            "reason": None if characteristics else "No clear step response was detected.",
            "steps": characteristics,
        }

    def generate_reports(self) -> dict[str, Path]:
        self.reports_dir.mkdir(parents=True, exist_ok=True)
        written: dict[str, Path] = {}
        summary = self.summary()
        written["metrics_summary"] = _write_json(self.reports_dir / "metrics_summary.json", summary)

        phase_payload: dict[str, Any] = {}
        cross_payload: dict[str, Any] = {}
        response_payload: dict[str, Any] = {}

        for experiment_id in TEST_EXPERIMENTS:
            phase_payload[experiment_id] = {}
            cross_payload[experiment_id] = {}
            response_payload[experiment_id] = {}
            for model in ("baseline", "lstm"):
                payload = self.predictions(experiment_id, model, pad_initial=False)
                predictions_frame = pd.DataFrame(payload["points"])
                prediction_path = self.reports_dir / f"predictions_{experiment_id}_{model}.csv"
                predictions_frame.to_csv(prediction_path, index=False)
                written[f"predictions_{experiment_id}_{model}"] = prediction_path

                residual_path = self.reports_dir / f"residuals_{experiment_id}_{model}.csv"
                predictions_frame[
                    [
                        "timestamp",
                        "experiment_id",
                        "input_voltage",
                        "ground_truth_power_kw",
                        "predicted_power_kw",
                        "residual",
                        "phase",
                        "alert_status",
                    ]
                ].to_csv(residual_path, index=False)
                written[f"residuals_{experiment_id}_{model}"] = residual_path

                phase_payload[experiment_id][model] = self.phase_metrics(experiment_id, model)
                cross_payload[experiment_id][model] = self.cross_correlation(experiment_id, model)
                response_payload[experiment_id][model] = self.response_characteristics(experiment_id, model)

        written["phase_metrics"] = _write_json(self.reports_dir / "phase_metrics.json", phase_payload)
        written["feature_importance"] = _write_json(
            self.reports_dir / "feature_importance.json",
            {"baseline": self.feature_importance("baseline"), "lstm": self.feature_importance("lstm")},
        )
        written["cross_correlation"] = _write_json(self.reports_dir / "cross_correlation.json", cross_payload)
        written["response_characteristics"] = _write_json(
            self.reports_dir / "response_characteristics.json",
            response_payload,
        )
        return written

    def _aligned_points_for_metrics(self, experiment_id: str, model: str) -> list[dict[str, Any]]:
        payload = self.predictions(experiment_id, model, pad_initial=True)
        points = list(payload["points"])
        lookback = 1
        lstm_model = self.model_service.load_model("lstm")
        if hasattr(lstm_model, "lookback_steps"):
            lookback = int(lstm_model.lookback_steps)
        return points[lookback - 1 :]


def compute_metrics(points: Sequence[dict[str, Any]]) -> Metrics:
    actual = np.asarray([point["ground_truth_power_kw"] for point in points if point["ground_truth_power_kw"] is not None], dtype=float)
    predicted = np.asarray([point["predicted_power_kw"] for point in points if point["ground_truth_power_kw"] is not None], dtype=float)
    if actual.size == 0:
        return Metrics(
            mae=0.0,
            rmse=0.0,
            r2=None,
            mape=None,
            peak_absolute_error=0.0,
            latency_ms=0.0,
            stationary_rmse=None,
            rising_transition_rmse=None,
            falling_transition_rmse=None,
        )
    residual = actual - predicted
    mae = float(np.mean(np.abs(residual)))
    rmse = float(np.sqrt(np.mean(np.square(residual))))
    total = float(np.sum(np.square(actual - np.mean(actual))))
    r2 = None if total <= 0 else float(1.0 - np.sum(np.square(residual)) / total)
    safe = np.abs(actual) > 1e-9
    mape = float(np.mean(np.abs(residual[safe] / actual[safe])) * 100.0) if safe.any() else None
    peak = float(np.max(np.abs(residual)))
    latency = float(np.mean([point["latency_ms"] for point in points])) if points else 0.0
    phase_rows = phase_metrics_from_points(points)
    phase_lookup = {row["phase"]: row for row in phase_rows}
    return Metrics(
        mae=mae,
        rmse=rmse,
        r2=r2,
        mape=mape,
        peak_absolute_error=peak,
        latency_ms=latency,
        stationary_rmse=_phase_value(phase_lookup, "steady_state", "rmse"),
        rising_transition_rmse=_phase_value(phase_lookup, "rising_transition", "rmse"),
        falling_transition_rmse=_phase_value(phase_lookup, "falling_transition", "rmse"),
    )


def phase_metrics_from_points(points: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for phase in ("steady_state", "rising_transition", "falling_transition"):
        residuals = np.asarray(
            [
                point["residual"]
                for point in points
                if point.get("phase") == phase and point.get("residual") is not None
            ],
            dtype=float,
        )
        if residuals.size:
            rows.append(
                {
                    "phase": phase,
                    "rmse": float(np.sqrt(np.mean(np.square(residuals)))),
                    "mae": float(np.mean(np.abs(residuals))),
                    "count": int(residuals.size),
                }
            )
        else:
            rows.append({"phase": phase, "rmse": None, "mae": None, "count": 0})
    return rows


def _phase_value(phase_lookup: dict[str, dict[str, Any]], phase: str, key: str) -> float | None:
    value = phase_lookup.get(phase, {}).get(key)
    return float(value) if value is not None else None


def _lagged_corr(left: np.ndarray, right: np.ndarray, lag_seconds: int, median_dt_seconds: float) -> float | None:
    offset = int(round(lag_seconds / median_dt_seconds))
    if offset <= 0:
        a = left
        b = right
    else:
        if len(left) <= offset:
            return None
        a = left[:-offset]
        b = right[offset:]
    mask = np.isfinite(a) & np.isfinite(b)
    if int(mask.sum()) < 3:
        return None
    a = a[mask]
    b = b[mask]
    if np.std(a) <= 1e-12 or np.std(b) <= 1e-12:
        return None
    return float(np.corrcoef(a, b)[0, 1])


def calculate_response_characteristics(points: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    if len(points) < 12:
        return []
    times = np.asarray([point["timestamp"] for point in points], dtype=float)
    voltage = np.asarray([point["input_voltage"] for point in points], dtype=float)
    predicted = np.asarray([point["predicted_power_kw"] for point in points], dtype=float)
    actual = np.asarray(
        [np.nan if point["ground_truth_power_kw"] is None else point["ground_truth_power_kw"] for point in points],
        dtype=float,
    )
    deltas = np.diff(voltage, prepend=voltage[0])
    step_threshold = max(0.5, PHASE_DELTA_THRESHOLD * 10)
    candidates = [index for index, delta in enumerate(deltas) if abs(delta) >= step_threshold]
    results: list[dict[str, Any]] = []
    for candidate in candidates[:8]:
        next_candidates = [index for index in candidates if index > candidate + 5]
        end = min(next_candidates[0] if next_candidates else candidate + 120, len(points))
        if end - candidate < 8:
            continue
        actual_characteristics = _characteristics_for_signal(times, actual, candidate, end)
        predicted_characteristics = _characteristics_for_signal(times, predicted, candidate, end)
        if actual_characteristics is None and predicted_characteristics is None:
            continue
        results.append(
            {
                "step_time": float(times[candidate]),
                "from_voltage": float(voltage[candidate - 1] if candidate > 0 else voltage[candidate]),
                "to_voltage": float(voltage[candidate]),
                "actual": actual_characteristics,
                "predicted": predicted_characteristics,
            }
        )
    return results


def _characteristics_for_signal(times: np.ndarray, signal: np.ndarray, start: int, end: int) -> dict[str, float | None] | None:
    window = signal[start:end]
    if window.size < 8 or not np.isfinite(window).any():
        return None
    previous_start = max(0, start - 8)
    previous = signal[previous_start:start]
    if previous.size == 0 or not np.isfinite(previous).any():
        initial = float(window[0])
    else:
        initial = float(np.nanmedian(previous))
    final = float(np.nanmedian(window[-max(5, min(12, window.size // 4)) :]))
    delta = final - initial
    if not math.isfinite(delta) or abs(delta) < 0.03:
        return None
    direction = 1.0 if delta >= 0 else -1.0
    ten = initial + delta * 0.1
    ninety = initial + delta * 0.9
    t10 = _first_crossing_time(times[start:end], window, ten, direction)
    t90 = _first_crossing_time(times[start:end], window, ninety, direction)
    rise_time = None if t10 is None or t90 is None else max(float(t90 - t10), 0.0)
    settling_time = _settling_time(times[start:end], window, final, abs(delta), tolerance=0.05)
    peak_response = float(np.nanmax(window) if direction > 0 else np.nanmin(window))
    overshoot = max((peak_response - final) * direction / abs(delta) * 100.0, 0.0)
    return {
        "rise_time_seconds": rise_time,
        "settling_time_seconds": settling_time,
        "overshoot_percent": float(overshoot),
        "peak_response_kw": peak_response,
        "final_steady_state_kw": final,
    }


def _first_crossing_time(times: np.ndarray, signal: np.ndarray, threshold: float, direction: float) -> float | None:
    for time_value, value in zip(times, signal):
        if not math.isfinite(float(value)):
            continue
        if (direction > 0 and value >= threshold) or (direction < 0 and value <= threshold):
            return float(time_value)
    return None


def _settling_time(times: np.ndarray, signal: np.ndarray, final: float, delta_abs: float, tolerance: float) -> float | None:
    band = max(delta_abs * tolerance, 0.01)
    for index, value in enumerate(signal):
        tail = signal[index:]
        finite = tail[np.isfinite(tail)]
        if finite.size == 0:
            continue
        if np.all(np.abs(finite - final) <= band):
            return float(times[index] - times[0])
    return None


def _write_json(path: Path, payload: Any) -> Path:
    path.write_text(json.dumps(payload, indent=2, allow_nan=False), encoding="utf-8")
    return path


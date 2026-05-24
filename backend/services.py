from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Sequence

from app.config import VOLTAGE_MAX, VOLTAGE_MIN
from app.experiment_registry import ExperimentRegistry
from app.ml.model_service import ModelService, assert_voltage, kw_to_watts, model_service_to_legacy_payload


@dataclass(frozen=True)
class TelemetrySample:
    time_seconds: float
    input_voltage: float
    el_power: float


class TelemetryDatasetRepository:
    """Compatibility adapter backed by the real experiment registry."""

    def __init__(self, data_dir: Path | None = None) -> None:
        self.registry = ExperimentRegistry(data_dir)

    @property
    def datasets(self) -> tuple[str, ...]:
        return tuple(experiment.experiment_id for experiment in self.registry.list(include_unknown=True))

    def load(self, dataset: str) -> list[TelemetrySample]:
        frame = self.registry.load_frame(dataset)
        return [
            TelemetrySample(
                time_seconds=float(row["time"] if "time" in frame.columns else index),
                input_voltage=float(row["input_voltage"]),
                el_power=float(row["el_power"] if "el_power" in frame.columns else 0.0),
            )
            for index, row in frame.iterrows()
        ]


class TurbineModelManager:
    """Compatibility adapter for older imports; delegates to the real model service."""

    def __init__(self, model_path: Path | None = None) -> None:
        self.service = ModelService()

    def versions(self) -> dict[str, dict[str, Any]]:
        return {str(model["id"]): model for model in self.service.get_available_models()}

    def normalize_version(self, model_version: str) -> str:
        from app.ml.model_service import normalize_model_name

        return normalize_model_name(model_version)

    def predict(self, voltage_window: Sequence[float], model_version: str = "lstm") -> Any:
        prediction = self.service.predict_single(samples=voltage_window, model_name=model_version)
        payload = model_service_to_legacy_payload(prediction)
        return type(
            "PredictionResult",
            (),
            {
                "predicted_power": payload["predicted_power"],
                "confidence_low": payload["confidence_low"],
                "confidence_high": payload["confidence_high"],
                "filtered_voltage": payload["filtered_voltage"],
                "uncertainty": payload["uncertainty"],
                "model_version": payload["model_version"],
                "model_source": payload["model_source"],
                "latency_ms": payload["latency_ms"],
            },
        )()


__all__ = [
    "TelemetryDatasetRepository",
    "TelemetrySample",
    "TurbineModelManager",
    "VOLTAGE_MIN",
    "VOLTAGE_MAX",
    "assert_voltage",
    "kw_to_watts",
]


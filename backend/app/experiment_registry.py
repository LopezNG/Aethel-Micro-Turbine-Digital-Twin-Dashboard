from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal, cast

import numpy as np
import pandas as pd

from .config import DATA_DIR


ExperimentSplit = Literal["train", "test"]
ExperimentMode = Literal["rectangular", "continuous", "unknown"]

TRAIN_EXPERIMENTS = ("ex_1", "ex_9", "ex_20", "ex_21", "ex_23", "ex_24")
TEST_EXPERIMENTS = ("ex_4", "ex_22")
ALL_EXPERIMENTS = TRAIN_EXPERIMENTS + TEST_EXPERIMENTS
METADATA_PATH = Path(__file__).with_name("experiment_metadata.json")


@dataclass(frozen=True)
class ExperimentMetadata:
    experiment_id: str
    path: str
    split: ExperimentSplit
    mode: ExperimentMode
    mode_source: str
    description: str
    notes: str | None
    sample_count: int
    available_columns: list[str]
    voltage_column: str
    power_column: str | None
    time_column: str | None
    duration_seconds: float | None
    median_dt_seconds: float | None

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


class ExperimentRegistry:
    """Discovers and describes the canonical turbine experiments on disk."""

    def __init__(self, data_dir: Path | None = None) -> None:
        self.data_dir = Path(data_dir or DATA_DIR)

    def list(
        self,
        split: ExperimentSplit | None = None,
        mode: ExperimentMode | None = None,
        include_unknown: bool = False,
    ) -> list[ExperimentMetadata]:
        experiments = [self.get(experiment_id) for experiment_id in ALL_EXPERIMENTS]
        if split is not None:
            experiments = [experiment for experiment in experiments if experiment.split == split]
        if mode is not None:
            experiments = [experiment for experiment in experiments if experiment.mode == mode]
        elif not include_unknown:
            experiments = [experiment for experiment in experiments if experiment.mode != "unknown"]
        return experiments

    def get(self, experiment_id: str) -> ExperimentMetadata:
        normalized = normalize_experiment_id(experiment_id)
        return _metadata_for(self.data_dir, normalized)

    def load_frame(self, experiment_id: str) -> pd.DataFrame:
        metadata = self.get(experiment_id)
        path = Path(metadata.path)
        if not path.exists():
            raise FileNotFoundError(f"Experiment CSV not found at {path}")
        frame = pd.read_csv(path)
        validate_experiment_frame(frame, path.name)
        return frame


def normalize_experiment_id(experiment_id: str) -> str:
    normalized = experiment_id.strip().lower()
    if normalized not in ALL_EXPERIMENTS:
        raise ValueError(f"Unsupported experiment_id '{experiment_id}'. Use one of: {', '.join(ALL_EXPERIMENTS)}")
    return normalized


def validate_experiment_frame(frame: pd.DataFrame, label: str = "sequence") -> None:
    required = {"input_voltage"}
    missing = sorted(required - set(frame.columns))
    if missing:
        raise ValueError(f"{label} is missing required columns: {', '.join(missing)}")
    if frame["input_voltage"].isna().any():
        raise ValueError(f"{label} contains empty input_voltage values")


@lru_cache(maxsize=16)
def _metadata_for(data_dir: Path, experiment_id: str) -> ExperimentMetadata:
    manual_metadata = _manual_metadata_for(experiment_id)
    split: ExperimentSplit = manual_metadata["split"] if manual_metadata else "train" if experiment_id in TRAIN_EXPERIMENTS else "test"
    path = data_dir / split / f"{experiment_id}.csv"
    if not path.exists():
        raise FileNotFoundError(f"Experiment CSV not found at {path}")

    frame = pd.read_csv(path)
    validate_experiment_frame(frame, path.name)

    columns = list(frame.columns)
    voltage_column = "input_voltage"
    power_column = _first_present(columns, ("el_power", "power", "electrical_power"))
    time_column = _first_present(columns, ("time", "timestamp"))
    duration_seconds: float | None = None
    median_dt_seconds: float | None = None

    if time_column is not None and len(frame) >= 2:
        times = pd.to_numeric(frame[time_column], errors="coerce")
        if times.notna().all():
            duration_seconds = float(times.iloc[-1] - times.iloc[0])
            deltas = times.diff().dropna()
            if not deltas.empty:
                median_dt_seconds = float(deltas.median())

    if manual_metadata is not None:
        mode = manual_metadata["mode"]
        mode_source = "experiment_metadata.json"
        description = manual_metadata["description"]
        notes = manual_metadata.get("notes")
    else:
        mode, fallback_source = infer_mode(frame[voltage_column])
        mode_source = f"fallback_voltage_pattern: {fallback_source}"
        description = f"{split.title()} experiment {experiment_id}"
        notes = "No manual metadata entry was found; mode was inferred from the voltage profile."

    return ExperimentMetadata(
        experiment_id=experiment_id,
        path=str(path),
        split=split,
        mode=mode,
        mode_source=mode_source,
        description=description,
        notes=notes,
        sample_count=int(len(frame)),
        available_columns=columns,
        voltage_column=voltage_column,
        power_column=power_column,
        time_column=time_column,
        duration_seconds=duration_seconds,
        median_dt_seconds=median_dt_seconds,
    )


def _first_present(columns: list[str], candidates: tuple[str, ...]) -> str | None:
    for candidate in candidates:
        if candidate in columns:
            return candidate
    return None


def _manual_metadata_for(experiment_id: str) -> dict[str, Any] | None:
    metadata = _load_manual_metadata()
    return metadata.get(experiment_id)


@lru_cache(maxsize=1)
def _load_manual_metadata(metadata_path: Path = METADATA_PATH) -> dict[str, dict[str, Any]]:
    if not metadata_path.exists():
        return {}

    raw = json.loads(metadata_path.read_text(encoding="utf-8"))
    experiments = raw.get("experiments")
    if not isinstance(experiments, dict):
        raise ValueError(f"{metadata_path} must contain an 'experiments' object")

    normalized: dict[str, dict[str, Any]] = {}
    for experiment_id, payload in experiments.items():
        normalized_id = normalize_experiment_id(str(experiment_id))
        if not isinstance(payload, dict):
            raise ValueError(f"Metadata for {normalized_id} must be an object")

        split = payload.get("split")
        mode = payload.get("mode")
        description = payload.get("description")
        notes = payload.get("notes")

        if split not in {"train", "test"}:
            raise ValueError(f"Metadata for {normalized_id} has invalid split: {split!r}")
        if mode not in {"rectangular", "continuous", "unknown"}:
            raise ValueError(f"Metadata for {normalized_id} has invalid mode: {mode!r}")
        if not isinstance(description, str) or not description.strip():
            raise ValueError(f"Metadata for {normalized_id} must include a non-empty description")
        if notes is not None and not isinstance(notes, str):
            raise ValueError(f"Metadata notes for {normalized_id} must be a string or null")

        expected_split = "train" if normalized_id in TRAIN_EXPERIMENTS else "test"
        if split != expected_split:
            raise ValueError(
                f"Metadata for {normalized_id} declares split {split!r}, expected {expected_split!r}"
            )

        normalized[normalized_id] = {
            "split": cast(ExperimentSplit, split),
            "mode": cast(ExperimentMode, mode),
            "description": description.strip(),
            "notes": notes.strip() if isinstance(notes, str) and notes.strip() else None,
        }

    return normalized


def infer_mode(voltage: pd.Series) -> tuple[ExperimentMode, str]:
    numeric = pd.to_numeric(voltage, errors="coerce").dropna()
    if numeric.empty:
        return "unknown", "input_voltage column has no numeric samples"

    unique_count = int(numeric.round(3).nunique())
    changes = numeric.diff().abs().fillna(0)
    step_changes = int((changes > 0.05).sum())
    large_step_ratio = float((changes[changes > 0.05] >= 0.25).mean()) if step_changes else 0.0

    if unique_count <= 12 and step_changes <= max(20, unique_count * 3) and large_step_ratio >= 0.75:
        return "rectangular", "inferred from a small set of repeated voltage levels and step changes"
    if unique_count >= 16 or step_changes > 40:
        return "continuous", "inferred from many voltage levels or frequent voltage changes"
    return "unknown", "mode is not explicitly stored and the voltage profile is ambiguous"


def frame_duration_seconds(frame: pd.DataFrame, time_column: str | None = "time") -> float | None:
    if time_column is None or time_column not in frame.columns or len(frame) < 2:
        return None
    times = pd.to_numeric(frame[time_column], errors="coerce")
    if not np.isfinite(times).all():
        return None
    return float(times.iloc[-1] - times.iloc[0])

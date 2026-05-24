from __future__ import annotations

from dataclasses import asdict, dataclass
from functools import lru_cache
from pathlib import Path
from typing import Literal

import numpy as np
import pandas as pd

from .config import DATA_DIR


ExperimentSplit = Literal["train", "test"]
ExperimentMode = Literal["rectangular", "continuous", "unknown"]

TRAIN_EXPERIMENTS = ("ex_1", "ex_9", "ex_20", "ex_21", "ex_23", "ex_24")
TEST_EXPERIMENTS = ("ex_4", "ex_22")
ALL_EXPERIMENTS = TRAIN_EXPERIMENTS + TEST_EXPERIMENTS


@dataclass(frozen=True)
class ExperimentMetadata:
    experiment_id: str
    path: str
    split: ExperimentSplit
    mode: ExperimentMode
    mode_source: str
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
    split: ExperimentSplit = "train" if experiment_id in TRAIN_EXPERIMENTS else "test"
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

    mode, mode_source = infer_mode(frame[voltage_column])

    return ExperimentMetadata(
        experiment_id=experiment_id,
        path=str(path),
        split=split,
        mode=mode,
        mode_source=mode_source,
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


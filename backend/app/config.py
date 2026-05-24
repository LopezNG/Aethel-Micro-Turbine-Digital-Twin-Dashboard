from __future__ import annotations

import os
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]
PROJECT_ROOT = BACKEND_DIR.parent
ML_ROOT = PROJECT_ROOT / "Machine Learning"

DEFAULT_DATA_DIR = ML_ROOT / "micro gas turbine electrical energy prediction dataset"
DEFAULT_LSTM_DIR = ML_ROOT / "artifacts" / "lstm"
DEFAULT_REPORTS_DIR = PROJECT_ROOT / "reports"

DATA_DIR = Path(os.getenv("AETHEL_DATA_DIR", DEFAULT_DATA_DIR))
LSTM_ARTIFACT_DIR = Path(os.getenv("AETHEL_LSTM_ARTIFACT_DIR", DEFAULT_LSTM_DIR))
REPORTS_DIR = Path(os.getenv("AETHEL_REPORTS_DIR", DEFAULT_REPORTS_DIR))

VOLTAGE_MIN = float(os.getenv("AETHEL_VOLTAGE_MIN", "0"))
VOLTAGE_MAX = float(os.getenv("AETHEL_VOLTAGE_MAX", "10"))
PHASE_DELTA_THRESHOLD = float(os.getenv("AETHEL_PHASE_DELTA_THRESHOLD", "0.05"))
MAINTENANCE_CONSECUTIVE_SAMPLES = int(os.getenv("AETHEL_MAINTENANCE_CONSECUTIVE_SAMPLES", "5"))


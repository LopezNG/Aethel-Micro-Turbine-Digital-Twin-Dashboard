from __future__ import annotations

import json
import math
import os
import sys
from pathlib import Path
from typing import Any


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.experiment_registry import ExperimentRegistry
from app.ml.model_service import ModelService
from app.results_service import ResultsService


def main() -> None:
    registry = ExperimentRegistry()
    model_service = ModelService(registry)
    results_service = ResultsService(registry, model_service)
    written = results_service.generate_reports()
    tracking_uri = log_mlflow_runs(registry, results_service, written)
    print("Generated evaluation reports:")
    for name, path in sorted(written.items()):
        print(f"- {name}: {path}")
    if tracking_uri is not None:
        print(f"Logged MLflow evaluation runs to: {tracking_uri}")


def log_mlflow_runs(
    registry: ExperimentRegistry,
    results_service: ResultsService,
    written: dict[str, Path],
) -> str | None:
    try:
        import mlflow
    except ModuleNotFoundError:
        print("MLflow logging skipped: install backend requirements so the 'mlflow' package is available.")
        return None

    tracking_uri = os.getenv("MLFLOW_TRACKING_URI")
    if not tracking_uri:
        tracking_dir = BACKEND_DIR.parent / "mlruns"
        tracking_dir.mkdir(parents=True, exist_ok=True)
        tracking_uri = tracking_dir.resolve().as_uri()

    mlflow.set_tracking_uri(tracking_uri)
    mlflow.set_experiment(os.getenv("MLFLOW_EXPERIMENT_NAME", "aethel_model_evaluation"))

    summary = results_service.summary()
    phase_metrics = _read_json(written["phase_metrics"])
    common_artifacts = [
        written["metrics_summary"],
        written["phase_metrics"],
        written["cross_correlation"],
        written["response_characteristics"],
    ]

    for experiment_id, models in summary["experiments"].items():
        metadata = registry.get(experiment_id)
        for model_name, metrics in models.items():
            run_name = f"{experiment_id}_{model_name}"
            with mlflow.start_run(run_name=run_name):
                mlflow.set_tags(
                    {
                        "aethel.model": model_name,
                        "aethel.experiment_id": experiment_id,
                        "aethel.split": metadata.split,
                        "aethel.mode": metadata.mode,
                    }
                )
                mlflow.log_params(
                    {
                        "model_name": model_name,
                        "experiment_id": experiment_id,
                        "split": metadata.split,
                        "mode": metadata.mode,
                    }
                )
                _log_metric_if_number(mlflow, "mae", metrics.get("mae"))
                _log_metric_if_number(mlflow, "rmse", metrics.get("rmse"))
                _log_metric_if_number(mlflow, "r2", metrics.get("r2"))
                _log_metric_if_number(mlflow, "peak_absolute_error", metrics.get("peak_absolute_error"))
                _log_metric_if_number(mlflow, "latency_ms", metrics.get("latency_ms"))
                _log_metric_if_number(mlflow, "mape", metrics.get("mape"))

                for phase_row in phase_metrics.get(experiment_id, {}).get(model_name, {}).get("phases", []):
                    phase = str(phase_row.get("phase", "unknown"))
                    _log_metric_if_number(mlflow, f"phase_{phase}_rmse", phase_row.get("rmse"))
                    _log_metric_if_number(mlflow, f"phase_{phase}_mae", phase_row.get("mae"))
                    _log_metric_if_number(mlflow, f"phase_{phase}_count", phase_row.get("count"))

                for artifact_path in common_artifacts:
                    mlflow.log_artifact(str(artifact_path), artifact_path="reports")
                for artifact_key in (
                    f"predictions_{experiment_id}_{model_name}",
                    f"residuals_{experiment_id}_{model_name}",
                ):
                    if artifact_key in written:
                        mlflow.log_artifact(str(written[artifact_key]), artifact_path="reports")

    return tracking_uri


def _read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _log_metric_if_number(mlflow: Any, key: str, value: Any) -> None:
    if isinstance(value, (int, float)) and math.isfinite(float(value)):
        mlflow.log_metric(key, float(value))


if __name__ == "__main__":
    main()

from __future__ import annotations

import sys
from pathlib import Path


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
    print("Generated evaluation reports:")
    for name, path in sorted(written.items()):
        print(f"- {name}: {path}")


if __name__ == "__main__":
    main()


# Aethel: Micro-Turbine Digital Twin Dashboard

## Overview

Aethel is a full-stack digital twin dashboard for micro gas turbine electrical power prediction. The app streams experiment playback over WebSockets, predicts electrical power from input voltage sequences, compares a real PyTorch LSTM regression model against an honest linear-regression baseline, and exposes backend-generated validation reports to the React UI.

## Features

- FastAPI backend with REST and WebSocket APIs
- React/Vite frontend with dashboard, virtual lab, and results views
- Real LSTM regression inference from `Machine Learning/artifacts/lstm`
- Baseline comparison trained from the registered training experiments
- Experiment registry for all 8 CSV experiments using `backend/app/experiment_metadata.json`
- Live experiment playback with selectable model and signal filtering
- Raw, voltage-filtered, power-filtered, and voltage+power-filtered modes
- Split conformal LSTM prediction bands with residual-based fallback when calibration data is unavailable
- Phase-aware metrics for steady, rising, and falling regimes
- Temporal-occlusion LSTM explainability, residual audit, cross-correlation heatmap, and response-characteristic cards
- MLflow evaluation run tracking and artifact logging
- Custom CSV voltage sequence upload and prediction
- Docker Compose setup for backend, frontend, and optional local MLflow tracking

## Tech Stack

- Backend: FastAPI, Pydantic, pandas, NumPy, SciPy, scikit-learn, PyTorch
- Frontend: React, TypeScript, Vite, Recharts, Tailwind CSS, lucide-react
- Runtime: Docker Compose, WebSockets
- ML artifacts: PyTorch checkpoint plus joblib feature/target scalers

## Architecture

The backend is the source of truth for ML behavior:

- `backend/app/experiment_registry.py` discovers experiment CSVs and applies manual metadata from `backend/app/experiment_metadata.json`.
- `backend/app/ml/model_service.py` loads the real LSTM, trains the baseline, applies optional filtering, predicts power, returns conformal or fallback uncertainty bands, and computes temporal occlusion attribution.
- `backend/app/results_service.py` computes metrics, residuals, phase metrics, cross-correlation, explainability payloads, and response characteristics.
- `backend/app/main.py` exposes REST endpoints, CSV upload, and `/ws/live`.

The frontend fetches backend data for Results and Virtual Lab views. Mock ML fixtures have been removed.

## Dataset / Experiments

Registered experiments:

- Train: `ex_1`, `ex_9`, `ex_20`, `ex_21`, `ex_23`, `ex_24`
- Test: `ex_4`, `ex_22`

Each experiment is registered with split, explicit manual mode, description, sample count, columns, voltage column, power column, and duration when timestamps are available. Mode labels are defined in `backend/app/experiment_metadata.json`; voltage-pattern inference remains only as a fallback for future experiments missing metadata.

## ML Pipeline

The LSTM artifact is loaded from:

```text
Machine Learning/artifacts/lstm/aethel_lstm_el_power.pth
Machine Learning/artifacts/lstm/feature_scaler.joblib
Machine Learning/artifacts/lstm/target_scaler.joblib
Machine Learning/artifacts/lstm/deployment_config.json
```

The checkpoint defines a 30-step lookback, `input_voltage` as the sequence feature, and `el_power` as the regression target. The backend reconstructs the PyTorch `AethelLSTM` architecture, applies the feature scaler before inference, and inverse-transforms model output back to electrical power. API fields ending in `_kw` are converted from the dataset/model watt-scale target.

## Model Comparison

The baseline is a linear regression model trained on the six training experiments. It predicts continuous electrical power from voltage and is exposed through the same model service as the LSTM.

The LSTM prediction band is labeled honestly as `split_conformal_prediction` when `Machine Learning/artifacts/lstm/validation_predictions.csv` is available. It uses the 95th percentile of absolute calibration errors as a symmetric prediction band. If calibration data is unavailable, the API returns `residual_based_prediction_band` with `coverage: null` rather than pretending native uncertainty exists.

## API Endpoints

- `GET /api/health`
- `GET /api/models`
- `GET /api/experiments`
- `GET /api/experiments/{experiment_id}`
- `POST /api/predict`
- `POST /api/upload-sequence`
- `POST /api/predict-sequence`
- `GET /api/results/summary`
- `GET /api/results/predictions?experiment_id=ex_22&model=lstm`
- `GET /api/results/residuals?experiment_id=ex_22&model=lstm`
- `GET /api/results/phase-metrics?experiment_id=ex_22&model=lstm`
- `GET /api/results/feature-importance?model=lstm`
- `GET /api/results/explainability?experiment_id=ex_22&model=lstm`
- `POST /api/results/explainability`
- `GET /api/results/cross-correlation?experiment_id=ex_22&model=lstm`
- `GET /api/results/response-characteristics?experiment_id=ex_22&model=lstm`
- `WS /ws/live?experiment_id=ex_22&model=lstm&filter_mode=none`

## Running Locally

Backend:

```bash
cd backend
python -m pip install -r requirements.txt
python scripts/evaluate_models.py
python -m uvicorn app.main:app --reload
```

Frontend:

```bash
cd my-project
npm install
npm run dev
```

Open the frontend at `http://localhost:5173`.

## Docker Setup

From the repository root:

```bash
docker compose up --build
```

The frontend is served at `http://localhost:8080`, the backend API is available at `http://localhost:8000`, and MLflow is available at `http://localhost:5000`.

To log evaluation runs into the Compose MLflow service:

```bash
docker compose up --build
docker compose exec backend python scripts/evaluate_models.py
```

Outside Docker, the evaluation script defaults to a local file-backed MLflow store in `mlruns/`. Set `MLFLOW_TRACKING_URI` to point at a different MLflow server.

## Evaluation Reports

Generate reports with:

```bash
cd backend
python scripts/evaluate_models.py
```

Generated files are written to `reports/`:

- `metrics_summary.json`
- `predictions_ex_4_lstm.csv`
- `predictions_ex_22_lstm.csv`
- `predictions_ex_4_baseline.csv`
- `predictions_ex_22_baseline.csv`
- `residuals_ex_4_lstm.csv`
- `residuals_ex_22_lstm.csv`
- `residuals_ex_4_baseline.csv`
- `residuals_ex_22_baseline.csv`
- `phase_metrics.json`
- `feature_importance.json`
- `cross_correlation.json`
- `response_characteristics.json`

The same evaluation run logs MLflow runs for each model and held-out experiment. Each run includes model name, experiment ID, split, MAE, RMSE, R2, peak absolute error, latency, phase metrics when available, prediction CSVs, residual CSVs, and the summary JSON artifacts.

## Known Limitations

- LSTM uncertainty uses split conformal prediction, not native Bayesian uncertainty.
- LSTM explainability uses temporal occlusion attribution, not SHAP or Integrated Gradients.
- Response characteristics are only available when valid step transitions exist.
- Experiment mode labels are defined in `backend/app/experiment_metadata.json`; the CSV files still do not contain mode labels.
- MLflow tracks evaluation runs and artifacts when `scripts/evaluate_models.py` is executed with the backend dependencies installed.

## Future Work

- Add gradient or Integrated Gradients attribution for LSTM sequences if a stronger attribution method is needed.
- Persist uploaded custom sequences beyond process memory.
- Add model registry promotion on top of the current MLflow tracking runs.
- Add richer automated browser regression tests.

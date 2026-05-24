# Aethel: Micro-Turbine Digital Twin Dashboard

## Overview

Aethel is a full-stack digital twin dashboard for micro gas turbine electrical power prediction. The app streams experiment playback over WebSockets, predicts electrical power from input voltage sequences, compares a real PyTorch LSTM regression model against an honest linear-regression baseline, and exposes backend-generated validation reports to the React UI.

## Features

- FastAPI backend with REST and WebSocket APIs
- React/Vite frontend with dashboard, virtual lab, and results views
- Real LSTM regression inference from `Machine Learning/artifacts/lstm`
- Baseline comparison trained from the registered training experiments
- Experiment registry for all 8 CSV experiments
- Live experiment playback with selectable model and signal filtering
- Raw, voltage-filtered, power-filtered, and voltage+power-filtered modes
- Residual-based prediction bands and anomaly alerts
- Phase-aware metrics for steady, rising, and falling regimes
- Residual audit, cross-correlation heatmap, and response-characteristic cards
- Custom CSV voltage sequence upload and prediction
- Docker Compose setup for backend and frontend

## Tech Stack

- Backend: FastAPI, Pydantic, pandas, NumPy, SciPy, scikit-learn, PyTorch
- Frontend: React, TypeScript, Vite, Recharts, Tailwind CSS, lucide-react
- Runtime: Docker Compose, WebSockets
- ML artifacts: PyTorch checkpoint plus joblib feature/target scalers

## Architecture

The backend is the source of truth for ML behavior:

- `backend/app/experiment_registry.py` discovers and describes experiment CSVs.
- `backend/app/ml/model_service.py` loads the real LSTM, trains the baseline, applies optional filtering, predicts power, and returns residual-based uncertainty bands.
- `backend/app/results_service.py` computes metrics, residuals, phase metrics, cross-correlation, and response characteristics.
- `backend/app/main.py` exposes REST endpoints, CSV upload, and `/ws/live`.

The frontend fetches backend data for Results and Virtual Lab views. Mock ML fixtures have been removed.

## Dataset / Experiments

Registered experiments:

- Train: `ex_1`, `ex_9`, `ex_20`, `ex_21`, `ex_23`, `ex_24`
- Test: `ex_4`, `ex_22`

Each experiment is registered with split, inferred mode, sample count, columns, voltage column, power column, and duration when timestamps are available. Modes are inferred only from voltage profile shape; ambiguous profiles are marked `unknown`.

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

The LSTM prediction band is labeled honestly as `residual_based_prediction_band`. It uses validation residual spread rather than pretending the model has native uncertainty.

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
- `GET /api/results/cross-correlation?experiment_id=ex_22&model=lstm`
- `GET /api/results/response-characteristics?experiment_id=ex_22&model=lstm`
- `WS /ws/live?experiment_id=ex_22&model=lstm&filter_mode=none`

## Running Locally

Backend:

```bash
cd backend
python -m pip install -r requirements.txt
python scripts/evaluate_models.py
uvicorn app.main:app --reload
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

The frontend is served at `http://localhost:8080`, and the backend API is available at `http://localhost:8000`.

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

## Known Limitations

- LSTM explainability is not faked. The API returns an unavailable message until a real sequence attribution method is added.
- LSTM prediction bands are residual-based, not native calibrated uncertainty.
- Experiment mode is inferred from voltage patterns because the CSV files do not store explicit rectangular/continuous labels.
- MLflow integration is not implemented; misleading MLflow claims have not been added.
- Response-characteristic detection returns an empty state when no clear step response is found.

## Future Work

- Add gradient, ablation, or permutation attribution for LSTM sequences.
- Persist uploaded custom sequences beyond process memory.
- Add model registry integration and MLflow tracking.
- Add richer automated browser regression tests.
- Calibrate uncertainty bands with held-out residual distributions or conformal prediction.

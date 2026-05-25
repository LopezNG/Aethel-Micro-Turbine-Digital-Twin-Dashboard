from __future__ import annotations

import asyncio
import io
import os
import time
import uuid
from collections import deque
from dataclasses import dataclass
from typing import Any, Literal

import pandas as pd
from fastapi import FastAPI, File, HTTPException, Query, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator
from starlette.websockets import WebSocketState

from .config import VOLTAGE_MAX, VOLTAGE_MIN
from .experiment_registry import ExperimentMetadata, ExperimentRegistry, ExperimentMode, ExperimentSplit
from .ml.model_service import (
    FilterMode,
    ModelService,
    assert_voltage,
    classify_phases,
    kw_to_watts,
    model_service_to_legacy_payload,
    normalize_filter_mode,
    normalize_model_name,
)
from .results_service import ResultsService


registry = ExperimentRegistry()
model_service = ModelService(registry)
results_service = ResultsService(registry, model_service)
uploaded_sequences: dict[str, pd.DataFrame] = {}

app = FastAPI(
    title="Aethel Digital Twin API",
    version="1.0.0",
    description="FastAPI inference, evaluation, and telemetry streaming service for micro-turbine digital twins.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        origin.strip()
        for origin in os.getenv(
            "AETHEL_CORS_ORIGINS",
            "http://localhost:5173,http://127.0.0.1:5173,"
            "http://localhost:4173,http://127.0.0.1:4173,"
            "http://localhost:8080,http://127.0.0.1:8080",
        ).split(",")
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class VoltageSample(BaseModel):
    model_config = ConfigDict(extra="forbid")

    timestamp: float | None = None
    time: float | None = None
    input_voltage: float = Field(..., ge=VOLTAGE_MIN, le=VOLTAGE_MAX)
    el_power: float | None = None
    power: float | None = None

    @field_validator("input_voltage")
    @classmethod
    def voltage_must_be_valid(cls, value: float) -> float:
        return assert_voltage(value)


class PredictionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    input_voltage: float | None = Field(default=None, ge=VOLTAGE_MIN, le=VOLTAGE_MAX)
    samples: list[VoltageSample] | None = Field(default=None, min_length=1, max_length=2048)
    model: str = "lstm"
    model_version: str | None = None

    @model_validator(mode="after")
    def has_voltage_or_samples(self) -> "PredictionRequest":
        if self.input_voltage is None and not self.samples:
            raise ValueError("Provide input_voltage or samples")
        return self


class PredictSequenceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    upload_id: str | None = None
    samples: list[VoltageSample] | None = Field(default=None, min_length=1, max_length=20000)
    model: str = "lstm"
    filter_mode: str = "none"

    @model_validator(mode="after")
    def has_upload_or_samples(self) -> "PredictSequenceRequest":
        if self.upload_id is None and not self.samples:
            raise ValueError("Provide upload_id or samples")
        return self


class ExplainabilityRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    upload_id: str | None = None
    samples: list[VoltageSample] | None = Field(default=None, min_length=1, max_length=2048)
    model: str = "lstm"
    filter_mode: str = "none"
    max_lags: int = Field(default=30, ge=1, le=128)

    @model_validator(mode="after")
    def has_upload_or_samples(self) -> "ExplainabilityRequest":
        if self.upload_id is None and not self.samples:
            raise ValueError("Provide upload_id or samples")
        return self


class SimulationControlMessage(BaseModel):
    model_config = ConfigDict(extra="ignore")

    mode: Literal["historical", "manual"] | None = None
    input_voltage: float | None = Field(default=None, ge=VOLTAGE_MIN, le=VOLTAGE_MAX)
    override_voltage: float | None = Field(default=None, ge=VOLTAGE_MIN, le=VOLTAGE_MAX)
    model: str | None = None
    model_version: str | None = None
    paused: bool | None = None
    tick_ms: int | None = Field(default=None, ge=50, le=5000)
    experiment_id: str | None = None
    dataset: str | None = None
    filter_mode: str | None = None

    @field_validator("input_voltage", "override_voltage")
    @classmethod
    def optional_voltage_must_be_valid(cls, value: float | None) -> float | None:
        return assert_voltage(value) if value is not None else None


@dataclass
class SimulationState:
    experiment_id: str
    tick_ms: int
    mode: Literal["historical", "manual"]
    manual_voltage: float
    model: str
    filter_mode: FilterMode
    paused: bool = False

    def as_payload(self) -> dict[str, Any]:
        return {
            "experiment_id": self.experiment_id,
            "dataset": self.experiment_id,
            "tick_ms": self.tick_ms,
            "mode": self.mode,
            "manual_voltage": self.manual_voltage,
            "model": normalize_model_name(self.model),
            "model_version": normalize_model_name(self.model),
            "filter_mode": self.filter_mode,
            "paused": self.paused,
        }


ControlQueueItem = SimulationControlMessage | dict[str, str]


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "experiments": [experiment.experiment_id for experiment in registry.list(include_unknown=True)],
        "models": model_service.get_available_models(),
    }


@app.get("/api/models")
def models() -> dict[str, Any]:
    return {"models": model_service.get_available_models()}


@app.get("/api/experiments")
def experiments(
    split: ExperimentSplit | None = Query(default=None),
    mode: ExperimentMode | None = Query(default=None),
    include_unknown: bool = Query(default=True),
) -> dict[str, Any]:
    return {
        "experiments": [
            experiment.to_dict()
            for experiment in registry.list(split=split, mode=mode, include_unknown=include_unknown)
        ]
    }


@app.get("/api/experiments/{experiment_id}")
def experiment_detail(experiment_id: str) -> dict[str, Any]:
    try:
        metadata = registry.get(experiment_id)
    except Exception as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return metadata.to_dict()


@app.post("/api/predict")
def predict(request: PredictionRequest) -> dict[str, Any]:
    model_name = request.model_version or request.model
    samples = [sample.input_voltage for sample in request.samples] if request.samples else None
    try:
        prediction = model_service.predict_single(
            input_voltage=request.input_voltage,
            samples=samples,
            model_name=model_name,
        )
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return model_service_to_legacy_payload(prediction)


@app.post("/api/upload-sequence")
async def upload_sequence(file: UploadFile = File(...)) -> dict[str, Any]:
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=422, detail="Upload a CSV file.")
    content = await file.read()
    try:
        frame = pd.read_csv(io.BytesIO(content))
        validate_uploaded_frame(frame)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    upload_id = str(uuid.uuid4())
    uploaded_sequences[upload_id] = frame
    power_column = "el_power" if "el_power" in frame.columns else "power" if "power" in frame.columns else None
    preview = frame.head(80).to_dict(orient="records")
    return {
        "upload_id": upload_id,
        "filename": file.filename,
        "sample_count": int(len(frame)),
        "columns": list(frame.columns),
        "has_ground_truth": power_column is not None,
        "preview": preview,
    }


@app.post("/api/predict-sequence")
def predict_sequence(request: PredictSequenceRequest) -> dict[str, Any]:
    try:
        frame = _frame_from_sequence_request(request)
        validate_uploaded_frame(frame)
        return model_service.predict_sequence(
            frame=frame,
            model_name=request.model,
            filter_mode=request.filter_mode,
            experiment_id=None,
            pad_initial=True,
        )
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get("/api/results/summary")
def results_summary() -> dict[str, Any]:
    try:
        return results_service.summary()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/results/predictions")
def result_predictions(
    experiment_id: str = Query(...),
    model: str = Query(default="lstm"),
    filter_mode: str = Query(default="none"),
) -> dict[str, Any]:
    try:
        return results_service.predictions(experiment_id, model, filter_mode, pad_initial=True)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get("/api/results/residuals")
def result_residuals(
    experiment_id: str = Query(...),
    model: str = Query(default="lstm"),
    filter_mode: str = Query(default="none"),
) -> dict[str, Any]:
    try:
        return results_service.residuals(experiment_id, model, filter_mode)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get("/api/results/phase-metrics")
def result_phase_metrics(
    experiment_id: str = Query(...),
    model: str = Query(default="lstm"),
    filter_mode: str = Query(default="none"),
) -> dict[str, Any]:
    try:
        return results_service.phase_metrics(experiment_id, model, filter_mode)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get("/api/results/feature-importance")
def result_feature_importance(model: str = Query(default="lstm")) -> dict[str, Any]:
    try:
        return results_service.feature_importance(model)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get("/api/results/explainability")
def result_explainability(
    experiment_id: str = Query(...),
    model: str = Query(default="lstm"),
    filter_mode: str = Query(default="none"),
    max_lags: int = Query(default=30, ge=1, le=128),
) -> dict[str, Any]:
    try:
        return results_service.explainability(experiment_id, model, filter_mode, max_lags)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/api/results/explainability")
def result_explainability_for_sequence(request: ExplainabilityRequest) -> dict[str, Any]:
    try:
        frame = _frame_from_explainability_request(request)
        validate_uploaded_frame(frame)
        return model_service.explain_sequence(
            frame=frame,
            model_name=request.model,
            filter_mode=request.filter_mode,
            max_lags=request.max_lags,
        )
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get("/api/results/cross-correlation")
def result_cross_correlation(
    experiment_id: str = Query(...),
    model: str = Query(default="lstm"),
    filter_mode: str = Query(default="none"),
) -> dict[str, Any]:
    try:
        return results_service.cross_correlation(experiment_id, model, filter_mode)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get("/api/results/response-characteristics")
def result_response_characteristics(
    experiment_id: str = Query(...),
    model: str = Query(default="lstm"),
    filter_mode: str = Query(default="none"),
) -> dict[str, Any]:
    try:
        return results_service.response_characteristics(experiment_id, model, filter_mode)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.websocket("/ws/live")
async def live(
    websocket: WebSocket,
    experiment_id: str = Query(default="ex_22"),
    tick_ms: int = Query(default=250, ge=50, le=5000),
    model: str = Query(default="lstm"),
    filter_mode: str = Query(default="none"),
) -> None:
    await _stream_live(websocket, experiment_id, tick_ms, model, filter_mode)


@app.websocket("/ws/simulate")
async def simulate_compat(
    websocket: WebSocket,
    dataset: str = Query(default="ex_22"),
    tick_ms: int = Query(default=250, ge=50, le=5000),
    model_version: str = Query(default="lstm"),
    filter_mode: str = Query(default="none"),
) -> None:
    await _stream_live(websocket, dataset, tick_ms, model_version, filter_mode)


async def _stream_live(
    websocket: WebSocket,
    experiment_id: str,
    tick_ms: int,
    model: str,
    filter_mode: str,
) -> None:
    await websocket.accept()
    try:
        metadata = registry.get(experiment_id)
        normalized_model = normalize_model_name(model)
        normalized_filter = normalize_filter_mode(filter_mode)
        frame = registry.load_frame(metadata.experiment_id)
        prediction_payload = model_service.predict_sequence(
            frame,
            model_name=normalized_model,
            experiment_id=metadata.experiment_id,
            filter_mode=normalized_filter,
            pad_initial=True,
        )
    except Exception as exc:
        await websocket.send_json({"type": "error", "message": str(exc)})
        await websocket.close(code=1008)
        return

    state = SimulationState(
        experiment_id=metadata.experiment_id,
        tick_ms=tick_ms,
        mode="historical",
        manual_voltage=float(frame["input_voltage"].iloc[0]),
        model=normalized_model,
        filter_mode=normalized_filter,
    )
    control_queue: asyncio.Queue[ControlQueueItem] = asyncio.Queue()
    disconnected = asyncio.Event()
    receiver = asyncio.create_task(_receive_control_messages(websocket, control_queue, disconnected))

    history: deque[float] = deque(maxlen=256)
    cursor = 0
    sequence = 0
    previous_voltage: float | None = None

    await websocket.send_json(
        {
            "type": "ready",
            "message": "Aethel telemetry stream initialized",
            "state": state.as_payload(),
            "models": model_service.get_available_models(),
        }
    )

    try:
        while not disconnected.is_set():
            control_events, reload_stream = await _apply_control_messages(control_queue, state)
            for event in control_events:
                await websocket.send_json(event)

            if reload_stream:
                metadata = registry.get(state.experiment_id)
                frame = registry.load_frame(metadata.experiment_id)
                prediction_payload = model_service.predict_sequence(
                    frame,
                    model_name=state.model,
                    experiment_id=metadata.experiment_id,
                    filter_mode=state.filter_mode,
                    pad_initial=True,
                )
                cursor = 0
                history.clear()
                previous_voltage = None

            if state.paused:
                await asyncio.sleep(0.1)
                continue

            points = prediction_payload["points"]
            if not points:
                await websocket.send_json({"type": "error", "message": "No telemetry points available"})
                await asyncio.sleep(state.tick_ms / 1000)
                continue
            if cursor >= len(points):
                cursor = 0
                history.clear()
                previous_voltage = None

            raw_row = frame.iloc[cursor]
            point = dict(points[cursor])
            cursor += 1

            if state.mode == "manual":
                timestamp = float(point["timestamp"])
                manual_voltage = assert_voltage(state.manual_voltage)
                history.append(manual_voltage)
                prediction = model_service.predict_single(samples=list(history), model_name=state.model)
                voltage_delta = 0.0 if previous_voltage is None else manual_voltage - previous_voltage
                previous_voltage = manual_voltage
                phase = classify_phases([manual_voltage - voltage_delta, manual_voltage])[-1]
                point = {
                    "timestamp": timestamp,
                    "experiment_id": state.experiment_id,
                    "input_voltage": manual_voltage,
                    "ground_truth_power_kw": None,
                    "predicted_power_kw": prediction.predicted_power_kw,
                    "uncertainty_lower_kw": prediction.uncertainty_lower_kw,
                    "uncertainty_upper_kw": prediction.uncertainty_upper_kw,
                    "residual": None,
                    "phase": phase,
                    "model": prediction.model,
                    "latency_ms": prediction.latency_ms,
                    "alert_status": None,
                    "severity": None,
                    "message": None,
                    "uncertainty_method": prediction.uncertainty_method,
                    "coverage": prediction.coverage,
                }
            else:
                previous_voltage = float(point["input_voltage"])

            await websocket.send_json(_telemetry_payload(sequence, state, point, raw_row))
            sequence += 1
            await asyncio.sleep(state.tick_ms / 1000)
    except WebSocketDisconnect:
        disconnected.set()
    except Exception as exc:
        if websocket.application_state == WebSocketState.CONNECTED:
            await websocket.send_json({"type": "error", "message": f"stream terminated: {exc}"})
            await websocket.close(code=1011)
    finally:
        receiver.cancel()
        try:
            await receiver
        except asyncio.CancelledError:
            pass


async def _receive_control_messages(
    websocket: WebSocket,
    control_queue: asyncio.Queue[ControlQueueItem],
    disconnected: asyncio.Event,
) -> None:
    while not disconnected.is_set():
        try:
            payload = await websocket.receive_json()
            if not isinstance(payload, dict):
                raise ValueError("control message must be a JSON object")
            message = SimulationControlMessage.model_validate(payload)
            await control_queue.put(message)
        except WebSocketDisconnect:
            disconnected.set()
        except ValidationError as exc:
            await control_queue.put({"type": "control_error", "message": str(exc)})
        except Exception as exc:
            await control_queue.put({"type": "control_error", "message": str(exc)})


async def _apply_control_messages(
    control_queue: asyncio.Queue[ControlQueueItem],
    state: SimulationState,
) -> tuple[list[dict[str, Any]], bool]:
    events: list[dict[str, Any]] = []
    reload_stream = False

    while True:
        try:
            item = control_queue.get_nowait()
        except asyncio.QueueEmpty:
            break

        if isinstance(item, dict):
            events.append(item)
            continue

        try:
            next_experiment = item.experiment_id or item.dataset
            if next_experiment is not None and next_experiment != state.experiment_id:
                state.experiment_id = registry.get(next_experiment).experiment_id
                reload_stream = True
            if item.tick_ms is not None:
                state.tick_ms = item.tick_ms
            if item.paused is not None:
                state.paused = item.paused
            next_model = item.model or item.model_version
            if next_model is not None:
                state.model = normalize_model_name(next_model)
                reload_stream = True
            if item.filter_mode is not None:
                state.filter_mode = normalize_filter_mode(item.filter_mode)
                reload_stream = True
            if item.mode is not None:
                state.mode = item.mode

            voltage = item.override_voltage if item.override_voltage is not None else item.input_voltage
            if voltage is not None:
                state.manual_voltage = assert_voltage(voltage)
                if item.mode is None:
                    state.mode = "manual"

            events.append({"type": "control_state", "state": state.as_payload()})
        except Exception as exc:
            events.append({"type": "control_error", "message": str(exc)})

    return events, reload_stream


def _telemetry_payload(
    sequence: int,
    state: SimulationState,
    point: dict[str, Any],
    raw_row: pd.Series,
) -> dict[str, Any]:
    predicted_kw = float(point["predicted_power_kw"])
    low_kw = float(point["uncertainty_lower_kw"])
    high_kw = float(point["uncertainty_upper_kw"])
    actual_kw = point["ground_truth_power_kw"]
    raw_power_kw = float(raw_row["el_power"]) / 1000.0 if "el_power" in raw_row else None
    uncertainty_method = str(point.get("uncertainty_method", "residual_based_prediction_band"))
    coverage = point.get("coverage")
    return {
        "type": "telemetry",
        "sequence": sequence,
        "server_time": time.time(),
        "timestamp": point["timestamp"],
        "time": point["timestamp"],
        "experiment_id": state.experiment_id,
        "dataset": state.experiment_id,
        "input_voltage": point["input_voltage"],
        "raw_input_voltage": float(raw_row["input_voltage"]),
        "source_voltage": float(raw_row["input_voltage"]),
        "ground_truth_power_kw": actual_kw,
        "raw_ground_truth_power_kw": raw_power_kw,
        "predicted_power_kw": predicted_kw,
        "uncertainty_lower_kw": low_kw,
        "uncertainty_upper_kw": high_kw,
        "residual": point["residual"],
        "phase": point["phase"],
        "model": state.model,
        "model_version": state.model,
        "latency_ms": point["latency_ms"],
        "alert_status": point["alert_status"],
        "severity": point["severity"],
        "message": point["message"],
        "filter_mode": state.filter_mode,
        "filter_method": "savitzky_golay" if state.filter_mode != "none" else None,
        "uncertainty_method": uncertainty_method,
        "uncertainty_source": uncertainty_method,
        "coverage": coverage if isinstance(coverage, (float, int)) else None,
        "mode": state.mode,
        "is_transition": point["phase"] != "steady_state",
        "el_power": kw_to_watts(actual_kw) if actual_kw is not None else None,
        "predicted_power": kw_to_watts(predicted_kw),
        "confidence_low": kw_to_watts(low_kw),
        "confidence_high": kw_to_watts(high_kw),
        "filtered_voltage": point["input_voltage"],
        "uncertainty": kw_to_watts((high_kw - low_kw) / 3.92),
        "model_source": "real_lstm_model" if state.model == "lstm" else model_service.baseline.source,
    }


def _frame_from_sequence_request(request: PredictSequenceRequest) -> pd.DataFrame:
    if request.upload_id is not None:
        if request.upload_id not in uploaded_sequences:
            raise ValueError("Unknown upload_id")
        return uploaded_sequences[request.upload_id].copy()

    assert request.samples is not None
    rows: list[dict[str, float]] = []
    for index, sample in enumerate(request.samples):
        row: dict[str, float] = {
            "time": float(sample.timestamp if sample.timestamp is not None else sample.time if sample.time is not None else index),
            "input_voltage": sample.input_voltage,
        }
        power = sample.el_power if sample.el_power is not None else sample.power
        if power is not None:
            row["el_power"] = float(power)
        rows.append(row)
    return pd.DataFrame(rows)


def _frame_from_explainability_request(request: ExplainabilityRequest) -> pd.DataFrame:
    if request.upload_id is not None:
        if request.upload_id not in uploaded_sequences:
            raise ValueError("Unknown upload_id")
        return uploaded_sequences[request.upload_id].copy()

    assert request.samples is not None
    rows: list[dict[str, float]] = []
    for index, sample in enumerate(request.samples):
        rows.append(
            {
                "time": float(sample.timestamp if sample.timestamp is not None else sample.time if sample.time is not None else index),
                "input_voltage": sample.input_voltage,
            }
        )
    return pd.DataFrame(rows)


def validate_uploaded_frame(frame: pd.DataFrame) -> None:
    if frame.empty:
        raise ValueError("CSV contains no rows")
    if "input_voltage" not in frame.columns:
        raise ValueError("CSV must include an input_voltage column")
    if frame["input_voltage"].isna().any():
        raise ValueError("input_voltage must not contain empty values")
    for value in pd.to_numeric(frame["input_voltage"], errors="raise"):
        assert_voltage(float(value))
    time_column = "timestamp" if "timestamp" in frame.columns else "time" if "time" in frame.columns else None
    if time_column:
        timestamps = pd.to_numeric(frame[time_column], errors="raise")
        if not timestamps.is_monotonic_increasing or timestamps.diff().dropna().le(0).any():
            raise ValueError("timestamps must be strictly increasing")
    power_column = "el_power" if "el_power" in frame.columns else "power" if "power" in frame.columns else None
    if power_column and frame[power_column].isna().any():
        raise ValueError(f"{power_column} contains empty values")

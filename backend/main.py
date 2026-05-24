from __future__ import annotations

import asyncio
import os
import time
from collections import deque
from dataclasses import dataclass
from typing import Any, Literal

from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator
from starlette.websockets import WebSocketState

try:
    from services import (
        TelemetryDatasetRepository,
        TurbineModelManager,
        VOLTAGE_MAX,
        VOLTAGE_MIN,
        assert_voltage,
    )
except ImportError:  # Allows `from backend.main import app` in tests.
    from .services import (
        TelemetryDatasetRepository,
        TurbineModelManager,
        VOLTAGE_MAX,
        VOLTAGE_MIN,
        assert_voltage,
    )

dataset_repository = TelemetryDatasetRepository()
model_manager = TurbineModelManager()

app = FastAPI(
    title="Aethel Digital Twin API",
    version="0.1.0",
    description="FastAPI inference and telemetry streaming service for micro-turbine digital twins.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        origin.strip()
        for origin in os.getenv(
            "AETHEL_CORS_ORIGINS",
            "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173,http://localhost:8080,http://127.0.0.1:8080",
        ).split(",")
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class VoltageSample(BaseModel):
    model_config = ConfigDict(extra="forbid")

    timestamp: float | None = Field(default=None, description="Optional monotonic sample timestamp.")
    input_voltage: float = Field(
        ...,
        ge=VOLTAGE_MIN,
        le=VOLTAGE_MAX,
        description="Micro-turbine control voltage in physical range 0V-10V.",
    )

    @field_validator("input_voltage")
    @classmethod
    def voltage_must_be_finite(cls, value: float) -> float:
        return assert_voltage(value)


class PredictionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    samples: list[VoltageSample] = Field(..., min_length=3, max_length=512)
    model_version: str = Field(default="lstm", description="Either 'baseline' or 'lstm'.")


class ConfidenceInterval(BaseModel):
    low: float
    high: float


class PredictionResponse(BaseModel):
    predicted_power: float
    confidence_interval: ConfidenceInterval
    filtered_voltage: float
    uncertainty: float
    model_version: str
    model_source: str
    latency_ms: float


class SimulationControlMessage(BaseModel):
    model_config = ConfigDict(extra="ignore")

    mode: Literal["historical", "manual"] | None = None
    input_voltage: float | None = Field(default=None, ge=VOLTAGE_MIN, le=VOLTAGE_MAX)
    override_voltage: float | None = Field(default=None, ge=VOLTAGE_MIN, le=VOLTAGE_MAX)
    model_version: str | None = None
    paused: bool | None = None
    tick_ms: int | None = Field(default=None, ge=50, le=5000)
    dataset: Literal["ex_9", "ex_22"] | None = None

    @field_validator("input_voltage", "override_voltage")
    @classmethod
    def optional_voltage_must_be_finite(cls, value: float | None) -> float | None:
        if value is None:
            return None
        return assert_voltage(value)


@dataclass
class SimulationState:
    dataset: str
    tick_ms: int
    mode: Literal["historical", "manual"]
    manual_voltage: float
    model_version: str
    paused: bool = False

    def as_payload(self) -> dict[str, Any]:
        return {
            "dataset": self.dataset,
            "tick_ms": self.tick_ms,
            "mode": self.mode,
            "manual_voltage": self.manual_voltage,
            "model_version": model_manager.normalize_version(self.model_version),
            "paused": self.paused,
        }


ControlQueueItem = SimulationControlMessage | dict[str, str]


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "datasets": dataset_repository.datasets,
        "models": model_manager.versions(),
    }


@app.get("/api/models")
def models() -> dict[str, Any]:
    return {"models": model_manager.versions()}


@app.post("/api/predict", response_model=PredictionResponse)
def predict(request: PredictionRequest) -> PredictionResponse:
    voltages = [sample.input_voltage for sample in request.samples]
    try:
        result = model_manager.predict(voltages, request.model_version)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return PredictionResponse(
        predicted_power=result.predicted_power,
        confidence_interval=ConfidenceInterval(
            low=result.confidence_low,
            high=result.confidence_high,
        ),
        filtered_voltage=result.filtered_voltage,
        uncertainty=result.uncertainty,
        model_version=result.model_version,
        model_source=result.model_source,
        latency_ms=result.latency_ms,
    )


@app.websocket("/ws/simulate")
async def simulate(
    websocket: WebSocket,
    dataset: str = Query(default="ex_22"),
    tick_ms: int = Query(default=250, ge=50, le=5000),
    model_version: str = Query(default="lstm"),
) -> None:
    await websocket.accept()

    try:
        rows = dataset_repository.load(dataset)
        normalized_model = model_manager.normalize_version(model_version)
    except Exception as exc:
        await websocket.send_json({"type": "error", "message": str(exc)})
        await websocket.close(code=1008)
        return

    state = SimulationState(
        dataset=dataset,
        tick_ms=tick_ms,
        mode="historical",
        manual_voltage=rows[0].input_voltage,
        model_version=normalized_model,
    )
    control_queue: asyncio.Queue[ControlQueueItem] = asyncio.Queue()
    disconnected = asyncio.Event()
    receiver = asyncio.create_task(_receive_control_messages(websocket, control_queue, disconnected))

    history: deque[float] = deque(maxlen=96)
    cursor = 0
    sequence = 0
    previous_voltage: float | None = None

    await websocket.send_json(
        {
            "type": "ready",
            "message": "Aethel telemetry stream initialized",
            "state": state.as_payload(),
            "models": model_manager.versions(),
        }
    )

    try:
        while not disconnected.is_set():
            control_events, reload_dataset = await _apply_control_messages(control_queue, state)
            for event in control_events:
                await websocket.send_json(event)

            if reload_dataset:
                rows = dataset_repository.load(state.dataset)
                cursor = 0
                history.clear()
                previous_voltage = None

            if state.paused:
                await asyncio.sleep(0.1)
                continue

            if cursor >= len(rows):
                cursor = 0

            sample = rows[cursor]
            cursor += 1

            effective_voltage = state.manual_voltage if state.mode == "manual" else sample.input_voltage
            history.append(effective_voltage)

            try:
                prediction = model_manager.predict(list(history), state.model_version)
            except Exception as exc:
                await websocket.send_json({"type": "error", "message": f"inference failed: {exc}"})
                await asyncio.sleep(state.tick_ms / 1000)
                continue

            voltage_delta = 0.0 if previous_voltage is None else effective_voltage - previous_voltage
            previous_voltage = effective_voltage

            # MLflow hook: stream-level monitoring can log sequence, dataset,
            # model alias, drift features, and any downstream client feedback.
            await websocket.send_json(
                {
                    "type": "telemetry",
                    "sequence": sequence,
                    "server_time": time.time(),
                    "dataset": state.dataset,
                    "time": sample.time_seconds,
                    "source_voltage": sample.input_voltage,
                    "input_voltage": effective_voltage,
                    "el_power": sample.el_power if state.mode == "historical" else None,
                    "predicted_power": prediction.predicted_power,
                    "confidence_low": prediction.confidence_low,
                    "confidence_high": prediction.confidence_high,
                    "filtered_voltage": prediction.filtered_voltage,
                    "uncertainty": prediction.uncertainty,
                    "model_version": prediction.model_version,
                    "model_source": prediction.model_source,
                    "mode": state.mode,
                    "is_transition": abs(voltage_delta) >= 0.08,
                    "latency_ms": prediction.latency_ms,
                }
            )

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
    reload_dataset = False

    while True:
        try:
            item = control_queue.get_nowait()
        except asyncio.QueueEmpty:
            break

        if isinstance(item, dict):
            events.append(item)
            continue

        try:
            if item.dataset is not None and item.dataset != state.dataset:
                state.dataset = item.dataset
                reload_dataset = True
            if item.tick_ms is not None:
                state.tick_ms = item.tick_ms
            if item.paused is not None:
                state.paused = item.paused
            if item.model_version is not None:
                state.model_version = model_manager.normalize_version(item.model_version)
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

    return events, reload_dataset

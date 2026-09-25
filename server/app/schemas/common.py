from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


ReportType = Literal[
    "flood",
    "landslide",
    "water_rise",
    "avalanche",
    "damaged_infrastructure",
    "blocked_route",
    "unusual_sound",
    "other",
]

Severity = Literal["low", "moderate", "high", "critical"]

HazardType = Literal[
    "flood",
    "flash_flood",
    "glof",
    "landslide",
    "avalanche",
    "earthquake",
    "rainfall",
    "unknown",
    "other",
]


class SensorReadingCreate(BaseModel):
    sensor_code: str = Field(min_length=2, max_length=100)
    sensor_type: Literal[
        "water_level",
        "rainfall",
        "seismic",
        "vibration",
        "camera",
        "temperature",
        "humidity",
        "multi_sensor",
        "other",
    ]
    numeric_value: float
    unit: str = Field(min_length=1, max_length=50)
    station_id: UUID | None = None
    battery_percentage: float | None = Field(default=None, ge=0, le=100)
    latitude: float | None = None
    longitude: float | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class CommunityReportCreate(BaseModel):
    station_id: UUID | None = None
    village_id: UUID | None = None
    report_type: ReportType
    severity: Severity
    description: str | None = Field(default=None, max_length=2000)
    latitude: float | None = None
    longitude: float | None = None
    multimedia_url: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)

    @field_validator("description")
    @classmethod
    def clean_description(cls, value: str | None) -> str | None:
        return value.strip() if value else None


class ApprovalCreate(BaseModel):
    comments: str | None = Field(default=None, max_length=1000)


class CommunityReportVerify(BaseModel):
    action: Literal["verified", "rejected"]
    trust_score: float | None = Field(default=None, ge=0, le=1)
    comments: str | None = Field(default=None, max_length=1000)


class CommunityReportFieldVerify(BaseModel):
    decision: Literal["confirmed", "disputed"]
    comments: str | None = Field(default=None, max_length=1000)


class CommunityReportCorroborate(BaseModel):
    comments: str | None = Field(default=None, max_length=1000)


class CommunityReportReview(BaseModel):
    action: Literal["verified", "rejected", "request_clarification"]
    trust_score: float | None = Field(default=None, ge=0, le=1)
    comments: str | None = Field(default=None, max_length=1000)


class ReplayStepRequest(BaseModel):
    station_code: str
    reading_id: UUID


class ReplayRequest(BaseModel):
    station_code: str | None = None
    limit: int = Field(default=500, ge=1, le=500)
    delay_seconds: float = Field(default=0, ge=0, le=10)

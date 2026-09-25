from fastapi import APIRouter, HTTPException, Query

from app.db.supabase import get_admin_client

router = APIRouter(prefix="/hydro", tags=["Hydrology"])


@router.get("/readings")
def readings(
    station_code: str = Query(...),
    limit: int = Query(default=50, ge=1, le=500),
):
    admin = get_admin_client()
    station = admin.table("hydro_stations").select("*").eq("station_code", station_code).maybe_single().execute().data
    if not station:
        raise HTTPException(404, "Station not found")
    rows = (
        admin.table("hydro_readings")
        .select("*")
        .eq("station_id", station["id"])
        .order("observed_at", desc=True)
        .limit(limit)
        .execute()
        .data
        or []
    )
    return {"station": station, "items": rows}

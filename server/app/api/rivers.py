from fastapi import APIRouter, HTTPException, Query

from app.db.supabase import get_admin_client

router = APIRouter(prefix="/rivers", tags=["Rivers"])


@router.get("")
def list_rivers():
    rows = get_admin_client().table("basins").select("*").in_("basin_code", ["TEESTA", "DESANG"]).order("basin_name").execute().data or []
    return {"items": rows}


@router.get("/{river_code}/stations")
def list_stations(river_code: str):
    basin = (
        get_admin_client().table("basins")
        .select("id,basin_code,basin_name,river_system")
        .eq("basin_code", river_code.upper())
        .single()
        .execute()
        .data
    )
    if not basin:
        raise HTTPException(404, "River not found")
    rows = (
        get_admin_client().table("hydro_stations")
        .select("id,station_code,station_name,river_name,district,state,latitude,longitude,warning_level_m,danger_level_m,highest_flood_level_m")
        .eq("basin_id", basin["id"])
        .order("station_name")
        .execute()
        .data
        or []
    )
    return {"river": basin, "items": rows}


@router.get("/{river_code}/villages")
def list_villages(river_code: str):
    basin = (
        get_admin_client().table("basins")
        .select("id,basin_code,basin_name")
        .eq("basin_code", river_code.upper())
        .single()
        .execute()
        .data
    )
    if not basin:
        raise HTTPException(404, "River not found")
    rows = (
        get_admin_client().table("villages")
        .select("id,village_code,village_name,district,state,latitude,longitude,population,vulnerability_score,internet_available,cellular_available")
        .eq("basin_id", basin["id"])
        .order("village_name")
        .execute()
        .data
        or []
    )
    return {"river": basin, "items": rows}

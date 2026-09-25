import asyncio

from fastapi import APIRouter, HTTPException

from app.schemas import ReplayRequest, ReplayStepRequest
from app.services.replay_service import replay_reading_step, replay_river, replay_tick

router = APIRouter(prefix="/demo", tags=["Demo"])

# Prevent multiple browser tabs (or rapid clicks) from starting duplicate
# all-stations evaluation passes at the same time. Existing clients still
# receive a normal tick response; a duplicate request simply reuses the
# in-progress result instead of doubling the database/rule-engine work.
_replay_tick_lock = asyncio.Lock()


@router.post("/replay/tick")
async def replay_tick_endpoint():
    """One automatic streaming tick: advance + evaluate one historical reading
    per station across EVERY basin (both rivers).

    The per-station cursor lives in the DB (each station's latest rule
    evaluation), so any client can drive the stream without locks and
    stations with different row counts advance independently. Registered
    before /replay/{river_code} so the static path wins over the path
    parameter.
    """
    try:
        if _replay_tick_lock.locked():
            # Let the first active evaluation finish rather than duplicating
            # its expensive Supabase reads. The client receives a small,
            # explicit coalesced marker and will pick up the next tick.
            return {"tick_at": None, "stations": [], "coalesced": True}
        async with _replay_tick_lock:
            return await asyncio.to_thread(_run_replay_tick_in_thread)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(500, str(exc)) from exc


def _run_replay_tick_in_thread() -> dict:
    """Run the blocking replay/evaluation pass in a worker thread.

    The replay service is declared async but performs synchronous Supabase
    calls, so awaiting it directly blocks the event loop for the entire
    two-station evaluation pass. That made every dashboard/village request
    queue behind a tick (measured 15s+ stalls). Executing the pass in a worker
    thread keeps the event loop free so normal reads are served while the tick
    runs. The single-tick lock still guarantees only one pass at a time.
    """
    return asyncio.run(replay_tick())


@router.post("/replay/{river_code}")
async def replay(river_code: str, payload: ReplayRequest):
    try:
        return await replay_river(
            river_code=river_code,
            station_code=payload.station_code,
            limit=payload.limit,
            delay_seconds=payload.delay_seconds,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/replay/{river_code}/step")
async def replay_step(
    river_code: str,
    payload: ReplayStepRequest,
):
    try:
        return await replay_reading_step(
            river_code=river_code,
            station_code=payload.station_code,
            reading_id=payload.reading_id,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

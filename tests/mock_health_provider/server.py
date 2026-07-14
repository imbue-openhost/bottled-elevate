"""Synthetic health-data provider for elevate tests.

Serves 3 workouts (2 runs on similar loops + 1 ride with power/cadence traces)
behind the health-data-service-spec wire format at /api/v1/*.
"""

import json
import math
from datetime import UTC
from datetime import datetime
from datetime import timedelta
from http.server import BaseHTTPRequestHandler
from http.server import HTTPServer
from urllib.parse import urlparse

CENTER_LAT = 37.7694
CENTER_LON = -122.4862


def _route_gpx(start: datetime, duration_s: int, n_points: int, radius_m: float, phase: float) -> str:
    """A noisy loop route with rolling elevation."""
    trkpts = []
    for i in range(n_points):
        frac = i / (n_points - 1)
        ang = 2 * math.pi * frac + phase
        r = radius_m * (1 + 0.15 * math.sin(3 * ang + phase))
        lat = CENTER_LAT + (r * math.cos(ang)) / 111320.0
        lon = CENTER_LON + (r * math.sin(ang)) / (111320.0 * math.cos(math.radians(CENTER_LAT)))
        ele = 25 + 18 * math.sin(2 * ang + phase) + 6 * math.sin(5 * ang)
        t = start + timedelta(seconds=frac * duration_s)
        trkpts.append(
            f'<trkpt lat="{lat:.6f}" lon="{lon:.6f}"><ele>{ele:.1f}</ele>'
            f"<time>{t.strftime('%Y-%m-%dT%H:%M:%SZ')}</time></trkpt>"
        )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<gpx version="1.1" creator="mock" xmlns="http://www.topografix.com/GPX/1/1">'
        f"<trk><name>mock</name><trkseg>{''.join(trkpts)}</trkseg></trk></gpx>"
    )


def _samples(
    start: datetime, duration_s: int, period_s: int, base: float, amp: float, freq: float, phase: float
) -> dict:
    samples = []
    for s in range(0, duration_s + 1, period_s):
        v = base + amp * math.sin(2 * math.pi * freq * s / duration_s + phase) + 4 * math.sin(s / 47.0)
        t = start + timedelta(seconds=s)
        samples.append({"timestamp": t.strftime("%Y-%m-%dT%H:%M:%SZ"), "value": round(v)})
    return {"samples": samples}


def _scalar(value: float) -> dict:
    return {"value": value}


def _build_workouts() -> dict[str, dict]:
    workouts: dict[str, dict] = {}

    def add(wid: str, wtype: str, start: datetime, duration_s: int, summary_extra: dict, detail_extra: dict) -> None:
        end = start + timedelta(seconds=duration_s)
        summary = {
            "id": wid,
            "workout_type": wtype,
            "start": start.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "end": end.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "source": "mock-health",
            "duration": _scalar(duration_s / 60.0),
            **summary_extra,
        }
        workouts[wid] = {"summary": summary, "detail": {**summary, **detail_extra}}

    start1 = datetime(2026, 6, 1, 15, 0, tzinfo=UTC)
    add(
        "run-1",
        "running",
        start1,
        45 * 60,
        {
            "calories": _scalar(520),
            "distance": _scalar(8000),
            "average_speed": _scalar(2.96),
            "elevation_gain": _scalar(96),
            "average_heart_rate": _scalar(152),
            "max_heart_rate": _scalar(171),
        },
        {
            "heart_rate": _samples(start1, 45 * 60, 60, 152, 12, 1.5, 0.0),
            "route_gpx": _route_gpx(start1, 45 * 60, 540, 1270, 0.0),
        },
    )

    start2 = datetime(2026, 6, 15, 14, 30, tzinfo=UTC)
    add(
        "run-2",
        "running",
        start2,
        41 * 60,
        {
            "calories": _scalar(548),
            "distance": _scalar(8100),
            "average_speed": _scalar(3.29),
            "elevation_gain": _scalar(102),
            "average_heart_rate": _scalar(158),
            "max_heart_rate": _scalar(176),
        },
        {
            "heart_rate": _samples(start2, 41 * 60, 60, 158, 10, 1.8, 1.0),
            "route_gpx": _route_gpx(start2, 41 * 60, 540, 1290, 0.15),
        },
    )

    start3 = datetime(2026, 6, 22, 16, 0, tzinfo=UTC)
    add(
        "ride-1",
        "cycling",
        start3,
        60 * 60,
        {
            "calories": _scalar(690),
            "distance": _scalar(25000),
            "average_speed": _scalar(6.94),
            "elevation_gain": _scalar(240),
            "average_heart_rate": _scalar(141),
            "max_heart_rate": _scalar(168),
            "average_power": _scalar(185),
            "max_power": _scalar(310),
            "average_cadence": _scalar(86),
        },
        {
            "heart_rate": _samples(start3, 60 * 60, 60, 141, 14, 2.2, 0.4),
            "power": _samples(start3, 60 * 60, 5, 185, 55, 3.0, 0.8),
            "cadence": _samples(start3, 60 * 60, 15, 86, 8, 2.0, 0.2),
            "route_gpx": _route_gpx(start3, 60 * 60, 720, 3980, 0.6),
        },
    )

    return workouts


WORKOUTS = _build_workouts()

WORKOUTS_PATH = "/api/v1/workouts"


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802 (http.server API)
        path = urlparse(self.path).path

        if path == "/health":
            return self._json({"status": "ok"})

        if path.startswith(WORKOUTS_PATH):
            workout_id = path[len(WORKOUTS_PATH) :].strip("/")
            if workout_id:
                workout = WORKOUTS.get(workout_id)
                if workout:
                    return self._json(workout["detail"])
                return self._json({"error": "not found"}, 404)
            data = sorted((w["summary"] for w in WORKOUTS.values()), key=lambda s: s["start"])
            return self._json({"data": data})

        if path.startswith("/api/v1/"):
            return self._json({"data": []})

        self._json({"error": "not found"}, 404)

    def _json(self, data: dict, status: int = 200) -> None:
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args) -> None:
        pass


if __name__ == "__main__":
    HTTPServer(("0.0.0.0", 8080), Handler).serve_forever()

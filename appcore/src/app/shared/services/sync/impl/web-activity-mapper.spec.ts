import { buildStreamsFromWorkout, ProviderWorkout } from "./web-activity-mapper";

const GPX = `<?xml version="1.0"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><trkseg>
    <trkpt lat="37.0000" lon="-122.0000"><ele>10</ele><time>2025-01-01T00:00:00Z</time></trkpt>
    <trkpt lat="37.0010" lon="-122.0000"><ele>20</ele><time>2025-01-01T00:00:30Z</time></trkpt>
    <trkpt lat="37.0020" lon="-122.0000"><ele>15</ele><time>2025-01-01T00:01:00Z</time></trkpt>
  </trkseg></trk>
</gpx>`;

const HR_TRACE = {
  samples: [
    { timestamp: "2025-01-01T00:00:00Z", value: 120 },
    { timestamp: "2025-01-01T00:01:00Z", value: 160 }
  ]
};

describe("buildStreamsFromWorkout", () => {
  it("builds GPS-backed streams with HR interpolated onto the track", () => {
    const workout = {
      workout_type: "running",
      start: "2025-01-01T00:00:00Z",
      end: "2025-01-01T00:01:00Z",
      route_gpx: GPX,
      heart_rate: HR_TRACE
    } as ProviderWorkout;

    const streams = buildStreamsFromWorkout(workout, 60);
    expect(streams).not.toBeNull();
    expect(streams.time).toEqual([0, 30, 60]);
    expect(streams.latlng).toEqual([
      [37.0, -122.0],
      [37.001, -122.0],
      [37.002, -122.0]
    ]);
    expect(streams.altitude).toEqual([10, 20, 15]);
    // distance is cumulative and increasing
    expect(streams.distance[0]).toBe(0);
    expect(streams.distance[2]).toBeGreaterThan(streams.distance[1]);
    expect(streams.velocity_smooth.length).toBe(3);
    // HR interpolated: 120 at t=0, ~140 at t=30, 160 at t=60
    expect(streams.heartrate[0]).toBe(120);
    expect(streams.heartrate[1]).toBe(140);
    expect(streams.heartrate[2]).toBe(160);
  });

  it("builds an HR-only timeline when there is no route (indoor)", () => {
    const workout = {
      workout_type: "strength",
      start: "2025-01-01T00:00:00Z",
      end: "2025-01-01T00:01:00Z",
      is_indoor: true,
      heart_rate: HR_TRACE
    } as ProviderWorkout;

    const streams = buildStreamsFromWorkout(workout, 60);
    expect(streams).not.toBeNull();
    expect(streams.time).toEqual([0, 60]);
    expect(streams.heartrate).toEqual([120, 160]);
    expect(streams.latlng).toBeUndefined();
  });

  it("ignores the route for indoor workouts even if GPX is present", () => {
    const workout = {
      workout_type: "cycling",
      start: "2025-01-01T00:00:00Z",
      end: "2025-01-01T00:01:00Z",
      is_indoor: true,
      route_gpx: GPX,
      heart_rate: HR_TRACE
    } as ProviderWorkout;

    const streams = buildStreamsFromWorkout(workout, 60);
    expect(streams.latlng).toBeUndefined();
    expect(streams.heartrate).toEqual([120, 160]);
  });

  it("returns null when neither HR trace nor route is present", () => {
    const workout = {
      workout_type: "yoga",
      start: "2025-01-01T00:00:00Z",
      end: "2025-01-01T00:01:00Z"
    } as ProviderWorkout;

    expect(buildStreamsFromWorkout(workout, 60)).toBeNull();
  });
});

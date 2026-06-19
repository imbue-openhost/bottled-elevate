import { buildStreamsFromWorkout, mapWorkoutTypeToSport, ProviderWorkout } from "./web-activity-mapper";
import { ElevateSport } from "@elevate/shared/enums/elevate-sport.enum";

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

const POWER_TRACE = {
  samples: [
    { timestamp: "2025-01-01T00:00:00Z", value: 100 },
    { timestamp: "2025-01-01T00:01:00Z", value: 200 }
  ]
};

const CADENCE_TRACE = {
  samples: [
    { timestamp: "2025-01-01T00:00:00Z", value: 80 },
    { timestamp: "2025-01-01T00:01:00Z", value: 100 }
  ]
};

describe("mapWorkoutTypeToSport", () => {
  // Every workout_type present in the live Apple Health data.
  const cases: [string, ElevateSport][] = [
    ["walking", ElevateSport.Walk],
    ["cycling", ElevateSport.Ride],
    ["yoga", ElevateSport.Yoga],
    ["swimming", ElevateSport.Swim],
    ["running", ElevateSport.Run],
    ["strength", ElevateSport.WeightTraining],
    ["volleyball", ElevateSport.Volleyball],
    ["pickleball", ElevateSport.Pickleball],
    ["hiking", ElevateSport.Hike],
    ["snowboarding", ElevateSport.Snowboard],
    ["climbing", ElevateSport.Climbing],
    ["core_training", ElevateSport.WeightTraining],
    ["other", ElevateSport.Other],
    ["tennis", ElevateSport.Tennis],
    ["elliptical", ElevateSport.Elliptical],
    ["stair_climbing", ElevateSport.StairStepper],
    ["rowing", ElevateSport.Rowing],
    ["cardio_dance", ElevateSport.Dance],
    ["downhill_skiing", ElevateSport.AlpineSki],
    ["badminton", ElevateSport.Badminton]
  ];

  cases.forEach(([type, sport]) => {
    it(`maps "${type}" to ${sport}`, () => {
      expect(mapWorkoutTypeToSport(type)).toBe(sport);
    });
  });

  it("auto-maps a multi-word type via PascalCase (table_tennis -> TableTennis)", () => {
    expect(mapWorkoutTypeToSport("table_tennis")).toBe(ElevateSport.TableTennis);
  });

  it("is case-insensitive", () => {
    expect(mapWorkoutTypeToSport("Volleyball")).toBe(ElevateSport.Volleyball);
  });

  it("falls back to Other for unknown types and empty input", () => {
    expect(mapWorkoutTypeToSport("quidditch")).toBe(ElevateSport.Other);
    expect(mapWorkoutTypeToSport("")).toBe(ElevateSport.Other);
  });
});

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

  it("interpolates power and cadence onto the GPS timeline", () => {
    const workout = {
      workout_type: "cycling",
      start: "2025-01-01T00:00:00Z",
      end: "2025-01-01T00:01:00Z",
      route_gpx: GPX,
      heart_rate: HR_TRACE,
      power: POWER_TRACE,
      cadence: CADENCE_TRACE
    } as ProviderWorkout;

    const streams = buildStreamsFromWorkout(workout, 60);
    expect(streams.time).toEqual([0, 30, 60]);
    // Power: 100 at t=0, 150 at t=30, 200 at t=60.
    expect(streams.watts).toEqual([100, 150, 200]);
    // Cadence: 80 at t=0, 90 at t=30, 100 at t=60.
    expect(streams.cadence).toEqual([80, 90, 100]);
  });

  it("builds a power/cadence timeline indoors with no route", () => {
    const workout = {
      workout_type: "cycling",
      start: "2025-01-01T00:00:00Z",
      end: "2025-01-01T00:01:00Z",
      is_indoor: true,
      power: POWER_TRACE,
      cadence: CADENCE_TRACE
    } as ProviderWorkout;

    const streams = buildStreamsFromWorkout(workout, 60);
    expect(streams).not.toBeNull();
    expect(streams.time).toEqual([0, 60]);
    expect(streams.watts).toEqual([100, 200]);
    expect(streams.cadence).toEqual([80, 100]);
    expect(streams.latlng).toBeUndefined();
    expect(streams.heartrate).toBeUndefined();
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

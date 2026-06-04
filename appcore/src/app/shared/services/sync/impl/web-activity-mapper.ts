import { Activity, ActivityStats, SlopeProfile } from "@elevate/shared/models/sync/activity.model";
import { ElevateSport } from "@elevate/shared/enums/elevate-sport.enum";
import { AthleteSnapshot } from "@elevate/shared/models/athlete/athlete-snapshot.model";
import { Movement } from "@elevate/shared/tools/movement";
import { Constant } from "@elevate/shared/constants/constant";
import { sha256 } from "@elevate/shared/tools/hash";
import { Streams } from "@elevate/shared/models/activity-data/streams.model";

/**
 * Wire shape of a workout served by the OpenHost health-data service
 * (github.com/imbue-openhost/health-data-service-spec, Workout container).
 * The proxy forwards provider responses verbatim, so values may be sparse.
 */
export interface ProviderScalar {
  value: number;
}

export interface ProviderWorkout {
  workout_type: string;
  start: string;
  end: string;
  source?: string;
  id?: string;
  metrics?: { [key: string]: number };
  duration?: ProviderScalar;
  calories?: ProviderScalar;
  average_heart_rate?: ProviderScalar;
  max_heart_rate?: ProviderScalar;
}

const WORKOUT_TYPE_TO_ELEVATE_SPORT: { [key: string]: ElevateSport } = {
  running: ElevateSport.Run,
  cycling: ElevateSport.Ride,
  swimming: ElevateSport.Swim,
  walking: ElevateSport.Walk,
  hiking: ElevateSport.Hike,
  strength: ElevateSport.WeightTraining,
  yoga: ElevateSport.Yoga,
  other: ElevateSport.Other
};

export function mapWorkoutTypeToSport(workoutType: string): ElevateSport {
  return WORKOUT_TYPE_TO_ELEVATE_SPORT[(workoutType || "").toLowerCase()] || ElevateSport.Other;
}

/** Build an ActivityStats with every nested sub-object present but unpopulated. */
export function createEmptyActivityStats(): ActivityStats {
  return {
    distance: null,
    elevationGain: null,
    elapsedTime: 0,
    movingTime: 0,
    pauseTime: 0,
    moveRatio: 1,
    calories: null,
    caloriesPerHour: null,
    speed: { avg: null, max: null, best20min: null, lowQ: null, median: null, upperQ: null, stdDev: null, zones: [], peaks: [] },
    pace: { avg: null, gapAvg: null, max: null, best20min: null, lowQ: null, median: null, upperQ: null, stdDev: null, zones: [] },
    power: {
      avg: null, avgKg: null, weighted: null, weightedKg: null, max: null, work: null, best20min: null,
      variabilityIndex: null, intensityFactor: null, lowQ: null, median: null, upperQ: null, stdDev: null, zones: [], peaks: []
    },
    heartRate: {
      avg: null, max: null, avgReserve: null, maxReserve: null, best20min: null, best60min: null,
      lowQ: null, median: null, upperQ: null, stdDev: null, zones: [], peaks: []
    },
    cadence: {
      avg: null, max: null, avgActive: null, activeRatio: null, activeTime: null, cycles: null, distPerCycle: null,
      lowQ: null, median: null, upperQ: null, slope: undefined, stdDev: null, zones: [], peaks: []
    },
    grade: {
      avg: null, max: null, min: null, lowQ: null, median: null, upperQ: null, stdDev: null,
      slopeTime: { up: null, flat: null, down: null }, slopeSpeed: { up: null, flat: null, down: null },
      slopePace: { up: null, flat: null, down: null }, slopeDistance: { up: null, flat: null, down: null },
      slopeCadence: { up: null, flat: null, down: null }, slopeProfile: SlopeProfile.FLAT, zones: []
    },
    elevation: {
      avg: null, max: null, min: null, ascent: null, descent: null, ascentSpeed: null,
      lowQ: null, median: null, upperQ: null, stdDev: null, elevationZones: []
    },
    scores: {
      stress: {
        hrss: null, hrssPerHour: null, trimp: null, trimpPerHour: null, rss: null, rssPerHour: null,
        sss: null, sssPerHour: null, pss: null, pssPerHour: null
      }
    }
  } as ActivityStats;
}

function num(value: number | null | undefined): number | null {
  return typeof value === "number" && isFinite(value) ? value : null;
}

/** Map a provider workout into a minimal-but-renderable elevate Activity plus (mock) streams. */
export async function buildActivityFromWorkout(
  workout: ProviderWorkout,
  athleteSnapshot: AthleteSnapshot
): Promise<{ activity: Activity; streams: Streams }> {
  const sport = mapWorkoutTypeToSport(workout.workout_type);
  const metrics = workout.metrics || {};

  const startTimestamp = Math.floor(Date.parse(workout.start) / 1000);
  const endTimestamp = Math.floor(Date.parse(workout.end) / 1000);

  const durationS = num(metrics["duration_s"]) ?? num(workout.duration?.value) ?? Math.max(0, endTimestamp - startTimestamp);
  const distanceM = num(metrics["distance_m"]);
  const calories = num(metrics["calories"]) ?? num(workout.calories?.value);
  const avgHr = num(metrics["average_heart_rate"]) ?? num(workout.average_heart_rate?.value);
  const maxHr = num(metrics["max_heart_rate"]) ?? num(workout.max_heart_rate?.value);

  const stats = createEmptyActivityStats();
  stats.elapsedTime = durationS;
  stats.movingTime = durationS;
  stats.distance = distanceM;
  stats.calories = calories;
  if (calories !== null && durationS > 0) {
    stats.caloriesPerHour = (calories / durationS) * Constant.SEC_HOUR_FACTOR;
  }
  if (distanceM !== null && durationS > 0) {
    stats.speed.avg = (distanceM / durationS) * Constant.MPS_KPH_FACTOR;
    stats.pace.avg = Movement.speedToPace(stats.speed.avg);
  }
  if (avgHr !== null) {
    stats.heartRate.avg = avgHr;
  }
  if (maxHr !== null) {
    stats.heartRate.max = maxHr;
  }

  const source = workout.source || "openhost";
  const id = workout.id ? `${source}:${workout.id}` : await sha256(`${source}:${workout.start}:${workout.end}`, true);
  const hash = await sha256(
    JSON.stringify({ type: sport, startTime: workout.start, endTime: workout.end, distance: distanceM }),
    true
  );

  const now = new Date().toISOString();
  const displaySport = sport.replace(/([A-Z])/g, " $1").trim();

  const activity = new Activity();
  activity.id = id;
  activity.name = `${displaySport} - ${workout.start.slice(0, 10)}`;
  activity.type = sport;
  activity.startTime = workout.start;
  activity.endTime = workout.end;
  activity.startTimestamp = startTimestamp;
  activity.endTimestamp = endTimestamp;
  activity.hasPowerMeter = Activity.isRide(sport);
  activity.trainer = false;
  activity.commute = false;
  activity.manual = false;
  activity.athleteSnapshot = athleteSnapshot;
  activity.stats = stats;
  activity.srcStats = stats;
  activity.laps = [];
  activity.hash = hash;
  activity.creationTime = now;
  activity.lastEditTime = now;
  activity.device = source;
  activity.notes = "";
  activity.autoDetectedType = false;
  activity.flags = [];
  activity.extras = {};

  const streams = buildMockStreams(sport, durationS, distanceM, avgHr);

  return { activity, streams };
}

const OUTDOOR_SPORTS = new Set<string>([
  ElevateSport.Run,
  ElevateSport.Ride,
  ElevateSport.Walk,
  ElevateSport.Hike,
  ElevateSport.VirtualRun,
  ElevateSport.Swim
]);

/**
 * Generate plausible per-second streams for a workout so the activity-view (graph, map, peaks,
 * time-in-zones) has data to render. PLACEHOLDER until providers expose real streams — values
 * are deterministic synthetic curves derived from the workout's summary metrics.
 */
export function buildMockStreams(
  sport: ElevateSport,
  durationS: number,
  distanceM: number | null,
  avgHr: number | null
): Streams {
  const streams = new Streams();
  const duration = Math.max(60, Math.round(durationS) || 600);
  const step = Math.max(1, Math.ceil(duration / 1800)); // cap ~1800 points
  const n = Math.floor(duration / step) + 1;

  const isRide = Activity.isRide(sport);
  const isRun = Activity.isRun(sport);
  const hasGps = OUTDOOR_SPORTS.has(sport);

  const baseHr = avgHr ?? (isRide ? 135 : isRun ? 150 : 115);
  const totalDistance = distanceM ?? (hasGps ? (isRide ? duration * 7 : duration * 2.5) : 0);
  const avgSpeed = totalDistance > 0 ? totalDistance / duration : 0;

  streams.time = [];
  streams.heartrate = [];
  streams.velocity_smooth = [];
  streams.distance = [];
  streams.altitude = [];
  streams.cadence = [];
  streams.grade_smooth = [];
  streams.temp = [];
  streams.watts = isRide ? [] : [];
  streams.latlng = hasGps ? [] : [];
  streams.watts_calc = [];
  streams.grade_adjusted_speed = [];
  streams.grade_adjusted_distance = [];

  const baseLat = 37.7749;
  const baseLng = -122.4194;

  for (let i = 0; i < n; i++) {
    const t = i * step;
    const p = t / duration; // progress 0..1
    const wobble = Math.sin(p * Math.PI * 8) * 0.5 + Math.sin(p * Math.PI * 31) * 0.5;

    streams.time.push(t);
    streams.heartrate.push(Math.round(baseHr + wobble * 12 + Math.sin(p * Math.PI) * 8));

    const speed = avgSpeed > 0 ? Math.max(0, avgSpeed * (1 + wobble * 0.25)) : 0;
    streams.velocity_smooth.push(+speed.toFixed(2));
    streams.distance.push(+(totalDistance * p).toFixed(1));

    const altitude = 80 + Math.sin(p * Math.PI * 3) * 25;
    streams.altitude.push(+altitude.toFixed(1));
    streams.grade_smooth.push(+(Math.cos(p * Math.PI * 3) * 4).toFixed(1));
    streams.cadence.push(isRide ? Math.round(85 + wobble * 8) : isRun ? Math.round(168 + wobble * 6) : 0);
    streams.temp.push(20);

    if (isRide) {
      streams.watts.push(Math.round(160 + wobble * 60 + Math.sin(p * Math.PI) * 30));
    }

    if (hasGps) {
      // small looping route scaled by distance
      const radius = Math.min(0.02, 0.0005 + totalDistance / 5_000_000);
      streams.latlng.push([
        +(baseLat + Math.sin(p * Math.PI * 2) * radius).toFixed(6),
        +(baseLng + Math.cos(p * Math.PI * 2) * radius).toFixed(6)
      ]);
    }
  }

  return streams;
}

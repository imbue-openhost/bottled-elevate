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
 * Scalars serialize as { value, ... }; the HR trace and GPS route are optional.
 */
export interface ProviderScalar {
  value: number;
}

export interface ProviderSample {
  timestamp: string;
  value: number;
}

export interface ProviderTimeSeries {
  samples: ProviderSample[];
}

export interface ProviderWorkout {
  workout_type: string;
  start: string;
  end: string;
  source?: string;
  id?: string;
  is_indoor?: boolean;

  duration?: ProviderScalar; // minutes
  calories?: ProviderScalar; // kcal
  average_heart_rate?: ProviderScalar; // bpm
  max_heart_rate?: ProviderScalar; // bpm
  lowest_heart_rate?: ProviderScalar; // bpm
  distance?: ProviderScalar; // meters
  average_speed?: ProviderScalar; // m/s
  elevation_gain?: ProviderScalar; // meters
  average_pace?: ProviderScalar; // s/km
  temperature?: ProviderScalar; // °C

  heart_rate?: ProviderTimeSeries; // per-sample HR trace
  route_gpx?: string; // GPX 1.1 document
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

/** Map a provider workout into a minimal-but-renderable elevate Activity plus streams. */
export async function buildActivityFromWorkout(
  workout: ProviderWorkout,
  athleteSnapshot: AthleteSnapshot
): Promise<{ activity: Activity; streams: Streams | null }> {
  const sport = mapWorkoutTypeToSport(workout.workout_type);

  const startTimestamp = Math.floor(Date.parse(workout.start) / 1000);
  const endTimestamp = Math.floor(Date.parse(workout.end) / 1000);

  const durationMin = num(workout.duration?.value);
  const durationS = durationMin !== null ? durationMin * 60 : Math.max(0, endTimestamp - startTimestamp);
  const distanceM = num(workout.distance?.value);
  const calories = num(workout.calories?.value);
  const avgHr = num(workout.average_heart_rate?.value);
  const maxHr = num(workout.max_heart_rate?.value);
  const avgSpeedMps = num(workout.average_speed?.value);
  const elevationGainM = num(workout.elevation_gain?.value);
  const avgPaceSPerKm = num(workout.average_pace?.value);

  const stats = createEmptyActivityStats();
  stats.elapsedTime = durationS;
  stats.movingTime = durationS;
  stats.distance = distanceM;
  stats.elevationGain = elevationGainM;
  stats.calories = calories;
  if (calories !== null && durationS > 0) {
    stats.caloriesPerHour = (calories / durationS) * Constant.SEC_HOUR_FACTOR;
  }
  // Average speed (km/h): prefer the reported value, else derive from distance/duration.
  if (avgSpeedMps !== null) {
    stats.speed.avg = avgSpeedMps * Constant.MPS_KPH_FACTOR;
  } else if (distanceM !== null && durationS > 0) {
    stats.speed.avg = (distanceM / durationS) * Constant.MPS_KPH_FACTOR;
  }
  if (avgPaceSPerKm !== null) {
    stats.pace.avg = avgPaceSPerKm;
  } else if (stats.speed.avg) {
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

  const streams = buildStreamsFromWorkout(workout, durationS);

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
  activity.hasPowerMeter = false; // no power trace from Apple Health
  activity.trainer = false;
  activity.commute = false;
  activity.manual = false;
  const hasGps = !!streams?.latlng?.length;
  activity.isSwimPool = Activity.isSwim(sport) && !hasGps;
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

  return { activity, streams };
}

// ---------------------------------------------------------------------------
// Real stream extraction (HR trace + GPS route)
// ---------------------------------------------------------------------------

interface GpxPoint {
  t: number | null; // epoch ms
  lat: number;
  lon: number;
  ele: number | null;
}

interface HrSample {
  t: number; // epoch ms
  v: number;
}

/**
 * Build elevate Streams from the workout's HR trace and/or GPS route.
 * - With a GPS route, the trackpoints form the timeline (lat/lng, altitude, distance,
 *   speed, grade) and HR is interpolated onto it.
 * - Without a route, an HR-only timeline is produced (e.g. indoor workouts).
 * Returns null when neither trace is present.
 */
export function buildStreamsFromWorkout(workout: ProviderWorkout, durationS: number): Streams | null {
  const hrSamples = parseHrSamples(workout.heart_rate);
  const gpxPoints = workout.route_gpx ? parseGpxTrack(workout.route_gpx) : [];

  if (gpxPoints.length >= 2 && !workout.is_indoor) {
    return streamsFromRoute(gpxPoints, hrSamples, durationS);
  }
  if (hrSamples.length >= 2) {
    return streamsFromHrOnly(hrSamples);
  }
  return null;
}

function parseHrSamples(trace: ProviderTimeSeries | undefined): HrSample[] {
  if (!trace?.samples?.length) {
    return [];
  }
  return trace.samples
    .map(s => ({ t: Date.parse(s.timestamp), v: s.value }))
    .filter(s => isFinite(s.t) && num(s.v) !== null)
    .sort((a, b) => a.t - b.t);
}

function parseGpxTrack(gpx: string): GpxPoint[] {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(gpx, "application/xml");
  } catch {
    return [];
  }
  if (doc.getElementsByTagName("parsererror").length) {
    return [];
  }
  const points: GpxPoint[] = [];
  const trkpts = doc.getElementsByTagName("trkpt");
  for (let i = 0; i < trkpts.length; i++) {
    const pt = trkpts[i];
    const lat = parseFloat(pt.getAttribute("lat") || "");
    const lon = parseFloat(pt.getAttribute("lon") || "");
    if (!isFinite(lat) || !isFinite(lon)) {
      continue;
    }
    const eleText = pt.getElementsByTagName("ele")[0]?.textContent;
    const timeText = pt.getElementsByTagName("time")[0]?.textContent;
    const ele = eleText ? parseFloat(eleText) : NaN;
    const t = timeText ? Date.parse(timeText) : NaN;
    points.push({ t: isFinite(t) ? t : null, lat, lon, ele: isFinite(ele) ? ele : null });
  }
  return points;
}

function haversineMeters(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const lat1 = (aLat * Math.PI) / 180;
  const lat2 = (bLat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Linearly interpolate HR (epoch ms) onto an arbitrary time, clamping at the ends. */
function interpolateHr(samples: HrSample[], t: number): number | null {
  if (!samples.length) {
    return null;
  }
  if (t <= samples[0].t) {
    return samples[0].v;
  }
  if (t >= samples[samples.length - 1].t) {
    return samples[samples.length - 1].v;
  }
  for (let i = 1; i < samples.length; i++) {
    if (samples[i].t >= t) {
      const a = samples[i - 1];
      const b = samples[i];
      const span = b.t - a.t;
      const frac = span > 0 ? (t - a.t) / span : 0;
      return Math.round(a.v + (b.v - a.v) * frac);
    }
  }
  return samples[samples.length - 1].v;
}

function streamsFromRoute(points: GpxPoint[], hrSamples: HrSample[], durationS: number): Streams {
  const streams = new Streams();
  const n = points.length;
  const t0 = points[0].t;

  streams.time = [];
  streams.latlng = [];
  streams.distance = [];
  streams.velocity_smooth = [];
  const hasEle = points.some(p => p.ele !== null);
  if (hasEle) {
    streams.altitude = [];
    streams.grade_smooth = [];
  }
  if (hrSamples.length) {
    streams.heartrate = [];
  }

  let cumDist = 0;
  for (let i = 0; i < n; i++) {
    const p = points[i];
    // Time: real GPX timestamps when present, else spread evenly across duration.
    const time = p.t !== null && t0 !== null ? Math.round((p.t - t0) / 1000) : Math.round((i / (n - 1)) * durationS);
    streams.time.push(time);
    streams.latlng.push([p.lat, p.lon]);

    if (i > 0) {
      cumDist += haversineMeters(points[i - 1].lat, points[i - 1].lon, p.lat, p.lon);
    }
    streams.distance.push(+cumDist.toFixed(1));

    const dt = i > 0 ? streams.time[i] - streams.time[i - 1] : 0;
    const dDist = i > 0 ? streams.distance[i] - streams.distance[i - 1] : 0;
    streams.velocity_smooth.push(dt > 0 ? +(dDist / dt).toFixed(2) : 0);

    if (hasEle) {
      const ele = p.ele ?? (i > 0 ? streams.altitude[i - 1] : 0);
      streams.altitude.push(+ele.toFixed(1));
      const dEle = i > 0 ? streams.altitude[i] - streams.altitude[i - 1] : 0;
      const grade = dDist > 0 ? Math.max(-45, Math.min(45, (dEle / dDist) * 100)) : 0;
      streams.grade_smooth.push(+grade.toFixed(1));
    }

    if (hrSamples.length) {
      const at = p.t !== null ? p.t : (t0 ?? 0) + time * 1000;
      streams.heartrate.push(interpolateHr(hrSamples, at) ?? hrSamples[0].v);
    }
  }

  return streams;
}

function streamsFromHrOnly(hrSamples: HrSample[]): Streams {
  const streams = new Streams();
  const t0 = hrSamples[0].t;
  streams.time = hrSamples.map(s => Math.round((s.t - t0) / 1000));
  streams.heartrate = hrSamples.map(s => Math.round(s.v));
  return streams;
}

import _ from "lodash";
import { Activity, ActivityStats, Lap, SlopeProfile } from "@elevate/shared/models/sync/activity.model";
import { ElevateSport } from "@elevate/shared/enums/elevate-sport.enum";
import { MeasureSystem } from "@elevate/shared/enums/measure-system.enum";
import { AthleteSnapshot } from "@elevate/shared/models/athlete/athlete-snapshot.model";
import { Movement } from "@elevate/shared/tools/movement";
import { Constant } from "@elevate/shared/constants/constant";
import { sha256 } from "@elevate/shared/tools/hash";
import { Streams } from "@elevate/shared/models/activity-data/streams.model";
import { ActivityComputer } from "@elevate/shared/sync/compute/activity-computer";
import { UserSettings } from "@elevate/shared/models/user-settings/user-settings.namespace";

/**
 * Wire shape of a workout served by the OpenHost health-data service
 * (github.com/imbue-openhost/health-data-service-spec). The list endpoint returns
 * scalar summaries only; the per-workout detail endpoint adds the HR trace + route.
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
  average_power?: ProviderScalar; // watts
  max_power?: ProviderScalar; // watts
  average_cadence?: ProviderScalar; // rpm
  max_cadence?: ProviderScalar; // rpm

  heart_rate?: ProviderTimeSeries; // per-sample HR trace (detail endpoint only)
  power?: ProviderTimeSeries; // per-sample power trace (detail endpoint only)
  cadence?: ProviderTimeSeries; // per-sample cadence trace (detail endpoint only)
  route_gpx?: string; // GPX 1.1 document (detail endpoint only)
}

// Overrides for workout_type slugs whose elevate sport differs from a plain
// PascalCase of the slug (name mismatch, or a more specific sport fits). Types
// that PascalCase straight onto an ElevateSport value (yoga, volleyball, tennis,
// rowing, badminton, ...) need no entry — they auto-map below.
const WORKOUT_TYPE_OVERRIDES: { [key: string]: ElevateSport } = {
  running: ElevateSport.Run,
  cycling: ElevateSport.Ride,
  swimming: ElevateSport.Swim,
  walking: ElevateSport.Walk,
  hiking: ElevateSport.Hike,
  strength: ElevateSport.WeightTraining,
  snowboarding: ElevateSport.Snowboard,
  downhill_skiing: ElevateSport.AlpineSki,
  stair_climbing: ElevateSport.StairStepper,
  cardio_dance: ElevateSport.Dance,
  core_training: ElevateSport.WeightTraining,
  other: ElevateSport.Other
};

const ELEVATE_SPORT_VALUES: Set<string> = new Set(Object.values(ElevateSport));

function pascalCase(slug: string): string {
  return slug
    .split(/[_\s]+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join("");
}

export function mapWorkoutTypeToSport(workoutType: string): ElevateSport {
  const key = (workoutType || "").toLowerCase();
  if (WORKOUT_TYPE_OVERRIDES[key]) {
    return WORKOUT_TYPE_OVERRIDES[key];
  }
  const candidate = pascalCase(key);
  return ELEVATE_SPORT_VALUES.has(candidate) ? (candidate as ElevateSport) : ElevateSport.Other;
}

export function workoutDurationS(workout: ProviderWorkout): number {
  const minutes = num(workout.duration?.value);
  if (minutes !== null) {
    return minutes * 60;
  }
  return Math.max(0, Math.floor((Date.parse(workout.end) - Date.parse(workout.start)) / 1000));
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

/** Sparse summary stats from the workout's scalar fields (overlaid on computed stats). */
function buildSummaryStats(workout: ProviderWorkout, durationS: number): Partial<ActivityStats> {
  const distanceM = num(workout.distance?.value);
  const calories = num(workout.calories?.value);
  const avgHr = num(workout.average_heart_rate?.value);
  const maxHr = num(workout.max_heart_rate?.value);
  const avgSpeedMps = num(workout.average_speed?.value);
  const elevationGainM = num(workout.elevation_gain?.value);
  const avgPaceSPerKm = num(workout.average_pace?.value);

  const src: any = { elapsedTime: durationS, movingTime: durationS, moveRatio: 1 };
  if (distanceM !== null) src.distance = distanceM;
  if (elevationGainM !== null) src.elevationGain = elevationGainM;
  if (calories !== null) {
    src.calories = calories;
    if (durationS > 0) src.caloriesPerHour = (calories / durationS) * Constant.SEC_HOUR_FACTOR;
  }
  const speedKph =
    avgSpeedMps !== null
      ? avgSpeedMps * Constant.MPS_KPH_FACTOR
      : distanceM !== null && durationS > 0
      ? (distanceM / durationS) * Constant.MPS_KPH_FACTOR
      : null;
  if (speedKph !== null) src.speed = { avg: speedKph };
  const paceVal = avgPaceSPerKm !== null ? avgPaceSPerKm : speedKph ? Movement.speedToPace(speedKph) : null;
  if (paceVal !== null) src.pace = { avg: paceVal };
  // Only set non-null fields: _.merge overwrites with null (it skips only undefined),
  // which would otherwise wipe stream-computed HR avg/max.
  if (avgHr !== null || maxHr !== null) {
    src.heartRate = {};
    if (avgHr !== null) src.heartRate.avg = avgHr;
    if (maxHr !== null) src.heartRate.max = maxHr;
  }
  return src;
}

/** Estimate HR stress (Banister TRIMP -> HRSS) from average HR, for workouts without a HR trace. */
function applyEstimatedStress(
  stats: ActivityStats,
  snapshot: AthleteSnapshot,
  sport: ElevateSport,
  avgHr: number | null,
  durationS: number
): void {
  const settings = snapshot?.athleteSettings;
  if (avgHr === null || !settings || durationS <= 0) {
    return;
  }
  const hrr = ActivityComputer.heartRateReserveRatio(avgHr, settings.maxHr, settings.restHr);
  const trimp = ActivityComputer.trainingImpulse(durationS, hrr * 100, snapshot.gender);
  const lthr = ActivityComputer.resolveLTHR(sport, settings);
  const hrss = ActivityComputer.computeHeartRateStressScore(snapshot.gender, settings.maxHr, settings.restHr, lthr, trimp);
  stats.scores.stress.trimp = trimp;
  stats.scores.stress.trimpPerHour = (trimp / durationS) * Constant.SEC_HOUR_FACTOR;
  if (hrss !== null) {
    stats.scores.stress.hrss = hrss;
    stats.scores.stress.hrssPerHour = (hrss / durationS) * Constant.SEC_HOUR_FACTOR;
  }
}

/**
 * Build a fully-populated elevate Activity (+streams) from a full workout detail.
 * When streams exist, ActivityComputer derives the rich stats (peaks, zones, scores);
 * otherwise summary scalars + an avg-HR stress estimate keep the activity usable.
 */
export async function buildActivityFromWorkout(
  workout: ProviderWorkout,
  athleteSnapshot: AthleteSnapshot,
  userSettings: UserSettings.BaseUserSettings
): Promise<{ activity: Activity; streams: Streams | null }> {
  const sport = mapWorkoutTypeToSport(workout.workout_type);
  const durationS = workoutDurationS(workout);
  const avgHr = num(workout.average_heart_rate?.value);
  const distanceM = num(workout.distance?.value);
  const startTimestamp = Math.floor(Date.parse(workout.start) / 1000);
  const endTimestamp = Math.floor(Date.parse(workout.end) / 1000);

  const streams = buildStreamsFromWorkout(workout, durationS);
  const hasGps = !!streams?.latlng?.length;

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
  activity.hasPowerMeter = !!streams?.watts?.length;
  activity.trainer = false;
  activity.commute = false;
  activity.manual = false;
  activity.isSwimPool = Activity.isSwim(sport) && !hasGps;
  activity.athleteSnapshot = athleteSnapshot;
  activity.laps = []; // computed on-demand from streams in the activity view
  activity.hash = hash;
  activity.creationTime = now;
  activity.lastEditTime = now;
  activity.device = source;
  activity.notes = "";
  activity.autoDetectedType = false;
  activity.flags = [];
  activity.extras = {};

  const srcStats = buildSummaryStats(workout, durationS);

  let stats: ActivityStats;
  if (streams) {
    try {
      const computed = ActivityComputer.compute(activity, athleteSnapshot, userSettings, streams, true, true);
      stats = _.merge(computed, srcStats); // summary scalars win over stream-derived where set
    } catch {
      stats = _.merge(createEmptyActivityStats(), srcStats);
      applyEstimatedStress(stats, athleteSnapshot, sport, avgHr, durationS);
    }
  } else {
    stats = _.merge(createEmptyActivityStats(), srcStats);
    applyEstimatedStress(stats, athleteSnapshot, sport, avgHr, durationS);
  }

  activity.stats = stats;
  activity.srcStats = srcStats;

  return { activity, streams };
}

// ---------------------------------------------------------------------------
// Stream extraction (HR / power / cadence traces + GPS route)
// ---------------------------------------------------------------------------

interface GpxPoint {
  t: number | null; // epoch ms
  lat: number;
  lon: number;
  ele: number | null;
}

interface TimedSample {
  t: number; // epoch ms
  v: number;
}

/**
 * Build elevate Streams from the workout's sensor traces (HR, power, cadence)
 * and/or GPS route. With a route, the trackpoints form the timeline and each
 * trace is interpolated onto it; otherwise the densest trace forms the timeline.
 * Returns null when no usable trace or route is present.
 */
export function buildStreamsFromWorkout(workout: ProviderWorkout, durationS: number): Streams | null {
  const hrSamples = parseSamples(workout.heart_rate);
  const powerSamples = parseSamples(workout.power);
  const cadenceSamples = parseSamples(workout.cadence);
  const gpxPoints = workout.route_gpx ? parseGpxTrack(workout.route_gpx) : [];

  if (gpxPoints.length >= 2 && !workout.is_indoor) {
    return streamsFromRoute(gpxPoints, hrSamples, powerSamples, cadenceSamples, durationS);
  }
  // No usable route: build the timeline from the richest sensor trace and
  // interpolate the others onto it.
  const base = [hrSamples, powerSamples, cadenceSamples].filter(s => s.length >= 2).sort((a, b) => b.length - a.length)[0];
  if (base) {
    return streamsFromSensors(base, hrSamples, powerSamples, cadenceSamples);
  }
  return null;
}

function parseSamples(trace: ProviderTimeSeries | undefined): TimedSample[] {
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

/** Linearly interpolate a sample value (epoch ms) onto an arbitrary time, clamping at the ends. */
function interpolateSample(samples: TimedSample[], t: number): number | null {
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

function streamsFromRoute(
  points: GpxPoint[],
  hrSamples: TimedSample[],
  powerSamples: TimedSample[],
  cadenceSamples: TimedSample[],
  durationS: number
): Streams {
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
  if (hrSamples.length) streams.heartrate = [];
  if (powerSamples.length) streams.watts = [];
  if (cadenceSamples.length) streams.cadence = [];

  let cumDist = 0;
  for (let i = 0; i < n; i++) {
    const p = points[i];
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

    const at = p.t !== null ? p.t : (t0 ?? 0) + time * 1000;
    if (hrSamples.length) {
      streams.heartrate.push(interpolateSample(hrSamples, at) ?? hrSamples[0].v);
    }
    if (powerSamples.length) {
      streams.watts.push(interpolateSample(powerSamples, at) ?? powerSamples[0].v);
    }
    if (cadenceSamples.length) {
      streams.cadence.push(interpolateSample(cadenceSamples, at) ?? cadenceSamples[0].v);
    }
  }

  return streams;
}

/**
 * Build streams from sensor traces with no GPS: the densest trace (base) forms
 * the timeline, and every available trace is interpolated onto it.
 */
function streamsFromSensors(
  base: TimedSample[],
  hrSamples: TimedSample[],
  powerSamples: TimedSample[],
  cadenceSamples: TimedSample[]
): Streams {
  const streams = new Streams();
  const t0 = base[0].t;
  streams.time = base.map(s => Math.round((s.t - t0) / 1000));
  if (hrSamples.length) streams.heartrate = base.map(s => interpolateSample(hrSamples, s.t) ?? hrSamples[0].v);
  if (powerSamples.length) streams.watts = base.map(s => interpolateSample(powerSamples, s.t) ?? powerSamples[0].v);
  if (cadenceSamples.length) streams.cadence = base.map(s => interpolateSample(cadenceSamples, s.t) ?? cadenceSamples[0].v);
  return streams;
}

// ---------------------------------------------------------------------------
// Auto-laps (Apple Health workouts carry no lap markers, so split by distance)
// ---------------------------------------------------------------------------

function safeMax(values: number[]): number | null {
  let max = -Infinity;
  for (const v of values) {
    if (typeof v === "number" && isFinite(v) && v > max) max = v;
  }
  return isFinite(max) ? max : null;
}

function makeLap(streams: Streams, a: number, b: number, id: number): Lap {
  const slice = (arr: number[] | undefined): number[] =>
    (arr || []).slice(a, b + 1).filter(v => typeof v === "number" && isFinite(v));

  const distance = streams.distance[b] - streams.distance[a];
  const elapsedTime = streams.time[b] - streams.time[a];
  const speedsMps = slice(streams.velocity_smooth);
  const avgSpeed =
    speedsMps.length > 0
      ? _.mean(speedsMps) * Constant.MPS_KPH_FACTOR
      : elapsedTime > 0
      ? (distance / elapsedTime) * Constant.MPS_KPH_FACTOR
      : null;
  const maxSpeedMps = safeMax(speedsMps);
  const hr = slice(streams.heartrate);

  const lap: Lap = { id, active: true, indexes: [a, b], distance: _.round(distance), elapsedTime, movingTime: elapsedTime };
  if (avgSpeed !== null) {
    lap.avgSpeed = _.round(avgSpeed, 2);
    lap.avgPace = Movement.speedToPace(avgSpeed);
  }
  if (maxSpeedMps !== null) lap.maxSpeed = _.round(maxSpeedMps * Constant.MPS_KPH_FACTOR, 2);
  if (hr.length > 0) {
    lap.avgHr = _.round(_.mean(hr));
    lap.maxHr = safeMax(hr);
  }
  if (streams.altitude?.length) {
    let gain = 0;
    for (let i = a + 1; i <= b; i++) {
      const d = streams.altitude[i] - streams.altitude[i - 1];
      if (d > 0) gain += d;
    }
    lap.elevationGain = _.round(gain);
  }
  return lap;
}

/** Split an activity into per-distance laps (1 mi imperial / 1 km metric) from its streams. */
export function buildLaps(streams: Streams, measureSystem: MeasureSystem): Lap[] {
  const dist = streams?.distance;
  const time = streams?.time;
  if (!dist?.length || !time?.length || dist.length !== time.length || _.last(dist) <= 0) {
    return [];
  }
  const lapMeters = measureSystem === MeasureSystem.IMPERIAL ? 1609.344 : 1000;
  const laps: Lap[] = [];
  let start = 0;
  let boundary = lapMeters;
  let id = 1;
  const n = dist.length;
  for (let i = 1; i < n; i++) {
    if (dist[i] >= boundary) {
      laps.push(makeLap(streams, start, i, id++));
      start = i;
      boundary = dist[i] + lapMeters;
    }
  }
  if (n - 1 > start) {
    laps.push(makeLap(streams, start, n - 1, id));
  }
  return laps;
}

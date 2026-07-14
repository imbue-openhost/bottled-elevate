import _ from "lodash";
import moment from "moment";
import { Stat } from "../../activity-view/shared/models/stats/stat.model";
import { MeasureSystem } from "@elevate/shared/enums/measure-system.enum";
import { ComparedWorkout } from "./compare.model";

export interface StatChartPoint {
  x: Date;
  y: number | Date;
  text: string;
  color: string;
  isTimeValue: boolean;
  seconds: number | null;
}

// Matches Time.secToMilitary outputs such as "05:23" or "1:05:23"
const MILITARY_TIME_PATTERN = /^-?\d+(:\d{1,2}){1,2}$/;

function militaryToSeconds(display: string): number {
  const negative = display.startsWith("-");
  const seconds = display
    .replace("-", "")
    .split(":")
    .map(Number)
    .reduce((total, part) => total * 60 + part, 0);
  return negative ? -seconds : seconds;
}

export function resolveStatUnit(stat: Stat<any>, measureSystem: MeasureSystem): string {
  if (stat.unit || stat.unit === null) {
    return stat.unit;
  }
  return stat.baseSensor.displayUnit ? stat.baseSensor.getDisplayUnit(measureSystem) : null;
}

/**
 * Compute one chart point per workout for a given stat. Values are charted with the same
 * conversion/formatting rules as the classic stat tiles: numeric formats plot as-is while
 * "military time" formats (pace, durations) plot on a time y-axis.
 */
export function buildStatChartPoints(
  stat: Stat<any>,
  workouts: ComparedWorkout[],
  measureSystem: MeasureSystem
): StatChartPoint[] {
  const unit = resolveStatUnit(stat, measureSystem);
  const points: StatChartPoint[] = [];

  for (const workout of workouts) {
    const rawValue = _.get(workout.activity, stat.path);
    if (!Number.isFinite(rawValue)) {
      continue;
    }

    const statValue = (rawValue as number) * stat.factor;
    const display = stat.baseSensor.formatFromStat(
      statValue,
      measureSystem,
      stat.roundDecimals || stat.baseSensor.defaultRoundDecimals
    );

    let y: number | Date;
    let isTimeValue = false;
    let seconds: number = null;

    if (typeof display === "number" && Number.isFinite(display)) {
      y = display;
    } else if (typeof display === "string" && MILITARY_TIME_PATTERN.test(display)) {
      seconds = militaryToSeconds(display);
      y = moment().startOf("day").add(seconds, "seconds").toDate();
      isTimeValue = true;
    } else {
      continue;
    }

    points.push({
      x: new Date(workout.activity.startTime),
      y: y,
      text: `${workout.label}: ${display}${unit ? " " + unit : ""}`,
      color: workout.color,
      isTimeValue: isTimeValue,
      seconds: seconds
    });
  }

  return points;
}

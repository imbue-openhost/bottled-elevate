import { Activity } from "@elevate/shared/models/sync/activity.model";
import { Streams } from "@elevate/shared/models/activity-data/streams.model";
import { Sensor } from "../../activity-view/shared/models/sensors/sensor.model";

export interface ComparedWorkout {
  activity: Activity;
  streams: Streams | null;
  color: string;
  label: string;
}

export interface CompareSensorEntry {
  workout: ComparedWorkout;
  sensor: Sensor;
}

export enum CompareScaleMode {
  TIME,
  DISTANCE
}

export const COMPARE_MAX_WORKOUTS = 8;

// Categorical palette validated for CVD separation and contrast on both app themes
// (worst adjacent deutan/protan ΔE 10.3; workout identity is also carried by legends/labels)
export const COMPARE_COLOR_PALETTE: string[] = [
  "#3987e5",
  "#199e70",
  "#c98500",
  "#008300",
  "#9085e9",
  "#e66767",
  "#d55181",
  "#d95926"
];

import { Component, Inject, OnInit } from "@angular/core";
import { ActivatedRoute, Router } from "@angular/router";
import { Location } from "@angular/common";
import _ from "lodash";
import moment from "moment";
import { ActivityService } from "../../shared/services/activity/activity.service";
import { WebActivityService } from "../../shared/services/activity/impl/web-activity.service";
import { StreamsService } from "../../shared/services/streams/streams.service";
import { UserSettingsService } from "../../shared/services/user-settings/user-settings.service";
import { ActivitySensorsService } from "../activity-view/shared/activity-sensors.service";
import { ActivityStatsService } from "../activity-view/shared/activity-stats.service";
import { Sensor } from "../activity-view/shared/models/sensors/sensor.model";
import { SMOOTHING_OPTIONS, SmoothingOption } from "../activity-view/shared/stream-smoother";
import { Stat } from "../activity-view/shared/models/stats/stat.model";
import { AppRoutes } from "../../shared/models/app-routes";
import { MatSnackBar } from "@angular/material/snack-bar";
import { UserSettings } from "@elevate/shared/models/user-settings/user-settings.namespace";
import { MeasureSystem } from "@elevate/shared/enums/measure-system.enum";
import { ProcessStreamMode } from "@elevate/shared/sync/compute/stream-processor";
import { Activity, Peak } from "@elevate/shared/models/sync/activity.model";
import { Streams } from "@elevate/shared/models/activity-data/streams.model";
import {
  COMPARE_COLOR_PALETTE,
  CompareScaleMode,
  CompareSensorEntry,
  ComparedWorkout
} from "./shared/compare.model";
import { buildStatChartPoints } from "./shared/compare-stat-points.util";
import BaseUserSettings = UserSettings.BaseUserSettings;

export interface CompareGraphRow {
  title: string;
  sensor: Sensor;
  entries: CompareSensorEntry[];
}

export interface ComparePeaksEntry extends CompareSensorEntry {
  peaks: Peak[];
}

export interface ComparePeaksRow {
  title: string;
  sensor: Sensor;
  entries: ComparePeaksEntry[];
}

export interface CompareStatsGroupRow {
  name: string;
  color: string;
  stats: Stat<any>[];
}

@Component({
  selector: "app-activity-compare",
  templateUrl: "./activity-compare.component.html",
  styleUrls: ["./activity-compare.component.scss"]
})
export class ActivityCompareComponent implements OnInit {
  private static readonly GRAPH_STREAMS_ORDER: (keyof Streams)[] = [
    "altitude",
    "velocity_smooth",
    "heartrate",
    "watts",
    "cadence",
    "grade_adjusted_speed"
  ];

  private static readonly PEAKS_STREAMS_ORDER: (keyof Streams)[] = ["watts", "heartrate", "velocity_smooth", "cadence"];

  public readonly CompareScaleMode = CompareScaleMode;

  public readonly smoothingOptions: SmoothingOption[] = SMOOTHING_OPTIONS;

  public smoothingSeconds: number;

  public workouts: ComparedWorkout[];
  public mapWorkouts: ComparedWorkout[];
  public graphRows: CompareGraphRow[];
  public peaksRows: ComparePeaksRow[];
  public statsGroupRows: CompareStatsGroupRow[];
  public userSettings: BaseUserSettings;
  public scaleMode: CompareScaleMode;
  public hasDistance: boolean;
  public initialized: boolean;

  constructor(
    @Inject(ActivatedRoute) private readonly route: ActivatedRoute,
    @Inject(UserSettingsService) private readonly userSettingsService: UserSettingsService,
    @Inject(ActivityService) protected readonly activityService: WebActivityService,
    @Inject(StreamsService) protected readonly streamsService: StreamsService,
    @Inject(ActivitySensorsService) private readonly activitySensorsService: ActivitySensorsService,
    @Inject(ActivityStatsService) private readonly activityStatsService: ActivityStatsService,
    @Inject(Router) protected readonly router: Router,
    @Inject(Location) private readonly location: Location,
    @Inject(MatSnackBar) protected readonly snackBar: MatSnackBar
  ) {
    this.workouts = [];
    this.mapWorkouts = [];
    this.graphRows = [];
    this.peaksRows = [];
    this.statsGroupRows = [];
    this.initialized = false;
    this.smoothingSeconds = 0;
  }

  public ngOnInit(): void {
    const ids: string[] = (this.route.snapshot.params.ids || "").split(",").filter(id => !!id);

    if (ids.length < 2) {
      this.snackBar.open("At least 2 activities are required for comparison.", "Ok", { duration: 5000 });
      this.onBack();
      return;
    }

    this.userSettingsService
      .fetch()
      .then((userSettings: BaseUserSettings) => {
        this.userSettings = userSettings;
        return Promise.all(ids.map(id => this.activityService.getById(id)));
      })
      .then((activities: Activity[]) => {
        const foundActivities = _.sortBy(
          activities.filter(activity => !!activity),
          activity => activity.startTime
        );

        if (foundActivities.length < 2) {
          this.snackBar.open("Unable to find the activities to compare.", "Ok", { duration: 5000 });
          this.onBack();
          return Promise.reject();
        }

        return Promise.all(
          foundActivities.map(activity =>
            this.streamsService
              .getProcessedById(ProcessStreamMode.DISPLAY, activity.id, {
                type: activity.type,
                hasPowerMeter: activity.hasPowerMeter,
                isSwimPool: activity.isSwimPool,
                athleteSnapshot: activity.athleteSnapshot
              })
              .catch(() => null as Streams)
          )
        ).then((streamsList: Streams[]) => {
          this.workouts = foundActivities.map((activity, index) => {
            return {
              activity: activity,
              streams: activity.isSwimPool ? null : streamsList[index],
              color: COMPARE_COLOR_PALETTE[index % COMPARE_COLOR_PALETTE.length],
              label: `${moment(activity.startTime).format("ll")} · ${activity.name}`
            };
          });

          this.mapWorkouts = this.workouts.filter(workout => workout.streams?.latlng?.length > 0);

          const streamedWorkouts = this.workouts.filter(workout => !!workout.streams);
          this.hasDistance =
            streamedWorkouts.length > 0 && streamedWorkouts.every(workout => workout.streams.distance?.length > 0);
          this.scaleMode = this.hasDistance ? CompareScaleMode.DISTANCE : CompareScaleMode.TIME;

          this.graphRows = this.buildGraphRows();
          this.peaksRows = this.buildPeaksRows();
          this.statsGroupRows = this.buildStatsGroupRows();
          this.initialized = true;
        });
      })
      .catch(err => {
        if (err) {
          throw err;
        }
      });
  }

  // Merges "Power" and "Est. Power" flavors of a sensor into a single row
  private static rowTitle(sensor: Sensor): string {
    return sensor.name.replace(/^Est\. /, "");
  }

  private buildGraphRows(): CompareGraphRow[] {
    const rowsByTitle = new Map<string, CompareGraphRow>();
    const rowsOrder: string[] = [];

    for (const workout of this.workouts) {
      if (!workout.streams) {
        continue;
      }

      const sensors = this.activitySensorsService.provideSensors(
        workout.activity,
        ActivityCompareComponent.GRAPH_STREAMS_ORDER
      );

      for (const sensor of sensors) {
        const stream = workout.streams[sensor.streamKey] as number[];
        if (!stream?.length) {
          continue;
        }

        const title = ActivityCompareComponent.rowTitle(sensor);
        let row = rowsByTitle.get(title);
        if (!row) {
          row = { title: title, sensor: sensor, entries: [] };
          rowsByTitle.set(title, row);
          rowsOrder.push(title);
        }
        row.entries.push({ workout: workout, sensor: sensor });
      }
    }

    return rowsOrder.map(title => rowsByTitle.get(title));
  }

  private buildPeaksRows(): ComparePeaksRow[] {
    const rowsByTitle = new Map<string, ComparePeaksRow>();
    const rowsOrder: string[] = [];

    for (const workout of this.workouts) {
      const sensors = this.activitySensorsService.provideSensors(
        workout.activity,
        ActivityCompareComponent.PEAKS_STREAMS_ORDER
      );

      for (const sensor of sensors) {
        if (!sensor.peaksPath) {
          continue;
        }

        const peaks: Peak[] = _.get(workout.activity.stats, sensor.peaksPath);
        if (!peaks?.length) {
          continue;
        }

        const title = ActivityCompareComponent.rowTitle(sensor);
        let row = rowsByTitle.get(title);
        if (!row) {
          row = { title: title, sensor: sensor, entries: [] };
          rowsByTitle.set(title, row);
          rowsOrder.push(title);
        }
        row.entries.push({ workout: workout, sensor: sensor, peaks: peaks });
      }
    }

    return rowsOrder.map(title => rowsByTitle.get(title));
  }

  private buildStatsGroupRows(): CompareStatsGroupRow[] {
    // Stat groups are taken from the earliest workout's sport; a stat is kept
    // when at least one compared workout provides a chartable value for it
    const statsGroups = this.activityStatsService.getStatsGroups(this.workouts[0].activity);

    const rows: CompareStatsGroupRow[] = [];
    for (const statsGroup of statsGroups) {
      const chartableStats = statsGroup.stats.filter(
        stat => stat && buildStatChartPoints(stat, this.workouts, this.userSettings.systemUnit).length > 0
      );

      if (chartableStats.length) {
        rows.push({ name: statsGroup.name, color: statsGroup.color, stats: chartableStats });
      }
    }

    return rows;
  }

  public onToggleScaleMode(): void {
    this.scaleMode = this.scaleMode === CompareScaleMode.TIME ? CompareScaleMode.DISTANCE : CompareScaleMode.TIME;
  }

  public onSmoothingChange(windowSeconds: number): void {
    this.smoothingSeconds = windowSeconds;
  }

  public onOpenActivity(workout: ComparedWorkout): void {
    this.router.navigate([`${AppRoutes.activity}/${workout.activity.id}`]);
  }

  public onBack(): void {
    this.location.back();
  }
}

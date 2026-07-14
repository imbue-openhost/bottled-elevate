import { Component, Inject, Input, OnChanges, OnInit, SimpleChanges } from "@angular/core";
import { Datum, Layout, LayoutAxis, PlotData } from "plotly.js";
import _ from "lodash";
import moment from "moment";
import { BaseChartComponent } from "../../activity-view/shared/base-chart.component";
import { ScatterChart } from "../../activity-view/shared/models/plot-chart.model";
import { GradeAdjustedPaceSensor, PaceSensor, SwimmingPaceSensor } from "../../activity-view/shared/models/sensors/move.sensor";
import { AppService } from "../../../shared/services/app-service/app.service";
import { PlotlyService } from "angular-plotly.js";
import { MeasureSystem } from "@elevate/shared/enums/measure-system.enum";
import { Constant } from "@elevate/shared/constants/constant";
import { CompareScaleMode } from "../shared/compare.model";
import { CompareGraphRow } from "../activity-compare.component";
import { smoothStream } from "../../activity-view/shared/stream-smoother";

@Component({
  selector: "app-compare-graph-chart",
  templateUrl: "./compare-graph-chart.component.html",
  styleUrls: ["./compare-graph-chart.component.scss"]
})
export class CompareGraphChartComponent extends BaseChartComponent<ScatterChart> implements OnInit, OnChanges {
  private static readonly REVERSED_TIME_YAXIS_SENSOR_NAMES: string[] = [
    PaceSensor.NAME,
    GradeAdjustedPaceSensor.NAME,
    SwimmingPaceSensor.DEFAULT.name
  ];

  private static readonly CHART_LAYOUT_SPECIFICS: Partial<Layout> = {
    legend: { orientation: "h" },
    showlegend: true,
    height: 260,
    margin: { r: 10, l: 70, t: 10, b: 30 }
  };

  @Input()
  public row: CompareGraphRow;

  @Input()
  public scaleMode: CompareScaleMode;

  @Input()
  public smoothingSeconds: number;

  @Input()
  public measureSystem: MeasureSystem;

  constructor(
    @Inject(AppService) protected readonly appService: AppService,
    @Inject(PlotlyService) protected readonly plotlyService: PlotlyService
  ) {
    super(appService, plotlyService);
  }

  public createChart(): ScatterChart {
    return new ScatterChart(_.cloneDeep(CompareGraphChartComponent.CHART_LAYOUT_SPECIFICS));
  }

  public ngOnInit(): void {
    this.updateChart();
  }

  public ngOnChanges(changes: SimpleChanges): void {
    if ((changes.scaleMode && !changes.scaleMode.firstChange) ||
        (changes.smoothingSeconds && !changes.smoothingSeconds.firstChange)) {
      this.updateChart();
    }
  }

  private isReversedTimeYAxis(): boolean {
    return CompareGraphChartComponent.REVERSED_TIME_YAXIS_SENSOR_NAMES.indexOf(this.row.sensor.name) !== -1;
  }

  private updateChart(): void {
    this.chart.clear();
    this.configureAxis();

    for (const entry of this.row.entries) {
      const streams = entry.workout.streams;
      const scaleStream =
        this.scaleMode === CompareScaleMode.TIME ? streams.time : (streams.distance as number[]);
      const rawSensorStream = streams[entry.sensor.streamKey] as number[];

      if (!scaleStream?.length || !rawSensorStream?.length) {
        continue;
      }

      const sensorStream = smoothStream(streams.time, rawSensorStream, this.smoothingSeconds);

      const trace: Partial<PlotData> = {
        name: entry.workout.label,
        type: "scattergl",
        mode: "lines",
        line: {
          color: entry.workout.color,
          width: 1.5,
          shape: "spline",
          simplify: true
        },
        x: [],
        y: []
      };

      const isYValueDate = this.isReversedTimeYAxis();
      const length = Math.min(scaleStream.length, sensorStream.length);

      for (let index = 0; index < length; index++) {
        let xValue: Datum | number;
        if (this.scaleMode === CompareScaleMode.TIME) {
          xValue = moment().startOf("day").add(scaleStream[index], "seconds").toDate();
        } else {
          xValue =
            (scaleStream[index] / 1000) * (this.measureSystem === MeasureSystem.IMPERIAL ? Constant.KM_TO_MILE_FACTOR : 1);
        }
        (trace.x as (Datum | number)[]).push(xValue);

        const yValue = entry.sensor.fromStreamConvert(sensorStream[index], this.measureSystem);
        if (isYValueDate) {
          (trace.y as Datum[]).push(
            Number.isFinite(yValue) ? moment().startOf("day").add(yValue, "seconds").toDate() : null
          );
        } else {
          (trace.y as number[]).push(yValue);
        }
      }

      this.chart.data.push(trace);
    }
  }

  private configureAxis(): void {
    const isScaledOnTime = this.scaleMode === CompareScaleMode.TIME;

    this.chart.layout.xaxis = _.merge(this.chart.layout.xaxis, {
      zeroline: false,
      type: isScaledOnTime ? "date" : "linear",
      tickformat: isScaledOnTime ? "%H:%M:%S" : "",
      ticksuffix: isScaledOnTime ? "" : this.measureSystem === MeasureSystem.METRIC ? "km" : "mi",
      hoverformat: isScaledOnTime ? "%H:%M:%S" : ".2f"
    } as Partial<LayoutAxis>);

    const unit = this.row.sensor.getDisplayUnit(this.measureSystem);

    this.chart.layout.yaxis = _.merge(this.chart.layout.yaxis, {
      title: this.row.title,
      ticksuffix: ` ${unit}`,
      zeroline: false,
      hoverformat: `.${this.row.sensor.defaultRoundDecimals}f`
    } as Partial<LayoutAxis>);

    if (this.isReversedTimeYAxis()) {
      this.chart.layout.yaxis = _.merge(this.chart.layout.yaxis, {
        autorange: "reversed",
        type: "date",
        tickformat: "%M:%S",
        hoverformat: null
      } as Partial<LayoutAxis>);
    }
  }
}

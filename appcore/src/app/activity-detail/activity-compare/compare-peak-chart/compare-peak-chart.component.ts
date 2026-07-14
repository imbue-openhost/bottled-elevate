import { Component, Inject, Input, OnInit } from "@angular/core";
import { Datum, Layout, LayoutAxis, PlotData } from "plotly.js";
import _ from "lodash";
import moment from "moment";
import { BaseChartComponent } from "../../activity-view/shared/base-chart.component";
import { LogChart } from "../../activity-view/shared/models/plot-chart.model";
import { PeakChartComponent } from "../../activity-view/activity-view-peaks/peak-chart/peak-chart.component";
import { GradeSensor } from "../../activity-view/shared/models/sensors/grade.sensor";
import { PaceSensor } from "../../activity-view/shared/models/sensors/move.sensor";
import { AppService } from "../../../shared/services/app-service/app.service";
import { PlotlyService } from "angular-plotly.js";
import { MeasureSystem } from "@elevate/shared/enums/measure-system.enum";
import { ComparePeaksRow } from "../activity-compare.component";

@Component({
  selector: "app-compare-peak-chart",
  templateUrl: "./compare-peak-chart.component.html",
  styleUrls: ["./compare-peak-chart.component.scss"]
})
export class ComparePeakChartComponent extends BaseChartComponent<LogChart> implements OnInit {
  private static readonly PER_SENSOR_LAYOUT_SPECIFICS = new Map<string, Partial<Layout>>([
    [
      PaceSensor.NAME,
      {
        yaxis: {
          autorange: "reversed",
          type: "date",
          tickformat: "%M:%S",
          hoverformat: "%M:%S"
        } as Partial<LayoutAxis>
      }
    ],
    [
      GradeSensor.NAME,
      {
        yaxis: {
          hoverformat: ".1f"
        } as Partial<LayoutAxis>
      }
    ]
  ]);

  @Input()
  public row: ComparePeaksRow;

  @Input()
  public measureSystem: MeasureSystem;

  constructor(
    @Inject(AppService) protected readonly appService: AppService,
    @Inject(PlotlyService) protected readonly plotlyService: PlotlyService
  ) {
    super(appService, plotlyService);
  }

  public createChart(): LogChart {
    const layout = _.cloneDeep(PeakChartComponent.CHART_LAYOUT_SPECIFICS);
    layout.height = 340;
    layout.showlegend = true;
    layout.legend = { orientation: "h" };
    return new LogChart(layout);
  }

  public ngOnInit(): void {
    // Time tick labels are precomputed for the whole scale; plotly only renders those in data range
    this.chart.layout.xaxis.ticktext = PeakChartComponent.TIME_TICKS.map(range => {
      if (range < 60) {
        return `${range}s`;
      } else if (range < 60 * 60) {
        return `${range / 60}m`;
      }
      return `${range / 3600}h`;
    });

    const unit = this.row.sensor.getDisplayUnit(this.measureSystem);
    this.chart.layout.yaxis.ticksuffix = ` ${unit}`;
    this.chart.layout.yaxis.title = this.row.title;

    const sensorLayoutSpecifics = ComparePeakChartComponent.PER_SENSOR_LAYOUT_SPECIFICS.get(this.row.sensor.name);
    if (sensorLayoutSpecifics) {
      this.chart.layout = _.merge(this.chart.layout, sensorLayoutSpecifics);
    }

    const isYValueDate = this.chart.layout.yaxis.type === "date";

    for (const entry of this.row.entries) {
      const trace: Partial<PlotData> = {
        name: entry.workout.label,
        type: "scattergl",
        mode: "lines",
        line: {
          color: entry.workout.color,
          shape: "spline",
          width: 1.25
        },
        x: [],
        y: []
      };

      for (const peak of entry.peaks) {
        (trace.x as Datum[]).push(peak.range);

        const yValue = entry.sensor.fromStreamConvert(peak.result, this.measureSystem);
        if (isYValueDate) {
          (trace.y as Datum[]).push(moment().startOf("day").add(yValue, "seconds").toDate());
        } else {
          (trace.y as number[]).push(yValue);
        }
      }

      this.chart.data.push(trace);
    }
  }
}

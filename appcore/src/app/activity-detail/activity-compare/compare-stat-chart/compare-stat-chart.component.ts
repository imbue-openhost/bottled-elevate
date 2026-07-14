import { Component, Inject, Input, OnInit } from "@angular/core";
import { Layout, LayoutAxis, PlotData } from "plotly.js";
import _ from "lodash";
import { BaseChartComponent } from "../../activity-view/shared/base-chart.component";
import { ScatterChart } from "../../activity-view/shared/models/plot-chart.model";
import { Stat } from "../../activity-view/shared/models/stats/stat.model";
import { AppService } from "../../../shared/services/app-service/app.service";
import { PlotlyService } from "angular-plotly.js";
import { MeasureSystem } from "@elevate/shared/enums/measure-system.enum";
import { ComparedWorkout } from "../shared/compare.model";
import { buildStatChartPoints, resolveStatUnit } from "../shared/compare-stat-points.util";

@Component({
  selector: "app-compare-stat-chart",
  templateUrl: "./compare-stat-chart.component.html",
  styleUrls: ["./compare-stat-chart.component.scss"]
})
export class CompareStatChartComponent extends BaseChartComponent<ScatterChart> implements OnInit {
  private static readonly CHART_LAYOUT_SPECIFICS: Partial<Layout> = {
    height: 150,
    showlegend: false,
    hovermode: "closest",
    margin: { r: 10, l: 55, t: 10, b: 30 },
    xaxis: {
      type: "date",
      fixedrange: true,
      nticks: 5
    },
    yaxis: {
      fixedrange: true
    }
  };

  @Input()
  public stat: Stat<any>;

  @Input()
  public workouts: ComparedWorkout[];

  @Input()
  public measureSystem: MeasureSystem;

  public unit: string;

  constructor(
    @Inject(AppService) protected readonly appService: AppService,
    @Inject(PlotlyService) protected readonly plotlyService: PlotlyService
  ) {
    super(appService, plotlyService);
  }

  public createChart(): ScatterChart {
    return new ScatterChart(_.cloneDeep(CompareStatChartComponent.CHART_LAYOUT_SPECIFICS));
  }

  public ngOnInit(): void {
    this.unit = resolveStatUnit(this.stat, this.measureSystem);

    const points = buildStatChartPoints(this.stat, this.workouts, this.measureSystem);

    if (!points.length) {
      return;
    }

    const isTimeValue = points[0].isTimeValue;
    if (isTimeValue) {
      const maxSeconds = _.max(points.map(point => Math.abs(point.seconds)));
      this.chart.layout.yaxis = _.merge(this.chart.layout.yaxis, {
        type: "date",
        tickformat: maxSeconds >= 3600 ? "%H:%M:%S" : "%M:%S"
      } as Partial<LayoutAxis>);
    } else {
      this.chart.layout.yaxis = _.merge(this.chart.layout.yaxis, {
        ticksuffix: this.unit ? ` ${this.unit}` : ""
      } as Partial<LayoutAxis>);
    }

    const trace: Partial<PlotData> = {
      type: "scatter",
      mode: "lines+markers",
      line: {
        color: "#9e9e9e",
        width: 1
      },
      marker: {
        color: points.map(point => point.color),
        size: 9
      },
      x: points.map(point => point.x),
      y: points.map(point => point.y),
      text: points.map(point => point.text),
      hoverinfo: "text"
    };

    this.chart.data.push(trace);
  }
}

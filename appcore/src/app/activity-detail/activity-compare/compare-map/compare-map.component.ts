import { Component, HostListener, Inject, Input, OnInit } from "@angular/core";
import mapboxgl, { FitBoundsOptions, LngLatBounds } from "mapbox-gl";
import { StylesControl } from "mapbox-gl-controls";
import _ from "lodash";
import { LoggerService } from "../../../shared/services/logging/logger.service";
import { UserSettingsService } from "../../../shared/services/user-settings/user-settings.service";
import { UserSettings } from "@elevate/shared/models/user-settings/user-settings.namespace";
import { StyleOption } from "mapbox-gl-controls/lib/StylesControl/types";
import { MapTokenService } from "../../mapbox/map-token.service";
import { ComparedWorkout } from "../shared/compare.model";
import BaseUserSettings = UserSettings.BaseUserSettings;

interface WorkoutPath {
  name: string;
  color: string;
  lngLat: [number, number][];
}

@Component({
  selector: "app-compare-map",
  templateUrl: "./compare-map.component.html",
  styleUrls: ["./compare-map.component.scss"]
})
export class CompareMapComponent implements OnInit {
  private static readonly STYLES: StyleOption[] = [
    {
      label: "Outdoor",
      styleName: "outdoor",
      styleUrl: "mapbox://styles/thomaschampagne/ckwtg0i5k0lv915paq5sxff4j"
    },
    {
      label: "Satellite",
      styleName: "satellite",
      styleUrl: "mapbox://styles/mapbox/satellite-v9?optimize=true"
    }
  ];

  private static readonly PATHS_FIT_OPTIONS: FitBoundsOptions = { padding: 20 };

  @Input()
  public workouts: ComparedWorkout[];

  public isMapReady: boolean;

  private map: mapboxgl.Map;
  private workoutPaths: WorkoutPath[];
  private pathsBounds: mapboxgl.LngLatBounds;

  constructor(
    @Inject(UserSettingsService) private readonly userSettingsService: UserSettingsService,
    @Inject(MapTokenService) private readonly mapTokenService: MapTokenService,
    @Inject(LoggerService) private readonly logger: LoggerService
  ) {
    this.isMapReady = null;
  }

  private static getPathsBounds(workoutPaths: WorkoutPath[]): LngLatBounds {
    const firstPoint = workoutPaths[0].lngLat[0];
    const bounds = new LngLatBounds(firstPoint, firstPoint);

    for (const workoutPath of workoutPaths) {
      for (const point of workoutPath.lngLat) {
        bounds.extend(point);
      }
    }
    return bounds;
  }

  @HostListener("fullscreenchange")
  public onFullScreenChange(): void {
    setTimeout(() => this.map.resize());
  }

  public ngOnInit(): void {
    this.mapTokenService.get().then(token => {
      this.configure(token);
    });
  }

  private configure(mapBoxToken: string): void {
    if (!mapBoxToken) {
      this.isMapReady = false;
      return;
    }

    mapboxgl.accessToken = mapBoxToken;

    this.workoutPaths = this.workouts.map((workout, index) => {
      return {
        name: `workoutPath-${index}`,
        color: workout.color,
        lngLat: workout.streams.latlng.map(latLng => [latLng[1], latLng[0]]) as [number, number][]
      };
    });

    this.pathsBounds = CompareMapComponent.getPathsBounds(this.workoutPaths);

    this.map = new mapboxgl.Map({
      optimizeForTerrain: true,
      container: "compareMap",
      bounds: this.pathsBounds,
      fitBoundsOptions: CompareMapComponent.PATHS_FIT_OPTIONS,
      antialias: false,
      zoom: 13,
      maxZoom: 17,
      attributionControl: false,
      touchPitch: false,
      touchZoomRotate: false,
      doubleClickZoom: false,
      pitchWithRotate: false
    });

    this.map.addControl(new mapboxgl.FullscreenControl());
    this.map.addControl(new mapboxgl.NavigationControl());

    this.setupStyles();

    this.map.on("load", () => {
      this.drawWorkoutPaths();
      this.isMapReady = true;
    });

    // We have to wait this event to draw paths on style change
    this.map.on("styledata", () => {
      this.drawWorkoutPaths();
    });

    // Reset map fit to all paths on double click
    this.map.on("dblclick", () => {
      this.map.fitBounds(this.pathsBounds, CompareMapComponent.PATHS_FIT_OPTIONS);
    });

    this.map.on("error", event => {
      this.logger.error(event.error.message);
      this.isMapReady = false;
    });
  }

  private setupStyles(): void {
    this.userSettingsService.fetch().then((userSettings: BaseUserSettings) => {
      const defaultMapType = (userSettings as { defaultMapType?: string }).defaultMapType;
      const preferredStyle =
        _.find<StyleOption>(CompareMapComponent.STYLES, { styleName: defaultMapType }) ||
        CompareMapComponent.STYLES[0];
      this.map.setStyle(preferredStyle.styleUrl);
    });

    this.map.addControl(
      new StylesControl({
        styles: CompareMapComponent.STYLES,
        onChange: () => this.drawWorkoutPaths()
      }),
      "bottom-right"
    );
  }

  private drawWorkoutPaths(): void {
    for (const workoutPath of this.workoutPaths) {
      if (!this.map.getSource(workoutPath.name)) {
        this.map.addSource(workoutPath.name, {
          type: "geojson",
          data: {
            type: "Feature",
            properties: {},
            geometry: {
              type: "LineString",
              coordinates: workoutPath.lngLat
            }
          }
        });
      }

      if (!this.map.getLayer(workoutPath.name)) {
        this.map.addLayer({
          id: workoutPath.name,
          type: "line",
          source: workoutPath.name,
          layout: {
            "line-join": "round",
            "line-cap": "round"
          },
          paint: {
            "line-color": workoutPath.color,
            "line-width": 3
          }
        });
      }
    }
  }
}

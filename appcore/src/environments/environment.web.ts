import { LoggerService } from "../app/shared/services/logging/logger.service";
import { BuildTarget } from "@elevate/shared/enums/build-target.enum";

// Web build target for OpenHost. Reuses BuildTarget.EXTENSION semantics (browser variant)
// so existing per-target settings/columns keep working without touching @elevate/shared.
// backendBaseUrl is empty => same-origin; the OpenHost proxy serves /api/* alongside the app.
export const environment = {
  buildTarget: BuildTarget.EXTENSION,
  production: false,
  logLevel: LoggerService.LEVEL_DEBUG,
  minBackupVersion: "7.0.0-0",
  showDebugRibbon: false,
  showActivityDebugData: false,
  showRouteUrl: false,
  bypassProfileRestoreChecks: false,
  backendBaseUrl: "",
  // Mapbox access token for the activity map. Empty => map is disabled (no tiles); set to enable.
  mapBoxToken: ""
};

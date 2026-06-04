import { Injectable } from "@angular/core";
import { environment } from "../../../environments/environment";

/**
 * Provides the Mapbox access token for the activity map. On web the token comes from the
 * build environment; when empty the map component gracefully disables itself (no tiles),
 * while the rest of the activity view still renders from the (mocked) streams.
 */
@Injectable({ providedIn: "root" })
export class MapTokenService {
  public get(): Promise<string> {
    return Promise.resolve((environment as { mapBoxToken?: string }).mapBoxToken || "");
  }
}

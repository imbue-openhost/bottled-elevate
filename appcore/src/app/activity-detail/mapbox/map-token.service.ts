import { Inject, Injectable } from "@angular/core";
import { environment } from "../../../environments/environment";
import { UserSettingsService } from "../../shared/services/user-settings/user-settings.service";

/**
 * Provides the Mapbox access token for the activity map. The token comes from the user's
 * "Personal Mapbox Token" setting (Global Settings -> Map), falling back to the build
 * environment. When empty the map component gracefully disables itself (no tiles), while
 * the rest of the activity view still renders from the streams.
 */
@Injectable({ providedIn: "root" })
export class MapTokenService {
  constructor(@Inject(UserSettingsService) private readonly userSettingsService: UserSettingsService) {}

  public get(): Promise<string> {
    return this.userSettingsService.fetch().then(settings => {
      const token = (settings as { mapToken?: string }).mapToken;
      return token || (environment as { mapBoxToken?: string }).mapBoxToken || "";
    });
  }
}

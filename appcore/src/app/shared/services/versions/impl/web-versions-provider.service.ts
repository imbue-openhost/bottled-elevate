import { Inject, Injectable } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { VersionsProvider } from "../versions-provider";
import { MatDialog } from "@angular/material/dialog";
import { GhRelease } from "@elevate/shared/models/updates/gh-release.model";
import { Platform } from "@elevate/shared/enums/platform.enum";

@Injectable()
export class WebVersionsProvider extends VersionsProvider {
  constructor(
    @Inject(HttpClient) public readonly httpClient: HttpClient,
    @Inject(MatDialog) protected readonly dialog: MatDialog
  ) {
    super(httpClient, dialog);
  }

  // OpenHost deploys via git pull + container rebuild, so there's no GitHub-release
  // update channel to surface here.
  public getGithubReleases(): Promise<GhRelease[]> {
    return Promise.resolve([]);
  }

  public getBuildMetadata(): Promise<{ commit: string; date: string }> {
    return Promise.resolve({ commit: "n/a", date: new Date().toISOString() });
  }

  public getPlatform(): Platform {
    return Platform.WEB_EXT;
  }

  public getWrapperVersion(): string {
    return navigator.userAgent;
  }
}

import { Inject, Injectable } from "@angular/core";
import { AppLoadService } from "../app-load.service";
import { DataStore } from "../../shared/data-store/data-store";
import { sleep } from "@elevate/shared/tools/sleep";

@Injectable()
export class ExtensionLoadService extends AppLoadService {
  protected readonly SPLASH_SCREEN_MIN_TIME_DISPLAYED: number = 750;

  constructor(@Inject(DataStore) protected readonly dataStore: DataStore<object>) {
    super(dataStore);
  }

  public loadApp(): Promise<void> {
    // Wait for the datastore to finish hydrating from the server (super.loadApp resolves on
    // DbEvent.LOADED) so the app never queries an empty in-memory db, while keeping the splash
    // visible for a minimum time.
    return Promise.all([super.loadApp(), sleep(this.SPLASH_SCREEN_MIN_TIME_DISPLAYED)]).then(() => undefined);
  }
}

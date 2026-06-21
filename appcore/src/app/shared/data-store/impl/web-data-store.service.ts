import { DataStore, HydratePayload, RemoteRecord } from "../data-store";
import Loki from "lokijs";
import { LoggerService } from "../../services/logging/logger.service";
import { Inject, Injectable } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { firstValueFrom } from "rxjs";
import { AppUsageDetails } from "../../models/app-usage-details.model";
import { AppUsage } from "../../models/app-usage.model";
import { environment } from "../../../../environments/environment";

@Injectable()
export class WebDataStore<T extends {}> extends DataStore<T> {
  constructor(
    @Inject(LoggerService) protected readonly logger: LoggerService,
    @Inject(HttpClient) private readonly http: HttpClient
  ) {
    super(logger);
  }

  private url(path: string): string {
    return `${environment.backendBaseUrl}/api/store${path}`;
  }

  public getPersistenceAdapter(): LokiPersistenceAdapter {
    // In-memory only — the server (via the remote* hooks below) is the durable store.
    return new Loki.LokiMemoryAdapter();
  }

  protected remoteHydrate(): Promise<HydratePayload> {
    return firstValueFrom(this.http.get<HydratePayload>(this.url("")));
  }

  protected remoteUpsert(collection: string, records: RemoteRecord[]): Promise<void> {
    if (!records.length) {
      return Promise.resolve();
    }
    return firstValueFrom(
      this.http.post(this.url(`/${encodeURIComponent(collection)}`), { records })
    ).then(() => undefined);
  }

  protected remoteDelete(collection: string, keys: string[]): Promise<void> {
    if (!keys.length) {
      return Promise.resolve();
    }
    return firstValueFrom(
      this.http.post(this.url(`/${encodeURIComponent(collection)}/delete`), { keys })
    ).then(() => undefined);
  }

  protected remoteClear(collection: string): Promise<void> {
    return firstValueFrom(this.http.delete(this.url(`/${encodeURIComponent(collection)}`))).then(() => undefined);
  }

  protected remoteGetOne(collection: string, key: string): Promise<any | null> {
    const path = `/${encodeURIComponent(collection)}/${encodeURIComponent(key)}`;
    return firstValueFrom(this.http.get<{ value: any }>(this.url(path))).then(res => (res ? res.value : null));
  }

  public getAppUsageDetails(): Promise<AppUsageDetails> {
    return navigator.storage.estimate().then((storageEstimate: StorageEstimate) => {
      const appUsage = new AppUsage(storageEstimate.usage, storageEstimate.quota);
      const megaBytesInUse = appUsage.bytesInUse / (1024 * 1024);
      const megaBytesQuota = appUsage.quotaBytes / (1024 * 1024);
      const percentUsage = (appUsage.bytesInUse / appUsage.quotaBytes) * 100;
      return Promise.resolve(new AppUsageDetails(appUsage, megaBytesInUse, megaBytesQuota, percentUsage));
    });
  }
}

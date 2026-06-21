import { AppUsageDetails } from "../models/app-usage-details.model";
import { CollectionDef } from "./collection-def";
import { ReplaySubject } from "rxjs";
import _ from "lodash";
import { LoggerService } from "../services/logging/logger.service";
import Loki from "lokijs";
import { Inject } from "@angular/core";
import semver from "semver/preload";
import { environment } from "../../../environments/environment";

export enum DbEvent {
  LOADED,
  SAVED
}

export interface RemoteRecord {
  key: string;
  value: any;
}

export type HydratePayload = { [collection: string]: any[] };

/**
 * In-memory Loki database used purely as the session query engine. Durability lives entirely on
 * the server: collections are hydrated from it on load and every mutation is written through to it
 * (see the remote* hooks). Loki itself never persists to the browser.
 *
 * Large collections can be flagged `lazy` on their CollectionDef: they are never hydrated or held
 * in memory, and are read/written one record at a time straight against the server instead.
 */
export abstract class DataStore<T extends {}> {
  protected constructor(@Inject(LoggerService) protected readonly logger: LoggerService) {
    this.initDatabase();
  }

  private static readonly DATABASE_NAME = "elevate";
  private static readonly SINGLETON_KEY = "singleton";
  private static readonly DEFAULT_LOKI_ID_FIELD = "$loki";
  private static readonly DEFAULT_LOKI_META_FIELD = "meta";
  public db: LokiConstructor;
  public dbEvent$: ReplaySubject<DbEvent>;
  private COLLECTIONS_MAP: Map<string, Collection<T>>;

  public static isBackupCompatible(dumpVersion): boolean {
    return semver.gte(dumpVersion, this.getMinBackupVersion()) || environment.bypassProfileRestoreChecks;
  }

  public static getMinBackupVersion(): string {
    return environment.minBackupVersion;
  }

  public static cleanDbObject<T>(dbObj: LokiQuery<T & LokiObj>): T {
    delete dbObj[DataStore.DEFAULT_LOKI_ID_FIELD];
    delete dbObj[DataStore.DEFAULT_LOKI_META_FIELD];
    return dbObj as T;
  }

  public static cleanDbCollection<T>(dbObjs: LokiQuery<T & LokiObj>[]): T[] {
    return dbObjs.map(dbObj => {
      return DataStore.cleanDbObject(dbObj);
    });
  }

  protected initDatabase(): void {
    this.dbEvent$ = new ReplaySubject<DbEvent>();
    this.db = new Loki(DataStore.DATABASE_NAME, this.getDbOptions());
    this.COLLECTIONS_MAP = new Map<string, Collection<T>>();
  }

  public abstract getPersistenceAdapter(): LokiPersistenceAdapter;

  public abstract getAppUsageDetails(): Promise<AppUsageDetails>;

  // --- Remote persistence hooks. Default to no-ops so an in-memory store (eg tests) works with no
  //     backend; the web store overrides them to read/write the server. ---

  protected remoteHydrate(): Promise<HydratePayload> {
    return Promise.resolve({});
  }

  protected remoteUpsert(collection: string, records: RemoteRecord[]): Promise<void> {
    return Promise.resolve();
  }

  protected remoteDelete(collection: string, keys: string[]): Promise<void> {
    return Promise.resolve();
  }

  protected remoteClear(collection: string): Promise<void> {
    return Promise.resolve();
  }

  protected remoteGetOne(collection: string, key: string): Promise<any | null> {
    return Promise.resolve(null);
  }

  public getDbOptions(): Partial<LokiConstructorOptions> & Partial<LokiConfigOptions> {
    return {
      adapter: this.getPersistenceAdapter(),
      env: "BROWSER",
      autosave: false,
      autoload: true,
      autoloadCallback: err => this.onAutoLoadDone(err)
    };
  }

  public resolveCollection(collectionDef: CollectionDef<T>): Collection<T> {
    // Is collection already tracked?
    let collection = this.COLLECTIONS_MAP.get(collectionDef.name);

    // If yes use it if collection not dirty
    if (collection && !collection.dirty) {
      return collection;
    }

    // Else try to get it from database through lokijs (it may have been hydrated already)
    collection = this.db.getCollection(collectionDef.name);

    // If missing collection then create it...
    if (!collection) {
      collection = this.db.addCollection(collectionDef.name, collectionDef.options);
    }

    // Make indexes are applied
    const indices = collectionDef.options?.indices as (keyof T)[];
    if (indices && indices.length) {
      indices.forEach(field => collection.ensureIndex(field, true));
    }

    // If unique fields apply them
    if (collectionDef.options && collectionDef.options.unique && collectionDef.options.unique.length) {
      collectionDef.options.unique.forEach(field => collection.ensureUniqueIndex(field));
    }

    // Track collection
    this.COLLECTIONS_MAP.set(collectionDef.name, collection);

    return collection;
  }

  public find(
    collectionDef: CollectionDef<T>,
    defaultStorageValue: T[],
    query?: LokiQuery<T & LokiObj>,
    sort?: { propName: keyof T; options: Partial<SimplesortOptions> }
  ): Promise<T[]> {
    const collection = this.resolveCollection(collectionDef);

    // Find document on current collection
    const resultSet = collection.chain().find(query);

    // Sort along property if given
    if (sort && sort.propName && sort.options) {
      resultSet.simplesort(sort.propName, sort.options);
    }

    return Promise.resolve(resultSet.data());
  }

  public findOne(collectionDef: CollectionDef<T>, defaultStorageValue: T, query: LokiQuery<T & LokiObj>): Promise<T> {
    const collection = this.resolveCollection(collectionDef);

    // Find document on current collection
    const doc = collection.findOne(query);

    // If doc is missing then save and return default value
    if (!doc) {
      const insertedDefaultDoc = collection.insert(defaultStorageValue);
      return Promise.resolve(insertedDefaultDoc);
    }

    return Promise.resolve(doc);
  }

  public update(collectionDef: CollectionDef<T>, doc: T, waitSaveDrained: boolean): Promise<T> {
    if (collectionDef.lazy) {
      return this.remoteUpsert(collectionDef.name, [this.toRemoteRecord(collectionDef, doc)]).then(() => doc);
    }
    const updatedDoc = this.resolveCollection(collectionDef).update(doc);
    return this.remoteUpsert(collectionDef.name, [this.toRemoteRecord(collectionDef, doc)]).then(() => updatedDoc);
  }

  public updateMany(collectionDef: CollectionDef<T>, docs: T[], waitSaveDrained: boolean): Promise<void> {
    if (!docs.length) {
      return Promise.resolve();
    }
    if (!collectionDef.lazy) {
      this.resolveCollection(collectionDef).update(docs);
    }
    return this.remoteUpsert(collectionDef.name, this.toRemoteRecords(collectionDef, docs));
  }

  public insert(collectionDef: CollectionDef<T>, doc: T, waitSaveDrained: boolean): Promise<T> {
    if (collectionDef.lazy) {
      return this.remoteUpsert(collectionDef.name, [this.toRemoteRecord(collectionDef, doc)]).then(() => doc);
    }
    const insertedDoc = this.resolveCollection(collectionDef).insert(doc);
    return this.remoteUpsert(collectionDef.name, [this.toRemoteRecord(collectionDef, insertedDoc)]).then(
      () => insertedDoc
    );
  }

  public insertMany(collectionDef: CollectionDef<T>, docs: T[], waitSaveDrained: boolean): Promise<void> {
    if (!docs.length) {
      return Promise.resolve();
    }
    if (collectionDef.lazy) {
      return this.remoteUpsert(collectionDef.name, this.toRemoteRecords(collectionDef, docs));
    }
    const inserted = this.resolveCollection(collectionDef).insert(docs);
    const insertedDocs = (Array.isArray(inserted) ? inserted : [inserted]) as T[];
    return this.remoteUpsert(collectionDef.name, this.toRemoteRecords(collectionDef, insertedDocs));
  }

  public put(collectionDef: CollectionDef<T>, doc: T, waitSaveDrained: boolean): Promise<T> {
    if (collectionDef.lazy) {
      return this.remoteUpsert(collectionDef.name, [this.toRemoteRecord(collectionDef, doc)]).then(() => doc);
    }

    const collection = this.resolveCollection(collectionDef);

    // Resolve unique collection index value
    const idField = this.extractDefaultFieldId(collection);

    // Format query and exec query
    const query: any = {};
    query[idField] = (doc as any)[idField];

    // Exec query
    const existingDoc = collection.findOne(query);

    if (existingDoc) {
      const updatedDoc = _.assign(existingDoc, doc);
      return this.update(collectionDef, updatedDoc, waitSaveDrained);
    }

    // The doc don't exists. Do a create.
    return this.insert(collectionDef, doc, waitSaveDrained);
  }

  public getById(collectionDef: CollectionDef<T>, id: number | string): Promise<T> {
    if (collectionDef.lazy) {
      return this.remoteGetOne(collectionDef.name, String(id)) as Promise<T>;
    }

    const collection = this.resolveCollection(collectionDef);

    // Resolve unique field on which we will perform the request
    const idField = this.extractDefaultFieldId(collection);

    // Format query
    const query: any = {};
    query[idField] = id;

    return Promise.resolve(collection.findOne(query) as T);
  }

  public remove(collectionDef: CollectionDef<T>, doc: T, waitSaveDrained: boolean): Promise<void> {
    const key = this.remoteKey(collectionDef, doc);
    if (!collectionDef.lazy) {
      this.resolveCollection(collectionDef).remove(doc);
    }
    return this.remoteDelete(collectionDef.name, [key]);
  }

  public removeById(collectionDef: CollectionDef<T>, id: number | string, waitSaveDrained: boolean): Promise<void> {
    if (!collectionDef.lazy) {
      const collection = this.resolveCollection(collectionDef);
      const idField = this.extractDefaultFieldId(collection);
      const query: any = {};
      query[idField] = id;
      collection.removeWhere(query);
    }
    return this.remoteDelete(collectionDef.name, [String(id)]);
  }

  public removeByManyIds(
    collectionDef: CollectionDef<T>,
    ids: (number | string)[],
    waitSaveDrained: boolean
  ): Promise<void> {
    if (!ids.length) {
      return Promise.resolve();
    }
    if (!collectionDef.lazy) {
      const collection = this.resolveCollection(collectionDef);
      const idField = this.extractDefaultFieldId(collection);
      const query: any = {};
      query[idField] = { $in: ids };
      collection.removeWhere(query);
    }
    return this.remoteDelete(collectionDef.name, ids.map(String));
  }

  public count(collectionDef: CollectionDef<T>, query?: LokiQuery<T & LokiObj>): Promise<number> {
    const count = this.resolveCollection(collectionDef).count(query);
    return Promise.resolve(count);
  }

  public clear(collectionDef: CollectionDef<T>, waitSaveDrained: boolean): Promise<void> {
    if (!collectionDef.lazy) {
      this.resolveCollection(collectionDef).removeDataOnly();
    }
    return this.remoteClear(collectionDef.name);
  }

  /**
   * No-op: mutations already write through to the server, so there is nothing buffered to flush.
   * Kept so existing callers (which used to persist the Loki db to disk) keep working unchanged.
   */
  public persist(waitSaveDrained: boolean): Promise<void> {
    return Promise.resolve();
  }

  /** Drop the in-memory collections and re-pull them from the server (the source of truth). */
  public reload(options?: Partial<ThrottledSaveDrainOptions>): Promise<void> {
    this.db.collections.slice().forEach(collection => this.db.removeCollection(collection.name));
    this.COLLECTIONS_MAP.clear();
    return this.hydrateEager();
  }

  protected hydrateEager(): Promise<void> {
    return this.remoteHydrate().then(payload => {
      Object.keys(payload || {}).forEach(name => {
        const docs = payload[name] || [];
        const collection = this.db.getCollection(name) || this.db.addCollection(name);
        if (docs.length) {
          collection.insert(docs);
        }
      });
    });
  }

  protected onAutoLoadDone(err: Error): void {
    if (err) {
      this.dbEvent$.error(err);
      this.logger.error(err);
      return;
    }

    // Loki's in-memory adapter fires this synchronously from the base constructor, before the
    // subclass constructor (which wires the HttpClient used by the remote hooks) has run. Defer
    // hydration a tick so those hooks are usable. dbEvent$ is a ReplaySubject, so a late LOADED
    // still reaches subscribers.
    setTimeout(() => {
      this.hydrateEager()
        .then(() => {
          this.dbEvent$.next(DbEvent.LOADED);

          // Allow access to database directly from window for debugging
          (window as any).db = this.db;

          // Allow access to collection data directly from window for debugging
          if (!environment.production) {
            (window as any).data = {};
            this.db.collections.forEach(collection => {
              (window as any).data[collection.name] = collection.data;
            });
          }
        })
        .catch(error => {
          this.dbEvent$.error(error);
          this.logger.error(error);
        });
    });
  }

  private extractDefaultFieldId(collection: Collection<T>): keyof T | "$loki" {
    const defaultIndex = collection.uniqueNames[0];
    if (defaultIndex) {
      return defaultIndex;
    }
    return DataStore.DEFAULT_LOKI_ID_FIELD;
  }

  /** Server key for a doc: its unique-indexed field, or a constant for singleton collections. */
  private remoteKey(collectionDef: CollectionDef<T>, doc: T): string {
    const unique = collectionDef.options && (collectionDef.options.unique as (keyof T)[] | undefined);
    if (unique && unique.length) {
      return String((doc as any)[unique[0]]);
    }
    return DataStore.SINGLETON_KEY;
  }

  private toRemoteRecord(collectionDef: CollectionDef<T>, doc: T): RemoteRecord {
    const value: any = { ...(doc as any) };
    delete value[DataStore.DEFAULT_LOKI_ID_FIELD];
    delete value[DataStore.DEFAULT_LOKI_META_FIELD];
    return { key: this.remoteKey(collectionDef, doc), value };
  }

  private toRemoteRecords(collectionDef: CollectionDef<T>, docs: T[]): RemoteRecord[] {
    return docs.map(doc => this.toRemoteRecord(collectionDef, doc));
  }
}

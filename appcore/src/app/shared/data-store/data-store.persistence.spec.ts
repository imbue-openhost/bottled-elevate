import { TestBed } from "@angular/core/testing";
import { CollectionDef } from "./collection-def";
import { DataStore } from "./data-store";
import { TestingDataStore } from "./testing-datastore.service";
import { LoggerService } from "../services/logging/logger.service";
import { ConsoleLoggerService } from "../services/logging/console-logger.service";

interface Doc {
  id?: string;
  name?: string;
}

// Eager, unique-keyed collection (like activities): held in memory and written through to the server.
const widgets = new CollectionDef<Doc>("widgets", { unique: ["id"] });

// Eager singleton (like userSettings/athlete): no unique field, so it is keyed "singleton".
const prefs = new CollectionDef<Doc>("prefs", null);

// Lazy collection (like streams): never held in memory, read/written one record at a time remotely.
const blobs = new CollectionDef<Doc>("blobs", { unique: ["id"] }, true);

describe("DataStore persistence", () => {
  let dataStore: TestingDataStore<Doc>;

  const flushMacrotask = () => new Promise<void>(resolve => setTimeout(resolve, 0));

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        TestingDataStore,
        { provide: DataStore, useClass: TestingDataStore },
        { provide: LoggerService, useClass: ConsoleLoggerService }
      ]
    });
    dataStore = TestBed.inject(TestingDataStore) as TestingDataStore<Doc>;
    // Let the constructor's deferred (empty) hydrate settle so per-test spies start clean.
    await flushMacrotask();
  });

  describe("eager collections", () => {
    it("writes an insert through to the server, stripped of loki metadata, and keeps it in memory", async () => {
      const upsert = jest.spyOn(dataStore as any, "remoteUpsert");

      const inserted = await dataStore.insert(widgets, { id: "1", name: "A" }, true);

      expect(inserted.name).toEqual("A");
      expect(await dataStore.count(widgets)).toEqual(1);
      expect(upsert).toHaveBeenCalledWith("widgets", [{ key: "1", value: { id: "1", name: "A" } }]);
    });

    it("writes insertMany through as one batch keyed by the unique field", async () => {
      const upsert = jest.spyOn(dataStore as any, "remoteUpsert");

      await dataStore.insertMany(widgets, [{ id: "1" }, { id: "2" }], true);

      expect(await dataStore.count(widgets)).toEqual(2);
      expect(upsert).toHaveBeenCalledWith("widgets", [
        { key: "1", value: { id: "1" } },
        { key: "2", value: { id: "2" } }
      ]);
    });

    it("keys a singleton (no unique field) under a constant key", async () => {
      const upsert = jest.spyOn(dataStore as any, "remoteUpsert");

      await dataStore.insert(prefs, { name: "settings" }, true);

      expect(upsert).toHaveBeenCalledWith("prefs", [{ key: "singleton", value: { name: "settings" } }]);
    });

    it("routes put to an upsert and update to an upsert", async () => {
      const upsert = jest.spyOn(dataStore as any, "remoteUpsert");

      await dataStore.put(widgets, { id: "1", name: "first" }, true); // insert path
      await dataStore.put(widgets, { id: "1", name: "second" }, true); // update path

      expect(await dataStore.count(widgets)).toEqual(1);
      expect(upsert).toHaveBeenLastCalledWith("widgets", [{ key: "1", value: { id: "1", name: "second" } }]);
    });

    it("writes removeById through as a delete and drops it from memory", async () => {
      await dataStore.insert(widgets, { id: "1" }, true);
      const remove = jest.spyOn(dataStore as any, "remoteDelete");

      await dataStore.removeById(widgets, "1", true);

      expect(await dataStore.count(widgets)).toEqual(0);
      expect(remove).toHaveBeenCalledWith("widgets", ["1"]);
    });

    it("writes clear through and empties the in-memory collection", async () => {
      await dataStore.insertMany(widgets, [{ id: "1" }, { id: "2" }], true);
      const clear = jest.spyOn(dataStore as any, "remoteClear");

      await dataStore.clear(widgets, true);

      expect(await dataStore.count(widgets)).toEqual(0);
      expect(clear).toHaveBeenCalledWith("widgets");
    });
  });

  describe("lazy collections", () => {
    it("writes inserts to the server without holding them in memory", async () => {
      const upsert = jest.spyOn(dataStore as any, "remoteUpsert");

      await dataStore.insert(blobs, { id: "x", name: "B" }, true);

      expect(upsert).toHaveBeenCalledWith("blobs", [{ key: "x", value: { id: "x", name: "B" } }]);
      expect(await dataStore.count(blobs)).toEqual(0);
    });

    it("reads getById straight from the server", async () => {
      const getOne = jest.spyOn(dataStore as any, "remoteGetOne").mockResolvedValue({ id: "x", name: "B" });

      const got = await dataStore.getById(blobs, "x");

      expect(getOne).toHaveBeenCalledWith("blobs", "x");
      expect(got).toEqual({ id: "x", name: "B" });
    });

    it("routes removeById and clear to the server only", async () => {
      const remove = jest.spyOn(dataStore as any, "remoteDelete");
      const clear = jest.spyOn(dataStore as any, "remoteClear");

      await dataStore.removeById(blobs, "x", true);
      await dataStore.clear(blobs, true);

      expect(remove).toHaveBeenCalledWith("blobs", ["x"]);
      expect(clear).toHaveBeenCalledWith("blobs");
    });
  });

  describe("hydration", () => {
    it("populates in-memory collections from the server payload", async () => {
      jest
        .spyOn(dataStore as any, "remoteHydrate")
        .mockResolvedValue({ widgets: [{ id: "1" }, { id: "2" }], prefs: [{ name: "s" }] });

      await (dataStore as any).hydrateEager();

      expect(await dataStore.count(widgets)).toEqual(2);
      expect(await dataStore.find(prefs, [])).toEqual([expect.objectContaining({ name: "s" })]);
    });

    it("emits a LOADED event once hydration completes", async () => {
      const events: number[] = [];
      dataStore.dbEvent$.subscribe(event => events.push(event));
      await flushMacrotask();
      expect(events).toContain(0 /* DbEvent.LOADED */);
    });
  });
});

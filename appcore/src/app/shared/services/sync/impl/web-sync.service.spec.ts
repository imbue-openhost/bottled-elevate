import { WebSyncService } from "./web-sync.service";
import { buildActivityFromWorkout, ProviderWorkout } from "./web-activity-mapper";

jest.mock("./web-activity-mapper", () => ({
  // Minimal stand-in: id matches the real mapper's `${source}:${id}` scheme; no streams.
  buildActivityFromWorkout: jest.fn((workout: any) =>
    Promise.resolve({
      activity: { id: `${workout.source || "openhost"}:${workout.id}` },
      streams: null
    })
  )
}));

interface Summary {
  id: string;
  source: string;
  start: string;
  end: string;
}

function summary(id: string, start: string): Summary {
  return { id, source: "apple_health", start, end: start };
}

// Mimics the real (no-unique-index) syncDateTime collection: findOne returns the FIRST doc and
// seeds a null default if empty; put updates by $loki or inserts a new doc. This is what makes a
// fresh-model put duplicate instead of update — the bug updateSyncDateTime must avoid.
function makeSyncDateTimeDao() {
  const docs: any[] = [];
  let nextLoki = 1;
  return {
    docs,
    findOne: jest.fn(() => {
      if (!docs.length) {
        docs.push({ syncDateTime: null, $loki: nextLoki++ });
      }
      return Promise.resolve(docs[0]);
    }),
    put: jest.fn((doc: any) => {
      const existing = doc.$loki != null ? docs.find(d => d.$loki === doc.$loki) : null;
      if (existing) {
        Object.assign(existing, doc);
      } else {
        docs.push({ ...doc, $loki: nextLoki++ });
      }
      return Promise.resolve(doc);
    }),
    count: jest.fn(() => Promise.resolve(docs.length)),
    clear: jest.fn(() => {
      docs.length = 0;
      return Promise.resolve();
    })
  };
}

describe("WebSyncService", () => {
  let service: WebSyncService;
  let detailFetchOrder: string[];
  let inserted: any[];
  let syncDao: ReturnType<typeof makeSyncDateTimeDao>;
  let existing: { id: string }[];

  // The list endpoint returns workouts ascending (oldest first), like the real service.
  const list: Summary[] = [
    summary("w1", "2025-01-01T00:00:00Z"),
    summary("w2", "2025-02-01T00:00:00Z"),
    summary("w3", "2025-03-01T00:00:00Z")
  ];

  function build(listData: Summary[], existingActivities: { id: string }[]): WebSyncService {
    detailFetchOrder = [];
    inserted = [];
    existing = existingActivities;
    syncDao = makeSyncDateTimeDao();

    const httpClient: any = {
      get: jest.fn((url: string) => {
        const data = url.includes("/api/workouts/")
          ? listData.find(w => url.endsWith(`/api/workouts/${w.id}`))
          : { data: listData };
        if (url.includes("/api/workouts/")) {
          detailFetchOrder.push(decodeURIComponent(url.split("/api/workouts/")[1]));
        }
        return { pipe: () => ({ toPromise: () => Promise.resolve(data) }) };
      })
    };

    const activityService: any = {
      find: jest.fn(() => Promise.resolve(existing)),
      count: jest.fn(() => Promise.resolve(existing.length)),
      insertMany: jest.fn((activities: any[]) => {
        inserted.push(...activities);
        return Promise.resolve();
      }),
      athleteSnapshotResolver: { update: jest.fn(() => Promise.resolve()), resolve: jest.fn(() => ({})) }
    };

    const svc = new WebSyncService(
      {} as any,
      { persist: jest.fn(() => Promise.resolve()) } as any,
      activityService,
      { insertMany: jest.fn(() => Promise.resolve()) } as any,
      {} as any,
      { fetch: jest.fn(() => Promise.resolve({})) } as any,
      { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() } as any,
      syncDao as any,
      httpClient
    );
    return svc;
  }

  beforeEach(() => {
    (buildActivityFromWorkout as jest.Mock).mockClear();
  });

  it("imports newest-first and writes syncDateTime once the pass completes", async () => {
    service = build(list, []);
    await service.sync(false, false);

    expect(detailFetchOrder).toEqual(["w3", "w2", "w1"]);
    expect(inserted.map(a => a.id)).toEqual(["apple_health:w3", "apple_health:w2", "apple_health:w1"]);
    // A completed pass leaves exactly one syncDateTime doc holding a real number (no shadowing
    // null/duplicate), so getSyncState reads SYNCED rather than sticking at PARTIALLY_SYNCED.
    expect(syncDao.docs.length).toBe(1);
    expect(typeof (await syncDao.findOne()).syncDateTime).toBe("number");
    expect(service.isSyncing).toBe(false);
  });

  it("skips workouts already in the store (cheap resume)", async () => {
    service = build(list, [{ id: "apple_health:w3" }, { id: "apple_health:w2" }]);
    await service.sync(false, false);

    // Only the unimported tail is fetched + inserted; the existing two are untouched.
    expect(detailFetchOrder).toEqual(["w1"]);
    expect(inserted.map(a => a.id)).toEqual(["apple_health:w1"]);
    expect(typeof (await syncDao.findOne()).syncDateTime).toBe("number");
  });

  it("does not run a second sync while one is in flight", async () => {
    service = build(list, []);
    const first = service.sync(false, false);
    const second = service.sync(false, false); // should no-op immediately
    await Promise.all([first, second]);
    // Detail fetched once per workout, not twice.
    expect(detailFetchOrder.sort()).toEqual(["w1", "w2", "w3"]);
  });

  it("emits progress and clears it when done", async () => {
    service = build(list, []);
    const progresses: any[] = [];
    service.syncProgress$.subscribe(p => progresses.push(p));
    await service.sync(false, false);

    expect(progresses).toContainEqual({ imported: 0, total: 3 });
    expect(progresses).toContainEqual({ imported: 3, total: 3 });
    expect(progresses[progresses.length - 1]).toBeNull();
  });

  it("aborting before a sync leaves syncDateTime unset when stopped mid-pass", async () => {
    // Many workouts so the import runs in multiple batches; stop after the first batch.
    const many: Summary[] = Array.from({ length: 20 }, (_, i) =>
      summary(`m${i}`, `2025-01-${String((i % 27) + 1).padStart(2, "0")}T00:00:00Z`)
    );
    service = build(many, []);
    let calls = 0;
    (buildActivityFromWorkout as jest.Mock).mockImplementation((workout: any) => {
      calls++;
      if (calls === 1) {
        service.stop(); // request cancellation during the first batch
      }
      return Promise.resolve({ activity: { id: `${workout.source}:${workout.id}` }, streams: null });
    });

    await service.sync(false, false);

    expect(inserted.length).toBeGreaterThan(0);
    expect(inserted.length).toBeLessThan(many.length);
    // Stopped mid-pass: syncDateTime is never stamped, so the next sync resumes the tail.
    expect((await syncDao.findOne()).syncDateTime).toBeNull();
    expect(service.isSyncing).toBe(false);
  });
});

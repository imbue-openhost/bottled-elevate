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

describe("WebSyncService", () => {
  let service: WebSyncService;
  let detailFetchOrder: string[];
  let inserted: any[];
  let syncDateTimePut: jest.Mock;
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
    syncDateTimePut = jest.fn((v: any) => Promise.resolve(v));

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
      { findOne: jest.fn(() => Promise.resolve(null)), put: syncDateTimePut, clear: jest.fn() } as any,
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
    expect(syncDateTimePut).toHaveBeenCalledTimes(1);
    expect(service.isSyncing).toBe(false);
  });

  it("skips workouts already in the store (cheap resume)", async () => {
    service = build(list, [{ id: "apple_health:w3" }, { id: "apple_health:w2" }]);
    await service.sync(false, false);

    // Only the unimported tail is fetched + inserted; the existing two are untouched.
    expect(detailFetchOrder).toEqual(["w1"]);
    expect(inserted.map(a => a.id)).toEqual(["apple_health:w1"]);
    expect(syncDateTimePut).toHaveBeenCalledTimes(1);
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
    expect(syncDateTimePut).not.toHaveBeenCalled();
    expect(service.isSyncing).toBe(false);
  });
});

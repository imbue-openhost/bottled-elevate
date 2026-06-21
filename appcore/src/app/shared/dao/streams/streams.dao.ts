import { Injectable } from "@angular/core";
import { BaseDao } from "../base.dao";
import { CollectionDef } from "../../data-store/collection-def";
import { DeflatedActivityStreams } from "@elevate/shared/models/sync/deflated-activity.streams";

@Injectable()
export class StreamsDao extends BaseDao<DeflatedActivityStreams> {
  // Lazy: streams are large and only ever read one activity at a time on the detail view, so they
  // stay server-side and are fetched by id on demand rather than hydrated into memory.
  public static readonly COLLECTION_DEF: CollectionDef<DeflatedActivityStreams> = new CollectionDef(
    "streams",
    {
      unique: ["activityId"]
    },
    true
  );

  public getCollectionDef(): CollectionDef<DeflatedActivityStreams> {
    return StreamsDao.COLLECTION_DEF;
  }

  public getDefaultStorageValue(): DeflatedActivityStreams[] {
    return [];
  }
}

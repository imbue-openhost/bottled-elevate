export class CollectionDef<T> {
  public readonly name: string;

  public options: Partial<CollectionOptions<T>>;

  // Lazy collections are never hydrated into / held in memory; they are read and written one
  // record at a time straight against the server. Use for large, point-read-only collections.
  public readonly lazy: boolean;

  constructor(name: string, options: Partial<CollectionOptions<T>>, lazy: boolean = false) {
    this.name = name;
    this.options = options;
    this.lazy = lazy;
  }
}

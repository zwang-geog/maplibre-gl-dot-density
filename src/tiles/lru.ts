export class Lru<V> {
  private readonly map = new Map<string, V>();

  constructor(readonly maxSize: number) {}

  get size(): number {
    return this.map.size;
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  peek(key: string): V | undefined {
    return this.map.get(key);
  }

  get(key: string): V | undefined {
    const value = this.map.get(key);
    if (value === undefined) return undefined;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: string, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
  }

  delete(key: string): boolean {
    return this.map.delete(key);
  }

  /** Oldest keys first. */
  keys(): string[] {
    return [...this.map.keys()];
  }

  values(): V[] {
    return [...this.map.values()];
  }
}

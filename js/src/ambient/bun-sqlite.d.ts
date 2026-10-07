// Minimal ambient types for `bun:sqlite`, so the package builds without @types/bun.
declare module 'bun:sqlite' {
  export interface Statement {
    all(...params: unknown[]): unknown[];
    run(...params: unknown[]): unknown;
    finalize(): void;
  }
  export class Database {
    constructor(filename?: string, options?: { readonly?: boolean; create?: boolean; readwrite?: boolean; strict?: boolean; safeIntegers?: boolean });
    static deserialize(data: Uint8Array, isReadOnly?: boolean | { readonly?: boolean; strict?: boolean; safeIntegers?: boolean }): Database;
    query(sql: string): Statement;
    prepare(sql: string): Statement;
    exec(sql: string): void;
    run(sql: string): void;
    serialize(name?: string): Uint8Array;
    close(throwOnError?: boolean): void;
  }
}

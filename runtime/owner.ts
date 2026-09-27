/** A held OS-backed SQLite lock, released even when the process is killed. */
import { Database } from "bun:sqlite";
import { chmodSync, existsSync, lstatSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { BridgeError } from "./contracts";

export class OwnerLock {
  private readonly database: Database;
  private closed = false;
  constructor(home: string) {
    mkdirSync(home, { recursive: true, mode: 0o700 });
    const path = join(home, "owner.sqlite");
    if (lstatSync(home).isSymbolicLink() || (existsSync(path) && lstatSync(path).isSymbolicLink())) throw new Error("Owner storage must not be a symbolic link");
    this.database = new Database(path, { create: true });
    chmodSync(path, 0o600);
    try {
      this.database.exec("PRAGMA busy_timeout=0; PRAGMA journal_mode=DELETE; CREATE TABLE IF NOT EXISTS owner(pid INTEGER); BEGIN EXCLUSIVE;");
      this.database.query("INSERT INTO owner VALUES(?)").run(process.pid);
    } catch {
      this.database.close();
      throw new BridgeError("profile_in_use", "Another process owns this profile. Use a separate home for development; do not recover a live runtime", 409);
    }
  }
  close(): void { if (!this.closed) { this.closed = true; this.database.close(); } }
}

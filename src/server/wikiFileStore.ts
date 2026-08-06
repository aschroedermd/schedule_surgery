import fs from "node:fs/promises";
import path from "node:path";

export interface WikiFileStore {
  put(sourceId: string, data: Buffer): Promise<void>;
  read(sourceId: string): Promise<Buffer | undefined>;
  delete(sourceId: string): Promise<void>;
}

export class MemoryWikiFileStore implements WikiFileStore {
  private readonly files = new Map<string, Buffer>();

  async put(sourceId: string, data: Buffer): Promise<void> {
    this.files.set(normalizeSourceId(sourceId), Buffer.from(data));
  }

  async read(sourceId: string): Promise<Buffer | undefined> {
    const data = this.files.get(normalizeSourceId(sourceId));
    return data ? Buffer.from(data) : undefined;
  }

  async delete(sourceId: string): Promise<void> {
    this.files.delete(normalizeSourceId(sourceId));
  }
}

export class FileSystemWikiFileStore implements WikiFileStore {
  constructor(private readonly rootPath: string) {}

  async put(sourceId: string, data: Buffer): Promise<void> {
    const filePath = this.filePath(sourceId);
    await fs.mkdir(this.rootPath, { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporaryPath, data, { mode: 0o600 });
    await fs.rename(temporaryPath, filePath);
  }

  async read(sourceId: string): Promise<Buffer | undefined> {
    try {
      return await fs.readFile(this.filePath(sourceId));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  async delete(sourceId: string): Promise<void> {
    try {
      await fs.unlink(this.filePath(sourceId));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  private filePath(sourceId: string): string {
    return path.join(this.rootPath, `${normalizeSourceId(sourceId)}.bin`);
  }
}

export function createDefaultWikiFileStore(): WikiFileStore {
  const defaultPath = process.env.NODE_ENV === "production" ? "/data/wiki-files" : path.resolve(process.cwd(), ".local/wiki-files");
  return new FileSystemWikiFileStore(path.resolve(process.env.WIKI_FILE_STORE_PATH || defaultPath));
}

function normalizeSourceId(sourceId: string): string {
  const normalized = sourceId.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,119}$/.test(normalized)) throw new Error("Invalid wiki source id");
  return normalized;
}

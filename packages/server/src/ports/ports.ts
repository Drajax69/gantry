import net from 'node:net';
import type { Database } from '../db/db.js';

/**
 * Port allocation. Allocations are sticky per (project, preview, service) so
 * restarting a preview keeps its URLs stable, and are probed against the real
 * loopback interface before being handed out.
 */

export function portFree(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, host, () => server.close(() => resolve(true)));
  });
}

export class PortAllocator {
  constructor(private readonly db: Database) {}

  private usedByOthers(projectId: string, previewId: string, serviceId: string): Set<number> {
    const rows = this.db.prepare('SELECT project_id, preview_id, service_id, port FROM port_allocations').all() as { project_id: string; preview_id: string; service_id: string; port: number }[];
    return new Set(rows.filter((row) => !(row.project_id === projectId && row.preview_id === previewId && row.service_id === serviceId)).map((row) => row.port));
  }

  existing(projectId: string, previewId: string, serviceId: string): number | null {
    const row = this.db.prepare('SELECT port FROM port_allocations WHERE project_id=? AND preview_id=? AND service_id=?').get(projectId, previewId, serviceId) as { port: number } | undefined;
    return row?.port ?? null;
  }

  /**
   * Return the port for a service, allocating (and persisting) one if needed.
   * Fixed ports from config are honored when free; otherwise allocation walks
   * the project range.
   */
  async allocate(projectId: string, previewId: string, serviceId: string, base: number, range: number, fixedPort?: number): Promise<number> {
    const existing = this.existing(projectId, previewId, serviceId);
    if (existing && (await portFree(existing))) return existing;
    const used = this.usedByOthers(projectId, previewId, serviceId);
    if (fixedPort) {
      if (used.has(fixedPort)) throw new Error(`Port ${fixedPort} is already assigned to another preview service`);
      if (!(await portFree(fixedPort))) throw new Error(`Port ${fixedPort} is occupied by another process; stop it or choose another port`);
      this.save(projectId, previewId, serviceId, fixedPort);
      return fixedPort;
    }
    const end = base + range;
    for (let port = base; port < end; port += 1) {
      if (used.has(port)) continue;
      if (!(await portFree(port))) continue;
      this.save(projectId, previewId, serviceId, port);
      return port;
    }
    throw new Error(`No free port in range ${base}-${end}`);
  }

  /** Release a preview's allocations (archive/remove paths). */
  release(previewId: string): void {
    this.db.prepare('DELETE FROM port_allocations WHERE preview_id=?').run(previewId);
  }

  private save(projectId: string, previewId: string, serviceId: string, port: number): void {
    this.db
      .prepare(
        'INSERT INTO port_allocations (project_id, preview_id, service_id, port) VALUES (?, ?, ?, ?) ON CONFLICT(project_id, preview_id, service_id) DO UPDATE SET port=excluded.port',
      )
      .run(projectId, previewId, serviceId, port);
  }
}

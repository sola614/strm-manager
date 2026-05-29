import { now } from '../utils/time.js';
import { normalizeBaseUrl, normalizeUrl, parseBoolean, sanitizeText } from '../utils/validators.js';

export function createServiceStore({ db, loadTasks, scheduleTask, stopScheduledTask }) {
  function loadServices() {
    return db.prepare('SELECT * FROM services ORDER BY created_at DESC').all().map(mapServiceRow);
  }

  function getServiceById(id) {
    const row = db.prepare('SELECT * FROM services WHERE id = ?').get(id);
    return row ? mapServiceRow(row) : null;
  }

  function createServiceRecord(service) {
    const timestamp = now();
    const result = db.prepare(`
      INSERT INTO services (name, url, token, base_url, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(service.name, service.url, service.token, service.baseUrl, service.enabled ? 1 : 0, timestamp, timestamp);
    return String(result.lastInsertRowid);
  }

  function updateServiceRecord(id, service) {
    db.prepare(`
      UPDATE services
      SET name = ?, url = ?, token = ?, base_url = ?, enabled = ?, updated_at = ?
      WHERE id = ?
    `).run(service.name, service.url, service.token, service.baseUrl, service.enabled ? 1 : 0, now(), id);
  }

  function bulkUpdateServiceEnabled(ids, enabled) {
    const services = ids.map((id) => getServiceById(id)).filter(Boolean);
    if (!services.length) {
      const error = new Error('请选择至少一个存在的 OpenList 服务。');
      error.status = 400;
      error.code = 'SERVICE_BULK_UPDATE_EMPTY';
      throw error;
    }

    const timestamp = now();
    const update = db.prepare('UPDATE services SET enabled = ?, updated_at = ? WHERE id = ?');
    const tx = db.transaction(() => {
      for (const service of services) {
        update.run(enabled ? 1 : 0, timestamp, service.id);
        if (!enabled) {
          db.prepare('UPDATE tasks SET enabled = 0, updated_at = ? WHERE service_id = ?').run(timestamp, service.id);
        }
      }
    });
    tx();

    services.forEach((service) => {
      if (!enabled) {
        loadTasks(service.id).forEach((task) => stopScheduledTask(task.id));
        return;
      }
      loadTasks(service.id).forEach(scheduleTask);
    });

    return {
      updatedCount: services.length,
      skippedCount: ids.length - services.length,
    };
  }

  function removeServiceRecord(id) {
    db.prepare('DELETE FROM services WHERE id = ?').run(id);
  }

  function findDuplicateServiceUrl(url, excludeId = null) {
    if (!url) return null;
    const row = excludeId
      ? db.prepare('SELECT id FROM services WHERE url = ? AND id != ?').get(url, excludeId)
      : db.prepare('SELECT id FROM services WHERE url = ?').get(url);
    return row ? String(row.id) : null;
  }

  function normalizeServicePayload(input, existing = null) {
    const name = sanitizeText(input?.name ?? existing?.name ?? '');
    const url = normalizeUrl(input?.url ?? existing?.url ?? '');
    const token = sanitizeText(input?.token ?? existing?.token ?? '');
    const baseUrl = normalizeBaseUrl(input?.baseUrl ?? input?.base_url ?? existing?.baseUrl ?? '/');
    const enabled = parseBoolean(input?.enabled ?? existing?.enabled ?? true);
    const errors = [];

    if (!url) errors.push('服务 URL 不能为空。');
    if (!token) errors.push('服务 Token 不能为空。');

    if (url) {
      try {
        new URL(url);
      } catch {
        errors.push('服务 URL 不合法。');
      }
    }

    if (url && findDuplicateServiceUrl(url, existing?.id || null)) {
      errors.push('服务 URL 已存在，请勿重复配置。');
    }

    return {
      errors,
      service: { name, url, token, baseUrl, enabled },
    };
  }

  return {
    loadServices,
    getServiceById,
    createServiceRecord,
    updateServiceRecord,
    bulkUpdateServiceEnabled,
    removeServiceRecord,
    normalizeServicePayload,
  };
}

function mapServiceRow(row) {
  return {
    id: String(row.id),
    name: row.name,
    url: row.url,
    token: row.token,
    baseUrl: row.base_url,
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

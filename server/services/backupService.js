import { createBackupExporter } from './backup/exportBackup.js';
import { createBackupImporter } from './backup/importBackup.js';

export function createBackupService(deps) {
  const exporter = createBackupExporter(deps);
  const importer = createBackupImporter(deps);

  return {
    buildBackupPayload: exporter.buildBackupPayload,
    restoreBackupPayload: importer.restoreBackupPayload,
  };
}

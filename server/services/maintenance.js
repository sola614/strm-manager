import cron from 'node-cron';

export function createMaintenanceService({ cleanupExpiredRuns, getConfiguredTimezone }) {
  let maintenanceJob = null;

  function startMaintenanceJobs() {
    cleanupExpiredRuns();
    if (maintenanceJob) {
      maintenanceJob.stop();
    }

    maintenanceJob = cron.schedule('0 15 3 * * *', () => {
      try {
        cleanupExpiredRuns();
      } catch (error) {
        console.error('Failed to cleanup expired runs:', error);
      }
    }, {
      timezone: getConfiguredTimezone(),
    });
  }

  return {
    startMaintenanceJobs,
  };
}

import {
  clampInteger,
  isValidTimezone,
  normalizeTimezone,
  parseBoolean,
  sanitizeText,
} from './utils/validators.js';

export function createAppConfigManager(options) {
  const {
    getSetting,
    setSetting,
    envPort,
    envDefaultStrmTargetPath,
    databasePath,
    resetAdminPassword,
    defaultLogCleanupEnabled,
    defaultLogRetentionDays,
    defaultTimezone,
    getRuntimePort,
    onApply,
  } = options;

  function ensureAppSettings() {
    if (!getSetting('app_port')) {
      setSetting('app_port', String(envPort));
    }

    if (!getSetting('default_strm_target_path')) {
      setSetting('default_strm_target_path', envDefaultStrmTargetPath);
    }

    if (!getSetting('log_cleanup_enabled')) {
      setSetting('log_cleanup_enabled', defaultLogCleanupEnabled ? '1' : '0');
    }

    if (!getSetting('log_retention_days')) {
      setSetting('log_retention_days', String(defaultLogRetentionDays));
    }

    if (!getSetting('timezone')) {
      setSetting('timezone', normalizeTimezone(process.env.TZ) || defaultTimezone);
    }
  }

  function getConfiguredPort() {
    return clampInteger(getSetting('app_port') || envPort, 1, 65535);
  }

  function getConfiguredStrmTargetPath() {
    return sanitizeText(getSetting('default_strm_target_path') || envDefaultStrmTargetPath) || envDefaultStrmTargetPath;
  }

  function getLogCleanupEnabled() {
    return parseBoolean(getSetting('log_cleanup_enabled') ?? (defaultLogCleanupEnabled ? '1' : '0'));
  }

  function getLogRetentionDays() {
    return clampInteger(getSetting('log_retention_days') || defaultLogRetentionDays, 1, 3650);
  }

  function getConfiguredTimezone() {
    return normalizeTimezone(getSetting('timezone') || process.env.TZ) || defaultTimezone;
  }

  function getAppConfigPayload() {
    return {
      port: getConfiguredPort(),
      runtimePort: getRuntimePort() || envPort,
      defaultStrmTargetPath: getConfiguredStrmTargetPath(),
      logCleanupEnabled: getLogCleanupEnabled(),
      logRetentionDays: getLogRetentionDays(),
      timezone: getConfiguredTimezone(),
      databasePath,
      nodeEnv: process.env.NODE_ENV || 'development',
      resetAdminPasswordEnabled: Boolean(resetAdminPassword),
    };
  }

  function normalizeAppConfigPayload(input, fallback = getAppConfigPayload()) {
    const rawPort = input?.port ?? fallback.port;
    const rawTargetPath = input?.defaultStrmTargetPath ?? input?.default_strm_target_path ?? fallback.defaultStrmTargetPath;
    const rawLogCleanupEnabled = input?.logCleanupEnabled ?? input?.log_cleanup_enabled ?? fallback.logCleanupEnabled;
    const rawLogRetentionDays = input?.logRetentionDays ?? input?.log_retention_days ?? fallback.logRetentionDays;
    const rawTimezone = input?.timezone ?? fallback.timezone;

    const port = Number.parseInt(String(rawPort), 10);
    const defaultStrmTargetPath = sanitizeText(rawTargetPath);
    const logRetentionDays = Number.parseInt(String(rawLogRetentionDays), 10);
    const logCleanupEnabled = parseBoolean(rawLogCleanupEnabled);
    const timezone = normalizeTimezone(rawTimezone);
    const errors = [];

    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      errors.push('PORT 必须是 1 到 65535 之间的整数。');
    }

    if (!defaultStrmTargetPath) {
      errors.push('STRM 默认输出目录不能为空。');
    }

    if (!Number.isInteger(logRetentionDays) || logRetentionDays < 1 || logRetentionDays > 3650) {
      errors.push('日志保留天数必须是 1 到 3650 之间的整数。');
    }

    if (!timezone) {
      errors.push('时区不能为空，仅支持 IANA 时区名称，例如 Asia/Shanghai。');
    } else if (!isValidTimezone(timezone)) {
      errors.push(`时区 ${timezone} 无效，请使用 IANA 时区名称，例如 Asia/Shanghai。`);
    }

    return {
      errors,
      config: {
        port: Number.isInteger(port) ? port : fallback.port,
        defaultStrmTargetPath: defaultStrmTargetPath || fallback.defaultStrmTargetPath,
        logCleanupEnabled,
        logRetentionDays: Number.isInteger(logRetentionDays) ? logRetentionDays : fallback.logRetentionDays,
        timezone: timezone || fallback.timezone,
      },
    };
  }

  function applyAppConfig(config) {
    setSetting('app_port', String(clampInteger(config.port, 1, 65535)));
    setSetting(
      'default_strm_target_path',
      sanitizeText(config.defaultStrmTargetPath) || envDefaultStrmTargetPath,
    );
    setSetting('log_cleanup_enabled', config.logCleanupEnabled ? '1' : '0');
    setSetting('log_retention_days', String(clampInteger(config.logRetentionDays, 1, 3650)));
    setSetting('timezone', normalizeTimezone(config.timezone) || defaultTimezone);
    process.env.TZ = getConfiguredTimezone();
    onApply?.();
  }

  return {
    ensureAppSettings,
    getConfiguredPort,
    getConfiguredStrmTargetPath,
    getLogCleanupEnabled,
    getLogRetentionDays,
    getConfiguredTimezone,
    getAppConfigPayload,
    normalizeAppConfigPayload,
    applyAppConfig,
  };
}

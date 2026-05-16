import parser from 'cron-parser';

export function getNextRun(cronExpr: string): string | null {
  if (!cronExpr.trim()) {
    return null;
  }

  try {
    const interval = parser.parseExpression(cronExpr, { currentDate: new Date() });
    return interval.next().toString();
  } catch {
    return null;
  }
}

export function isCronDue(cronExpr: string): boolean {
  if (!cronExpr.trim()) {
    return false;
  }

  try {
    const lastMinute = new Date(Date.now() - 30_000);
    const interval = parser.parseExpression(cronExpr, { currentDate: lastMinute });
    const next = interval.next();
    const now = Date.now();
    const diff = next.getTime() - now;
    return diff >= 0 && diff < 30_000;
  } catch {
    return false;
  }
}

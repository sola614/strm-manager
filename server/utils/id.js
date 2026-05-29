import crypto from 'node:crypto';

export function hashValue(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function generateId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');

const CACHE_DIR = path.join(__dirname, '..', 'data', 'cache');
fs.mkdirSync(CACHE_DIR, { recursive: true });

const DEFAULT_TTL_MS = Number(process.env.CACHE_TTL_MS) || (30 * 60 * 1000); // 30 minutes default

class CacheManager {
  constructor(defaultTtl = DEFAULT_TTL_MS) {
    this.defaultTtl = defaultTtl;
    this.memoryCache = new Map(); // key -> { value, expiresAt }
  }

  get(key) {
    const item = this.memoryCache.get(key);
    if (!item) return null;
    if (Date.now() > item.expiresAt) {
      this.memoryCache.delete(key);
      return null;
    }
    return item.value;
  }

  set(key, value, ttl = this.defaultTtl) {
    this.memoryCache.set(key, {
      value,
      expiresAt: Date.now() + ttl
    });
  }

  has(key) {
    return this.get(key) !== null;
  }

  delete(key) {
    this.memoryCache.delete(key);
  }

  clear() {
    this.memoryCache.clear();
  }
}

const defaultCache = new CacheManager();

module.exports = {
  CacheManager,
  defaultCache
};

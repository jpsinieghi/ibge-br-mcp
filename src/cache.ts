/**
 * Simple in-memory cache with TTL support for IBGE API requests
 */

import { fetchWithRetry, type RetryOptions } from "./retry.js";
import { withObservation } from "./observability.js";

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

class RequestCache {
  private cache: Map<string, CacheEntry<unknown>> = new Map();
  private defaultTTL: number;

  constructor(defaultTTLMinutes: number = 15) {
    this.defaultTTL = defaultTTLMinutes * 60 * 1000;
  }

  /**
   * Get cached data if available and not expired
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.data as T;
  }

  /**
   * Store data in cache with optional TTL
   */
  set<T>(key: string, data: T, ttlMinutes?: number): void {
    const ttl = ttlMinutes ? ttlMinutes * 60 * 1000 : this.defaultTTL;
    this.cache.set(key, {
      data,
      expiresAt: Date.now() + ttl,
    });
  }

  /**
   * Check if a key exists and is not expired
   */
  has(key: string): boolean {
    return this.get(key) !== null;
  }

  /**
   * Remove a specific key from cache
   */
  delete(key: string): void {
    this.cache.delete(key);
  }

  /**
   * Clear all cached data
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Remove all expired entries
   */
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Get cache statistics
   */
  stats(): { size: number; keys: string[] } {
    this.cleanup();
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
    };
  }
}

// Global cache instance with 15 minute default TTL
export const cache = new RequestCache(15);

// Cache TTL presets (in minutes)
export const CACHE_TTL = {
  STATIC: 60 * 24, // 24 hours - for static data like states, municipalities
  MEDIUM: 60, // 1 hour - for semi-static data like CNAE, indicators list
  SHORT: 15, // 15 minutes - for data that changes occasionally
  REALTIME: 1, // 1 minute - for real-time data like population projection
} as const;

/**
 * Generate cache key from URL and parameters
 */
export function cacheKey(
  base: string,
  params?: Record<string, string | number | boolean | undefined>
): string {
  if (!params) return base;

  const sortedParams = Object.entries(params)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  return sortedParams ? `${base}?${sortedParams}` : base;
}

/**
 * Fetch with cache support and automatic retry on network failures
 */
export async function cachedFetch<T>(
  url: string,
  cacheKeyStr: string,
  ttlMinutes?: number,
  retryOptions?: RetryOptions
): Promise<T> {
  return withObservation(
    "ibge.api.request",
    {
      input: observationTarget(url),
      metadata: { ttlMinutes: ttlMinutes ?? null },
    },
    async (observation) => {
      const cached = cache.get<T>(cacheKeyStr);
      if (cached !== null) {
        observation.update({ output: { status: "ok", cacheHit: true } });
        return cached;
      }

      const response = await fetchWithRetry(url, undefined, retryOptions);
      if (!response.ok) {
        observation.update({
          output: { status: "http_error", cacheHit: false, httpStatus: response.status },
        });
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as T;
      cache.set(cacheKeyStr, data, ttlMinutes);
      observation.update({
        output: { status: "ok", cacheHit: false, httpStatus: response.status },
      });
      return data;
    }
  );
}

function observationTarget(url: string): { origin: string; endpoint: string } {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean).slice(0, 4);
    return { origin: parsed.origin, endpoint: `/${parts.join("/")}` };
  } catch {
    return { origin: "invalid-url", endpoint: "[redacted]" };
  }
}

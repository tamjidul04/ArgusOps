export const DAEMON_CONFIG = {
  // Hard memory constraint for the daemon process itself
  MAX_DAEMON_RAM_MB: 150,
  
  // Interception latency target
  MAX_INTERCEPT_LATENCY_MS: 100,
  
  // Loop detection circuit-breaker parameters
  MAX_CONSECUTIVE_IDENTICAL_CALLS: 3,
  MAX_CONSECUTIVE_ERRORS: 4,
  LOOP_CHECK_WINDOW_SECONDS: 30,
  
  // Local agent bridge service port
  DEFAULT_PORT: 41829,
  
  // Heartbeat ping interval in milliseconds
  HEARTBEAT_INTERVAL_MS: 3000,
  
  // Lock timeout in milliseconds for cross-agent file mutex
  FILE_LOCK_TIMEOUT_MS: 15000,
} as const;


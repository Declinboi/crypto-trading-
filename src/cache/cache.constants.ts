export const CACHE_KEYS = {
  EXCHANGE_RATE: 'exchange_rate',
  ALL_EXCHANGE_RATES: 'all_exchange_rates',
  BANK_LIST: 'bank_list',
  PLATFORM_SETTINGS: 'platform_settings',
  USER_WALLET: 'user_wallet',
  SYSTEM_WALLET: 'system_wallet',
};

export const CACHE_TTL = {
  EXCHANGE_RATE: 10 * 60 * 1000, // 10 minutes
  ALL_EXCHANGE_RATES: 10 * 60 * 1000, // 10 minutes — matches fetch interval
  BANK_LIST: 24 * 60 * 60 * 1000, // 24 hours
  PLATFORM_SETTINGS: 5 * 60 * 1000, // 5 minutes
  USER_WALLET: 30 * 1000, // 30 seconds
  SYSTEM_WALLET: 30 * 1000, // 30 seconds
};

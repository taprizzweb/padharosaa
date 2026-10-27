// Runs before any route module is imported: the environment the routes validate at first use.
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://testproject.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key-test-anon-key-test';
process.env.NEXT_PUBLIC_APP_ORIGIN = 'https://gotomenu.taprizz.in';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key-test-service-role';
process.env.GUEST_COOKIE_SECRET = 'api-test-cookie-secret-api-test-cookie-secret';
process.env.IP_HASH_SALT = 'api-test-ip-salt-api-test';
process.env.LOG_LEVEL = 'error';
process.env.PADHAROSAA_DATA_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.CRON_SECRET = 'cron-secret-cron-secret-cron-secret';
process.env.AI_BASE_URL = 'https://ai.example.test/v1';
process.env.AI_API_KEY = 'ai-test-key-ai-test-key';
process.env.AI_MODEL = 'test-model';
process.env.CHANNEX_API_KEY = 'channex-test-key-channex-test-key';

const port = process.env.PORT || 3001;
const key = process.env.API_KEY;
const db = process.env['DATABASE_URL'];
const { SESSION_SECRET, LOG_LEVEL = 'info' } = process.env;
if (process.env.NODE_ENV === 'production') {}
process.env.CACHE_DIR = '/tmp';
// process.env.COMMENTED

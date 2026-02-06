const redis = require('redis');

async function connectRedis() {
  try {
    const host = process.env.REDIS_HOST || 'localhost';
    const port = process.env.REDIS_PORT || 6379;
    const password = process.env.REDIS_PASSWORD || undefined;

    console.log('🔧 Redis configuration:');
    console.log('   Host:', host, process.env.REDIS_HOST ? '(from env)' : '(default)');
    console.log('   Port:', port, process.env.REDIS_PORT ? '(from env)' : '(default)');
    console.log('   Password:', password ? '***' : 'none', process.env.REDIS_PASSWORD ? '(from env)' : '(default)');

    const client = redis.createClient({
      host: host,
      port: port,
      password: password,
    });

    await client.connect();
    console.log('✅ Redis connected successfully!');
    
    return client;
  } catch (error) {
    console.log('❌ Redis connection failed:', error.message);
    return null;
  }
}

module.exports = { connectRedis };                              
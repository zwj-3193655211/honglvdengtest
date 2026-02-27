const redis = require('redis');
require('dotenv').config();

// 创建Redis客户端
const redisClient = redis.createClient({
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    retry_strategy: (options) => {
        if (options.error && options.error.code === 'ECONNREFUSED') {
            return new Error('Redis服务器拒绝连接');
        }
        if (options.total_retry_time > 1000 * 60 * 60) {
            return new Error('重试时间已用完');
        }
        if (options.attempt > 10) {
            return undefined;
        }
        return Math.min(options.attempt * 100, 3000);
    }
});

// 连接事件处理
redisClient.on('connect', () => {
    console.log('Redis客户端已连接');
});

redisClient.on('ready', () => {
    console.log('Redis客户端已准备就绪');
});

redisClient.on('error', (err) => {
    console.error('Redis客户端错误:', err);
});

redisClient.on('end', () => {
    console.log('Redis客户端连接已关闭');
});

// 订阅客户端（用于消息订阅）
const subscriber = redisClient.duplicate();

subscriber.on('connect', () => {
    console.log('Redis订阅客户端已连接');
});

subscriber.on('error', (err) => {
    console.error('Redis订阅客户端错误:', err);
});

// 发布客户端（用于消息发布）
const publisher = redisClient.duplicate();

publisher.on('connect', () => {
    console.log('Redis发布客户端已连接');
});

publisher.on('error', (err) => {
    console.error('Redis发布客户端错误:', err);
});

// 初始化Redis连接
async function initializeRedis() {
    try {
        await redisClient.connect();
        await subscriber.connect();
        await publisher.connect();
        
        console.log('Redis连接初始化完成');
        return true;
    } catch (error) {
        console.error('Redis连接初始化失败:', error);
        return false;
    }
}

// 发布消息
async function publishMessage(channel, message) {
    try {
        await publisher.publish(channel, JSON.stringify(message));
        return true;
    } catch (error) {
        console.error('发布消息失败:', error);
        return false;
    }
}

// 订阅消息
async function subscribeMessage(channel, callback) {
    try {
        await subscriber.subscribe(channel, (message) => {
            try {
                const parsedMessage = JSON.parse(message);
                callback(parsedMessage);
            } catch (error) {
                console.error('解析消息失败:', error);
            }
        });
        return true;
    } catch (error) {
        console.error('订阅消息失败:', error);
        return false;
    }
}

// 缓存操作封装
async function setCache(key, value, expireSeconds = 300) {
    try {
        if (value === null || value === undefined || !Number.isFinite(expireSeconds) || expireSeconds <= 0) {
            await redisClient.del(key);
            return true;
        }
        const serializedValue = typeof value === 'string' ? value : JSON.stringify(value);
        await redisClient.setEx(key, expireSeconds, serializedValue);
        return true;
    } catch (error) {
        console.error('设置缓存失败:', error);
        return false;
    }
}

async function getCache(key) {
    try {
        const value = await redisClient.get(key);
        if (!value) return null;
        
        try {
            return JSON.parse(value);
        } catch {
            return value;
        }
    } catch (error) {
        console.error('获取缓存失败:', error);
        return null;
    }
}

async function deleteCache(key) {
    try {
        await redisClient.del(key);
        return true;
    } catch (error) {
        console.error('删除缓存失败:', error);
        return false;
    }
}

// 关闭Redis连接
async function closeRedis() {
    try {
        await redisClient.quit();
        await subscriber.quit();
        await publisher.quit();
        console.log('Redis连接已关闭');
    } catch (error) {
        console.error('关闭Redis连接失败:', error);
    }
}

module.exports = {
    redisClient,
    subscriber,
    publisher,
    initializeRedis,
    publishMessage,
    subscribeMessage,
    setCache,
    getCache,
    deleteCache,
    closeRedis
};

const path = require('path')
const db = require(path.join(__dirname, '..', 'config', 'database.js'))

;(async () => {
  console.log('开始初始化数据库...')
  const ok = await db.initializeDatabase()
  if (!ok) {
    console.error('数据库初始化失败')
    process.exit(1)
  }
  console.log('数据库初始化完成')
  process.exit(0)
})()


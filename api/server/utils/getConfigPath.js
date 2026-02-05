const path = require('path');

/**
 * 获取配置文件路径
 * 优先级：CONFIG_PATH 环境变量 > 默认路径 (项目根目录/Aipyq.yaml)
 * @returns {string} 配置文件路径
 */
function getConfigPath() {
  // 从 api/server/utils 向上3级到达项目根目录
  const projectRoot = path.resolve(__dirname, '..', '..', '..');
  const defaultConfigPath = path.resolve(projectRoot, 'Aipyq.yaml');
  return process.env.CONFIG_PATH || defaultConfigPath;
}

module.exports = getConfigPath;


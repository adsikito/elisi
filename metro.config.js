const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');
const { resolve } = require('metro-resolver');

const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith('@/')) {
    const mapped = path.join(projectRoot, 'src', moduleName.slice(2));
    return resolve(context, mapped, platform);
  }

  return resolve(context, moduleName, platform);
};

module.exports = config;

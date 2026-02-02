const path = require('path');
const axios = require('axios');
const yaml = require('js-yaml');
const keyBy = require('lodash/keyBy');
const { loadYaml } = require('@aipyq/api');
const { logger } = require('@aipyq/data-schemas');
const {
  configSchema,
  paramSettings,
  EImageOutputType,
  agentParamSettings,
  validateSettingDefinitions,
} = require('@aipyq/data-provider');

const projectRoot = path.resolve(__dirname, '..', '..', '..', '..');
const defaultConfigPath = path.resolve(projectRoot, 'Chizhou.yaml');

let i = 0;

/**
 * Load custom configuration files and caches the object if the `cache` field at root is true.
 * Validation via parsing the config file with the config schema.
 * @function loadCustomConfig
 * @returns {Promise<TCustomConfig | null>} A promise that resolves to null or the custom config object.
 * */
async function loadCustomConfig(printConfig = true) {
  // Use CONFIG_PATH if set, otherwise fallback to defaultConfigPath
  const configPath = process.env.CONFIG_PATH || defaultConfigPath;

  let customConfig;

  if (/^https?:\/\//.test(configPath)) {
    try {
      const response = await axios.get(configPath);
      customConfig = response.data;
    } catch (error) {
      i === 0 && logger.error(`Failed to fetch the remote config file from ${configPath}`, error);
      i === 0 && i++;
      return null;
    }
  } else {
    customConfig = loadYaml(configPath);
    if (!customConfig) {
      i === 0 &&
        logger.info(
          'Custom config file missing or YAML format invalid.\n\nCheck out the latest config file guide for configurable options and features.\nhttps://www.aipyq.com/docs/configuration/aipyq_yaml\n\n',
        );
      i === 0 && i++;
      return null;
    }

    if (customConfig.reason || customConfig.stack) {
      i === 0 && logger.error('Config file YAML format is invalid:', customConfig);
      i === 0 && i++;
      return null;
    }
  }

  if (typeof customConfig === 'string') {
    try {
      customConfig = yaml.load(customConfig);
    } catch (parseError) {
      i === 0 && logger.info(`Failed to parse the YAML config from ${configPath}`, parseError);
      i === 0 && i++;
      return null;
    }
  }

  const result = configSchema.strict().safeParse(customConfig);
  if (result?.error?.errors?.some((err) => err?.path && err.path?.includes('imageOutputType'))) {
    throw new Error(
      `
Please specify a correct \`imageOutputType\` value (case-sensitive).

      The available options are:
      - ${EImageOutputType.JPEG}
      - ${EImageOutputType.PNG}
      - ${EImageOutputType.WEBP}
      
      Refer to the latest config file guide for more information:
      https://www.aipyq.com/docs/configuration/aipyq_yaml`,
    );
  }
  if (!result.success) {
    let errorMessage = `Invalid custom config file at ${configPath}:
${JSON.stringify(result.error, null, 2)}`;

    if (i === 0) {
      logger.error(errorMessage);
      const speechError = result.error.errors.find(
        (err) =>
          err.code === 'unrecognized_keys' &&
          (err.message?.includes('stt') || err.message?.includes('tts')),
      );

      if (speechError) {
        logger.warn(`
The Speech-to-text and Text-to-speech configuration format has recently changed.
If you're getting this error, please refer to the latest documentation:

https://www.aipyq.com/docs/configuration/stt_tts`);
      }

      i++;
    }

    return null;
  } else {
    if (printConfig) {
      logger.info('Custom config file loaded:');
      logger.info(JSON.stringify(customConfig, null, 2));
      logger.debug('Custom config:', customConfig);
    }
    // 添加日志，检查 interface.defaultEndpoint 和 defaultModel
    // 注意：loadCustomConfig 返回的是 customConfig（原始配置），而不是 result.data（验证后的数据）
    // 所以我们需要检查 customConfig.interface，而不是 result.data.interface
    if (customConfig?.interface) {
      logger.info('[loadCustomConfig] Interface config from customConfig:', {
        defaultEndpoint: customConfig.interface.defaultEndpoint,
        defaultModel: customConfig.interface.defaultModel,
        customWelcome: customConfig.interface.customWelcome,
      });
    }
    if (result.data?.interface) {
      logger.info('[loadCustomConfig] Interface config from result.data:', {
        defaultEndpoint: result.data.interface.defaultEndpoint,
        defaultModel: result.data.interface.defaultModel,
        customWelcome: result.data.interface.customWelcome,
      });
    } else {
      logger.warn('[loadCustomConfig] No interface config found in result.data');
    }
  }

  (customConfig.endpoints?.custom ?? [])
    .filter((endpoint) => endpoint.customParams)
    .forEach((endpoint) => parseCustomParams(endpoint.name, endpoint.customParams));

  if (result.data.modelSpecs) {
    customConfig.modelSpecs = result.data.modelSpecs;
  }

  // 确保 interface 配置从 result.data 中获取（验证后的数据），而不是原始 customConfig
  // 这样可以确保所有字段都符合 schema
  // 特别保留 defaultEndpoint 和 defaultModel，因为它们可能在 schema 验证时被移除
  if (result.data?.interface || customConfig.interface) {
    // 首先保存原始配置中的关键字段值（在合并前保存）
    const originalDefaultEndpoint = customConfig.interface?.defaultEndpoint;
    const originalDefaultModel = customConfig.interface?.defaultModel;
    const originalCustomWelcome = customConfig.interface?.customWelcome;
    
    // 获取验证后的 interface 配置
    const validatedInterface = result.data?.interface || {};
    
    // 合并配置：先使用验证后的数据（但不包括 undefined 值），然后用原始值明确覆盖关键字段
    customConfig.interface = {
      ...customConfig.interface,
      // 只合并验证后的非 undefined 字段
      ...Object.fromEntries(
        Object.entries(validatedInterface).filter(([_, value]) => value !== undefined)
      ),
      // 确保这些关键字段优先使用原始配置中的值（如果存在）
      ...(originalDefaultEndpoint !== undefined && originalDefaultEndpoint !== null && { defaultEndpoint: originalDefaultEndpoint }),
      ...(originalDefaultModel !== undefined && originalDefaultModel !== null && { defaultModel: originalDefaultModel }),
      ...(originalCustomWelcome !== undefined && originalCustomWelcome !== null && { customWelcome: originalCustomWelcome }),
    };
    logger.info(
      `[loadCustomConfig] Merged interface config: defaultEndpoint=${customConfig.interface.defaultEndpoint}, defaultModel=${customConfig.interface.defaultModel}, originalDefaultEndpoint=${originalDefaultEndpoint}, originalDefaultModel=${originalDefaultModel}, validatedInterfaceKeys=${Object.keys(validatedInterface).join(',')}, validatedInterfaceDefaultEndpoint=${validatedInterface.defaultEndpoint}, validatedInterfaceDefaultModel=${validatedInterface.defaultModel}`,
    );
  }

  return customConfig;
}

// Validate and fill out missing values for custom parameters
function parseCustomParams(endpointName, customParams) {
  const paramEndpoint = customParams.defaultParamsEndpoint;
  customParams.paramDefinitions = customParams.paramDefinitions || [];

  // Checks if `defaultParamsEndpoint` is a key in `paramSettings`.
  const validEndpoints = new Set([
    ...Object.keys(paramSettings),
    ...Object.keys(agentParamSettings),
  ]);
  if (!validEndpoints.has(paramEndpoint)) {
    throw new Error(
      `defaultParamsEndpoint of "${endpointName}" endpoint is invalid. ` +
        `Valid options are ${Array.from(validEndpoints).join(', ')}`,
    );
  }

  // creates default param maps
  const regularParams = paramSettings[paramEndpoint] ?? [];
  const agentParams = agentParamSettings[paramEndpoint] ?? [];
  const defaultParams = regularParams.concat(agentParams);
  const defaultParamsMap = keyBy(defaultParams, 'key');

  // TODO: Remove this check once we support new parameters not part of default parameters.
  // Checks if every key in `paramDefinitions` is valid.
  const validKeys = new Set(Object.keys(defaultParamsMap));
  const paramKeys = customParams.paramDefinitions.map((param) => param.key);
  if (paramKeys.some((key) => !validKeys.has(key))) {
    throw new Error(
      `paramDefinitions of "${endpointName}" endpoint contains invalid key(s). ` +
        `Valid parameter keys are ${Array.from(validKeys).join(', ')}`,
    );
  }

  // Fill out missing values for custom param definitions
  customParams.paramDefinitions = customParams.paramDefinitions.map((param) => {
    return { ...defaultParamsMap[param.key], ...param, optionType: 'custom' };
  });

  try {
    validateSettingDefinitions(customParams.paramDefinitions);
  } catch (e) {
    throw new Error(
      `Custom parameter definitions for "${endpointName}" endpoint is malformed: ${e.message}`,
    );
  }
}

module.exports = loadCustomConfig;

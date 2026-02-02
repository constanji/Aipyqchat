import React, { useState, useEffect, useMemo, useCallback, createContext, useRef } from 'react';
import { Button, useToastContext, Switch } from '@aipyq/client';
import { useQueryClient } from '@tanstack/react-query';
import { QueryKeys, EModelEndpoint, Permissions, PermissionTypes, isAgentsEndpoint, isAssistantsEndpoint } from '@aipyq/data-provider';
import { useGetModelsQuery } from '@aipyq/data-provider/react-query';
import { useGetStartupConfig, useGetEndpointsQuery } from '~/data-provider';
import { useLocalize, useAuthContext, useHasAccess } from '~/hooks';
import { mapEndpoints } from '~/utils';
import type { TInterfaceConfig, TConversation } from '@aipyq/data-provider';
import { ModelSelectorProvider, useModelSelectorContext } from '~/components/Chat/Menus/Endpoints/ModelSelectorContext';
import { ModelSelectorChatContext } from '~/components/Chat/Menus/Endpoints/ModelSelectorChatContext';
import {
  renderModelSpecs,
  renderEndpoints,
  renderSearchResults,
  renderCustomGroups,
} from '~/components/Chat/Menus/Endpoints/components';
import { getSelectedIcon, getDisplayValue } from '~/components/Chat/Menus/Endpoints/utils';
import { CustomMenu as Menu } from '~/components/Chat/Menus/Endpoints/CustomMenu';

interface FeaturesManagementProps {
  startupConfig?: any;
}

interface InterfaceConfig {
  customWelcome?: string;
  defaultEndpoint?: string;
  defaultModel?: string;
  fileSearch?: boolean;
  endpointsMenu?: boolean;
  modelSelect?: boolean;
  parameters?: boolean;
  sidePanel?: boolean;
  presets?: boolean;
  prompts?: boolean;
  multiConvo?: boolean;
  agents?: boolean;
  temporaryChat?: boolean;
  bookmarks?: boolean;
  peoplePicker?: {
    users?: boolean;
    groups?: boolean;
    roles?: boolean;
  };
  marketplace?: {
    use?: boolean;
  };
  fileCitations?: boolean;
}

export default function FeaturesManagement({ startupConfig: propStartupConfig }: FeaturesManagementProps) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { token } = useAuthContext();
  const queryClient = useQueryClient();
  const { data: startupConfigFromQuery, refetch } = useGetStartupConfig();
  const startupConfig = propStartupConfig || startupConfigFromQuery;

  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [config, setConfig] = useState<InterfaceConfig>({});
  // 用于跟踪最近保存的配置，防止被旧值覆盖
  const savedConfigRef = useRef<InterfaceConfig | null>(null);

  // 从 startupConfig 加载配置
  useEffect(() => {
    if (startupConfig?.interface) {
      const interfaceConfig = startupConfig.interface as InterfaceConfig;
      console.log('[FeaturesManagement] Loading config from startupConfig:', {
        customWelcome: interfaceConfig.customWelcome,
        defaultEndpoint: interfaceConfig.defaultEndpoint,
        defaultModel: interfaceConfig.defaultModel,
        fullInterface: JSON.stringify(interfaceConfig, null, 2),
      });
      
      // 如果最近保存过配置，检查服务器返回的值是否与保存的值匹配
      // 如果不匹配，说明服务器返回的是旧值（缓存问题），保持当前配置不变
      if (savedConfigRef.current) {
        const savedConfig = savedConfigRef.current;
        const serverMatchesSaved = 
          interfaceConfig.customWelcome === savedConfig.customWelcome &&
          interfaceConfig.defaultEndpoint === savedConfig.defaultEndpoint &&
          interfaceConfig.defaultModel === savedConfig.defaultModel;
        
        console.log('[FeaturesManagement] Checking saved config:', {
          savedConfig: {
            customWelcome: savedConfig.customWelcome,
            defaultEndpoint: savedConfig.defaultEndpoint,
            defaultModel: savedConfig.defaultModel,
          },
          serverConfig: {
            customWelcome: interfaceConfig.customWelcome,
            defaultEndpoint: interfaceConfig.defaultEndpoint,
            defaultModel: interfaceConfig.defaultModel,
          },
          matches: serverMatchesSaved,
        });
        
        if (!serverMatchesSaved) {
          // 服务器返回的值与保存的值不同，说明是旧值（缓存问题），保持当前配置
          // 注意：不要清除 savedConfigRef，因为服务器可能还没有更新，需要继续保护
          console.log('[FeaturesManagement] Server config differs from saved config, keeping current config and savedConfigRef');
          setIsLoading(false);
          return;
        } else {
          // 服务器返回的值与保存的值相同，说明服务器已经更新了，清除保存标记
          console.log('[FeaturesManagement] Server config matches saved config, clearing saved config ref');
          savedConfigRef.current = null;
        }
      } else {
        console.log('[FeaturesManagement] No saved config ref, checking if current config differs from server');
        // 如果没有保存的配置，检查当前配置是否与服务器配置不同
        // 如果不同，可能是服务器返回了旧值，我们应该保持当前配置
        const currentConfig = config;
        const serverDiffersFromCurrent = 
          interfaceConfig.customWelcome !== currentConfig.customWelcome ||
          interfaceConfig.defaultEndpoint !== currentConfig.defaultEndpoint ||
          interfaceConfig.defaultModel !== currentConfig.defaultModel;
        
        if (serverDiffersFromCurrent && currentConfig.customWelcome) {
          // 如果服务器配置与当前配置不同，且当前配置有值，可能是服务器返回了旧值
          // 保持当前配置不变
          console.log('[FeaturesManagement] Server config differs from current config, keeping current config:', {
            currentConfig: {
              customWelcome: currentConfig.customWelcome,
              defaultEndpoint: currentConfig.defaultEndpoint,
              defaultModel: currentConfig.defaultModel,
            },
            serverConfig: {
              customWelcome: interfaceConfig.customWelcome,
              defaultEndpoint: interfaceConfig.defaultEndpoint,
              defaultModel: interfaceConfig.defaultModel,
            },
          });
          setIsLoading(false);
          return;
        }
        console.log('[FeaturesManagement] Loading from server (no saved config ref and configs match or current is empty)');
      }
      
      // 确保所有字段都被正确设置，包括 customWelcome（即使是空字符串也要保留）
      const loadedConfig: InterfaceConfig = {
        ...interfaceConfig,
        // 确保 customWelcome 被正确设置（如果存在）
        customWelcome: interfaceConfig.customWelcome !== undefined ? interfaceConfig.customWelcome : '',
        defaultEndpoint: interfaceConfig.defaultEndpoint !== undefined ? interfaceConfig.defaultEndpoint : '',
        defaultModel: interfaceConfig.defaultModel !== undefined ? interfaceConfig.defaultModel : '',
      };
      console.log('[FeaturesManagement] Setting config:', {
        customWelcome: loadedConfig.customWelcome,
        defaultEndpoint: loadedConfig.defaultEndpoint,
        defaultModel: loadedConfig.defaultModel,
      });
      setConfig(loadedConfig);
      setIsLoading(false);
    } else {
      console.log('[FeaturesManagement] No interface config found in startupConfig');
      setIsLoading(false);
    }
  }, [startupConfig]);

  // 保存配置
  const handleSave = async () => {
    setIsSaving(true);
    try {
      const baseEl = document.querySelector('base');
      const baseHref = baseEl?.getAttribute('href') || '/';
      const apiBase = baseHref.endsWith('/') ? baseHref.slice(0, -1) : baseHref;

      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      };
      
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      // 构建要保存的配置对象，确保所有关键字段都被包含
      // 只发送需要保存的字段，避免覆盖其他配置
      const configToSave: Partial<InterfaceConfig> = {};
      
      // 始终包含 customWelcome（即使是空字符串）
      if (config.customWelcome !== undefined) {
        configToSave.customWelcome = config.customWelcome;
      }
      
      // 始终包含 defaultEndpoint（即使是空字符串）
      if (config.defaultEndpoint !== undefined) {
        configToSave.defaultEndpoint = config.defaultEndpoint || undefined;
      }
      
      // 始终包含 defaultModel（即使是空字符串）
      if (config.defaultModel !== undefined) {
        configToSave.defaultModel = config.defaultModel || undefined;
      }
      
      // 包含其他已修改的字段
      const otherFields: (keyof InterfaceConfig)[] = [
        'fileSearch', 'endpointsMenu', 'modelSelect', 'parameters', 'sidePanel',
        'presets', 'prompts', 'multiConvo', 'agents', 'temporaryChat', 'bookmarks',
        'fileCitations', 'peoplePicker', 'marketplace'
      ];
      
      otherFields.forEach((key) => {
        const value = config[key];
        if (value !== undefined) {
          (configToSave as Record<string, any>)[key] = value;
        }
      });

      console.log('[FeaturesManagement] Saving config:', JSON.stringify(configToSave, null, 2));

      const response = await fetch(`${apiBase}/api/config/interface`, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({ interface: configToSave }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || '保存失败');
      }

      showToast({
        message: '功能配置保存成功',
        status: 'success',
      });

      // 保存后，保持当前本地状态不变（用户刚刚输入的值就是最新的）
      // 不要立即用服务器返回的值覆盖，因为服务器可能返回缓存的旧值
      // 保存当前配置到 ref，用于后续比较
      // 注意：必须保存完整的配置对象，包括所有字段
      savedConfigRef.current = {
        customWelcome: config.customWelcome,
        defaultEndpoint: config.defaultEndpoint,
        defaultModel: config.defaultModel,
      };
      console.log('[FeaturesManagement] Keeping current config after save and setting savedConfigRef:', {
        customWelcome: config.customWelcome,
        defaultEndpoint: config.defaultEndpoint,
        defaultModel: config.defaultModel,
        savedConfigRef: savedConfigRef.current,
      });

      // 清除缓存并刷新配置（在后台进行，不影响UI显示）
      queryClient.invalidateQueries([QueryKeys.startupConfig]);
      
      // 延迟刷新配置，确保服务器缓存已更新
      // 只有当服务器返回的值与保存时的值相同（说明服务器已经更新）时，才更新本地状态
      // 如果服务器返回的值与保存时的值不同，说明服务器返回的是旧值（缓存问题），保持当前值
      setTimeout(async () => {
        try {
          // 先清除客户端缓存
          queryClient.removeQueries([QueryKeys.startupConfig]);
          
          // 保存当前状态，用于比较
          const savedConfig = { ...config };
          
          // 然后重新获取配置
          const result = await refetch();
          if (result.data?.interface) {
            const interfaceConfig = result.data.interface as InterfaceConfig;
            console.log('[FeaturesManagement] Refreshed config from server:', {
              customWelcome: interfaceConfig.customWelcome,
              defaultEndpoint: interfaceConfig.defaultEndpoint,
              defaultModel: interfaceConfig.defaultModel,
            });
            
            // 只有当服务器返回的值与保存时的值相同（说明服务器已经更新）时，才更新本地状态
            // 如果服务器返回的值与保存时的值不同，说明服务器返回的是旧值（缓存问题），保持当前值
            const serverMatchesSaved = 
              interfaceConfig.customWelcome === savedConfig.customWelcome &&
              interfaceConfig.defaultEndpoint === savedConfig.defaultEndpoint &&
              interfaceConfig.defaultModel === savedConfig.defaultModel;
            
            if (serverMatchesSaved) {
              // 服务器返回的值与保存时的值相同，说明服务器已经更新了，使用服务器值
              const refreshedConfig: InterfaceConfig = {
                ...interfaceConfig,
                customWelcome: interfaceConfig.customWelcome ?? '',
                defaultEndpoint: interfaceConfig.defaultEndpoint ?? '',
                defaultModel: interfaceConfig.defaultModel ?? '',
              };
              console.log('[FeaturesManagement] Server config matches saved config, updating:', {
                customWelcome: refreshedConfig.customWelcome,
                defaultEndpoint: refreshedConfig.defaultEndpoint,
                defaultModel: refreshedConfig.defaultModel,
              });
              // 清除保存标记，因为服务器已经更新了
              savedConfigRef.current = null;
              setConfig(refreshedConfig);
            } else {
              // 服务器返回的值与保存时的值不同，说明服务器返回的是旧值（缓存问题），保持当前值
              console.log('[FeaturesManagement] Server config differs from saved config, keeping current config');
            }
          }
        } catch (error) {
          console.error('Error refreshing config after save:', error);
        }
      }, 1500);
    } catch (error) {
      showToast({
        message: `保存失败: ${error instanceof Error ? error.message : '未知错误'}`,
        status: 'error',
      });
    } finally {
      setIsSaving(false);
    }
  };

  // 更新配置值
  const updateConfig = (key: keyof InterfaceConfig, value: any) => {
    setConfig((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  // 更新嵌套配置值
  const updateNestedConfig = (parentKey: keyof InterfaceConfig, childKey: string, value: any) => {
    setConfig((prev) => {
      const currentParent = prev[parentKey];
      const parentValue = currentParent && typeof currentParent === 'object' 
        ? { ...currentParent } 
        : {};
      return {
        ...prev,
        [parentKey]: {
          ...parentValue,
          [childKey]: value,
        },
      };
    });
  };

  if (isLoading) {
    return (
      <div className="flex h-32 items-center justify-center text-text-secondary">
        <p className="text-sm">加载中...</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">初始界面配置</h2>
          <p className="mt-1 text-sm text-text-secondary">
            管理初始界面的欢迎语和模型
          </p>
        </div>
        <Button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          className="btn btn-primary relative flex items-center gap-2 rounded-lg px-3 py-2"
        >
          {isSaving ? '保存中...' : '保存配置'}
        </Button>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="space-y-6">
          {/* 欢迎消息及默认模型配置 */}
          <div className="rounded-lg border border-border-light bg-surface-secondary p-4">
            <label className="mb-2 block text-sm font-medium text-text-primary">
              自定义欢迎消息及所配置的模型
            </label>
            <div className="space-y-3">
              <input
                type="text"
                value={config.customWelcome ?? ''}
                onChange={(e) => updateConfig('customWelcome', e.target.value)}
                placeholder="欢迎来到池州职业技术学院 ！祝您体验愉快。"
                className="w-full rounded-md border border-border-light bg-surface-primary px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:border-primary focus:outline-none"
              />
              <ConfigModelSelector
                defaultEndpoint={config.defaultEndpoint}
                defaultModel={config.defaultModel}
                onEndpointChange={(endpoint) => {
                  updateConfig('defaultEndpoint', endpoint);
                  updateConfig('defaultModel', '');
                }}
                onModelChange={(model) => updateConfig('defaultModel', model)}
                startupConfig={startupConfig}
              />
            </div>
          </div>

          {/* 基础功能开关 */}
          <div className="rounded-lg border border-border-light bg-surface-secondary p-4">
            <h3 className="mb-4 text-sm font-semibold text-text-primary">基础功能</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-text-primary">文件搜索</div>
                  <div className="text-xs text-text-secondary">启用文件搜索功能</div>
                </div>
                <Switch
                  id="fileSearch"
                  checked={config.fileSearch ?? true}
                  onCheckedChange={(checked) => updateConfig('fileSearch', checked)}
                  aria-label="文件搜索"
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-text-primary">端点菜单</div>
                  <div className="text-xs text-text-secondary">显示端点选择菜单</div>
                </div>
                <Switch
                  id="endpointsMenu"
                  checked={config.endpointsMenu ?? true}
                  onCheckedChange={(checked) => updateConfig('endpointsMenu', checked)}
                  aria-label="端点菜单"
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-text-primary">模型选择</div>
                  <div className="text-xs text-text-secondary">显示模型选择器</div>
                </div>
                <Switch
                  id="modelSelect"
                  checked={config.modelSelect ?? true}
                  onCheckedChange={(checked) => updateConfig('modelSelect', checked)}
                  aria-label="模型选择"
                />
              </div>
            </div>
          </div>

          {/* 对话功能 */}
          <div className="rounded-lg border border-border-light bg-surface-secondary p-4">
            <h3 className="mb-4 text-sm font-semibold text-text-primary">对话功能</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-text-primary">预设</div>
                  <div className="text-xs text-text-secondary">启用预设功能</div>
                </div>
                <Switch
                  id="presets"
                  checked={config.presets ?? true}
                  onCheckedChange={(checked) => updateConfig('presets', checked)}
                  aria-label="预设"
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-text-primary">提示词</div>
                  <div className="text-xs text-text-secondary">启用提示词功能</div>
                </div>
                <Switch
                  id="prompts"
                  checked={config.prompts ?? true}
                  onCheckedChange={(checked) => updateConfig('prompts', checked)}
                  aria-label="提示词"
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-text-primary">多轮对话</div>
                  <div className="text-xs text-text-secondary">启用多轮对话功能</div>
                </div>
                <Switch
                  id="multiConvo"
                  checked={config.multiConvo ?? true}
                  onCheckedChange={(checked) => updateConfig('multiConvo', checked)}
                  aria-label="多轮对话"
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-text-primary">临时对话</div>
                  <div className="text-xs text-text-secondary">启用临时对话功能</div>
                </div>
                <Switch
                  id="temporaryChat"
                  checked={config.temporaryChat ?? true}
                  onCheckedChange={(checked) => updateConfig('temporaryChat', checked)}
                  aria-label="临时对话"
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-text-primary">书签</div>
                  <div className="text-xs text-text-secondary">启用书签功能</div>
                </div>
                <Switch
                  id="bookmarks"
                  checked={config.bookmarks ?? true}
                  onCheckedChange={(checked) => updateConfig('bookmarks', checked)}
                  aria-label="书签"
                />
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

// 配置模式的 ModelSelectorChatProvider（不依赖 ChatContext）
function ConfigModelSelectorChatProvider({
  children,
  defaultEndpoint,
  defaultModel,
}: {
  children: React.ReactNode;
  defaultEndpoint?: string;
  defaultModel?: string;
}) {
  // 使用导出的 ModelSelectorChatContext 来创建配置版本的 Provider
  const configValue = useMemo(
    () => ({
      endpoint: (defaultEndpoint as EModelEndpoint) || null,
      model: defaultModel || null,
      spec: null,
      agent_id: null,
      assistant_id: null,
      conversation: {
        endpoint: defaultEndpoint || null,
        model: defaultModel || null,
      } as TConversation,
      newConversation: () => {
        // 配置模式下不执行新对话操作
      },
    }),
    [defaultEndpoint, defaultModel],
  );

  return (
    <ModelSelectorChatContext.Provider value={configValue}>
      {children}
    </ModelSelectorChatContext.Provider>
  );
}

// 配置模式的端点-模型选择器组件（使用主页选择器的样式，但不切换对话）
function ConfigModelSelector({
  defaultEndpoint,
  defaultModel,
  onEndpointChange,
  onModelChange,
  startupConfig,
}: {
  defaultEndpoint?: string;
  defaultModel?: string;
  onEndpointChange: (endpoint: string) => void;
  onModelChange: (model: string) => void;
  startupConfig?: any;
}) {
  // 由于 ModelSelectorProvider 需要 ModelSelectorChatProvider
  // 而 ModelSelectorChatProvider 需要 ChatContext
  // 我们需要创建一个配置版本的 ModelSelectorChatProvider
  // 但由于 ModelSelectorChatContext 是内部导出的，我们需要通过其他方式
  
  // 最简单的方法是：修改 ModelSelectorChatContext.tsx 来导出 Context
  // 或者创建一个配置版本的 Provider，它提供相同的接口
  
  // 让我们先尝试创建一个配置版本的 Provider
  return (
    <ConfigModelSelectorChatProvider defaultEndpoint={defaultEndpoint} defaultModel={defaultModel}>
      <ModelSelectorProvider startupConfig={startupConfig}>
        <ConfigModelSelectorContent
          defaultEndpoint={defaultEndpoint}
          defaultModel={defaultModel}
          onEndpointChange={onEndpointChange}
          onModelChange={onModelChange}
        />
      </ModelSelectorProvider>
    </ConfigModelSelectorChatProvider>
  );
}

// 配置模式的选择器内容组件
function ConfigModelSelectorContent({
  defaultEndpoint,
  defaultModel,
  onEndpointChange,
  onModelChange,
}: {
  defaultEndpoint?: string;
  defaultModel?: string;
  onEndpointChange: (endpoint: string) => void;
  onModelChange: (model: string) => void;
}) {
  const localize = useLocalize();
  const {
    agentsMap,
    modelSpecs,
    mappedEndpoints,
    endpointsConfig,
    searchValue,
    searchResults,
    setSearchValue,
    setSelectedValues: setContextSelectedValues,
    selectedValues: contextSelectedValues,
    handleSelectEndpoint,
    handleSelectModel,
    handleSelectSpec,
  } = useModelSelectorContext();

  // 同步配置的默认值到 Context 的 selectedValues
  useEffect(() => {
    const expectedEndpoint = defaultEndpoint || '';
    const expectedModel = defaultModel || '';
    
    if (expectedEndpoint !== contextSelectedValues.endpoint || expectedModel !== contextSelectedValues.model) {
      setContextSelectedValues({
        endpoint: expectedEndpoint,
        model: expectedModel,
        modelSpec: '',
      });
    }
  }, [defaultEndpoint, defaultModel, setContextSelectedValues]);

  // 使用 Context 的 selectedValues，这样选择器会正确显示
  const selectedValues = useMemo(() => {
    // 优先使用 Context 的值，如果 Context 的值与配置不一致，使用配置的值
    const endpoint = contextSelectedValues.endpoint || defaultEndpoint || '';
    const model = contextSelectedValues.model || defaultModel || '';
    return {
      endpoint,
      model,
      modelSpec: contextSelectedValues.modelSpec || '',
    };
  }, [contextSelectedValues, defaultEndpoint, defaultModel]);

  const selectedIcon = useMemo(
    () =>
      getSelectedIcon({
        mappedEndpoints: mappedEndpoints ?? [],
        selectedValues,
        modelSpecs,
        endpointsConfig,
      }),
    [mappedEndpoints, selectedValues, modelSpecs, endpointsConfig],
  );

  const selectedDisplayValue = useMemo(
    () =>
      getDisplayValue({
        localize,
        agentsMap,
        modelSpecs,
        selectedValues,
        mappedEndpoints,
      }),
    [localize, agentsMap, modelSpecs, selectedValues, mappedEndpoints],
  );

  // 处理选择变化，更新配置而不是切换对话
  const handleValuesChange = useCallback(
    (values: Record<string, any>) => {
      const newEndpoint = values.endpoint || '';
      const newModel = values.model || '';
      const newModelSpec = values.modelSpec || '';

      console.log('[ConfigModelSelector] Values changed:', { newEndpoint, newModel, newModelSpec });

      if (newModelSpec) {
        // 如果选择了 modelSpec，找到对应的 endpoint 和 model
        const spec = modelSpecs?.find((s) => s.name === newModelSpec);
        if (spec?.preset) {
          const endpoint = spec.preset.endpoint || '';
          let model = spec.preset.model || '';
          
          if (isAgentsEndpoint(endpoint) && spec.preset.agent_id) {
            model = spec.preset.agent_id;
          } else if (isAssistantsEndpoint(endpoint) && spec.preset.assistant_id) {
            model = spec.preset.assistant_id;
          }
          
          console.log('[ConfigModelSelector] ModelSpec selected:', { endpoint, model });
          
          // 更新配置
          if (endpoint !== defaultEndpoint) {
            onEndpointChange(endpoint);
          }
          if (model !== defaultModel) {
            onModelChange(model);
          }
        }
      } else {
        // 更新端点
        if (newEndpoint !== defaultEndpoint) {
          console.log('[ConfigModelSelector] Endpoint changed:', newEndpoint);
          onEndpointChange(newEndpoint);
          // 端点改变时，清空模型
          if (newModel) {
            onModelChange('');
          }
        }
        // 更新模型（只有在端点相同或没有端点时才更新）
        if (newModel && (newEndpoint === defaultEndpoint || !defaultEndpoint)) {
          if (newModel !== defaultModel) {
            console.log('[ConfigModelSelector] Model changed:', newModel);
            onModelChange(newModel);
          }
        }
      }
    },
    [defaultEndpoint, defaultModel, modelSpecs, onEndpointChange, onModelChange],
  );

  const trigger = (
    <button
      className="my-1 flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-border-light bg-surface-secondary px-3 py-2 text-sm text-text-primary hover:bg-surface-tertiary"
      aria-label={localize('com_ui_select_model')}
    >
      {selectedIcon && React.isValidElement(selectedIcon) && (
        <div className="flex flex-shrink-0 items-center justify-center overflow-hidden">
          {selectedIcon}
        </div>
      )}
      <span className="flex-grow truncate text-left">
        {selectedDisplayValue || localize('com_ui_select_model')}
      </span>
    </button>
  );

  return (
    <div className="relative flex w-full flex-col items-center gap-2">
      <Menu
        values={selectedValues}
        onValuesChange={handleValuesChange}
        onSearch={(value) => setSearchValue(value)}
        combobox={<input placeholder={localize('com_endpoint_search_models')} />}
        trigger={trigger}
      >
        {searchResults ? (
          renderSearchResults(searchResults, localize, searchValue)
        ) : (
          <>
            {/* Render ungrouped modelSpecs (no group field) */}
            {renderModelSpecs(
              modelSpecs?.filter((spec) => !spec.group) || [],
              selectedValues.modelSpec || '',
            )}
            {/* Render endpoints (will include grouped specs matching endpoint names) */}
            {renderEndpoints(mappedEndpoints ?? [])}
            {/* Render custom groups (specs with group field not matching any endpoint) */}
            {renderCustomGroups(modelSpecs || [], mappedEndpoints ?? [])}
          </>
        )}
      </Menu>
    </div>
  );
}


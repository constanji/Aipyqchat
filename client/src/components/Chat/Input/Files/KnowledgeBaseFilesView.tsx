import React, { useState, useRef, useCallback, useEffect } from 'react';
import { FileSources, FileContext } from '@aipyq/data-provider';
import type { TFile } from '@aipyq/data-provider';
import { OGDialog, OGDialogContent, OGDialogHeader, OGDialogTitle, Button, Input, Spinner, useToastContext } from '@aipyq/client';
import { useGetKnowledgeListQuery, useAddKnowledgeMutation, useDeleteKnowledgeMutation, useUpdateKnowledgeMutation, useRAGQuery, type KnowledgeEntry } from '~/data-provider/KnowledgeBase';
import { useUploadFileMutation, useFileContent } from '~/data-provider/Files';
import { useLocalize, useAuthContext } from '~/hooks';
import { useRecoilValue } from 'recoil';
import store from '~/store';
import { cn } from '~/utils';
import { Upload, Trash2, FileText, X, Eye, XCircle, TestTube, Folder, FolderOpen, ChevronRight, ChevronDown, Plus, Pencil, Check } from 'lucide-react';

const KnowledgeType = {
  FILE: 'file',
  BUSINESS_KNOWLEDGE: 'business_knowledge',
};

export default function KnowledgeBaseFilesView({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const user = useRecoilValue(store.user);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showRAGTestModal, setShowRAGTestModal] = useState(false);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [viewingFileId, setViewingFileId] = useState<string | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [showCreateFolderModal, setShowCreateFolderModal] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>('');

  // 查询知识库文件列表（只查询文件类型）
  const { data: knowledgeList, isLoading, refetch } = useGetKnowledgeListQuery({
    type: KnowledgeType.BUSINESS_KNOWLEDGE,
    limit: 100,
  });

  // 添加知识条目 mutation
  const addKnowledgeMutation = useAddKnowledgeMutation();
  
  // 更新知识条目 mutation
  const updateKnowledgeMutation = useUpdateKnowledgeMutation();

  // 文件上传 mutation
  const uploadFileMutation = useUploadFileMutation({
    onSuccess: async (fileData: TFile) => {
      try {
        console.log('[KnowledgeBaseFilesView] 文件上传成功，开始添加到知识库:', {
          file_id: fileData.file_id,
          filename: fileData.filename,
          user_id: user?.id,
        });
        
        // 文件上传成功后，添加到知识库
        const result = await addKnowledgeMutation.mutateAsync({
          type: KnowledgeType.BUSINESS_KNOWLEDGE,
          data: {
            fileId: fileData.file_id,
            filename: fileData.filename,
            title: fileData.filename,
            category: selectedCategory || undefined,
          },
        });
        
        console.log('[KnowledgeBaseFilesView] 知识条目创建成功:', result);
        
        showToast({
          message: '文件上传并向量化成功',
          status: 'success',
        });
        setSelectedCategory(''); // 重置选择的分类
        
        // 等待一小段时间确保数据已写入，然后刷新列表
        setTimeout(() => {
          refetch();
        }, 500);
      } catch (error: any) {
        console.error('[KnowledgeBaseFilesView] 添加到知识库失败:', error);
        showToast({
          message: `添加到知识库失败: ${error.message || '未知错误'}`,
          status: 'error',
        });
      }
    },
    onError: (error: any) => {
      console.error('[KnowledgeBaseFilesView] 文件上传失败:', error);
      showToast({
        message: `文件上传失败: ${error.message || '未知错误'}`,
        status: 'error',
      });
    },
  });

  // 删除知识条目 mutation
  const deleteKnowledgeMutation = useDeleteKnowledgeMutation();


  // 文件内容查询
  const { data: fileContent, isLoading: isContentLoading, error: contentError } = useFileContent(
    user?.id,
    viewingFileId || undefined,
  );

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);
    formData.append('endpoint', 'agents');
    formData.append('tool_resource', 'file_search'); // 使用 file_search 工具资源，会自动向量化

    uploadFileMutation.mutate(formData);
  }, [uploadFileMutation]);

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleDelete = (entry: KnowledgeEntry) => {
    if (confirm(`确定要删除文件 "${entry.title}" 吗？`)) {
      deleteKnowledgeMutation.mutate(entry._id, {
        onSuccess: () => {
          showToast({
            message: '删除成功',
            status: 'success',
          });
          refetch();
        },
        onError: (error: any) => {
          showToast({
            message: `删除失败: ${error.message || '未知错误'}`,
            status: 'error',
          });
        },
      });
    }
  };


  const handleViewFile = (fileId: string) => {
    setViewingFileId(fileId);
    // 不需要手动调用 refetchContent，因为 enabled 条件会自动触发查询
  };

  const handleCloseView = () => {
    setViewingFileId(null);
  };

  const handleCreateFolder = () => {
    setShowCreateFolderModal(true);
    setNewCategoryName('');
  };

  const handleSaveFolder = async () => {
    if (!newCategoryName.trim()) {
      showToast({
        message: '文件夹名称不能为空',
        status: 'error',
      });
      return;
    }
    
    const folderName = newCategoryName.trim();
    
    try {
      // 创建一个占位符知识条目来创建文件夹（空文件夹）
      await addKnowledgeMutation.mutateAsync({
        type: KnowledgeType.BUSINESS_KNOWLEDGE,
        data: {
          title: `文件夹: ${folderName}`,
          content: '', // 空内容，仅用于创建文件夹
          category: folderName,
        },
      });
      
      setShowCreateFolderModal(false);
      setNewCategoryName('');
      
      // 展开新创建的文件夹
      setExpandedCategories(prev => new Set(prev).add(folderName));
      
      showToast({
        message: `文件夹 "${folderName}" 已创建`,
        status: 'success',
      });
      
      // 刷新列表
      setTimeout(() => {
        refetch();
      }, 500);
    } catch (error: any) {
      console.error('[KnowledgeBaseFilesView] 创建文件夹失败:', error);
      showToast({
        message: `创建文件夹失败: ${error.message || '未知错误'}`,
        status: 'error',
      });
    }
  };

  const handleStartEditCategory = (category: string) => {
    setEditingCategory(category);
    setNewCategoryName(category);
  };

  const handleSaveCategoryRename = async () => {
    if (!editingCategory || !newCategoryName.trim()) {
      setEditingCategory(null);
      setNewCategoryName('');
      return;
    }

    if (editingCategory === newCategoryName.trim()) {
      setEditingCategory(null);
      setNewCategoryName('');
      return;
    }

    try {
      // 更新该分类下所有文件的 category
      const categoryFiles = groupedFiles[editingCategory] || [];
      const updatePromises = categoryFiles.map(entry =>
        updateKnowledgeMutation.mutateAsync({
          id: entry._id,
          type: KnowledgeType.BUSINESS_KNOWLEDGE,
          data: {
            category: newCategoryName.trim(),
          },
        })
      );

      await Promise.all(updatePromises);
      
      showToast({
        message: `文件夹已重命名为 "${newCategoryName.trim()}"`,
        status: 'success',
      });
      
      // 更新展开状态
      setExpandedCategories(prev => {
        const newSet = new Set(prev);
        newSet.delete(editingCategory);
        newSet.add(newCategoryName.trim());
        return newSet;
      });
      
      setEditingCategory(null);
      setNewCategoryName('');
      refetch();
    } catch (error: any) {
      showToast({
        message: `重命名失败: ${error.message || '未知错误'}`,
        status: 'error',
      });
    }
  };

  const handleCancelEditCategory = () => {
    setEditingCategory(null);
    setNewCategoryName('');
  };

  const toggleCategory = (category: string) => {
    setExpandedCategories(prev => {
      const newSet = new Set(prev);
      if (newSet.has(category)) {
        newSet.delete(category);
      } else {
        newSet.add(category);
      }
      return newSet;
    });
  };

  const files = knowledgeList?.data || [];
  
  // 调试日志
  useEffect(() => {
    if (knowledgeList) {
      console.log('[KnowledgeBaseFilesView] 知识库数据:', {
        success: knowledgeList.success,
        count: knowledgeList.count,
        dataLength: knowledgeList.data?.length || 0,
        isLoading,
        error: knowledgeList.error,
      });
      if (knowledgeList.data && knowledgeList.data.length > 0) {
        console.log('[KnowledgeBaseFilesView] 第一条数据:', knowledgeList.data[0]);
      }
    }
  }, [knowledgeList, isLoading]);
  
  // 收集所有分类（包括空文件夹）
  const allCategories = new Set<string>();
  files.forEach(entry => {
    const category = entry.metadata?.category || '未分类';
    allCategories.add(category);
  });

  // 按分类分组文件，过滤掉文件夹占位符条目（标题以"文件夹:"开头的空条目）
  const groupedFiles = files.reduce((acc, entry) => {
    const category = entry.metadata?.category || '未分类';
    // 跳过文件夹占位符条目（标题以"文件夹:"开头且没有文件ID的条目）
    const isFolderPlaceholder = entry.title.startsWith('文件夹:') && !entry.metadata?.file_id && (!entry.content || entry.content.trim() === '');
    if (isFolderPlaceholder) {
      // 只创建分类，不添加条目
      if (!acc[category]) {
        acc[category] = [];
      }
      return acc;
    }
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category].push(entry);
    return acc;
  }, {} as Record<string, KnowledgeEntry[]>);

  // 确保所有分类都有条目（包括空文件夹）
  allCategories.forEach(category => {
    if (!groupedFiles[category]) {
      groupedFiles[category] = [];
    }
  });

  // 按分类名称排序（使用 allCategories 确保空文件夹也能显示）
  const sortedCategories = Array.from(allCategories).sort((a, b) => {
    if (a === '未分类') return 1;
    if (b === '未分类') return -1;
    return a.localeCompare(b, 'zh-CN');
  });

  // 当文件列表更新时，自动展开新分类
  useEffect(() => {
    if (files.length > 0) {
      setExpandedCategories(prev => {
        const newSet = new Set(prev);
        files.forEach(entry => {
          const category = entry.metadata?.category || '未分类';
          newSet.add(category);
        });
        return newSet;
      });
    }
  }, [files.length]);

  return (
    <OGDialog open={open} onOpenChange={onOpenChange}>
      <OGDialogContent
        title="知识库文件管理"
        className="w-11/12 max-w-6xl bg-background text-text-primary shadow-2xl"
      >
        <OGDialogHeader>
          <OGDialogTitle>知识库文件管理</OGDialogTitle>
        </OGDialogHeader>

        <div className="flex flex-col gap-4">
          {/* 上传区域 */}
          <div className="flex items-center justify-between border-b border-border-light pb-4">
            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={handleFileSelect}
                accept=".pdf,.doc,.docx,.txt,.md"
                aria-label="上传文件"
              />
              <Button
                onClick={handleUploadClick}
                disabled={uploadFileMutation.isLoading}
                className="flex items-center gap-2"
              >
                <Upload className="h-4 w-4" />
                {uploadFileMutation.isLoading ? '上传中...' : '上传文件'}
              </Button>
              {uploadFileMutation.isLoading && (
                <Spinner className="h-4 w-4" />
              )}
              <Button
                onClick={handleCreateFolder}
                variant="outline"
                className="flex items-center gap-2"
              >
                <Plus className="h-4 w-4" />
                新建文件夹
              </Button>
              {selectedCategory && (
                <div className="flex items-center gap-2 text-sm text-text-secondary">
                  <span>上传到:</span>
                  <span className="font-medium text-text-primary">{selectedCategory}</span>
                  <button
                    onClick={() => setSelectedCategory('')}
                    className="text-red-500 hover:text-red-700"
                    aria-label="清除选择"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}
            </div>
            <Button
              onClick={() => setShowRAGTestModal(true)}
              variant="outline"
              className="flex items-center gap-2"
            >
              <TestTube className="h-4 w-4" />
              RAG测试
            </Button>
          </div>

          {/* 创建文件夹模态框 */}
          {showCreateFolderModal && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50" onClick={() => setShowCreateFolderModal(false)}>
              <div
                className="w-full max-w-md rounded-lg bg-surface-primary p-6 shadow-lg"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-text-primary">新建文件夹</h3>
                  <button
                    type="button"
                    onClick={() => setShowCreateFolderModal(false)}
                    className="rounded p-1 text-text-secondary hover:bg-surface-hover hover:text-text-primary"
                    aria-label="关闭"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-text-primary mb-2">
                      文件夹名称
                    </label>
                    <Input
                      value={newCategoryName}
                      onChange={(e) => setNewCategoryName(e.target.value)}
                      placeholder="输入文件夹名称..."
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleSaveFolder();
                        }
                      }}
                      autoFocus
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      onClick={() => setShowCreateFolderModal(false)}
                      variant="outline"
                    >
                      取消
                    </Button>
                    <Button
                      type="button"
                      onClick={handleSaveFolder}
                      disabled={!newCategoryName.trim()}
                    >
                      创建
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* RAG 测试模态框 */}
          {showRAGTestModal && (
            <RAGTestModal
              selectedFileId={selectedFileId}
              files={files}
              onClose={() => {
                setShowRAGTestModal(false);
                setSelectedFileId(null);
              }}
            />
          )}

          {/* 文件内容查看对话框 */}
          {viewingFileId && (
            <OGDialog open={!!viewingFileId} onOpenChange={(open) => !open && handleCloseView()}>
              <OGDialogContent
                title="文件内容"
                className="w-11/12 max-w-4xl bg-background text-text-primary shadow-2xl"
                showCloseButton={false}
              >
                <OGDialogHeader>
                  <div className="flex items-center justify-between">
                    <OGDialogTitle>
                      {fileContent?.filename || '文件内容'}
                    </OGDialogTitle>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleCloseView}
                      className="h-6 w-6 p-0"
                    >
                      <XCircle className="h-4 w-4" />
                    </Button>
                  </div>
                </OGDialogHeader>
                <div className="max-h-[70vh] overflow-auto">
                  {isContentLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Spinner className="h-6 w-6" />
                      <span className="ml-2 text-sm text-text-secondary">加载中...</span>
                    </div>
                  ) : contentError ? (
                    <div className="flex flex-col items-center justify-center py-8 text-text-secondary">
                      <p className="text-sm font-medium text-red-500">加载失败</p>
                      <p className="mt-2 text-xs">
                        {contentError instanceof Error ? contentError.message : '无法加载文件内容'}
                      </p>
                    </div>
                  ) : fileContent ? (
                    <div className="space-y-2">
                      <div className="text-xs text-text-secondary">
                        文件名: {fileContent.filename} | 类型: {fileContent.type} | 大小: {(fileContent.size / 1024).toFixed(2)} KB
                      </div>
                      <pre className="whitespace-pre-wrap break-words rounded border border-border-light bg-surface-secondary p-4 text-sm">
                        {fileContent.content}
                      </pre>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center py-8 text-text-secondary">
                      <p>无法加载文件内容</p>
                    </div>
                  )}
                </div>
              </OGDialogContent>
            </OGDialog>
          )}

          {/* 文件列表 */}
          <div className="flex-1 overflow-auto">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Spinner className="h-6 w-6" />
              </div>
            ) : files.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-text-secondary">
                <FileText className="mb-2 h-12 w-12 opacity-50" />
                <p className="text-sm">暂无文件</p>
                <p className="mt-1 text-xs">上传文件后会自动向量化并存入知识库</p>
              </div>
            ) : (
              <div className="space-y-2">
                {sortedCategories.map((category) => {
                  const categoryFiles = groupedFiles[category];
                  const isExpanded = expandedCategories.has(category);
                  
                  return (
                    <div key={category} className="space-y-1">
                      {/* 分类文件夹头部 */}
                      <div className="flex w-full items-center justify-between rounded-lg border border-border-light bg-surface-secondary p-3 hover:bg-surface-hover transition-colors">
                        <button
                          onClick={() => toggleCategory(category)}
                          className="flex flex-1 items-center gap-2"
                        >
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4 text-text-secondary" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-text-secondary" />
                          )}
                          {isExpanded ? (
                            <FolderOpen className="h-5 w-5 text-primary" />
                          ) : (
                            <Folder className="h-5 w-5 text-primary" />
                          )}
                          {editingCategory === category ? (
                            <Input
                              value={newCategoryName}
                              onChange={(e) => setNewCategoryName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  handleSaveCategoryRename();
                                } else if (e.key === 'Escape') {
                                  handleCancelEditCategory();
                                }
                              }}
                              className="h-7 w-48 text-sm"
                              autoFocus
                              onClick={(e) => e.stopPropagation()}
                            />
                          ) : (
                            <>
                              <span className="font-medium text-text-primary">{category}</span>
                              <span className="text-xs text-text-secondary">({categoryFiles.length})</span>
                            </>
                          )}
                        </button>
                        {editingCategory === category ? (
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSaveCategoryRename();
                              }}
                              className="h-6 w-6 p-0"
                              title="保存"
                            >
                              <Check className="h-3 w-3 text-green-500" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleCancelEditCategory();
                              }}
                              className="h-6 w-6 p-0"
                              title="取消"
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleStartEditCategory(category);
                              }}
                              className="h-6 w-6 p-0"
                              title="重命名文件夹"
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                // 直接设置分类并触发文件选择
                                setSelectedCategory(category);
                                // 立即触发文件选择对话框
                                setTimeout(() => {
                                  fileInputRef.current?.click();
                                }, 100);
                              }}
                              className="h-6 w-6 p-0 text-primary"
                              title="在此文件夹上传文件"
                            >
                              <Upload className="h-3 w-3" />
                            </Button>
                          </div>
                        )}
                      </div>
                      
                      {/* 分类下的文件列表 */}
                      {isExpanded && (
                        <div className="ml-6 space-y-1 border-l-2 border-border-light pl-2">
                          {categoryFiles.map((entry) => (
                            <div
                              key={entry._id}
                              className="flex items-center justify-between rounded-lg border border-border-light bg-surface-secondary p-3 hover:bg-surface-hover"
                            >
                              <div className="flex flex-1 items-center gap-3">
                                <FileText className="h-5 w-5 text-text-secondary" />
                                <div className="flex-1">
                                  <div className="font-medium">{entry.title}</div>
                                  <div className="text-xs text-text-secondary">
                                    {entry.metadata?.filename && (
                                      <span>文件: {entry.metadata.filename}</span>
                                    )}
                                    <span className="ml-2">
                                      创建时间: {new Date(entry.createdAt).toLocaleString('zh-CN')}
                                    </span>
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                {entry.metadata?.file_id && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                      if (entry.metadata?.file_id) {
                                        handleViewFile(entry.metadata.file_id);
                                      }
                                    }}
                                    className="text-xs"
                                    title="查看文件内容"
                                    disabled={!entry.metadata?.file_id}
                                  >
                                    <Eye className="h-4 w-4" />
                                  </Button>
                                )}
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleDelete(entry)}
                                  disabled={deleteKnowledgeMutation.isLoading}
                                  className="text-red-500 hover:text-red-700"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </OGDialogContent>
    </OGDialog>
  );
}

interface RAGTestModalProps {
  selectedFileId: string | null;
  files: KnowledgeEntry[];
  onClose: () => void;
}

function RAGTestModal({ selectedFileId, files, onClose }: RAGTestModalProps) {
  const { showToast } = useToastContext();
  const { token } = useAuthContext();
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [metadata, setMetadata] = useState<any>(null);

  const handleTest = async () => {
    if (!query.trim()) {
      showToast({
        message: '请输入查询内容',
        status: 'error',
      });
      return;
    }

    if (!token) {
      showToast({
        message: '未登录，请先登录',
        status: 'error',
      });
      return;
    }

    setIsLoading(true);
    setResults([]);
    setMetadata(null);

    try {
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      };

      const response = await fetch('/api/rag/query', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({
          query: query.trim(),
          options: {
            fileIds: selectedFileId ? [selectedFileId] : undefined,
            topK: 10,
            useReranking: true,
          },
        }),
      });

      if (!response.ok) {
        const contentType = response.headers.get('content-type');
        const isJson = contentType && contentType.includes('application/json');
        
        let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        
        if (isJson) {
          try {
            const errorData = await response.json();
            errorMessage = errorData.error || errorData.message || errorMessage;
          } catch (e) {
            // JSON 解析失败
          }
        } else {
          const text = await response.text().catch(() => '');
          errorMessage = text || errorMessage;
        }
        
        throw new Error(errorMessage);
      }

      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const text = await response.text();
        throw new Error(`服务器返回了非 JSON 响应: ${text.substring(0, 100)}`);
      }

      const data = await response.json();
      const allResults = data.results || [];
      
      setResults(allResults);
      setMetadata(data.metadata || null);

      if (allResults.length > 0) {
        const scoreRange = allResults.length > 1 
          ? `相似度范围: ${(Math.min(...allResults.map(r => r.score || r.similarity || 0)) * 100).toFixed(1)}% - ${(Math.max(...allResults.map(r => r.score || r.similarity || 0)) * 100).toFixed(1)}%`
          : '';
        showToast({
          message: `成功检索到 ${allResults.length} 条结果${scoreRange ? `，${scoreRange}` : ''}`,
          status: 'success',
        });
      } else {
        showToast({
          message: '未检索到相关结果',
          status: 'info',
        });
      }
    } catch (error: any) {
      console.error('RAG查询失败:', error);
      showToast({
        message: `RAG查询失败: ${error.message || '未知错误'}`,
        status: 'error',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const getTypeLabel = (type: string) => {
    const typeMap: Record<string, string> = {
      semantic_model: '语义模型',
      qa_pair: 'QA对',
      synonym: '同义词',
      business_knowledge: '业务知识',
      file: '文件',
    };
    return typeMap[type] || type;
  };

  const selectedFile = selectedFileId ? files.find((f) => f.metadata?.file_id === selectedFileId) : null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-full max-w-4xl max-h-[90vh] rounded-lg bg-surface-primary p-6 shadow-lg overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-text-primary">RAG测试</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-text-secondary hover:bg-surface-hover hover:text-text-primary"
            aria-label="关闭"
            title="关闭"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          {selectedFile && (
            <div className="rounded-lg border border-border-light bg-surface-secondary p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-text-secondary">仅测试文件:</span>
                  <span className="text-sm font-medium text-text-primary">{selectedFile.title}</span>
                </div>
                <button
                  onClick={() => {
                    // 清除文件选择，但保持模态框打开
                    // 这里需要通过父组件处理，所以暂时不处理
                  }}
                  className="text-red-500 hover:text-red-700"
                  aria-label="清除文件选择"
                  title="清除文件选择"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              查询内容
            </label>
            <textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              rows={3}
              className="w-full rounded border border-border-light bg-surface-secondary px-3 py-2 text-sm text-text-primary"
              placeholder="输入要查询的问题或关键词..."
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  handleTest();
                }
              }}
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              onClick={onClose}
              variant="outline"
              className="rounded-lg px-4 py-2"
            >
              关闭
            </Button>
            <Button
              type="button"
              onClick={handleTest}
              disabled={isLoading || !query.trim()}
              className="rounded-lg px-4 py-2"
            >
              {isLoading ? (
                <>
                  <Spinner className="h-4 w-4 mr-2" />
                  查询中...
                </>
              ) : (
                '测试查询'
              )}
            </Button>
          </div>

          {metadata && (
            <div className="rounded-lg border border-border-light bg-surface-secondary p-3">
              <p className="text-xs text-text-secondary">
                检索数量: {metadata.retrievalCount || 0} | 
                重排: {metadata.reranked ? '是' : '否'} | 
                增强重排: {metadata.enhancedReranking ? '是' : '否'}
              </p>
            </div>
          )}

          {results.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-sm font-medium text-text-primary">
                检索结果 ({results.length} 条)
              </h4>
              <div className="space-y-2 max-h-96 overflow-auto">
                {results.map((result, index) => (
                  <div
                    key={index}
                    className="rounded-lg border border-border-light bg-surface-secondary p-4"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium px-2 py-1 rounded bg-primary/20 text-primary">
                          {getTypeLabel(result.type)}
                        </span>
                        {(result.score !== undefined || result.similarity !== undefined) && (
                          <span className="text-xs text-text-tertiary">
                            相似度: {((result.score || result.similarity || 0) * 100).toFixed(1)}%
                          </span>
                        )}
                      </div>
                    </div>
                    {result.title && (
                      <h5 className="text-sm font-medium text-text-primary mb-1">
                        {result.title}
                      </h5>
                    )}
                    <p className="text-sm text-text-secondary whitespace-pre-wrap">
                      {result.content}
                    </p>
                    {result.metadata && Object.keys(result.metadata).length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {Object.entries(result.metadata)
                          .filter(([key]) => key !== 'file_id' && key !== 'filename')
                          .slice(0, 3)
                          .map(([key, value]) => (
                            <span
                              key={key}
                              className="rounded bg-surface-primary px-2 py-1 text-xs text-text-secondary"
                            >
                              {key}: {String(value)}
                            </span>
                          ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {!isLoading && results.length === 0 && query && (
            <div className="text-center py-8 text-text-secondary">
              <p className="text-sm">暂无检索结果</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

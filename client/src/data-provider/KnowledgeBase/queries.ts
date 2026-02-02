import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryObserverResult, UseQueryOptions } from '@tanstack/react-query';
import { request } from '@aipyq/data-provider';

export interface KnowledgeEntry {
  _id: string;
  type: string;
  title: string;
  content?: string;
  user: string;
  createdAt: string;
  updatedAt: string;
  metadata?: {
    file_id?: string;
    filename?: string;
    category?: string;
    tags?: string[];
    entity_id?: string;
  };
}

export interface KnowledgeListResponse {
  success: boolean;
  count: number;
  data: KnowledgeEntry[];
}

export interface RAGQueryResponse {
  query: string;
  results: Array<{
    content: string;
    score: number;
    metadata: Record<string, unknown>;
  }>;
  total: number;
  metadata: {
    retrievalCount: number;
    reranked: boolean;
    enhancedReranking: boolean;
  };
}

const QueryKeys = {
  knowledgeList: ['knowledge', 'list'] as const,
  knowledgeEntry: (id: string) => ['knowledge', 'entry', id] as const,
};

export const useGetKnowledgeListQuery = (
  filters?: {
    type?: string;
    entityId?: string;
    includeChildren?: boolean;
    limit?: number;
    skip?: number;
  },
  config?: UseQueryOptions<KnowledgeListResponse>,
): QueryObserverResult<KnowledgeListResponse> => {
  const queryParams = new URLSearchParams();
  if (filters?.type) queryParams.append('type', filters.type);
  if (filters?.entityId) queryParams.append('entityId', filters.entityId);
  if (filters?.includeChildren !== undefined)
    queryParams.append('includeChildren', String(filters.includeChildren));
  if (filters?.limit) queryParams.append('limit', String(filters.limit));
  if (filters?.skip) queryParams.append('skip', String(filters.skip));

  const queryString = queryParams.toString();
  const url = `/api/rag/knowledge${queryString ? `?${queryString}` : ''}`;

  return useQuery<KnowledgeListResponse>(
    [...QueryKeys.knowledgeList, filters],
    () => request.get(url),
    {
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      refetchOnMount: true,
      ...config,
    },
  );
};

export const useRAGQuery = (
  query: string,
  options?: {
    types?: string[];
    fileIds?: string[];
    entityId?: string;
    topK?: number;
    useReranking?: boolean;
    enhancedReranking?: boolean;
  },
  config?: UseQueryOptions<RAGQueryResponse>,
): QueryObserverResult<RAGQueryResponse> => {
  return useQuery<RAGQueryResponse>(
    ['rag', 'query', query, options],
    () =>
      request.post('/api/rag/query', {
        query,
        options,
      }),
    {
      enabled: !!query && query.trim().length > 0,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      ...config,
    },
  );
};

export { QueryKeys as KnowledgeBaseQueryKeys };

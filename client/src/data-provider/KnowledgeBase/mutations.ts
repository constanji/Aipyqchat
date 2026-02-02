import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult } from '@tanstack/react-query';
import { request } from '@aipyq/data-provider';
import type { KnowledgeEntry, KnowledgeListResponse } from './queries';
import { KnowledgeBaseQueryKeys } from './queries';

export interface AddKnowledgeParams {
  type: string;
  data: {
    title?: string;
    content?: string;
    fileId?: string;
    filename?: string;
    category?: string;
    tags?: string[];
    entityId?: string;
  };
}

export interface UpdateKnowledgeParams {
  id: string;
  type: string;
  data: {
    title?: string;
    content?: string;
    category?: string;
    tags?: string[];
  };
}

export const useAddKnowledgeMutation = (): UseMutationResult<
  { success: boolean; data: KnowledgeEntry },
  unknown,
  AddKnowledgeParams
> => {
  const queryClient = useQueryClient();

  return useMutation(
    (params: AddKnowledgeParams) =>
      request.post('/api/rag/knowledge', {
        type: params.type,
        data: params.data,
      }),
    {
      onSuccess: () => {
        queryClient.invalidateQueries(KnowledgeBaseQueryKeys.knowledgeList);
      },
    },
  );
};

export const useUpdateKnowledgeMutation = (): UseMutationResult<
  { success: boolean; data: KnowledgeEntry },
  unknown,
  UpdateKnowledgeParams
> => {
  const queryClient = useQueryClient();

  return useMutation(
    (params: UpdateKnowledgeParams) =>
      request.put(`/api/rag/knowledge/${params.id}`, {
        type: params.type,
        data: params.data,
      }),
    {
      onSuccess: () => {
        queryClient.invalidateQueries(KnowledgeBaseQueryKeys.knowledgeList);
      },
    },
  );
};

export const useDeleteKnowledgeMutation = (): UseMutationResult<
  { success: boolean; message: string },
  unknown,
  string
> => {
  const queryClient = useQueryClient();

  return useMutation(
    (id: string) => request.delete(`/api/rag/knowledge/${id}`),
    {
      onSuccess: () => {
        queryClient.invalidateQueries(KnowledgeBaseQueryKeys.knowledgeList);
      },
    },
  );
};

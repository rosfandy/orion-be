export interface CreateWorkspaceDto {
  name: string;
  description?: string;
}

export interface UpdateWorkspaceDto {
  name?: string;
  description?: string | null;
}

export interface AddWorkspaceMemberDto {
  user_id: string;
}

export interface SearchUserByEmailQuery {
  email: string;
}

export interface SearchUserResult {
  id: string;
  name: string;
  email: string;
}

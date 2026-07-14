import type { CursorPaginationOptions, PaginatedResult } from '../../core/pagination.js';
import type { TransactionContext } from '../../core/transaction.js';

export interface ProjectProfile {
  id: string;
  chainId: number;
  projectName: string;
  slug: string;
  description: string | null;
  websiteUrl: string | null;
  logoUri: string | null;
  verified: boolean;
  verifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface ProjectContract {
  id: string;
  projectProfileId: string;
  chainId: number;
  contractAddress: string;
  contractType: string;
  verified: boolean;
  verifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectRepository {
  getProjectProfile(id: string, tx?: TransactionContext): Promise<ProjectProfile | null>;

  getProjectProfileBySlug(slug: string, tx?: TransactionContext): Promise<ProjectProfile | null>;

  getProjectProfiles(
    options: CursorPaginationOptions,
    tx?: TransactionContext,
  ): Promise<PaginatedResult<ProjectProfile>>;

  getProjectProfilesByChain(
    chainId: number,
    options: CursorPaginationOptions,
    tx?: TransactionContext,
  ): Promise<PaginatedResult<ProjectProfile>>;

  insertProjectProfile(
    projectProfile: Omit<ProjectProfile, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>,
    tx?: TransactionContext,
  ): Promise<ProjectProfile>;

  updateProjectProfile(
    id: string,
    data: Partial<Omit<ProjectProfile, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>>,
    tx?: TransactionContext,
  ): Promise<ProjectProfile | null>;

  deleteProjectProfile(id: string, tx?: TransactionContext): Promise<boolean>;

  getProjectContract(id: string, tx?: TransactionContext): Promise<ProjectContract | null>;

  getProjectContractsByProject(
    projectProfileId: string,
    tx?: TransactionContext,
  ): Promise<ProjectContract[]>;

  insertProjectContract(
    projectContract: Omit<ProjectContract, 'id' | 'createdAt' | 'updatedAt'>,
    tx?: TransactionContext,
  ): Promise<ProjectContract>;

  updateProjectContract(
    id: string,
    data: Partial<Omit<ProjectContract, 'id' | 'createdAt' | 'updatedAt'>>,
    tx?: TransactionContext,
  ): Promise<ProjectContract | null>;

  deleteProjectContract(id: string, tx?: TransactionContext): Promise<boolean>;
}

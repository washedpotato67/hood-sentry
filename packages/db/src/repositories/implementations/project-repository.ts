import { and, asc, desc, eq, gt, isNull, lt } from 'drizzle-orm';
import type { Database } from '../../client.js';
import { buildPaginatedResult, decodeCursor } from '../../core/pagination.js';
import type { CursorPaginationOptions, PaginatedResult } from '../../core/pagination.js';
import type { TransactionContext } from '../../core/transaction.js';
import { projectContracts, projectProfiles } from '../../schema/product.js';
import type {
  ProjectContract,
  ProjectProfile,
  ProjectRepository,
} from '../interfaces/project-repository.js';

type ProjectProfileRow = typeof projectProfiles.$inferSelect;
type ProjectContractRow = typeof projectContracts.$inferSelect;
type ContractTypeEnumValue = ProjectContractRow['contractType'];

function toProjectProfile(row: ProjectProfileRow): ProjectProfile {
  return {
    id: row.id,
    chainId: row.chainId,
    projectName: row.projectName,
    slug: row.slug,
    description: row.description,
    websiteUrl: row.websiteUrl,
    logoUri: row.logoUri,
    verified: row.verified,
    verifiedAt: row.verifiedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

function toProjectContract(row: ProjectContractRow): ProjectContract {
  return {
    id: row.id,
    projectProfileId: row.projectProfileId,
    chainId: row.chainId,
    contractAddress: row.contractAddress,
    contractType: row.contractType,
    verified: row.verified,
    verifiedAt: row.verifiedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class DrizzleProjectRepository implements ProjectRepository {
  constructor(private readonly db: Database['db']) {}

  private resolve(tx?: TransactionContext): TransactionContext {
    return tx ?? (this.db as unknown as TransactionContext);
  }

  async getProjectProfile(id: string, tx?: TransactionContext): Promise<ProjectProfile | null> {
    try {
      const rows = await this.resolve(tx)
        .select()
        .from(projectProfiles)
        .where(and(eq(projectProfiles.id, id), isNull(projectProfiles.deletedAt)))
        .limit(1);

      const row = rows[0];
      return row ? toProjectProfile(row) : null;
    } catch (error) {
      throw new Error(
        `Failed to get project profile "${id}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async getProjectProfileBySlug(
    slug: string,
    tx?: TransactionContext,
  ): Promise<ProjectProfile | null> {
    try {
      const rows = await this.resolve(tx)
        .select()
        .from(projectProfiles)
        .where(and(eq(projectProfiles.slug, slug), isNull(projectProfiles.deletedAt)))
        .limit(1);

      const row = rows[0];
      return row ? toProjectProfile(row) : null;
    } catch (error) {
      throw new Error(
        `Failed to get project profile by slug "${slug}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async getProjectProfiles(
    options: CursorPaginationOptions,
    tx?: TransactionContext,
  ): Promise<PaginatedResult<ProjectProfile>> {
    try {
      const { limit, cursor, orderBy } = options;
      const conditions = [isNull(projectProfiles.deletedAt)];

      if (cursor) {
        const decodedCursor = decodeCursor(cursor);
        conditions.push(
          orderBy === 'asc'
            ? gt(projectProfiles.id, decodedCursor)
            : lt(projectProfiles.id, decodedCursor),
        );
      }

      const rows = await this.resolve(tx)
        .select()
        .from(projectProfiles)
        .where(and(...conditions))
        .orderBy(orderBy === 'asc' ? asc(projectProfiles.id) : desc(projectProfiles.id))
        .limit(limit + 1);

      const profiles = rows.map(toProjectProfile);

      return buildPaginatedResult(profiles, limit, (item) => item.id);
    } catch (error) {
      throw new Error(
        `Failed to get project profiles: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async getProjectProfilesByChain(
    chainId: number,
    options: CursorPaginationOptions,
    tx?: TransactionContext,
  ): Promise<PaginatedResult<ProjectProfile>> {
    try {
      const { limit, cursor, orderBy } = options;
      const conditions = [eq(projectProfiles.chainId, chainId), isNull(projectProfiles.deletedAt)];

      if (cursor) {
        const decodedCursor = decodeCursor(cursor);
        conditions.push(
          orderBy === 'asc'
            ? gt(projectProfiles.id, decodedCursor)
            : lt(projectProfiles.id, decodedCursor),
        );
      }

      const rows = await this.resolve(tx)
        .select()
        .from(projectProfiles)
        .where(and(...conditions))
        .orderBy(orderBy === 'asc' ? asc(projectProfiles.id) : desc(projectProfiles.id))
        .limit(limit + 1);

      const profiles = rows.map(toProjectProfile);

      return buildPaginatedResult(profiles, limit, (item) => item.id);
    } catch (error) {
      throw new Error(
        `Failed to get project profiles for chain ${chainId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async insertProjectProfile(
    projectProfile: Omit<ProjectProfile, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>,
    tx?: TransactionContext,
  ): Promise<ProjectProfile> {
    try {
      const now = new Date();

      const rows = await this.resolve(tx)
        .insert(projectProfiles)
        .values({
          chainId: projectProfile.chainId,
          projectName: projectProfile.projectName,
          slug: projectProfile.slug,
          description: projectProfile.description,
          websiteUrl: projectProfile.websiteUrl,
          logoUri: projectProfile.logoUri,
          verified: projectProfile.verified,
          verifiedAt: projectProfile.verifiedAt,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      const row = rows[0];
      if (!row) {
        throw new Error('Insert returned no rows');
      }

      return toProjectProfile(row);
    } catch (error) {
      throw new Error(
        `Failed to insert project profile "${projectProfile.projectName}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async updateProjectProfile(
    id: string,
    data: Partial<Omit<ProjectProfile, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>>,
    tx?: TransactionContext,
  ): Promise<ProjectProfile | null> {
    try {
      const setFields: Record<string, unknown> = { updatedAt: new Date() };

      if (data.chainId !== undefined) {
        setFields.chainId = data.chainId;
      }
      if (data.projectName !== undefined) {
        setFields.projectName = data.projectName;
      }
      if (data.slug !== undefined) {
        setFields.slug = data.slug;
      }
      if (data.description !== undefined) {
        setFields.description = data.description;
      }
      if (data.websiteUrl !== undefined) {
        setFields.websiteUrl = data.websiteUrl;
      }
      if (data.logoUri !== undefined) {
        setFields.logoUri = data.logoUri;
      }
      if (data.verified !== undefined) {
        setFields.verified = data.verified;
      }
      if (data.verifiedAt !== undefined) {
        setFields.verifiedAt = data.verifiedAt;
      }

      const rows = await this.resolve(tx)
        .update(projectProfiles)
        .set(setFields)
        .where(and(eq(projectProfiles.id, id), isNull(projectProfiles.deletedAt)))
        .returning();

      const row = rows[0];
      return row ? toProjectProfile(row) : null;
    } catch (error) {
      throw new Error(
        `Failed to update project profile "${id}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async deleteProjectProfile(id: string, tx?: TransactionContext): Promise<boolean> {
    try {
      const rows = await this.resolve(tx)
        .update(projectProfiles)
        .set({ deletedAt: new Date() })
        .where(and(eq(projectProfiles.id, id), isNull(projectProfiles.deletedAt)))
        .returning();

      return rows.length > 0;
    } catch (error) {
      throw new Error(
        `Failed to delete project profile "${id}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async getProjectContract(id: string, tx?: TransactionContext): Promise<ProjectContract | null> {
    try {
      const rows = await this.resolve(tx)
        .select()
        .from(projectContracts)
        .where(eq(projectContracts.id, id))
        .limit(1);

      const row = rows[0];
      return row ? toProjectContract(row) : null;
    } catch (error) {
      throw new Error(
        `Failed to get project contract "${id}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async getProjectContractsByProject(
    projectProfileId: string,
    tx?: TransactionContext,
  ): Promise<ProjectContract[]> {
    try {
      const rows = await this.resolve(tx)
        .select()
        .from(projectContracts)
        .where(eq(projectContracts.projectProfileId, projectProfileId))
        .orderBy(asc(projectContracts.id));

      return rows.map(toProjectContract);
    } catch (error) {
      throw new Error(
        `Failed to get project contracts for project "${projectProfileId}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async insertProjectContract(
    projectContract: Omit<ProjectContract, 'id' | 'createdAt' | 'updatedAt'>,
    tx?: TransactionContext,
  ): Promise<ProjectContract> {
    try {
      const now = new Date();

      const rows = await this.resolve(tx)
        .insert(projectContracts)
        .values({
          projectProfileId: projectContract.projectProfileId,
          chainId: projectContract.chainId,
          contractAddress: projectContract.contractAddress,
          contractType: projectContract.contractType as ContractTypeEnumValue,
          verified: projectContract.verified,
          verifiedAt: projectContract.verifiedAt,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      const row = rows[0];
      if (!row) {
        throw new Error('Insert returned no rows');
      }

      return toProjectContract(row);
    } catch (error) {
      throw new Error(
        `Failed to insert project contract "${projectContract.contractAddress}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async updateProjectContract(
    id: string,
    data: Partial<Omit<ProjectContract, 'id' | 'createdAt' | 'updatedAt'>>,
    tx?: TransactionContext,
  ): Promise<ProjectContract | null> {
    try {
      const setFields: Record<string, unknown> = { updatedAt: new Date() };

      if (data.projectProfileId !== undefined) {
        setFields.projectProfileId = data.projectProfileId;
      }
      if (data.chainId !== undefined) {
        setFields.chainId = data.chainId;
      }
      if (data.contractAddress !== undefined) {
        setFields.contractAddress = data.contractAddress;
      }
      if (data.contractType !== undefined) {
        setFields.contractType = data.contractType as ContractTypeEnumValue;
      }
      if (data.verified !== undefined) {
        setFields.verified = data.verified;
      }
      if (data.verifiedAt !== undefined) {
        setFields.verifiedAt = data.verifiedAt;
      }

      const rows = await this.resolve(tx)
        .update(projectContracts)
        .set(setFields)
        .where(eq(projectContracts.id, id))
        .returning();

      const row = rows[0];
      return row ? toProjectContract(row) : null;
    } catch (error) {
      throw new Error(
        `Failed to update project contract "${id}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async deleteProjectContract(id: string, tx?: TransactionContext): Promise<boolean> {
    try {
      const rows = await this.resolve(tx)
        .delete(projectContracts)
        .where(eq(projectContracts.id, id))
        .returning();

      return rows.length > 0;
    } catch (error) {
      throw new Error(
        `Failed to delete project contract "${id}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

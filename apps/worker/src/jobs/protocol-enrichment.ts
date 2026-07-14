import type {
  ProtocolDefinition,
  ProtocolValidationResult,
  VersionedProtocolRegistry,
} from '@hood-sentry/chain';
import type { ProtocolRepository } from '@hood-sentry/db';

interface ProtocolValidationReader {
  getValidation(
    protocolKey: string,
    protocolVersion: string,
    chainId: number,
  ): Promise<ProtocolValidationResult>;
}

export interface ProtocolEnrichmentJobData {
  chainId: number;
  protocolKey: string;
  protocolVersion: string;
}

export class ProtocolEnrichmentJob {
  constructor(
    private readonly registry: VersionedProtocolRegistry,
    private readonly validation: ProtocolValidationReader,
    private readonly repository: Pick<ProtocolRepository, 'saveProtocolValidation'>,
  ) {}

  async run(data: ProtocolEnrichmentJobData): Promise<{ active: boolean; idempotencyKey: string }> {
    const definition = this.findDefinition(data);
    const result = await this.validation.getValidation(
      data.protocolKey,
      data.protocolVersion,
      data.chainId,
    );
    await this.repository.saveProtocolValidation(definition, result, this.registry.version);
    return {
      active: result.active,
      idempotencyKey: `${data.chainId}:${data.protocolKey}:${data.protocolVersion}:${result.checkedAt}`,
    };
  }

  private findDefinition(data: ProtocolEnrichmentJobData): ProtocolDefinition {
    const definition = this.registry.protocols.find(
      (candidate) =>
        candidate.chainId === data.chainId &&
        candidate.protocolKey === data.protocolKey &&
        candidate.protocolVersion === data.protocolVersion,
    );
    if (definition === undefined)
      throw new Error('Protocol enrichment received an unknown protocol');
    return definition;
  }
}

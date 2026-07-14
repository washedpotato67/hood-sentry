import { ProtocolAdapterManager } from './manager.js';
import type {
  ProtocolAdapter,
  ProtocolDefinition,
  ProtocolExecutionClient,
  ProtocolValidationResult,
  TransactionFeaturePolicy,
  VersionedProtocolRegistry,
} from './types.js';
import { UniswapV2Adapter } from './uniswap-v2.js';
import { type ProtocolValidationService, validateProtocolRegistry } from './validation.js';

export interface ProtocolAdapterFactory {
  protocolKey: string;
  protocolVersion: string;
  create(context: ProtocolAdapterFactoryContext): ProtocolAdapter;
}

export interface ProtocolAdapterFactoryContext {
  definition: ProtocolDefinition;
  client: ProtocolExecutionClient;
  validation: ProtocolValidationService;
  featurePolicy: TransactionFeaturePolicy;
}

export interface ProtocolAdapterRuntime {
  manager: ProtocolAdapterManager;
  validationResults: readonly ProtocolValidationResult[];
  initializationErrors: readonly string[];
}

const defaultFactories: readonly ProtocolAdapterFactory[] = [
  {
    protocolKey: 'uniswap',
    protocolVersion: 'v2',
    create: ({ definition, client, validation, featurePolicy }) =>
      new UniswapV2Adapter(definition, client, validation, featurePolicy),
  },
];

export async function createProtocolAdapterRuntime(request: {
  registry: VersionedProtocolRegistry;
  chainId: number;
  client: ProtocolExecutionClient;
  validation: ProtocolValidationService;
  featurePolicy: TransactionFeaturePolicy;
  factories?: readonly ProtocolAdapterFactory[];
}): Promise<ProtocolAdapterRuntime> {
  const registry = validateProtocolRegistry(request.registry);
  const validationResults = await request.validation.initialize();
  const adapters: ProtocolAdapter[] = [];
  const initializationErrors: string[] = [];
  const factories = request.factories ?? defaultFactories;

  for (const result of validationResults) {
    if (!result.active || result.chainId !== request.chainId) continue;
    const definition = registry.protocols.find(
      (candidate) =>
        candidate.protocolKey === result.protocolKey &&
        candidate.protocolVersion === result.protocolVersion &&
        candidate.chainId === result.chainId,
    );
    if (definition === undefined) continue;
    const factory = factories.find(
      (candidate) =>
        candidate.protocolKey === definition.protocolKey &&
        candidate.protocolVersion === definition.protocolVersion,
    );
    if (factory === undefined) {
      initializationErrors.push(
        `${definition.protocolKey} ${definition.protocolVersion} has no adapter implementation`,
      );
      continue;
    }
    try {
      adapters.push(
        factory.create({
          definition,
          client: request.client,
          validation: request.validation,
          featurePolicy: request.featurePolicy,
        }),
      );
    } catch (error) {
      initializationErrors.push(error instanceof Error ? error.message : String(error));
    }
  }

  return {
    manager: new ProtocolAdapterManager(adapters),
    validationResults,
    initializationErrors,
  };
}

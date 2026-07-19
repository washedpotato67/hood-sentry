import type { ProtocolReadClient } from '@hood-sentry/chain';
import { DrizzleTokenRepositoryImpl } from '@hood-sentry/db';
import type { DerivedJobPayload } from '@hood-sentry/queue';
import { erc20Abi, getAddress, isAddress } from 'viem';
import { z } from 'zod';
import type { ProcessorContext } from './types.js';

const metadataDataSchema = z.object({
  tokenAddress: z
    .string()
    .refine(isAddress, 'expected a 20-byte token address')
    .transform((value) => getAddress(value)),
});

const stringResultSchema = z.string().trim().min(1).max(256);
const decimalsResultSchema = z.number().int().min(0).max(255);
const totalSupplyResultSchema = z.bigint().nonnegative();

type MetadataField = 'name' | 'symbol' | 'decimals' | 'totalSupply';

async function readField(
  reader: Pick<ProtocolReadClient, 'readContract'>,
  address: `0x${string}`,
  blockNumber: bigint,
  field: MetadataField,
): Promise<unknown> {
  return reader.readContract({
    address,
    abi: erc20Abi,
    functionName: field,
    blockNumber,
  });
}

export async function processTokenMetadata(
  payload: DerivedJobPayload,
  context: Pick<ProcessorContext, 'database' | 'logger' | 'chainReader'>,
): Promise<void> {
  const data = metadataDataSchema.parse(payload.data);
  const chainId = z.coerce.number().int().positive().safe().parse(payload.chainId);
  const blockNumber = z.coerce.bigint().nonnegative().parse(payload.blockNumber);
  const identity = data.tokenAddress.toLowerCase();
  const repository = new DrizzleTokenRepositoryImpl(context.database.db);
  const existing = await repository.getToken(chainId, identity);

  // ERC-20 name/symbol/decimals cannot change, so re-reading them on every sighting
  // spends five RPC calls to learn nothing. Once they are known, refresh only
  // totalSupply, which does move with mints and burns and feeds supply-based risk.
  // This turns a token's repeat appearances from 5 calls into 1 — the difference
  // between fitting the provider's request budget and exhausting it.
  if (
    existing !== null &&
    existing.name !== null &&
    existing.symbol !== null &&
    existing.decimals !== null
  ) {
    const supplyResult = await Promise.allSettled([
      readField(context.chainReader, data.tokenAddress, blockNumber, 'totalSupply'),
    ]);
    const supply =
      supplyResult[0].status === 'fulfilled'
        ? totalSupplyResultSchema.safeParse(supplyResult[0].value)
        : null;

    await repository.upsertToken({
      chainId,
      address: identity,
      name: existing.name,
      symbol: existing.symbol,
      decimals: existing.decimals,
      totalSupplyRaw:
        supply?.success === true ? supply.data.toString() : (existing.totalSupplyRaw ?? null),
      tokenType: existing.tokenType ?? 'erc20',
      canonicalAssetKey: existing.canonicalAssetKey ?? null,
      logoUri: existing.logoUri ?? null,
      // A failed supply read leaves the three immutable fields intact, so the row
      // is 'partial' rather than 'complete' until supply is readable again.
      metadataStatus: supply?.success === true ? 'complete' : 'partial',
      spamStatus: existing.spamStatus ?? 'unknown',
      firstSeenBlock:
        existing.firstSeenBlock === null || existing.firstSeenBlock === undefined
          ? blockNumber
          : existing.firstSeenBlock < blockNumber
            ? existing.firstSeenBlock
            : blockNumber,
    });

    if (supply?.success !== true) {
      context.logger.warn('Token supply refresh failed for a token with cached metadata', {
        chainId,
        tokenAddress: data.tokenAddress,
        blockNumber: blockNumber.toString(),
      });
    }
    return;
  }

  const bytecode = await context.chainReader.getBytecode(data.tokenAddress, blockNumber);

  if (bytecode === undefined || bytecode === '0x') {
    if (existing !== null) {
      await repository.updateToken(chainId, identity, { metadataStatus: 'unavailable' });
    }
    context.logger.warn('Token metadata target has no runtime bytecode at the source block', {
      chainId,
      tokenAddress: data.tokenAddress,
      blockNumber: blockNumber.toString(),
    });
    return;
  }

  const [nameResult, symbolResult, decimalsResult, supplyResult] = await Promise.allSettled([
    readField(context.chainReader, data.tokenAddress, blockNumber, 'name'),
    readField(context.chainReader, data.tokenAddress, blockNumber, 'symbol'),
    readField(context.chainReader, data.tokenAddress, blockNumber, 'decimals'),
    readField(context.chainReader, data.tokenAddress, blockNumber, 'totalSupply'),
  ]);

  const name =
    nameResult.status === 'fulfilled' ? stringResultSchema.safeParse(nameResult.value) : null;
  const symbol =
    symbolResult.status === 'fulfilled' ? stringResultSchema.safeParse(symbolResult.value) : null;
  const decimals =
    decimalsResult.status === 'fulfilled'
      ? decimalsResultSchema.safeParse(decimalsResult.value)
      : null;
  const totalSupply =
    supplyResult.status === 'fulfilled'
      ? totalSupplyResultSchema.safeParse(supplyResult.value)
      : null;
  const successfulFields = [name, symbol, decimals, totalSupply].filter(
    (result) => result?.success === true,
  ).length;
  const metadataStatus =
    successfulFields === 4 ? 'complete' : successfulFields === 0 ? 'unavailable' : 'partial';

  await repository.upsertToken({
    chainId,
    address: identity,
    name: name?.success === true ? name.data : (existing?.name ?? null),
    symbol: symbol?.success === true ? symbol.data : (existing?.symbol ?? null),
    decimals: decimals?.success === true ? decimals.data : (existing?.decimals ?? null),
    totalSupplyRaw:
      totalSupply?.success === true
        ? totalSupply.data.toString()
        : (existing?.totalSupplyRaw ?? null),
    tokenType: existing?.tokenType ?? 'erc20',
    canonicalAssetKey: existing?.canonicalAssetKey ?? null,
    logoUri: existing?.logoUri ?? null,
    metadataStatus,
    spamStatus: existing?.spamStatus ?? 'unknown',
    firstSeenBlock:
      existing?.firstSeenBlock === null || existing?.firstSeenBlock === undefined
        ? blockNumber
        : existing.firstSeenBlock < blockNumber
          ? existing.firstSeenBlock
          : blockNumber,
  });

  if (metadataStatus !== 'complete') {
    context.logger.warn('Token metadata is incomplete at the source block', {
      chainId,
      tokenAddress: data.tokenAddress,
      blockNumber: blockNumber.toString(),
      metadataStatus,
      missingFields: [
        name?.success === true ? null : 'name',
        symbol?.success === true ? null : 'symbol',
        decimals?.success === true ? null : 'decimals',
        totalSupply?.success === true ? null : 'totalSupply',
      ].filter((field): field is string => field !== null),
    });
  }
}

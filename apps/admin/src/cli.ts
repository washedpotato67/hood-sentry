import { getEnv } from '@hood-sentry/config';
import { createDatabase, schema } from '@hood-sentry/db';
import { and, eq, isNull } from 'drizzle-orm';
import { getAddress } from 'viem';
import { z } from 'zod';

const roleSchema = z.enum(['super_admin', 'moderator', 'reviewer', 'analyst']);
const chainIdSchema = z.union([z.literal(4663), z.literal(46630)]);
const commandSchema = z.discriminatedUnion('command', [
  z.object({ command: z.literal('list') }),
  z.object({
    command: z.enum(['grant', 'revoke']),
    wallet: z.string().transform((value) => getAddress(value)),
    chainId: chainIdSchema,
    role: roleSchema,
  }),
]);

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

function parseCommand() {
  const command = process.argv[2];
  if (command === 'list') return commandSchema.parse({ command });
  return commandSchema.parse({
    command,
    wallet: argument('--wallet'),
    chainId: Number(argument('--chain-id')),
    role: argument('--role'),
  });
}

async function listRoles(database: ReturnType<typeof createDatabase>): Promise<void> {
  const roles = await database.db
    .select({
      roleId: schema.adminRoles.id,
      userId: schema.adminRoles.userId,
      role: schema.adminRoles.roleName,
      grantedAt: schema.adminRoles.grantedAt,
      wallet: schema.userWallets.address,
      chainId: schema.userWallets.chainId,
    })
    .from(schema.adminRoles)
    .innerJoin(schema.userWallets, eq(schema.adminRoles.userId, schema.userWallets.userId))
    .where(and(isNull(schema.adminRoles.revokedAt), isNull(schema.userWallets.deletedAt)));
  process.stdout.write(`${JSON.stringify(roles, null, 2)}\n`);
}

async function findUser(
  database: ReturnType<typeof createDatabase>,
  wallet: `0x${string}`,
  chainId: 4663 | 46630,
) {
  const rows = await database.db
    .select({ userId: schema.userWallets.userId })
    .from(schema.userWallets)
    .where(
      and(
        eq(schema.userWallets.address, wallet.toLowerCase()),
        eq(schema.userWallets.chainId, chainId),
        isNull(schema.userWallets.deletedAt),
      ),
    )
    .limit(1);
  const user = rows[0];
  if (user === undefined) {
    throw new Error('The wallet must complete SIWE sign-in before an admin role is assigned.');
  }
  return user;
}

async function grantRole(
  database: ReturnType<typeof createDatabase>,
  input: { wallet: `0x${string}`; chainId: 4663 | 46630; role: z.infer<typeof roleSchema> },
): Promise<void> {
  const user = await findUser(database, input.wallet, input.chainId);
  const result = await database.db.transaction(async (transaction) => {
    const active = await transaction
      .select({ id: schema.adminRoles.id })
      .from(schema.adminRoles)
      .where(
        and(
          eq(schema.adminRoles.userId, user.userId),
          eq(schema.adminRoles.roleName, input.role),
          isNull(schema.adminRoles.revokedAt),
        ),
      )
      .limit(1);
    if (active[0] !== undefined) return { id: active[0].id, changed: false };
    const inserted = await transaction
      .insert(schema.adminRoles)
      .values({ userId: user.userId, roleName: input.role, grantedBy: user.userId })
      .returning({ id: schema.adminRoles.id });
    const role = inserted[0];
    if (role === undefined) throw new Error('Admin role insert returned no row.');
    await transaction.insert(schema.adminAuditLogs).values({
      adminUserId: user.userId,
      actionType: 'create',
      targetType: 'admin_role',
      targetId: role.id,
      changes: {
        source: 'database_bootstrap_cli',
        role: input.role,
        wallet: input.wallet,
        chainId: input.chainId,
      },
      ipAddress: null,
      userAgent: 'hood-sentry-admin-cli',
    });
    return { id: role.id, changed: true };
  });
  process.stdout.write(
    `${JSON.stringify({ action: 'grant', roleId: result.id, changed: result.changed })}\n`,
  );
}

async function revokeRole(
  database: ReturnType<typeof createDatabase>,
  input: { wallet: `0x${string}`; chainId: 4663 | 46630; role: z.infer<typeof roleSchema> },
): Promise<void> {
  const user = await findUser(database, input.wallet, input.chainId);
  const result = await database.db.transaction(async (transaction) => {
    const revoked = await transaction
      .update(schema.adminRoles)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(schema.adminRoles.userId, user.userId),
          eq(schema.adminRoles.roleName, input.role),
          isNull(schema.adminRoles.revokedAt),
        ),
      )
      .returning({ id: schema.adminRoles.id });
    const role = revoked[0];
    if (role === undefined) return { id: null, changed: false };
    await transaction.insert(schema.adminAuditLogs).values({
      adminUserId: user.userId,
      actionType: 'revoke',
      targetType: 'admin_role',
      targetId: role.id,
      changes: {
        source: 'database_bootstrap_cli',
        role: input.role,
        wallet: input.wallet,
        chainId: input.chainId,
      },
      ipAddress: null,
      userAgent: 'hood-sentry-admin-cli',
    });
    return { id: role.id, changed: true };
  });
  process.stdout.write(
    `${JSON.stringify({ action: 'revoke', roleId: result.id, changed: result.changed })}\n`,
  );
}

async function main(): Promise<void> {
  const input = parseCommand();
  const database = createDatabase(getEnv().DATABASE_URL);
  try {
    if (input.command === 'list') await listRoles(database);
    else if (input.command === 'grant') await grantRole(database, input);
    else await revokeRole(database, input);
  } finally {
    await database.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Admin command failed.'}\n`);
  process.exitCode = 1;
});

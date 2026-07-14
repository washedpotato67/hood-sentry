export class ProtocolAdapterError extends Error {}

export class UnverifiedProtocolContractError extends ProtocolAdapterError {
  constructor(message: string) {
    super(message);
    this.name = 'UnverifiedProtocolContractError';
  }
}

export class UnsupportedFeeTierError extends ProtocolAdapterError {
  constructor(protocol: string, version: string, fee: bigint) {
    super(`${protocol} ${version} does not support fee tier ${fee.toString()}`);
    this.name = 'UnsupportedFeeTierError';
  }
}

export class UnknownProtocolError extends ProtocolAdapterError {
  constructor(protocolKey: string) {
    super(`No active adapter exists for protocol ${protocolKey}`);
    this.name = 'UnknownProtocolError';
  }
}

export class UnknownFactoryError extends ProtocolAdapterError {
  constructor(address: string) {
    super(`No active protocol adapter owns factory ${address}`);
    this.name = 'UnknownFactoryError';
  }
}

export class UnknownPoolError extends ProtocolAdapterError {
  constructor(address: string) {
    super(`No active protocol adapter owns pool ${address}`);
    this.name = 'UnknownPoolError';
  }
}

export class DuplicateProtocolEventError extends ProtocolAdapterError {
  constructor(kind: string, transactionHash: string, logIndex: number) {
    super(`Duplicate ${kind} event ${transactionHash}:${logIndex}`);
    this.name = 'DuplicateProtocolEventError';
  }
}

export class DuplicatePoolEventError extends DuplicateProtocolEventError {
  constructor(transactionHash: string, logIndex: number) {
    super('pool creation', transactionHash, logIndex);
    this.name = 'DuplicatePoolEventError';
  }
}

export class MalformedProtocolLogError extends ProtocolAdapterError {
  constructor(message: string) {
    super(message);
    this.name = 'MalformedProtocolLogError';
  }
}

export class QuoteValidationError extends ProtocolAdapterError {
  constructor(message: string) {
    super(message);
    this.name = 'QuoteValidationError';
  }
}

export class TransactionPreparationError extends ProtocolAdapterError {
  constructor(message: string) {
    super(message);
    this.name = 'TransactionPreparationError';
  }
}

export class ProtocolAdapterError extends Error {}

export class UnverifiedProtocolContractError extends ProtocolAdapterError {
  constructor(message: string) {
    super(message);
    this.name = 'UnverifiedProtocolContractError';
  }
}

export class UnsupportedFeeTierError extends ProtocolAdapterError {
  constructor(protocol: string, version: string, fee: number) {
    super(`${protocol} ${version} does not support fee tier ${fee}`);
    this.name = 'UnsupportedFeeTierError';
  }
}

export class UnknownFactoryError extends ProtocolAdapterError {
  constructor(address: string) {
    super(`No verified protocol adapter owns factory ${address}`);
    this.name = 'UnknownFactoryError';
  }
}

export class UnknownPoolError extends ProtocolAdapterError {
  constructor(address: string) {
    super(`No verified protocol adapter owns pool ${address}`);
    this.name = 'UnknownPoolError';
  }
}

export class DuplicatePoolEventError extends ProtocolAdapterError {
  constructor(address: string) {
    super(`Pool creation event already processed for ${address}`);
    this.name = 'DuplicatePoolEventError';
  }
}

export class MalformedProtocolLogError extends ProtocolAdapterError {
  constructor(message: string) {
    super(message);
    this.name = 'MalformedProtocolLogError';
  }
}

export interface VaultEntry {
  id: string;
  title: string;
  username: string;
  password: string;
  url: string;
  notes: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface PlainVault {
  schemaVersion: 1;
  createdAt: string;
  updatedAt: string;
  entries: VaultEntry[];
}

export interface VaultSummary {
  entryCount: number;
  updatedAt: string;
}

export interface WebDavConfig {
  baseUrl: string;
  username: string;
  password: string;
  vaultPath: string;
}

export interface KdfParams {
  name: "PBKDF2";
  hash: "SHA-256";
  iterations: number;
  salt: string;
}

export interface WrappedVaultKey {
  algorithm: "AES-GCM";
  iv: string;
  wrappedKey: string;
}

export interface EncryptedVaultData {
  algorithm: "AES-GCM";
  iv: string;
  ciphertext: string;
}

export interface EncryptedVaultFile {
  schemaVersion: 1;
  createdAt: string;
  updatedAt: string;
  kdf: KdfParams;
  wrappedVaultKey: WrappedVaultKey;
  vault: EncryptedVaultData;
}

export interface VaultState {
  file: EncryptedVaultFile;
  vault: PlainVault;
}


# Cryptography Specification

**Document:** `architecture/18-cryptography.md`

**Status:** Draft

**Owner:** Engineering

**Depends On:**

- architecture/03-zero-knowledge.md
- architecture/04-security-model.md
- architecture/14-trust-and-device-management.md
- architecture/16-archive-protocol.md

---

# Purpose

This document specifies the cryptographic architecture used throughout Archive Platform.

The goal is to protect Vault contents while allowing an untrusted Coordination Server to synchronize encrypted data.

This document defines cryptographic responsibilities and key relationships.

It intentionally does not prescribe specific algorithms for the MVP. Algorithm choices are defined separately to allow future upgrades without changing the architecture.

---

# Design Goals

The cryptographic architecture must provide:

- zero-knowledge storage
- authenticated encryption
- forward migration
- key rotation
- device enrollment
- algorithm agility
- deterministic key derivation where appropriate

---

# Philosophy

The client owns plaintext.

The server owns ciphertext.

Encryption occurs before synchronization.

Decryption occurs only on trusted devices.

---

# Trust Boundary

```
Plaintext

↓

Client Runtime

↓

Encryption Boundary

↓

Ciphertext

↓

Coordination Server

↓

Object Storage
```

Plaintext never crosses the encryption boundary.

---

# Key Hierarchy

```
Master Secret

↓

Vault Root Key

├── Bundle Key
├── Event Key
├── Artifact Key
├── Metadata Key
└── Future Keys
```

Keys should be derived rather than randomly generated independently where appropriate.

---

# Key Responsibilities

## Master Secret

Used only to derive or protect Vault-level secrets.

Never used directly for encrypting application data.

---

## Vault Root Key

Root of the Vault's cryptographic hierarchy.

Used to derive subordinate keys.

---

## Bundle Key

Protects immutable Bundle contents.

---

## Event Key

Protects encrypted Event payloads.

---

## Artifact Key

Protects derived Artifacts.

---

## Metadata Key

Protects synchronized encrypted metadata.

---

# Device Keys

Each trusted device possesses:

- Device Private Key
- Device Public Key

Private keys remain on the device.

Public keys are synchronized.

---

# Wrapped Keys

Vault keys are wrapped individually for each trusted device.

```
Vault Root Key

↓

Encrypt for Device A

Encrypt for Device B

Encrypt for Device C
```

The Coordination Server stores wrapped keys only.

The initial Chrome Host uses a non-exportable Web Crypto device key to wrap the Vault Root Key locally. It may also create a passphrase-derived wrapper during onboarding. These are multiple wrappers for the same Vault Root Key.

Bundle, Event, and Projection keys are context-derived and are not stored as individually wrapped keys in the initial implementation.

---

# Encryption Pipeline

```
Bundle

↓

Serialize

↓

Compress

↓

Encrypt

↓

Store
```

Encryption precedes synchronization.

Compression precedes encryption.

---

# Event Encryption

Only Event payloads require confidentiality.

Routing information required for synchronization may remain unencrypted if necessary.

Sensitive metadata should remain encrypted whenever practical.

---

# Artifact Encryption

Artifacts follow the same lifecycle as Bundles.

Artifacts remain immutable.

Artifacts are encrypted before storage.

---

# Metadata Protection

User-visible synchronized metadata should be encrypted.

Examples include:

- archive titles
- notes
- tags
- AI summaries (if synchronized)

Operational metadata required for coordination may remain plaintext.

Examples include:

- protocol version
- block identifiers
- timestamps required for synchronization
- device identifiers

---

# Authentication

Every encrypted object should provide integrity protection.

Tampered ciphertext must be detected before use.

---

# Key Rotation

The platform supports independent rotation of:

- Vault Root Key
- Device Keys

Future versions may support independent rotation of subordinate keys.

Rotation procedures should minimize unnecessary data re-encryption.

---

# Algorithm Agility

Cryptographic algorithms must be versioned.

Encrypted objects should record:

- algorithm identifier
- key version
- object format version

This enables future migration without ambiguity.

---

# Randomness

All cryptographic randomness must originate from the host platform's cryptographically secure random number generator.

---

# Secure Storage

Long-lived secrets should use platform secure storage where available.

Examples:

- WebCrypto non-exportable keys
- macOS Keychain
- Windows DPAPI / Credential Manager
- Linux Secret Service

Fallback storage should be clearly identified.

---

# Synchronization

The Coordination Server stores only:

- ciphertext
- wrapped keys
- encrypted Event payloads
- encrypted Blocks

The server never derives plaintext.

---

# Cryptographic Versioning

Every encrypted object records:

- format version
- key version
- algorithm version

Older objects remain readable while migration is in progress.

---

# Future Extensions

The architecture should support:

- post-quantum migration
- hardware-backed keys
- threshold recovery
- shared Vaults
- delegated decryption
- tenant-managed keys

These should not require redesigning the key hierarchy.

---

# Design Decisions

## Why a Key Hierarchy?

Derived keys isolate cryptographic domains and simplify future rotation.

---

## Why Wrapped Keys?

Each trusted device receives independent access without exposing the Vault Root Key to the server.

---

## Why Algorithm Agility?

Cryptographic algorithms evolve. Object formats should accommodate future replacement.

---

## Why Encrypt Before Synchronization?

The server should never observe plaintext application data.

---

# Open Questions

Should Metadata Keys be derived directly from the Vault Root Key or through an intermediate key hierarchy?

Should Vault Root Key rotation be automatic after device revocation?

How should long-running migrations be coordinated across multiple devices?

How should shared Vaults derive participant-specific keys?

---

# References

- `docs/architecture/19-testing-strategy.md`
- `docs/specifications/bundle/bundle.md`
- `docs/specifications/event/event.md`
- `docs/specifications/protocol/protocol.md`

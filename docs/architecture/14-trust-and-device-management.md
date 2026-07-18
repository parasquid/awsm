# Trust & Device Management

**Document:** `architecture/14-trust-and-device-management.md`

**Status:** Draft

**Owner:** Engineering

**Depends On:**

- architecture/03-zero-knowledge.md
- architecture/04-security-model.md
- architecture/08-synchronization.md

---

# Purpose

This document defines how devices are trusted, authorized, and revoked within Archive Platform.

The platform follows a zero-knowledge model.

The Coordination Server authenticates devices but cannot decrypt Vault contents.

---

# Design Goals

The trust model must provide:

- secure device enrollment
- secure key distribution
- device revocation
- device auditing
- offline operation after enrollment
- extensibility for future enterprise features

---

# Philosophy

A Vault belongs to a user.

Access to a Vault is granted through trusted devices.

Trust is established cryptographically rather than by server-side access to plaintext data.

---

# Domain Model

```
Vault

↓

Trusted Devices

↓

Wrapped Vault Root Keys

↓

Events
```

The Vault owns the encryption keys.

Devices receive wrapped copies.

---

# Device Identity

Every device has a stable identity.

Properties include:

- Device ID
- Public Key
- Device Name
- Device Type
- Platform
- Client Version
- First Enrollment Time
- Last Seen Time

Private keys never leave the device.

---

# Device States

Devices may exist in one of the following states:

Pending

Trusted

Revoked

Expired (future)

Disabled (future)

Only Trusted devices may decrypt Vault contents.

---

# Enrollment

Enrollment establishes trust.

Typical flow:

```
New Device

↓

Generate Key Pair

↓

Authenticate User

↓

Existing Trusted Device Approves

↓

Wrap Vault Root Key

↓

Upload Wrapped Key

↓

Synchronization Begins
```

The Coordination Server never receives plaintext Vault Root Keys.

---

# Approval Methods

Possible enrollment methods include:

- QR code
- One-time pairing code
- Local network discovery (future)
- Hardware security key (future)
- Enterprise administrator approval (future)

The enrollment protocol should be transport-independent.

---

# Wrapped Vault Root Keys

Each trusted device receives its own encrypted copy of the Vault Root Key.

```
Vault Root Key

↓

Encrypt For Device A

Encrypt For Device B

Encrypt For Device C
```

Compromise of one wrapped key does not affect others.

---

# Device Revocation

Revocation removes trust.

```
Revoke Device

↓

Remove Wrapped Vault Root Key

↓

Append DeviceRevokedEvent
```

Future policy may also trigger Vault Root Key rotation.

---

# Key Rotation

The platform supports Vault Root Key rotation.

Typical sequence:

```
Generate New Vault Root Key

↓

Re-encrypt Active Data Key Material

↓

Wrap New Vault Root Key For Trusted Devices

↓

Invalidate Old Wrapped Keys
```

Rotation should minimize disruption to active devices.

---

# Device Capabilities

The model supports future capability restrictions.

Examples:

- Read-only
- Capture disabled
- Processing disabled
- Synchronization disabled
- Administrative

The MVP grants identical capabilities to all trusted devices.

---

# Device Audit Log

The Event Log records trust-related actions.

Examples:

DeviceEnrolledEvent

DeviceRevokedEvent

VaultKeyRotatedEvent

TrustEstablishedEvent

These Events synchronize like any other Vault Event.

---

# Lost Device Recovery

If a trusted device is lost:

1. Revoke the device.
2. Optionally rotate the Vault Root Key.
3. Continue synchronization with remaining trusted devices.

The lost device cannot receive future wrapped keys.

---

# Offline Behavior

Once enrolled, a device may operate offline indefinitely.

Synchronization resumes when connectivity returns.

Enrollment of a new device requires communication with an already trusted device or another approved recovery mechanism.

---

# Server Responsibilities

The Coordination Server stores:

- Device metadata
- Public keys
- Wrapped Vault Root Keys
- Enrollment status
- Trust Events

The server cannot decrypt Vault data.

---

# Client Responsibilities

The Client Runtime:

- Generates device keys.
- Stores private keys securely.
- Requests enrollment.
- Verifies trust.
- Wraps and unwraps Vault Root Keys.
- Applies trust-related Events.

---

# Security Considerations

Private keys should use platform secure storage where available.

Examples:

- WebCrypto non-exportable keys
- macOS Keychain
- Windows Credential Manager / DPAPI
- Linux Secret Service (where available)

Fallback mechanisms must be clearly identified to users.

---

# Future Extensions

Potential enhancements include:

- Multiple users per Vault
- Shared Vaults
- Organization-managed Vaults
- Hardware-backed attestation
- Threshold recovery
- Emergency access
- Device health checks

These should extend the trust model without changing the core synchronization architecture.

---

# Design Decisions

## Why Device Keys?

Each device has an independent cryptographic identity, enabling selective trust and revocation.

---

## Why Wrapped Vault Root Keys?

The Vault Root Key remains the root secret while allowing each trusted device to access it independently.

---

## Why Events?

Trust changes are part of Vault history and should be synchronized like all other authoritative state.

---

## Why Transport-Independent Enrollment?

The trust model should support browsers, desktop applications, and future mobile clients without redesign.

---

# Open Questions

Should a Vault require multiple trusted devices before enabling recovery?

Should Vault Root Key rotation be automatic after revocation or user-configurable?

Should inactive devices expire automatically after a configurable period?

How should enterprise policy integrate with personal Vaults?

---

# References

- `docs/architecture/15-coordination-server.md`
- `docs/architecture/16-archive-protocol.md`
- `docs/architecture/18-cryptography.md`

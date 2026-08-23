# Ring Auditor

A small Next.js page that reads a custom ring through its Ring RPC, which
accepts a read from the ring authority or a granted reader, signed over the
request, and shows a participant its own view from a local wallet sync.

| Read as | Key | Sees |
| --- | --- | --- |
| Ring auditor | the connected wallet, the ring's authority or a reader it granted | every transaction of the ring |
| Ring auditor, passkey | a passkey (Touch ID, YubiKey) the authority granted | every transaction of the ring |
| Participant | the shielded keys derived from the connected wallet, no RPC call | the outputs it received and the transfers it sent, from its local wallet sync |

The page reads the ring config and the wallet's reader record from the Solana
RPC and shows the wallet's role (authority, delegated reader, participant only)
before it signs anything.

The wire work lives in `@heliuslabs/zolana/ring` (`RingRpc`, the attestation
layout, the P-256 reader). `lib/signers.ts` adapts the browser wallet to the
SDK's `RingReadSigner`. `lib/shielded.tsx` derives the wallet's shielded keys
with one `signMessage` over the bare derivation payload `TSPP/derive/v1`
(browser wallets refuse the off-chain envelope). The keys live in page state only.

On the first visit, with no ring stored in the browser, a wizard asks for the
first ring's name and program id and, below the form, shows how to generate a
ring: clone the Zolana checkout, `just ring-new`, then `just devnet` and
`just pipeline` in the generated ring, which prints the program id to paste.

The Ring card lists named rings, `+` adds one (name and program id),
`×` removes the selected one, and shows the wallet's balance
on the ring with **Deposit** (shield SOL from the wallet), **Transfer** (an
audited transfer inside the ring, the recipient is asked in a modal, a shielded
address as shown under the balance, or the Solana address of a registered user)
and **Burn** (the same transfer to a key nobody holds), each one wallet
signature. Failures show as toasts. The wallet's shielded keys are derived once per connection from its
signature over `TSPP/derive/v1` and reused by every action and the Participant
view. The ring's lookup table is created with the wallet on the first transfer
or burn and remembered per ring.
Service URLs are deployment settings in `.env.local` (see `.env.example`), the
same for every ring the page lists.

## Delegating reads

The authority grants ring reads to another key on chain, so the authority
key never has to sign in a browser and a Squads-held authority can grant by
proposal. Either from the ring repository, with a base58 wallet key or the hex
key of a passkey:

```bash
just grant-reader <key>
just revoke-reader <key>
```

or from the page: connect the authority wallet and the Passkeys card shows
Grant and Revoke for every listed key, plus a field for a key pasted from
another machine.

## Passkeys

1. Auditor: Passkeys card, "Create passkey". The browser offers Touch ID or a
   security key. The page keeps the credential id and the public key, nothing
   secret, and shows the key.
2. Authority: grant the key, from the page or the CLI.
3. Auditor: "Ring auditor", sign with the passkey, touch. Every read is one
   gesture, the signature covers the page it requests.
4. Authority: revoke. The next read fails with `unauthorized`.

A passkey signs through WebAuthn, so the ring RPC checks the page's origin
against `RING_RPC_ALLOW_ORIGINS`, the same list that allows the browser to call
it. An RPC without that list accepts no passkey. Safari, Chrome and Brave share
the flow; the YubiKey needs a PIN or touch set up for user verification.

## Run

The Ring RPC must allow the browser origin. In the ring repository:

```bash
RING_RPC_ALLOW_ORIGINS=http://localhost:3000 just rpc
```

Then:

```bash
pnpm install
pnpm dev
```

Copy `.env.example` to `.env.local` and set the ring, then open
<http://localhost:3000>, connect a wallet, pick a mode and sign. The page signs again for every page of
results, because the cursor and the time are part of the signed bytes.

## From the command line

The same request from a Solana keypair file, useful to check an RPC without a
wallet:

```bash
pnpm read --ring <program id> --keypair ~/.config/solana/id.json
```

## Wire format

The request layout and the signed attestation are documented on
`ringReadAttestation` in `@heliuslabs/zolana/ring`, whose bytes are pinned
against the Rust server by the SDK's tests. The page signs again for every
request because the cursor and the time are both part of the signature.

The SDK is consumed as a `link:` dependency on the `zolana-ts-rings` checkout next to
this repository, `build:ts` there refreshes it.

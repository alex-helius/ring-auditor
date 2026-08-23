# Showcase

Devnet ring `4629XhR1jRFZVck1Ss7y1KtTqLHfmhnuomBhmTGh2RYP`, repo `~/rings/demo`.
Authority `2GNuM5ksdfNxGNbwf2hrnND9FHgQsdju7vz8CyGd7Zjy` (`~/.config/solana/id.json`).

## Before

```bash
cd ~/rings/demo && RING_RPC_ALLOW_ORIGINS=http://localhost:3000 just rpc   # ring RPC on :9485
cd ~/Projects/Helius/dev/ring-auditor && pnpm dev                          # page on :3000
```

Add the ring on the page: `+`, name "Rings.fun", program id above. The ring RPC
comes from `.env.local`, `http://127.0.0.1:9485` here. Phantom on devnet.

## 0. Something to read

Connect any wallet with devnet SOL. **Refresh** derives the wallet's shielded
keys (one signature, once per session) and shows its balance on the ring.
**Deposit** shields SOL (one signature), **Transfer** moves it inside the ring
to a registered recipient and **Burn** to a key nobody holds, each with an audit
proof from the prover (one signature, about twenty seconds).

## 1. Auditor, wallet

Connect the authority wallet, "Ring auditor", Sign and read. Badge says
"authority", every transaction renders. Sign again for "Older".

## 2. Auditor, passkey

Passkeys card, label, Create passkey. Pick Touch ID or the YubiKey in the
browser sheet. Badge "participant only". **Request grant** opens the text to
send the operator (key and command).

Grant it, either way:

- page: the authority wallet is connected, click Grant next to the key (or
  paste a visitor's key into the field)
- terminal: `cd ~/rings/demo && just grant-reader <hex>`

Badge flips to "delegated reader". "Ring auditor", sign with `passkey · <label>`,
Sign and read, touch. Same ring page, the wallet signs nothing.

## 3. Revoke

Revoke on the page or `just revoke-reader <hex>`. Sign and read again:
`unauthorized: reader is not the ring authority or a granted reader`.

## 4. Participant

"Participant", Sync and read. No RPC call, one wallet prompt for the derivation
text `TSPP/derive/v1` unless the session already has it. "Sent" lists the
wallet's outbound transfers, "Received" its notes, from its local wallet sync.

## Client test

Same page, their wallet: step 4 works for anyone. For step 2 they send the
passkey hex, you grant it.
